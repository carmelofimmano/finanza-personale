import { db, type Account, type Frequency, type Kind, type Plan, type PlanFrequency, type Recurring, type Rule, type Scheduled, type Transaction } from './db';
import { addDays, daysInMonth, monthKey, today } from './dates';

export function accountBalances(accounts: Account[], txs: Transaction[]): Map<number, number> {
  const balances = new Map<number, number>();
  for (const a of accounts) balances.set(a.id!, a.initial);
  const add = (id: number | undefined, delta: number) => {
    if (id !== undefined && balances.has(id)) balances.set(id, balances.get(id)! + delta);
  };
  for (const t of txs) {
    if (t.type === 'income') add(t.accountId, t.amount);
    else if (t.type === 'expense') add(t.accountId, -t.amount);
    else {
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.toAmount ?? t.amount);
    }
  }
  return balances;
}

/** Normalizza una descrizione per confrontarla con le regole: minuscolo, senza numeri e punteggiatura. */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s&']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La regola più specifica (pattern più lungo) le cui parole compaiono intere nella descrizione. */
export function matchRule(desc: string, rules: Rule[]): Rule | undefined {
  const norm = normalizeDescription(desc);
  if (!norm) return undefined;
  const padded = ` ${norm} `;
  let best: Rule | undefined;
  for (const r of rules) {
    if (r.pattern && padded.includes(` ${r.pattern} `) && (!best || r.pattern.length > best.pattern.length)) best = r;
  }
  return best;
}

export async function suggestCategory(desc: string): Promise<number | undefined> {
  const rule = matchRule(desc, await db.rules.toArray());
  return rule?.categoryId;
}

/**
 * Memorizza l'associazione descrizione → categoria scelta dall'utente,
 * così la prossima volta la categoria viene proposta da sola.
 */
export async function learnRule(desc: string, categoryId: number) {
  const pattern = normalizeDescription(desc);
  if (pattern.length < 3) return;
  const rules = await db.rules.toArray();
  const current = matchRule(desc, rules);
  if (current?.categoryId === categoryId) return;
  const same = rules.find((r) => r.pattern === pattern);
  if (same) await db.rules.update(same.id!, { categoryId });
  else await db.rules.add({ pattern, categoryId });
}

/** Assegna la categoria ai movimenti che ne sono privi, usando le regole. Restituisce quanti ne ha aggiornati. */
export async function applyRulesToUncategorized(): Promise<number> {
  const rules = await db.rules.toArray();
  const categories = new Map((await db.categories.toArray()).map((c) => [c.id!, c]));
  const txs = await db.transactions.filter((t) => t.type !== 'transfer' && t.categoryId === undefined).toArray();
  let count = 0;
  for (const t of txs) {
    const rule = matchRule(t.description, rules);
    if (rule && categories.get(rule.categoryId)?.kind === t.type) {
      await db.transactions.update(t.id!, { categoryId: rule.categoryId });
      count++;
    }
  }
  return count;
}

export function nextOccurrence(date: string, frequency: Frequency, day: number): string {
  if (frequency === 'weekly') return addDays(date, 7);
  let [y, m] = date.split('-').map(Number);
  if (frequency === 'monthly') {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  } else {
    y += 1;
  }
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function recurringToTransaction(r: Recurring, date: string): Transaction {
  return {
    date,
    amount: r.amount,
    type: r.type,
    accountId: r.accountId,
    categoryId: r.categoryId,
    description: r.description,
    tags: [],
    recurringId: r.id,
    createdAt: Date.now(),
  };
}

function scheduledToTransaction(s: Scheduled, date = s.date): Transaction {
  return {
    date,
    amount: s.amount,
    type: s.type,
    accountId: s.accountId,
    categoryId: s.categoryId,
    description: s.description,
    note: s.note,
    tags: s.planId ? ['rate'] : [],
    scheduledId: s.id,
    createdAt: Date.now(),
  };
}

/** Registra le ricorrenze automatiche scadute fino a oggi. */
async function processRecurring(): Promise<number> {
  const t = today();
  let created = 0;
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    const due = await db.recurring.where('nextDate').belowOrEqual(t).toArray();
    for (const r of due) {
      if (!r.active || !r.autoCreate) continue;
      let next = r.nextDate;
      for (let guard = 0; next <= t && guard < 1000; guard++) {
        await db.transactions.add(recurringToTransaction(r, next));
        created++;
        next = nextOccurrence(next, r.frequency, r.day);
      }
      await db.recurring.update(r.id!, { nextDate: next });
    }
  });
  return created;
}

