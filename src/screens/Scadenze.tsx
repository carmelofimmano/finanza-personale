import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Plan } from '../db';
import { evalAmount, fmt, toInput } from '../money';
import { dayLabel, monthKey, monthLabel, shortDate, today } from '../dates';
import { confirmRecurring, confirmScheduled, skipRecurring, skipScheduled, type UpcomingItem } from '../logic';
import { HORIZONS, useForecast } from '../useForecast';
import { Amount, byId, CatIcon, Empty, haptic, PageHeader, Segmented, Sheet, toast, useAccounts, useCategories } from '../ui';
import { useHorizon } from './Previsione';
import { PlanDetail, RecurringForm, ScheduledForm } from './Pianificati';

type Editing = { kind: 'confirm'; item: UpcomingItem } | { kind: 'recurring'; item: UpcomingItem } | { kind: 'scheduled'; item: UpcomingItem } | { kind: 'plan'; plan: Plan } | null;

/** Linea del tempo delle entrate e uscite future, con il saldo previsto a fine giornata. */
export function Scadenze() {
  const [days, setDays] = useHorizon();
  const f = useForecast(days);
  const catMap = byId(useCategories());
  const accMap = byId(useAccounts(true));
  const plans = useLiveQuery(() => db.plans.toArray(), [], []);
  const [filter, setFilter] = useState<'all' | 'out' | 'in'>('all');
  const [editing, setEditing] = useState<Editing>(null);

  const balanceAt = useMemo(() => new Map(f.result.points.map((p) => [p.date, p.balance])), [f.result.points]);
  const t = today();
  const items = f.items.filter((i) => filter === 'all' || (filter === 'in' ? i.type === 'income' : i.type === 'expense'));
  const overdue = items.filter((i) => i.date < t);
  const future = items.filter((i) => i.date >= t);

  // Mese → giorno → voci
  const months = new Map<string, Map<string, UpcomingItem[]>>();
  for (const i of future) {
    const m = monthKey(i.date);
    let byDay = months.get(m);
    if (!byDay) months.set(m, (byDay = new Map()));
    const list = byDay.get(i.date);
    if (list) list.push(i);
    else byDay.set(i.date, [i]);
  }

  const open = (item: UpcomingItem) => {
    haptic(5);
    setEditing({ kind: 'confirm', item });
  };

  const row = (u: UpcomingItem) => (
    <li key={u.key}>
      <button className="row" onClick={() => open(u)}>
        <CatIcon category={u.categoryId ? catMap.get(u.categoryId) : undefined} icon={u.scheduled?.planId ? '💳' : u.categoryId ? undefined : u.type === 'income' ? '💰' : '💸'} />
        <div className="grow">
          <div className="title">{u.description}</div>
          <div className="sub">
            {u.date < t && <span className="warn">Scaduta il {shortDate(u.date)} · </span>}
            {u.recurring ? 'ricorrente' : u.scheduled?.planId ? 'rata' : 'una tantum'}
            {u.auto ? ' · automatica' : ' · da confermare'}
            {accMap.get(u.accountId)?.currency === 'USD' ? ' · USD' : ''}
          </div>
        </div>
        <Amount cents={u.amount} type={u.type} currency={accMap.get(u.accountId)?.currency} />
      </button>
    </li>
  );

  return (
    <>
      <PageHeader title="Scadenze" />
      <div className="sticky">
        <Segmented value={String(days)} onChange={(v) => setDays(Number(v))} options={HORIZONS.map(([d, l]) => [String(d), l] as [string, string])} />
        <div className="chips" style={{ marginBottom: 6 }}>
          {([['all', 'Tutte'], ['out', 'Uscite'], ['in', 'Entrate']] as const).map(([v, l]) => (
            <button key={v} className={`chip${filter === v ? ' active' : ''}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {overdue.length > 0 && (
        <>
          <h3 className="warn">Da confermare</h3>
          <section className="card overdue"><ul className="list">{overdue.map(row)}</ul></section>
        </>
      )}

      {f.ready && future.length === 0 && overdue.length === 0 && <Empty icon="🗓️">Nessuna scadenza in questo periodo. Tocca + per aggiungerne.</Empty>}

      {[...months.entries()].map(([m, byDay]) => {
        const monthItems = [...byDay.values()].flat();
        const inc = monthItems.filter((i) => i.type === 'income').reduce((s, i) => s + i.amount, 0);
        const out = monthItems.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amount, 0);
        return (
          <section key={m}>
            <div className="month-head">
              <span>{monthLabel(m)}</span>
              <span className="small">
                {inc > 0 && <span className="pos">+{fmt(inc)}</span>}
                {inc > 0 && out > 0 && ' · '}
                {out > 0 && <span className="neg">−{fmt(out)}</span>}
              </span>
            </div>
            {[...byDay.entries()].map(([date, list]) => {
              const balance = balanceAt.get(date);
              return (
                <div key={date}>
                  <div className="day-head">
                    <span>{dayLabel(date)}</span>
                    {balance !== undefined && <span className={balance < f.settings.threshold ? 'neg' : ''}>saldo {fmt(balance)}</span>}
                  </div>
                  <ul className="list card" style={{ padding: '0 16px' }}>{list.map(row)}</ul>
                </div>
              );
            })}
          </section>
        );
      })}
      {f.variableMonthly > 0 && f.settings.includeVariable && future.length > 0 && (
        <p className="small muted" style={{ textAlign: 'center' }}>Il saldo previsto tiene conto anche di {fmt(f.variableMonthly)}/mese di spese variabili.</p>
      )}

      {editing?.kind === 'confirm' && (
        <ConfirmSheet
          item={editing.item}
          onClose={() => setEditing(null)}
          onEdit={() => {
            const u = editing.item;
            const plan = u.scheduled?.planId ? plans.find((p) => p.id === u.scheduled!.planId) : undefined;
            setEditing(plan ? { kind: 'plan', plan } : u.recurring ? { kind: 'recurring', item: u } : { kind: 'scheduled', item: u });
          }}
        />
      )}
      {editing?.kind === 'recurring' && <RecurringForm item={editing.item.recurring} onClose={() => setEditing(null)} />}
      {editing?.kind === 'scheduled' && <ScheduledForm item={editing.item.scheduled} onClose={() => setEditing(null)} />}
      {editing?.kind === 'plan' && <PlanDetail plan={editing.plan} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Conferma una scadenza (anche con importo diverso), la salta o apre la voce che la genera. */
function ConfirmSheet({ item, onClose, onEdit }: { item: UpcomingItem; onClose: () => void; onEdit: () => void }) {
  const t = today();
  const [amount, setAmount] = useState(toInput(item.amount));
  const [date, setDate] = useState(item.date <= t ? item.date : t);
  const [error, setError] = useState('');
  // Di una ricorrenza si può registrare o saltare solo la prossima occorrenza
  const actionable = item.scheduled ? true : item.date === item.recurring!.nextDate;

  const record = async () => {
    const cents = evalAmount(amount);
    if (!cents || cents <= 0) return setError('Importo non valido.');
    if (item.recurring) await confirmRecurring(item.recurring, cents, date);
    else await confirmScheduled(item.scheduled!, date, cents);
    haptic();
    toast(`${item.description}: registrato ${fmt(cents)}`);
    onClose();
  };

  const skip = async () => {
    if (item.recurring) await skipRecurring(item.recurring);
    else await skipScheduled(item.scheduled!);
    haptic();
    toast('Scadenza saltata', {
      label: 'Annulla',
      run: () => (item.scheduled ? db.scheduled.update(item.scheduled.id!, { skipped: false }) : db.recurring.update(item.recurring!.id!, { nextDate: item.recurring!.nextDate })),
    });
    onClose();
  };

  return (
    <Sheet title={item.description} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Prevista {item.date < t ? `il ${shortDate(item.date)} (scaduta)` : shortDate(item.date)} · {item.type === 'income' ? 'entrata' : 'uscita'} {item.auto ? 'automatica' : 'da confermare'}
      </p>
      {actionable ? (
        <form onSubmit={(e) => { e.preventDefault(); record(); }}>
          <div className="grid-2">
            <label className="field"><span>Importo reale</span><input className="input" inputMode="decimal" value={amount} onFocus={(e) => e.target.select()} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="field"><span>Data</span><input className="input" type="date" value={date} max={t} onChange={(e) => setDate(e.target.value || t)} /></label>
          </div>
          {error && <p className="notice err">{error}</p>}
          <button className="btn primary block" type="submit">{item.date > t ? 'Registra ora (in anticipo)' : 'Registra come avvenuta'}</button>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={skip}>Salta questa volta</button>
            <button type="button" className="btn" onClick={onEdit}>Modifica</button>
          </div>
        </form>
      ) : (
        <>
          <p className="small">Questa è una delle prossime occorrenze: si potrà confermare dopo la precedente.</p>
          <button className="btn block" onClick={onEdit}>Modifica la ricorrenza</button>
        </>
      )}
    </Sheet>
  );
}
