import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta, type Frequency, type Kind, type Plan, type PlanFrequency, type Recurring, type Scheduled } from '../db';
import { evalAmount, fmt, toInput } from '../money';
import { addDays, shortDate, today } from '../dates';
import {
  confirmScheduled, createPlan, deletePlan, detectSubscriptions, installmentDates, nextOccurrence,
  payPlanNow, planStatus, processDue, splitInstallments, type SubscriptionSuggestion,
} from '../logic';
import { Amount, Bar, byId, CatIcon, Empty, haptic, PageHeader, Segmented, Sheet, toast, useAccounts, useCategories } from '../ui';

export type PlannedView = 'ricorrenti' | 'unatantum' | 'rate';

const FREQ: Record<Frequency, string> = { weekly: 'Ogni settimana', monthly: 'Ogni mese', yearly: 'Ogni anno' };
const PLAN_FREQ: Record<PlanFrequency, string> = { monthly: 'Ogni mese', days30: 'Ogni 30 giorni', biweekly: 'Ogni 2 settimane', weekly: 'Ogni settimana' };

const PRESETS: { provider: string; label: string; count: number; frequency: PlanFrequency }[] = [
  { provider: 'PayPal', label: 'PayPal in 3 rate', count: 3, frequency: 'monthly' },
  { provider: 'Klarna', label: 'Klarna in 3 rate', count: 3, frequency: 'days30' },
  { provider: 'Scalapay', label: 'Scalapay in 3', count: 3, frequency: 'monthly' },
  { provider: 'Scalapay', label: 'Scalapay in 4', count: 4, frequency: 'monthly' },
  { provider: 'Finanziamento', label: 'Altro / finanziamento', count: 10, frequency: 'monthly' },
];

export function Pianificati({ view, onView }: { view: PlannedView; onView: (v: PlannedView) => void }) {
  const [form, setForm] = useState<
    | { kind: 'recurring'; item?: Recurring; initial?: Partial<Recurring> }
    | { kind: 'scheduled'; item?: Scheduled }
    | { kind: 'plan' }
    | { kind: 'planDetail'; plan: Plan }
    | null
  >(null);
  const close = () => setForm(null);
  const add = () => setForm(view === 'ricorrenti' ? { kind: 'recurring' } : view === 'unatantum' ? { kind: 'scheduled' } : { kind: 'plan' });

  return (
    <>
      <PageHeader title="Pianificati" action={<button className="btn" onClick={add}>+ Nuovo</button>} />
      <Segmented value={view} onChange={onView} options={[['ricorrenti', 'Ricorrenti'], ['unatantum', 'Una tantum'], ['rate', 'Rate']]} />
      <div className="screen" key={view}>
        {view === 'ricorrenti' && <RecurringList onEdit={(item) => setForm({ kind: 'recurring', item })} onSuggest={(initial) => setForm({ kind: 'recurring', initial })} />}
        {view === 'unatantum' && <ScheduledList onEdit={(item) => setForm({ kind: 'scheduled', item })} />}
        {view === 'rate' && <PlanList onOpen={(plan) => setForm({ kind: 'planDetail', plan })} onAdd={() => setForm({ kind: 'plan' })} />}
      </div>

      {form?.kind === 'recurring' && <RecurringForm item={form.item} initial={form.initial} onClose={close} />}
      {form?.kind === 'scheduled' && <ScheduledForm item={form.item} onClose={close} />}
      {form?.kind === 'plan' && <PlanForm onClose={close} />}
      {form?.kind === 'planDetail' && <PlanDetail plan={form.plan} onClose={close} />}
    </>
  );
}

// ---------- Ricorrenti ----------

