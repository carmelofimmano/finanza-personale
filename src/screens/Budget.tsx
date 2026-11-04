import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category } from '../db';
import { fmt, parseAmount, toInput } from '../money';
import { currentMonth, daysInMonth, monthBounds } from '../dates';
import { computeStats } from '../logic';
import { Bar, CatIcon, haptic, MonthNav, PageHeader, Sheet, toast, useAccounts, useCategories } from '../ui';

export function Budget() {
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Category | null>(null);
  const categories = useCategories().filter((c) => c.kind === 'expense');
  const accounts = useAccounts(true);
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], []);
  const txs = useLiveQuery(() => {
    const [s, e] = monthBounds(month);
    return db.transactions.where('date').between(s, e, true, true).toArray();
  }, [month], []);

  const eur = new Set(accounts.filter((a) => a.currency === 'EUR').map((a) => a.id!));
  const stats = computeStats(txs, eur);
  const budgetOf = (id: number) => budgets.find((b) => b.categoryId === id);
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const spentInBudget = budgets.reduce((s, b) => s + (stats.byCategory.get(b.categoryId) ?? 0), 0);

  // Quota del mese trascorsa, per capire se si sta spendendo troppo in fretta
  const [y, m] = month.split('-').map(Number);
  const isCurrent = month === currentMonth();
  const elapsed = isCurrent ? new Date().getDate() / daysInMonth(y, m) : month < currentMonth() ? 1 : 0;

  const withBudget = categories.filter((c) => budgetOf(c.id!));
  const without = categories.filter((c) => !budgetOf(c.id!));

  return (
    <>
      <PageHeader title="Spese variabili" />
      <p className="small muted" style={{ marginTop: 0 }}>
        Le spese che non pianifichi una per una: spesa, carburante, uscite. Indica quanto spendi di solito al mese
        e la previsione le distribuisce giorno per giorno. Non serve registrarle.
      </p>

      <section className="card hero">
        <div className="label">Stima mensile</div>
        <div className="big">{fmt(totalBudget)}</div>
        {totalBudget === 0 ? (
          <p className="small muted" style={{ margin: '8px 0 0' }}>Tocca una categoria qui sotto per indicare quanto spendi al mese.</p>
        ) : (
          <p className="small muted" style={{ margin: '8px 0 0' }}>≈ {fmt(Math.round(totalBudget / 30))} al giorno nella previsione.</p>
        )}
        {spentInBudget > 0 && (
          <>
            <Bar value={spentInBudget} max={totalBudget} over={spentInBudget > totalBudget} />
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Registrate nel mese: {fmt(spentInBudget)}. La previsione usa la stima solo per la parte non ancora spesa.
            </p>
          </>
        )}
      </section>
      <MonthNav month={month} onChange={setMonth} />

      {withBudget.length > 0 && (
        <section className="card">
          <ul className="list">
            {withBudget.map((c) => {
              const b = budgetOf(c.id!)!;
              const spent = stats.byCategory.get(c.id) ?? 0;
              const over = spent > b.amount;
              const fast = !over && elapsed > 0 && elapsed < 1 && spent / b.amount > elapsed + 0.15;
              return (
                <li key={c.id}>
                  <button className="row" onClick={() => setEditing(c)}>
                    <CatIcon category={c} />
                    <div className="grow">
                      <div className="title">{c.name}</div>
                      <Bar value={spent} max={b.amount} color={c.color} over={over} />
                      <div className="sub">
                        {over ? <span className="neg">Sforato di {fmt(spent - b.amount)}</span> : fast ? <span className="warn">Stai spendendo in fretta</span> : `Restano ${fmt(b.amount - spent)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="amount">{fmt(spent)}</span>
                      <div className="sub muted small">di {fmt(b.amount)}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h3>{withBudget.length ? 'Altre categorie' : 'Categorie'}</h3>
      <section className="card">
        <ul className="list">
          {without.map((c) => (
            <li key={c.id}>
              <button className="row" onClick={() => setEditing(c)}>
                <CatIcon category={c} />
                <div className="grow title">{c.name}</div>
                <span className="amount muted">{fmt(stats.byCategory.get(c.id) ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {editing && <BudgetForm category={editing} current={budgetOf(editing.id!)?.amount} onClose={() => setEditing(null)} />}
    </>
  );
}

function BudgetForm({ category, current, onClose }: { category: Category; current?: number; onClose: () => void }) {
  const [value, setValue] = useState(current ? toInput(current) : '');
  const save = async () => {
    const cents = parseAmount(value);
    const existing = await db.budgets.where('categoryId').equals(category.id!).first();
    if (!cents || cents <= 0) {
      if (existing) await db.budgets.delete(existing.id!);
    } else if (existing) {
      await db.budgets.update(existing.id!, { amount: cents });
    } else {
      await db.budgets.add({ categoryId: category.id!, amount: cents });
    }
    haptic();
    toast(cents && cents > 0 ? `${category.name}: ${fmt(cents)} al mese` : 'Stima rimossa');
    onClose();
  };
  return (
    <Sheet title={`${category.icon} ${category.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field">
          <span>Quanto spendi di solito al mese (vuoto per rimuovere)</span>
          <input className="input" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
        </label>
        <button className="btn primary block" type="submit">Salva</button>
      </form>
    </Sheet>
  );
}
