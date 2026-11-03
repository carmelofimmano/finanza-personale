import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, type Currency, type Transaction } from '../db';
import { fmt } from '../money';
import { addDays, currentMonth, monthBounds, monthLabel, shiftMonth, shortDate, today } from '../dates';
import { accountBalances, computeStats, confirmRecurring, confirmScheduled, forecast, upcomingAll, type UpcomingItem } from '../logic';
import { Amount, Bar, byId, CatIcon, Empty, haptic, Sparkline, toast, useAccounts, useCategories } from '../ui';
import { TxRow } from './TxRow';

const FORECAST_DAYS = 60;

export function Home({ onEdit, onGo }: { onEdit: (tx: Transaction) => void; onGo: (route: string) => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const month = currentMonth();

  const allTxs = useLiveQuery(() => db.transactions.toArray(), [], undefined);
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], []);
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], []);
  const scheduled = useLiveQuery(() => db.scheduled.filter((s) => !s.doneTxId).toArray(), [], []);
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackup'), [], undefined);

  const catMap = byId(categories);
  const accMap = byId(accounts);
  const eur = useMemo(() => new Set(accounts.filter((a) => a.currency === 'EUR').map((a) => a.id!)), [accounts]);
  const txs = allTxs ?? [];

  const data = useMemo(() => {
    const balances = accountBalances(accounts, txs);
    const totals = new Map<Currency, number>();
    for (const a of accounts) totals.set(a.currency, (totals.get(a.currency) ?? 0) + (balances.get(a.id!) ?? 0));

    // Un solo passaggio sui movimenti per mese corrente e andamento dei 6 mesi
    const trendStart = monthBounds(shiftMonth(month, -5))[0];
    const byMonth = new Map<string, Transaction[]>();
    for (const t of txs) {
      if (t.date < trendStart) continue;
      const m = t.date.slice(0, 7);
      const list = byMonth.get(m);
      if (list) list.push(t);
      else byMonth.set(m, [t]);
    }
    const stats = computeStats(byMonth.get(month) ?? [], eur);
    const trend = Array.from({ length: 6 }, (_, i) => {
      const m = shiftMonth(month, i - 5);
      return { month: m, ...computeStats(byMonth.get(m) ?? [], eur) };
    });
    const recent = [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
    return { totals, stats, trend, recent };
  }, [accounts, txs, eur, month]);

  const upcoming = useMemo(() => upcomingAll(recurring, scheduled, FORECAST_DAYS), [recurring, scheduled]);
  const projection = useMemo(() => forecast(data.totals.get('EUR') ?? 0, upcoming, eur, FORECAST_DAYS), [data.totals, upcoming, eur]);

  if (!allTxs) return <div className="skeleton" />;

  const { totals, stats, trend, recent } = data;
  const trendMax = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense]));
  const topCategories = [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const budgetOver = budgets.filter((b) => (stats.byCategory.get(b.categoryId) ?? 0) > b.amount);
  const next30 = upcoming.filter((u) => u.date <= addDays(today(), 30));
  const needsBackup = txs.length > 0 && (!lastBackup || lastBackup < addDays(today(), -7));
  const goesNegative = projection.min.balance < 0;

  const confirm = async (u: UpcomingItem) => {
    if (u.recurring) await confirmRecurring(u.recurring);
    else if (u.scheduled) await confirmScheduled(u.scheduled);
    haptic();
    toast(`${u.description} registrato`);
  };

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

      {upcoming.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Previsione {FORECAST_DAYS} giorni</h2>
            <span className={`amount ${projection.end < 0 ? 'neg' : ''}`}>{fmt(projection.end)}</span>
          </div>
          <Sparkline points={projection.points} />
          <p className={`small ${goesNegative ? 'neg' : 'muted'}`} style={{ margin: '6px 0 0' }}>
            {goesNegative
              ? `⚠️ Il saldo andrebbe a ${fmt(projection.min.balance)} il ${shortDate(projection.min.date)}`
              : `Punto più basso: ${fmt(projection.min.balance)} il ${shortDate(projection.min.date)}`}
            <span className="muted"> · solo movimenti pianificati</span>
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Prossime scadenze</h2>
          <button onClick={() => onGo('pianificati')}>Gestisci</button>
        </div>
        {next30.length === 0 ? (
          <Empty icon="🗓️">Niente nei prossimi 30 giorni.</Empty>
        ) : (
          <ul className="list">
            {next30.slice(0, 6).map((u) => (
              <li className="row" key={u.key}>
                <CatIcon category={u.categoryId ? catMap.get(u.categoryId) : undefined} icon={u.scheduled?.planId ? '💳' : undefined} />
                <div className="grow">
                  <div className="title">{u.description}</div>
                  <div className="sub">
                    {u.date < today() ? <span className="warn">Scaduta il {shortDate(u.date)}</span> : shortDate(u.date)}
                    {u.auto ? ' · automatica' : ' · da confermare'}
                  </div>
                </div>
                <Amount cents={u.amount} type={u.type} currency={accMap.get(u.accountId)?.currency} />
                {u.confirmable && <button className="chip confirm" onClick={() => confirm(u)} aria-label="Registra">✓</button>}
              </li>
            ))}
          </ul>
        )}
        {next30.length > 6 && <button className="link-btn" onClick={() => onGo('pianificati')}>Altre {next30.length - 6}</button>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Spese per categoria</h2>
          <button onClick={() => onGo('budget')}>Budget{budgetOver.length ? ` · ${budgetOver.length} sforati` : ''}</button>
        </div>
        {topCategories.length === 0 ? (
          <Empty icon="🧾">Nessuna spesa questo mese.</Empty>
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
          <h2>Ultimi movimenti</h2>
          <button onClick={() => onGo('movimenti')}>Tutti</button>
        </div>
        {recent.length === 0 ? (
          <Empty icon="✨">Tocca + per registrare la prima spesa.</Empty>
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