function RecurringList({ onEdit, onSuggest }: { onEdit: (r: Recurring) => void; onSuggest: (r: Partial<Recurring>) => void }) {
  const list = useLiveQuery(() => db.recurring.orderBy('nextDate').toArray(), [], []);
  const catMap = byId(useCategories());
  const accMap = byId(useAccounts(true));
  const txs = useLiveQuery(() => db.transactions.where('date').aboveOrEqual(addDays(today(), -200)).toArray(), [], []);
  const ignored = useLiveQuery(() => getMeta<string[]>('ignoredSubscriptions'), [], undefined) ?? [];
  const suggestions = useMemo(() => detectSubscriptions(txs, list).filter((s) => !ignored.includes(s.key)), [txs, list, ignored]);

  const monthlyFixed = list
    .filter((r) => r.active && r.type === 'expense')
    .reduce((s, r) => s + (r.frequency === 'monthly' ? r.amount : r.frequency === 'weekly' ? (r.amount * 52) / 12 : r.amount / 12), 0);

  const accept = (s: SubscriptionSuggestion) => {
    const day = Number(s.lastDate.slice(8, 10));
    onSuggest({ description: s.description, amount: s.amount, type: 'expense', accountId: s.accountId, categoryId: s.categoryId, frequency: 'monthly', day, nextDate: nextOccurrence(s.lastDate, 'monthly', day), autoCreate: false });
  };
  const ignore = async (s: SubscriptionSuggestion) => {
    await setMeta('ignoredSubscriptions', [...ignored, s.key]);
  };

  return (
    <>
      {list.length > 0 && (
        <div className="card hero">
          <div className="label">Uscite fisse al mese (circa)</div>
          <div className="big">{fmt(Math.round(monthlyFixed))}</div>
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="card suggest">
          <div className="card-head"><h2>💡 Sembrano abbonamenti</h2></div>
          <ul className="list">
            {suggestions.slice(0, 5).map((s) => (
              <li className="row" key={s.key}>
                <CatIcon category={s.categoryId ? catMap.get(s.categoryId) : undefined} />
                <div className="grow">
                  <div className="title">{s.description}</div>
                  <div className="sub">circa {fmt(s.amount)} al mese · visto in {s.months} mesi</div>
                </div>
                <button className="chip" onClick={() => ignore(s)} aria-label="Ignora">✕</button>
                <button className="chip active" onClick={() => accept(s)}>Aggiungi</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="small muted">
        Le voci <b>automatiche</b> vengono registrate da sole alla scadenza. I <b>promemoria</b> compaiono tra le scadenze in Home e li confermi con ✓.
      </p>
      <section className="card">
        {list.length === 0 ? <Empty icon="🔁">Aggiungi affitto, stipendio, abbonamenti…</Empty> : (
          <ul className="list">
            {list.map((r) => (
              <li key={r.id}>
                <button className="row" onClick={() => onEdit(r)} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <CatIcon category={r.categoryId ? catMap.get(r.categoryId) : undefined} />
                  <div className="grow">
                    <div className="title">{r.description}</div>
                    <div className="sub">{FREQ[r.frequency]} · prossima {shortDate(r.nextDate)} · {r.autoCreate ? 'automatica' : 'promemoria'}{r.active ? '' : ' · in pausa'}</div>
                  </div>
                  <Amount cents={r.amount} type={r.type} currency={accMap.get(r.accountId)?.currency} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RecurringForm({ item, initial, onClose }: { item?: Recurring; initial?: Partial<Recurring>; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const src = item ?? initial;
  const [type, setType] = useState<Kind>(src?.type ?? 'expense');
  const [description, setDescription] = useState(src?.description ?? '');
  const [amount, setAmount] = useState(src?.amount ? toInput(src.amount) : '');
  const [accountId, setAccountId] = useState(src?.accountId ?? accounts[0]?.id);
  const [categoryId, setCategoryId] = useState(src?.categoryId);
  const [frequency, setFrequency] = useState<Frequency>(src?.frequency ?? 'monthly');
  const [nextDate, setNextDate] = useState(src?.nextDate ?? today());
  const [autoCreate, setAutoCreate] = useState(src?.autoCreate ?? true);
  const [active, setActive] = useState(src?.active ?? true);
  const [error, setError] = useState('');

  const save = async () => {
    const cents = evalAmount(amount);
    if (!description.trim()) return setError('Inserisci una descrizione.');
    if (!cents || cents <= 0) return setError('Inserisci un importo valido.');
    const acc = accountId ?? accounts[0]?.id;
    if (!acc) return setError('Crea prima un conto.');
    const data: Recurring = {
      description: description.trim(),
      amount: cents,
      type,
      accountId: acc,
      categoryId: categories.find((c) => c.id === categoryId)?.kind === type ? categoryId : undefined,
      frequency,
      day: Number(nextDate.slice(8, 10)),
      nextDate,
      autoCreate,
      active,
    };
    if (item?.id) await db.recurring.put({ ...data, id: item.id });
    else await db.recurring.add(data);
    const created = await processDue();
    haptic();
    toast(created ? `Salvato · registrati ${created} movimenti arretrati` : 'Ricorrenza salvata');
    onClose();
  };

  const remove = async () => {
    if (!item?.id) return;
    await db.recurring.delete(item.id);
    toast('Ricorrenza eliminata', { label: 'Annulla', run: () => db.recurring.put(item) });
    onClose();
  };

  return (
    <Sheet title={item ? 'Modifica ricorrente' : 'Nuova ricorrente'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Segmented value={type} onChange={setType} options={[['expense', 'Uscita'], ['income', 'Entrata']]} />
        <label className="field"><span>Descrizione</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Affitto" autoFocus={!src} /></label>
        <div className="grid-2">
          <label className="field"><span>Importo</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></label>
          <label className="field">
            <span>Frequenza</span>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="grid-2">
          <AccountSelect value={accountId} onChange={setAccountId} />
          <label className="field"><span>Prossima scadenza</span><input className="input" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value || today())} /></label>
        </div>
        <CategorySelect kind={type} value={categoryId} onChange={setCategoryId} />
        <label className="toggle"><span>Registra automaticamente alla scadenza</span><input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} /></label>
        <label className="toggle"><span>Attiva</span><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>
        {autoCreate && nextDate < today() && <p className="notice">Le scadenze dal {shortDate(nextDate)} a oggi verranno registrate subito.</p>}
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {item && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Una tantum ----------

function ScheduledList({ onEdit }: { onEdit: (s: Scheduled) => void }) {
  const all = useLiveQuery(() => db.scheduled.orderBy('date').filter((s) => !s.planId).toArray(), [], []);
  const catMap = byId(useCategories());
  const accMap = byId(useAccounts(true));
  const [showDone, setShowDone] = useState(false);
  const pending = all.filter((s) => !s.doneTxId);
  const done = all.filter((s) => s.doneTxId).reverse();
  const t = today();

  const row = (s: Scheduled) => (
    <li key={s.id} className="row-wrap">
      <button className="row" onClick={() => onEdit(s)}>
        <CatIcon category={s.categoryId ? catMap.get(s.categoryId) : undefined} />
        <div className="grow">
          <div className="title">{s.description}</div>
          <div className="sub">
            {s.doneTxId ? `Pagato · ${shortDate(s.date)}` : s.date < t ? <span className="warn">Scaduto il {shortDate(s.date)}</span> : shortDate(s.date)}
            {!s.doneTxId && (s.autoCreate ? ' · automatico' : ' · promemoria')}
          </div>
        </div>
        <Amount cents={s.amount} type={s.type} currency={accMap.get(s.accountId)?.currency} />
      </button>
      {!s.doneTxId && !s.autoCreate && (
        <button className="chip confirm" aria-label="Segna come pagato" onClick={async () => { await confirmScheduled(s); haptic(); toast('Registrato'); }}>✓</button>
      )}
    </li>
  );

  return (
    <>
      <p className="small muted">Pagamenti singoli futuri: bollo auto, assicurazione, una visita, un acconto. Puoi anche inserire un movimento con data futura dal tasto +.</p>
      <section className="card">
        {pending.length === 0 ? <Empty icon="📅">Nessun pagamento pianificato.</Empty> : <ul className="list">{pending.map(row)}</ul>}
      </section>
      {done.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowDone(!showDone)}>{showDone ? 'Nascondi' : 'Mostra'} completati ({done.length})</button>
          {showDone && <section className="card"><ul className="list">{done.slice(0, 30).map(row)}</ul></section>}
        </>
      )}
    </>
  );
}

function ScheduledForm({ item, onClose }: { item?: Scheduled; onClose: () => void }) {
  const accounts = useAccounts();
  const [type, setType] = useState<Kind>(item?.type ?? 'expense');
  const [description, setDescription] = useState(item?.description ?? '');
  const [amount, setAmount] = useState(item ? toInput(item.amount) : '');
  const [date, setDate] = useState(item?.date ?? addDays(today(), 7));
  const [accountId, setAccountId] = useState(item?.accountId ?? accounts[0]?.id);
  const [categoryId, setCategoryId] = useState(item?.categoryId);
  const [autoCreate, setAutoCreate] = useState(item?.autoCreate ?? true);
  const [note, setNote] = useState(item?.note ?? '');
  const [error, setError] = useState('');
  const done = !!item?.doneTxId;

  const save = async () => {
    const cents = evalAmount(amount);
    if (!description.trim()) return setError('Inserisci una descrizione.');
    if (!cents || cents <= 0) return setError('Inserisci un importo valido.');
    const acc = accountId ?? accounts[0]?.id;
    if (!acc) return setError('Crea prima un conto.');
    const data: Scheduled = { date, amount: cents, type, accountId: acc, categoryId, description: description.trim(), note: note.trim() || undefined, autoCreate, planId: item?.planId, installment: item?.installment };
    if (item?.id) await db.scheduled.put({ ...data, id: item.id });
    else await db.scheduled.add(data);
    await processDue();
    haptic();
    toast(date <= today() && autoCreate ? 'Registrato' : `Pianificato per ${shortDate(date)}`);
    onClose();
  };

  const remove = async () => {
    if (!item?.id) return;
    await db.scheduled.delete(item.id);
    toast('Eliminato', { label: 'Annulla', run: () => db.scheduled.put(item) });
    onClose();
  };

  if (done) {
    return (
      <Sheet title="Pagamento completato" onClose={onClose}>
        <p>{item!.description}: <Amount cents={item!.amount} type={item!.type} /> il {shortDate(item!.date)}.</p>
        <p className="small muted">Il movimento è stato registrato: per modificarlo aprilo da Movimenti.</p>
        <div className="btn-row"><button className="btn danger" onClick={remove}>Elimina dallo storico</button></div>
      </Sheet>
    );
  }

  return (
    <Sheet title={item ? 'Modifica pagamento' : 'Pagamento una tantum'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Segmented value={type} onChange={setType} options={[['expense', 'Uscita'], ['income', 'Entrata']]} />
        <label className="field"><span>Descrizione</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Bollo auto" autoFocus={!item} /></label>
        <div className="grid-2">
          <label className="field"><span>Importo</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></label>
          <label className="field"><span>Data</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} /></label>
        </div>
        <div className="grid-2">
          <AccountSelect value={accountId} onChange={setAccountId} />
          <CategorySelect kind={type} value={categoryId} onChange={setCategoryId} />
        </div>
        <label className="field"><span>Nota</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="toggle"><span>Registra automaticamente alla data</span><input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} /></label>
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {item && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Rate ----------

function PlanList({ onOpen, onAdd }: { onOpen: (p: Plan) => void; onAdd: () => void }) {
  const plans = useLiveQuery(() => db.plans.toArray(), [], []);
  const scheduled = useLiveQuery(() => db.scheduled.filter((s) => s.planId !== undefined).toArray(), [], []);
  const catMap = byId(useCategories());
  const status = plans.map((p) => ({ plan: p, ...planStatus(scheduled.filter((s) => s.planId === p.id)) }));
  const active = status.filter((s) => s.remaining > 0).sort((a, b) => (a.next?.date ?? '').localeCompare(b.next?.date ?? ''));
  const closed = status.filter((s) => s.remaining === 0);
  const debt = active.reduce((s, p) => s + p.remaining, 0);
  const next30 = active.flatMap((p) => p.installments).filter((i) => !i.doneTxId && i.date <= addDays(today(), 30)).reduce((s, i) => s + i.amount, 0);

  const card = (s: (typeof status)[number]) => (
    <li key={s.plan.id}>
      <button className="row" onClick={() => onOpen(s.plan)}>
        <CatIcon category={s.plan.categoryId ? catMap.get(s.plan.categoryId) : undefined} icon={providerIcon(s.plan.provider)} />
        <div className="grow">
          <div className="title">{s.plan.description}</div>
          <Bar value={s.paid} max={s.plan.total} />
          <div className="sub">
            {s.plan.provider} · {s.paidCount}/{s.plan.count} pagate
            {s.next ? ` · prossima ${shortDate(s.next.date)} (${fmt(s.next.amount)})` : ' · saldato'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="amount">{fmt(s.remaining)}</span>
          <div className="sub muted small">di {fmt(s.plan.total)}</div>
        </div>
      </button>
    </li>
  );

  return (
    <>
      <section className="card hero">
        <div className="label">Da pagare a rate</div>
        <div className="big">{fmt(debt)}</div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>{active.length === 1 ? '1 piano attivo' : `${active.length} piani attivi`} ·{fmt(next30)} nei prossimi 30 giorni</p>
      </section>
      <section className="card">
        {active.length === 0 ? (
          <Empty icon="💳">
            Nessuna rata in corso.<br />
            <button className="link-btn" onClick={onAdd}>Aggiungi un acquisto a rate</button>
          </Empty>
        ) : <ul className="list">{active.map(card)}</ul>}
      </section>
      {closed.length > 0 && (
        <>
          <h3>Saldati</h3>
          <section className="card"><ul className="list">{closed.map(card)}</ul></section>
        </>
      )}
    </>
  );
}

function providerIcon(provider: string) {
  const p = provider.toLowerCase();
  return p.includes('paypal') ? '🅿️' : p.includes('klarna') ? '🩷' : p.includes('scalapay') ? '💠' : '💳';
}

function PlanForm({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const [preset, setPreset] = useState(0);
  const [provider, setProvider] = useState(PRESETS[0].provider);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState(PRESETS[0].count);
  const [frequency, setFrequency] = useState<PlanFrequency>(PRESETS[0].frequency);
  const [firstDate, setFirstDate] = useState(today());
  const [accountId, setAccountId] = useState(accounts[0]?.id);
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [error, setError] = useState('');

  const choose = (i: number) => {
    setPreset(i);
    setProvider(PRESETS[i].provider);
    setCount(PRESETS[i].count);
    setFrequency(PRESETS[i].frequency);
  };

  const cents = evalAmount(total);
  const n = Math.min(120, Math.max(1, Math.floor(count) || 1));
  const preview = cents && cents > 0 ? splitInstallments(cents, n).map((a, i, arr) => ({ amount: a, date: installmentDates(firstDate, arr.length, frequency)[i] })) : [];
  const t = today();

  const save = async () => {
    if (!description.trim()) return setError('Cosa hai comprato?');
    if (!cents || cents <= 0) return setError('Inserisci il totale.');
    const acc = accountId ?? accounts[0]?.id;
    if (!acc) return setError('Crea prima un conto.');
    await createPlan({ description: description.trim(), provider: provider.trim() || 'Rate', total: cents, count: n, frequency, firstDate, accountId: acc, categoryId });
    haptic();
    const paidNow = preview.filter((p) => p.date <= t).length;
    toast(paidNow ? `Piano creato · ${paidNow === 1 ? 'prima rata registrata' : `${paidNow} rate registrate`}` : 'Piano creato');
    onClose();
  };

  return (
    <Sheet title="Acquisto a rate" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="chips">
          {PRESETS.map((p, i) => (
            <button type="button" key={p.label} className={`chip${preset === i ? ' active' : ''}`} onClick={() => choose(i)}>
              {providerIcon(p.provider)} {p.label}
            </button>
          ))}
        </div>
        <label className="field"><span>Cosa hai comprato</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Cuffie Sony" autoFocus /></label>
        <div className="grid-2">
          <label className="field"><span>Totale</span><input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" /></label>
          <label className="field"><span>Numero rate</span><input className="input" type="number" min={1} max={120} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Frequenza</span>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as PlanFrequency)}>
              {Object.entries(PLAN_FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field"><span>Prima rata</span><input className="input" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value || today())} /></label>
        </div>
        <div className="grid-2">
          <AccountSelect value={accountId} onChange={setAccountId} />
          <CategorySelect kind="expense" value={categoryId} onChange={setCategoryId} />
        </div>
        {preset === PRESETS.length - 1 && (
          <label className="field"><span>Nome del servizio</span><input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} /></label>
        )}

        {preview.length > 0 && (
          <div className="installments">
            {preview.slice(0, 12).map((p, i) => (
              <div key={i} className={p.date <= t ? 'paid' : ''}>
                <span>{i + 1}ª · {shortDate(p.date)}</span>
                <span className="amount">{fmt(p.amount)}</span>
              </div>
            ))}
            {preview.length > 12 && <div className="muted">…altre {preview.length - 12}</div>}
            {preview[0].date <= t && <p className="small muted">Le rate con data di oggi o passata vengono registrate subito.</p>}
          </div>
        )}
        {error && <p className="notice err">{error}</p>}
        <button className="btn primary block" type="submit" style={{ marginTop: 12 }}>Crea piano</button>
      </form>
    </Sheet>
  );
}

function PlanDetail({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const installments = useLiveQuery(() => db.scheduled.where('planId').equals(plan.id!).toArray(), [plan.id], []);
  const s = planStatus(installments);
  const t = today();

  const payNext = async () => {
    if (!s.next) return;
    await confirmScheduled(s.next, t);
    haptic();
    toast(`Rata ${s.next.installment} registrata`);
  };
  const payAll = async () => {
    if (!confirm(`Registrare oggi le ${s.installments.length - s.paidCount} rate rimaste (${fmt(s.remaining)})?`)) return;
    await payPlanNow(plan.id!);
    haptic();
    toast('Piano saldato');
  };
  const remove = async () => {
    if (!confirm('Eliminare il piano? Le rate non pagate spariscono, quelle già pagate restano tra i movimenti.')) return;
    await deletePlan(plan.id!);
    toast('Piano eliminato');
    onClose();
  };

  return (
    <Sheet title={plan.description} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{plan.provider} · {plan.count} rate · {PLAN_FREQ[plan.frequency].toLowerCase()}</p>
      <Bar value={s.paid} max={plan.total} />
      <div className="stats">
        <div><span className="label muted">Pagato</span><span className="amount">{fmt(s.paid)}</span></div>
        <div><span className="label muted">Restano</span><span className="amount neg">{fmt(s.remaining)}</span></div>
        <div><span className="label muted">Totale</span><span className="amount">{fmt(plan.total)}</span></div>
      </div>
      <div className="installments">
        {s.installments.map((i) => (
          <div key={i.id} className={i.doneTxId ? 'paid' : i.date < t ? 'late' : ''}>
            <span>{i.doneTxId ? '✓' : '○'} {i.installment}ª · {shortDate(i.date)}</span>
            <span className="amount">{fmt(i.amount)}</span>
          </div>
        ))}
      </div>
      {s.remaining > 0 && (
        <div className="btn-row">
          <button className="btn" onClick={payAll}>Salda tutto</button>
          <button className="btn primary" onClick={payNext}>Paga rata {s.next?.installment} ora</button>
        </div>
      )}
      <button className="btn danger block" style={{ marginTop: 8 }} onClick={remove}>Elimina piano</button>
    </Sheet>
  );
}

// ---------- Campi comuni ----------

function AccountSelect({ value, onChange }: { value?: number; onChange: (id: number) => void }) {
  const accounts = useAccounts();
  return (
    <label className="field">
      <span>Conto</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

function CategorySelect({ kind, value, onChange }: { kind: Kind; value?: number; onChange: (id?: number) => void }) {
  const categories = useCategories().filter((c) => c.kind === kind);
  return (
    <label className="field">
      <span>Categoria</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || undefined)}>
        <option value="">—</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
      </select>
    </label>
  );
}
