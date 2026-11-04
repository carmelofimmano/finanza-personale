import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from './db';
import { currentMonth, monthBounds } from './dates';
import { accountBalances, forecast, upcomingAll, type Forecast, type UpcomingItem } from './logic';
import { useAccounts } from './ui';

export const HORIZONS: [number, string][] = [[30, '1 mese'], [90, '3 mesi'], [180, '6 mesi'], [365, '1 anno']];

export interface ForecastSettings {
  threshold: number; // soglia di sicurezza in centesimi
  includeVariable: boolean;
}

const DEFAULTS: ForecastSettings = { threshold: 0, includeVariable: true };

export function useSettings(): ForecastSettings {
  const s = useLiveQuery(() => getMeta<Partial<ForecastSettings>>('forecastSettings'), [], undefined);
  return { ...DEFAULTS, ...s };
}

export async function saveSettings(patch: Partial<ForecastSettings>) {
  const current = (await getMeta<Partial<ForecastSettings>>('forecastSettings')) ?? {};
  await setMeta('forecastSettings', { ...current, ...patch });
}

export interface ForecastData {
  ready: boolean;
  today: number; // saldo EUR di oggi
  usd: number | undefined;
  items: UpcomingItem[];
  result: Forecast;
  variableMonthly: number;
  spentThisMonth: number;
  settings: ForecastSettings;
  eur: Set<number>;
  hasPlans: boolean;
  hasBalance: boolean;
}

/**
 * Tutto ciò che serve per prevedere il saldo: saldo di oggi, scadenze future, spese variabili stimate.
 * `extra` aggiunge voci ipotetiche (simulatore) senza salvarle.
 */
const NO_EXTRA: UpcomingItem[] = [];

export function useForecast(days: number, extra: UpcomingItem[] = NO_EXTRA): ForecastData {
  const accounts = useAccounts();
  const txs = useLiveQuery(() => db.transactions.toArray(), [], undefined);
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], undefined);
  const scheduled = useLiveQuery(() => db.scheduled.filter((s) => !s.doneTxId && !s.skipped).toArray(), [], undefined);
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], []);
  const settings = useSettings();

  const eur = useMemo(() => new Set(accounts.filter((a) => a.currency === 'EUR').map((a) => a.id!)), [accounts]);

  const base = useMemo(() => {
    const balances = accountBalances(accounts, txs ?? []);
    let eurTotal = 0;
    let usd: number | undefined;
    for (const a of accounts) {
      if (a.currency === 'EUR') eurTotal += balances.get(a.id!) ?? 0;
      else usd = (usd ?? 0) + (balances.get(a.id!) ?? 0);
    }
    // Spese variabili già registrate nel mese: solo quelle non pianificate, nelle categorie con stima
    const [start] = monthBounds(currentMonth());
    const budgetCats = new Set(budgets.map((b) => b.categoryId));
    let spent = 0;
    for (const t of txs ?? []) {
      if (t.date >= start && t.type === 'expense' && eur.has(t.accountId) && !t.recurringId && !t.scheduledId && t.categoryId && budgetCats.has(t.categoryId)) spent += t.amount;
    }
    return { eurTotal, usd, spent, hasBalance: accounts.some((a) => a.initial !== 0) || (txs?.length ?? 0) > 0 };
  }, [accounts, txs, budgets, eur]);

  const items = useMemo(() => upcomingAll(recurring ?? [], scheduled ?? [], days), [recurring, scheduled, days]);
  const variableMonthly = budgets.reduce((s, b) => s + b.amount, 0);

  const result = useMemo(
    () =>
      forecast(base.eurTotal, extra.length ? [...items, ...extra].sort((a, b) => a.date.localeCompare(b.date)) : items, eur, days,
        settings.includeVariable && variableMonthly ? { monthly: variableMonthly, spentThisMonth: base.spent } : undefined),
    [base, items, extra, eur, days, settings.includeVariable, variableMonthly],
  );

  return {
    ready: !!txs && !!recurring && !!scheduled,
    today: base.eurTotal,
    usd: base.usd,
    items,
    result,
    variableMonthly,
    spentThisMonth: base.spent,
    settings,
    eur,
    hasPlans: (recurring?.length ?? 0) + (scheduled?.length ?? 0) > 0,
    hasBalance: base.hasBalance,
  };
}

export function horizonLabel(days: number): string {
  return HORIZONS.find(([d]) => d === days)?.[1] ?? `${days} giorni`;
}
