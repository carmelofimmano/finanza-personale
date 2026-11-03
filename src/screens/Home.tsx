import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, type Currency, type Transaction } from '../db';
import { fmt } from '../money';
import { addDays, currentMonth, monthBounds, monthLabel, shiftMonth, shortDate, today } from '../dates';
import { accountBalances, computeStats, confirmRecurring, upcomingOccurrences } from '../logic';
import { Amount, Bar, byId, CatIcon, Empty, useAccounts, useCategories } from '../ui';
import { TxRow } from './TxRow';

export function Home({ onEdit, onGo }: { onEdit: (tx: Transaction) => void; onGo: (tab: string) => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const month = currentMonth();

  const allTxs = useLiveQuery(() => db.transactions.toArray(), [], [] as Transaction[]);
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], []);
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], []);
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackup'), [], undefined);

  const catMap = byId(categories);
  const accMap = byId(accounts);
  const eur = useMemo(() => new Set(accounts.filter((a) => a.currency === 'EUR').map((a) => a.id!)), [accounts]);

  const balances = accountBalances(accounts, allTxs);
  const totals = new Map<Currency, number>();
  for (const a of accounts) totals.set(a.currency, (totals.get(a.currency) ?? 0) + (balances.get(a.id!) ?? 0));

  const [start, end] = monthBounds(month);
  const monthTxs = allTxs.filter((t) => t.date >= start && t.date <= end);
  const stats = computeStats(monthTxs, eur);

  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(month, i - 5);
    const [s, e] = monthBounds(m);
    return { month: m, ...computeStats(allTxs.filter((t) => t.date >= s && t.date <= e), eur) };
  });
  const trendMax = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense]));

  const topCategories = [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const budgetOver = budgets.filter((b) => (stats.byCategory.get(b.categoryId) ?? 0) > b.amount);
  const upcoming = upcomingOccurrences(recurring, 30).slice(0, 5);
  const recent = [...allTxs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
  const needsBackup = allTxs.length > 0 && (!lastBackup || lastBackup < addDays(today(), -7));

  return (
    <>
      <header className="page-head">
        <h1>{monthLabel(month)}</h1>
      </header>

      {needsBackup && (
        <div className="banner">
          <span>💾 {lastBackup ? `Ultimo backup: ${shortDate(lastBackup)}` : 'Non hai ancora fatto un backup'}</span>
          <button onClick={() => onGo('altro/backup')}>Fai backup</button>
        </div>
      )}

      <section className="card hero">
        <div className="label">Saldo totale</div>
        <div className="big">{fmt(totals.get('EUR') ?? 0)}</div>
        {totals.has('USD') && <div className="muted">+ {fmt(totals.get('USD')!, 'USD')}</div>}
        <div className="stats">
          <div><span className="label muted">Entrate</span><span className="amount pos">{fmt(stats.income)}</span></div>
          <div><span className="label muted">Uscite</span><span className="amount neg">{fmt(stats.expense)}</span></div>
          <div><span className="label muted">Risparmio</span><span className={`amount ${stats.income - stats.expense < 0 ? 'neg' : ''}`}>{fmt(stats.income - stats.expense)}</span></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Ultimi 6 mesi</h2></div>
        <div className="trend">
          {trend.map((t) => (
            <div className="trend-col" key={t.month} title={`${monthLabel(t.month)}: +${fmt(t.income)} / −${fmt(t.expense)}`}>
              <div className="trend-bars">
                <div style={{ height: `${(t.income / trendMax) * 100}%`, background: 'var(--pos)' }} />
                <div style={{ height: `${(t.expense / trendMax) * 100}%`, background: 'var(--neg)' }} />
              </div>
              <span className="label">{monthLabel(t.month, true)}</span>
            </div>
          ))}
        </div>
        <div className="legend">
          <span><span className="dot" style={{ background: 'var(--pos)' }} />Entrate</span>
          <span><span className="dot" style={{ background: 'var(--neg)' }} />Uscite</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Spese per categoria</h2>
          <button onClick={() => onGo('budget')}>Budget{budgetOver.length ? ` · ${budgetOver.length} sforati` : ''}</button>
        </div>
        {topCategories.length === 0 ? (
          <Empty>Nessuna spesa questo mese.</Empty>
        ) : (
          <ul className="list">
            {topCategories.map(([id, value]) => {
              const cat = id ? catMap.get(id) : undefined;
              const budget = budgets.find((b) => b.categoryId === id);
              return (
                <li className="row" key={id ?? 'none'}>
                  <CatIcon category={cat} />
                  <div className="grow">
                    <div className="title">{cat?.name ?? 'Senza categoria'}</div>
                    <Bar value={value} max={budget?.amount ?? stats.expense} color={cat?.color} over={!!budget && value > budget.amount} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="amount">{fmt(value)}</span>
                    {budget && <div className="sub muted small">di {fmt(budget.amount)}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Prossime scadenze</h2>
          <button onClick={() => onGo('altro/ricorrenti')}>Gestisci</button>
        </div>
        {upcoming.length === 0 ? (
          <Empty>Nessuna scadenza nei prossimi 30 giorni.</Empty>
        ) : (
          <ul className="list">
            {upcoming.map(({ recurring: r, date }) => (
              <li className="row" key={`${r.id}-${date}`}>
                <CatIcon category={r.categoryId ? catMap.get(r.categoryId) : undefined} />
                <div className="grow">
                  <div className="title">{r.description}</div>
                  <div className="sub">
                    {date < today() ? <span className="warn">Scaduta il {shortDate(date)}</span> : shortDate(date)}
                    {r.autoCreate ? ' · automatica' : ''}
                  </div>
                </div>
                <Amount cents={r.amount} type={r.type} currency={accMap.get(r.accountId)?.currency} />
                {!r.autoCreate && date === r.nextDate && (
                  <button className="chip" onClick={() => confirmRecurring(r)} title="Registra il movimento">✓</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Ultimi movimenti</h2>
          <button onClick={() => onGo('movimenti')}>Tutti</button>
        </div>
        {recent.length === 0 ? (
          <Empty>Tocca + per registrare la prima spesa.</Empty>
        ) : (
          <ul className="list">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} categories={catMap} accounts={accMap} onClick={() => onEdit(t)} showDate={shortDate(t.date)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