/** Registra i pagamenti singoli e le rate automatiche scaduti fino a oggi. */
async function processScheduled(): Promise<number> {
  let created = 0;
  await db.transaction('rw', db.scheduled, db.transactions, async () => {
    const due = await db.scheduled.where('date').belowOrEqual(today()).filter((s) => s.autoCreate && !s.doneTxId).toArray();
    for (const s of due) {
      const txId = await db.transactions.add(scheduledToTransaction(s));
      await db.scheduled.update(s.id!, { doneTxId: txId });
      created++;
    }
  });
  return created;
}

let running: Promise<number> | null = null;

/** Registra tutto ciò che è scaduto. Chiamate sovrapposte condividono la stessa esecuzione. */
export function processDue(): Promise<number> {
  running ??= (async () => {
    try {
      return (await processRecurring()) + (await processScheduled());
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Registra subito la prossima occorrenza di un promemoria e passa alla successiva. */
export async function confirmRecurring(r: Recurring) {
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    await db.transactions.add(recurringToTransaction(r, r.nextDate));
    await db.recurring.update(r.id!, { nextDate: nextOccurrence(r.nextDate, r.frequency, r.day) });
  });
}

/** Segna come pagato un pagamento pianificato, alla data prevista o a quella indicata. */
export async function confirmScheduled(s: Scheduled, date = s.date) {
  await db.transaction('rw', db.scheduled, db.transactions, async () => {
    const fresh = await db.scheduled.get(s.id!);
    if (!fresh || fresh.doneTxId) return;
    const txId = await db.transactions.add(scheduledToTransaction(fresh, date));
    await db.scheduled.update(s.id!, { doneTxId: txId });
  });
}

export function upcomingOccurrences(list: Recurring[], days: number): { recurring: Recurring; date: string }[] {
  const end = addDays(today(), days);
  const out: { recurring: Recurring; date: string }[] = [];
  for (const r of list) {
    if (!r.active) continue;
    let d = r.nextDate;
    for (let guard = 0; d <= end && guard < 60; guard++) {
      out.push({ recurring: r, date: d });
      d = nextOccurrence(d, r.frequency, r.day);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface UpcomingItem {
  key: string;
  date: string;
  description: string;
  amount: number;
  type: Kind;
  accountId: number;
  categoryId?: number;
  auto: boolean;
  /** Solo la prima occorrenza di un promemoria si può confermare */
  confirmable: boolean;
  recurring?: Recurring;
  scheduled?: Scheduled;
}

/** Scadenze dei prossimi `days` giorni (più i promemoria già scaduti), da ricorrenze, una tantum e rate. */
export function upcomingAll(recurring: Recurring[], scheduled: Scheduled[], days: number): UpcomingItem[] {
  const end = addDays(today(), days);
  const items: UpcomingItem[] = upcomingOccurrences(recurring, days).map(({ recurring: r, date }) => ({
    key: `r${r.id}-${date}`,
    date,
    description: r.description,
    amount: r.amount,
    type: r.type,
    accountId: r.accountId,
    categoryId: r.categoryId,
    auto: r.autoCreate,
    confirmable: !r.autoCreate && date === r.nextDate,
    recurring: r,
  }));
  for (const s of scheduled) {
    if (s.doneTxId || s.date > end) continue;
    items.push({
      key: `s${s.id}`,
      date: s.date,
      description: s.description,
      amount: s.amount,
      type: s.type,
      accountId: s.accountId,
      categoryId: s.categoryId,
      auto: s.autoCreate,
      confirmable: !s.autoCreate,
      scheduled: s,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export interface ForecastPoint {
  date: string;
  balance: number;
}

/** Saldo previsto giorno per giorno sui conti in EUR, a partire da oggi. */
export function forecast(start: number, items: UpcomingItem[], eurAccounts: Set<number>, days: number) {
  const t = today();
  const deltas = new Map<string, number>();
  for (const i of items) {
    if (!eurAccounts.has(i.accountId)) continue;
    const date = i.date < t ? t : i.date;
    deltas.set(date, (deltas.get(date) ?? 0) + (i.type === 'income' ? i.amount : -i.amount));
  }
  const points: ForecastPoint[] = [];
  let balance = start;
  let min: ForecastPoint = { date: t, balance: start };
  for (let i = 0; i <= days; i++) {
    const date = addDays(t, i);
    balance += deltas.get(date) ?? 0;
    points.push({ date, balance });
    if (balance < min.balance) min = { date, balance };
  }
  return { points, min, end: balance };
}

/** Divide il totale in rate intere; i centesimi che avanzano vanno sulla prima. */
export function splitInstallments(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? total - base * n : 0));
}

export function installmentDates(first: string, count: number, frequency: PlanFrequency): string[] {
  const day = Number(first.slice(8, 10));
  const dates = [first];
  for (let i = 1; i < count; i++) {
    const prev = dates[i - 1];
    dates.push(
      frequency === 'weekly' ? addDays(prev, 7)
      : frequency === 'biweekly' ? addDays(prev, 14)
      : frequency === 'days30' ? addDays(prev, 30)
      : nextOccurrence(prev, 'monthly', day),
    );
  }
  return dates;
}

export async function createPlan(input: Omit<Plan, 'id' | 'createdAt'>): Promise<number> {
  const amounts = splitInstallments(input.total, input.count);
  const dates = installmentDates(input.firstDate, input.count, input.frequency);
  const id = await db.transaction('rw', db.plans, db.scheduled, async () => {
    const planId = await db.plans.add({ ...input, createdAt: Date.now() });
    await db.scheduled.bulkAdd(
      amounts.map((amount, i): Scheduled => ({
        date: dates[i],
        amount,
        type: 'expense',
        accountId: input.accountId,
        categoryId: input.categoryId,
        description: `${input.description} · rata ${i + 1}/${input.count}`,
        planId,
        installment: i + 1,
        autoCreate: true,
      })),
    );
    return planId;
  });
  await processDue();
  return id;
}

/** Paga oggi tutte le rate rimaste (estinzione anticipata). */
export async function payPlanNow(planId: number) {
  const pending = (await db.scheduled.where('planId').equals(planId).toArray()).filter((s) => !s.doneTxId);
  for (const s of pending) await confirmScheduled(s, today());
}

/** Elimina il piano e le rate non pagate; i movimenti già registrati restano. */
export async function deletePlan(planId: number) {
  await db.transaction('rw', db.plans, db.scheduled, async () => {
    await db.scheduled.where('planId').equals(planId).delete();
    await db.plans.delete(planId);
  });
}

export function planStatus(installments: Scheduled[]) {
  const sorted = [...installments].sort((a, b) => (a.installment ?? 0) - (b.installment ?? 0));
  const paid = sorted.filter((s) => s.doneTxId);
  const pending = sorted.filter((s) => !s.doneTxId);
  return {
    paidCount: paid.length,
    paid: paid.reduce((s, i) => s + i.amount, 0),
    remaining: pending.reduce((s, i) => s + i.amount, 0),
    next: pending[0],
    installments: sorted,
  };
}

export interface MonthStats {
  income: number;
  expense: number;
  byCategory: Map<number | undefined, number>;
}

/** Statistiche di un insieme di movimenti (già filtrati per periodo), solo sui conti in EUR. */
export function computeStats(txs: Transaction[], eurAccounts: Set<number>): MonthStats {
  const stats: MonthStats = { income: 0, expense: 0, byCategory: new Map() };
  for (const t of txs) {
    if (t.type === 'transfer' || !eurAccounts.has(t.accountId)) continue;
    if (t.type === 'income') stats.income += t.amount;
    else {
      stats.expense += t.amount;
      stats.byCategory.set(t.categoryId, (stats.byCategory.get(t.categoryId) ?? 0) + t.amount);
    }
  }
  return stats;
}

export interface SubscriptionSuggestion {
  key: string;
  description: string;
  amount: number;
  months: number;
  lastDate: string;
  accountId: number;
  categoryId?: number;
}

/**
 * Cerca spese che si ripetono circa una volta al mese con importo simile (abbonamenti, bollette)
 * e che non sono già gestite come ricorrenza.
 */
export function detectSubscriptions(txs: Transaction[], recurring: Recurring[]): SubscriptionSuggestion[] {
  const now = today();
  const since = addDays(now, -200);
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || t.recurringId || t.scheduledId || t.date < since || t.date > now) continue;
    const key = normalizeDescription(t.description);
    if (key.length < 3) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const known = recurring.map((r) => normalizeDescription(r.description)).filter(Boolean);
  const out: SubscriptionSuggestion[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map((t) => monthKey(t.date)));
    if (months.size < 3 || list.length > months.size * 1.25) continue;
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    if (latest.date < addDays(now, -45)) continue;
    const amounts = list.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (amounts.some((a) => Math.abs(a - median) > median * 0.15)) continue;
    if (known.some((k) => k.includes(key) || key.includes(k))) continue;
    out.push({ key, description: latest.description, amount: median, months: months.size, lastDate: latest.date, accountId: latest.accountId, categoryId: latest.categoryId });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function categoryUsage(txs: Transaction[]): Map<number, number> {
  const usage = new Map<number, number>();
  for (const t of txs) if (t.categoryId) usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1);
  return usage;
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[,#]/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
