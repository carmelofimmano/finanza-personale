import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction } from '../db';
import { fmt } from '../money';
import { currentMonth, dayLabel, monthBounds } from '../dates';
import { byId, Empty, MonthNav, PageHeader, useAccounts, useCategories } from '../ui';
import { TxRow } from './TxRow';

export function Movimenti({ onEdit }: { onEdit: (tx: Transaction) => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const accounts = useAccounts(true);
  const categories = useCategories();
  const catMap = byId(categories);
  const accMap = byId(accounts);

  // Con una ricerca attiva cerca in tutti i mesi
  const txs = useLiveQuery(() => {
    if (query.trim()) return db.transactions.toArray();
    const [s, e] = monthBounds(month);
    return db.transactions.where('date').between(s, e, true, true).toArray();
  }, [month, query], [] as Transaction[]);

  const q = query.trim().toLowerCase();
  const filtered = txs
    .filter((t) => {
      if (accountFilter && t.accountId !== Number(accountFilter) && t.toAccountId !== Number(accountFilter)) return false;
      if (categoryFilter === 'none' ? t.categoryId !== undefined || t.type === 'transfer' : categoryFilter && t.categoryId !== Number(categoryFilter)) return false;
      if (!q) return true;
      const cat = t.categoryId ? catMap.get(t.categoryId)?.name : '';
      return [t.description, t.note, cat, ...t.tags].some((s) => s?.toLowerCase().includes(q));
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const groups = new Map<string, Transaction[]>();
  for (const t of filtered) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);

  let income = 0;
  let expense = 0;
  for (const t of filtered) {
    if (accMap.get(t.accountId)?.currency !== 'EUR') continue;
    if (t.type === 'income') income += t.amount;
    if (t.type === 'expense') expense += t.amount;
  }

  return (
    <>
      <PageHeader title="Movimenti" />
      <input className="input search" type="search" placeholder="Cerca descrizione, tag, nota…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="filters">
        <select className="input" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="">Tutti i conti</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Tutte le categorie</option>
          <option value="none">Senza categoria</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </div>
      {!q && <MonthNav month={month} onChange={setMonth} />}
      <div className="card" style={{ padding: '10px 16px' }}>
        <div className="stats" style={{ marginTop: 0 }}>
          <div><span className="label muted">Entrate</span><span className="amount pos">{fmt(income)}</span></div>
          <div><span className="label muted">Uscite</span><span className="amount neg">{fmt(expense)}</span></div>
          <div><span className="label muted">Saldo</span><span className="amount">{fmt(income - expense)}</span></div>
        </div>
      </div>

      {filtered.length === 0 && <Empty>{q ? 'Nessun risultato.' : 'Nessun movimento in questo mese.'}</Empty>}
      {[...groups.entries()].map(([date, list]) => {
        const net = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
        return (
          <section key={date}>
            <div className="day-head">
              <span>{dayLabel(date)}</span>
              <span>{net !== 0 && fmt(net)}</span>
            </div>
            <ul className="list card" style={{ padding: '0 16px' }}>
              {list.map((t) => <TxRow key={t.id} tx={t} categories={catMap} accounts={accMap} onClick={() => onEdit(t)} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}
