import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Frequency, type Kind, type Recurring } from '../db';
import { parseAmount, toInput } from '../money';
import { shortDate, today } from '../dates';
import { processRecurring } from '../logic';
import { Amount, byId, CatIcon, Empty, PageHeader, Sheet, useAccounts, useCategories } from '../ui';

const FREQ: Record<Frequency, string> = { weekly: 'Ogni settimana', monthly: 'Ogni mese', yearly: 'Ogni anno' };

export function Ricorrenti({ back }: { back: () => void }) {
  const list = useLiveQuery(() => db.recurring.orderBy('nextDate').toArray(), [], []);
  const catMap = byId(useCategories());
  const accMap = byId(useAccounts(true));
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);

  // Un totale mensile indicativo delle uscite fisse
  const monthlyFixed = list
    .filter((r) => r.active && r.type === 'expense')
    .reduce((s, r) => s + (r.frequency === 'monthly' ? r.amount : r.frequency === 'weekly' ? (r.amount * 52) / 12 : r.amount / 12), 0);

  return (
    <>
      <PageHeader title="Ricorrenti" back={back} action={<button className="btn" onClick={() => setEditing('new')}>+ Nuova</button>} />
      <p className="small muted">
        Le voci <b>automatiche</b> vengono registrate da sole alla scadenza. Le altre sono <b>promemoria</b>: compaiono tra le scadenze in Home e le confermi con ✓.
      </p>
      {list.length > 0 && (
        <div className="card hero">
          <div className="label">Uscite fisse al mese (circa)</div>
          <div className="big">{<Amount cents={Math.round(monthlyFixed)} />}</div>
        </div>
      )}
      <section className="card">
        {list.length === 0 ? <Empty>Aggiungi affitto, stipendio, abbonamenti…</Empty> : (
          <ul className="list">
            {list.map((r) => (
              <li key={r.id}>
                <button className="row" onClick={() => setEditing(r)} style={{ opacity: r.active ? 1 : 0.5 }}>
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
      {editing && <RecurringForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurringForm({ item, onClose }: { item?: Recurring; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const [type, setType] = useState<Kind>(item?.type ?? 'expense');
  const [description, setDescription] = useState(item?.description ?? '');
  const [amount, setAmount] = useState(item ? toInput(item.amount) : '');
  const [accountId, setAccountId] = useState(item?.accountId ?? accounts[0]?.id);
  const [categoryId, setCategoryId] = useState(item?.categoryId);
  const [frequency, setFrequency] = useState<Frequency>(item?.frequency ?? 'monthly');
  const [nextDate, setNextDate] = useState(item?.nextDate ?? today());
  const [autoCreate, setAutoCreate] = useState(item?.autoCreate ?? true);
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState('');

  const save = async () => {
    const cents = parseAmount(amount);
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
    await processRecurring();
    onClose();
  };

  return (
    <Sheet title={item ? 'Modifica ricorrente' : 'Nuova ricorrente'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="segmented">
          <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>Uscita</button>
          <button type="button" className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>Entrata</button>
        </div>
        <label className="field"><span>Descrizione</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Affitto" autoFocus={!item} /></label>
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
          <label className="field">
            <span>Conto</span>
            <select className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Prossima scadenza</span><input className="input" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value || today())} /></label>
        </div>
        <label className="field">
          <span>Categoria</span>
          <select className="input" value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value) || undefined)}>
            <option value="">—</option>
            {categories.filter((c) => c.kind === type).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>
        <label className="toggle"><span>Registra automaticamente alla scadenza</span><input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} /></label>
        <label className="toggle"><span>Attiva</span><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>
        {autoCreate && nextDate < today() && <p className="notice">Le scadenze passate dal {shortDate(nextDate)} a oggi verranno registrate subito.</p>}
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {item && <button type="button" className="btn danger" onClick={async () => { if (confirm('Eliminare la ricorrenza? I movimenti già registrati restano.')) { await db.recurring.delete(item.id!); onClose(); } }}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}
