import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Account, type Category, type Currency, type TxType } from './db';
import { fmt } from './money';
import { monthLabel, shiftMonth } from './dates';
import type { ForecastPoint } from './logic';

export function useAccounts(includeArchived = false): Account[] {
  return useLiveQuery(() => db.accounts.toArray(), [], []).filter((a) => includeArchived || !a.archived);
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('name').toArray(), [], []);
}

export function byId<T extends { id?: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((i) => [i.id!, i]));
}

export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supportato */
  }
}

// ---- Avvisi temporanei con azione "Annulla" ----

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let nextToast = 1;

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, action?: ToastItem['action']) {
  const id = nextToast++;
  toasts = [...toasts.slice(-1), { id, text, action }];
  emit();
  setTimeout(() => dismiss(id), action ? 5000 : 2200);
}

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
                haptic();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Scheda dal basso ----

/**
 * Si chiude con ✕, Esc, tocco fuori, trascinamento verso il basso e tasto indietro di Android
 * (la scheda aggiunge una voce alla cronologia, così "indietro" chiude lei invece di cambiare pagina).
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onCloseRef.current(), 160);
  }, []);

  useEffect(() => {
    let popped = false;
    history.pushState({ sheet: true }, '');
    const onPop = () => {
      popped = true;
      requestClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose();
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      if (!popped && history.state?.sheet) history.back();
    };
  }, [requestClose]);

  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetRef.current!.style.transition = 'none';
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    sheetRef.current!.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { dy } = drag.current;
    drag.current = null;
    const el = sheetRef.current!;
    el.style.transition = '';
    if (dy > 90) {
      el.style.transform = 'translateY(100%)';
      requestClose();
    } else {
      el.style.transform = '';
    }
  };

  return (
    <div className={`sheet-backdrop${closing ? ' closing' : ''}`} onClick={requestClose}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="grabber" />
          <h2>{title}</h2>
          <button className="icon-btn" onClick={requestClose} aria-label="Chiudi">✕</button>
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

export function CatIcon({ category, icon }: { category?: Category; icon?: string }) {
  return (
    <span className="cat-icon" style={{ background: (category?.color ?? '#9aa5b1') + '22' }}>
      {icon ?? category?.icon ?? '❔'}
    </span>
  );
}

export function Empty({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p>{children}</p>
    </div>
  );
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

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button type="button" role="tab" aria-selected={value === v} key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Linea del saldo previsto, con la linea dello zero se il saldo la attraversa. */
export function Sparkline({ points }: { points: ForecastPoint[] }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 64;
  const values = points.map((p) => p.balance);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // La scala segue i dati (con un po' di margine): includere sempre lo zero appiattirebbe saldi alti
  const pad = Math.max((hi - lo) * 0.15, 100);
  const min = lo - pad;
  const max = hi + pad;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / (max - min)) * (H - 8);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const minIdx = values.indexOf(Math.min(...values));
  const negative = Math.min(...values) < 0;
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#spark-fill)" />
      {negative && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--neg)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={x(minIdx)} cy={y(values[minIdx])} r="3" fill={negative ? 'var(--neg)' : 'var(--accent)'} />
    </svg>
  );
}
