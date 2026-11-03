import { db, type Account, type Frequency, type Recurring, type Rule, type Transaction } from './db';
import { addDays, daysInMonth, today } from './dates';

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

/** La regola più specifica (pattern più lungo) contenuta nella descrizione. */
export function matchRule(desc: string, rules: Rule[]): Rule | undefined {
  const norm = normalizeDescription(desc);
  if (!norm) return undefined;
  let best: Rule | undefined;
  for (const r of rules) {
    if (r.pattern && norm.includes(r.pattern) && (!best || r.pattern.length > best.pattern.length)) best = r;
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
  const txs = await db.transactions.filter((t) => t.type !== 'transfer' && t.categoryId === undefined).toArray();
  let count = 0;
  for (const t of txs) {
    const rule = matchRule(t.description, rules);
    if (rule) {
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

export function recurringToTransaction(r: Recurring, date: string): Transaction {
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

/** Registra le ricorrenze automatiche scadute fino a oggi. */
export async function processRecurring(): Promise<number> {
  const t = today();
  let created = 0;
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    const due = await db.recurring.where('nextDate').belowOrEqual(t).toArray();
    for (const r of due) {
      if (!r.active || !r.autoCreate) continue;
      let next = r.nextDate;
      for (let guard = 0; next <= t && guard < 500; guard++) {
        await db.transactions.add(recurringToTransaction(r, next));
        created++;
        next = nextOccurrence(next, r.frequency, r.day);
      }
      await db.recurring.update(r.id!, { nextDate: next });
    }
  });
  return created;
}

/** Registra subito la prossima occorrenza di un promemoria e passa alla successiva. */
export async function confirmRecurring(r: Recurring) {
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    await db.transactions.add(recurringToTransaction(r, r.nextDate));
    await db.recurring.update(r.id!, { nextDate: nextOccurrence(r.nextDate, r.frequency, r.day) });
  });
}

export interface Upcoming {
  recurring: Recurring;
  date: string;
}

export function upcomingOccurrences(list: Recurring[], days: number): Upcoming[] {
  const end = addDays(today(), days);
  const out: Upcoming[] = [];
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

export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[,#]/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
