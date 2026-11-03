import { useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Account, type Category, type Currency, type TxType } from './db';
import { fmt } from './money';
import { monthLabel, shiftMonth } from './dates';

export function useAccounts(includeArchived = false): Account[] {
  return useLiveQuery(() => db.accounts.toArray(), [], []).filter((a) => includeArchived || !a.archived);
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('name').toArray(), [], []);
}

export function byId<T extends { id?: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((i) => [i.id!, i]));
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-nav">
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Mese precedente">‹</button>
      <span>{monthLabel(month)}</span>
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Mese successivo">›</button>
    </div>
  );
}

export function Amount({ cents, type, currency = 'EUR' }: { cents: number; type?: TxType; currency?: Currency }) {
  const sign = type === 'expense' ? '−' : type === 'income' ? '+' : '';
  const cls = type === 'expense' ? 'neg' : type === 'income' ? 'pos' : '';
  return <span className={`amount ${cls}`}>{sign}{fmt(cents, currency)}</span>;
}

export function CatIcon({ category }: { category?: Category }) {
  return (
    <span className="cat-icon" style={{ background: (category?.color ?? '#9aa5b1') + '22' }}>
      {category?.icon ?? '❔'}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function PageHeader({ title, back, action }: { title: string; back?: () => void; action?: ReactNode }) {
  return (
    <header className="page-head">
      {back && <button className="icon-btn" onClick={back} aria-label="Indietro">‹</button>}
      <h1>{title}</h1>
      <div className="spacer" />
      {action}
    </header>
  );
}

export function Bar({ value, max, color, over }: { value: number; max: number; color?: string; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar">
      <div className={`bar-fill${over ? ' over' : ''}`} style={{ width: `${pct}%`, background: over ? undefined : color }} />
    </div>
  );
}
