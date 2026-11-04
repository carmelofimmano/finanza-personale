import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, type PlanFrequency } from '../db';
import { evalAmount, fmt, toInput } from '../money';
import { addDays, monthLabel, shortDate, today } from '../dates';
import { accountBalances, createPlan, firstBelow, hypotheticalItems, setCurrentBalance, type UpcomingItem } from '../logic';
import { HORIZONS, horizonLabel, saveSettings, useForecast, useSettings } from '../useForecast';
import { Amount, byId, CatIcon, Empty, haptic, Segmented, Sheet, Sparkline, toast, useAccounts, useCategories } from '../ui';

const HORIZON_KEY = 'fp:horizon';

function readHorizon(): number {
  try {
    const v = Number(localStorage.getItem(HORIZON_KEY));
    return HORIZONS.some(([d]) => d === v) ? v : 90;
  } catch {
    return 90;
  }
}

export function useHorizon(): [number, (d: number) => void] {
  const [days, setDays] = useState(readHorizon);
  return [
    days,
    (d) => {
      setDays(d);
      try {
        localStorage.setItem(HORIZON_KEY, String(d));
      } catch {
        /* solo una comodità */
      }
    },
  ];
}

export function Previsione({ onGo, onOpen }: { onGo: (route: string) => void; onOpen: (sheet: 'balance' | 'simulate' | 'add') => void }) {
  const [days, setDays] = useHorizon();
  const f = useForecast(days);
  const catMap = byId(useCategories());
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackup'), [], undefined);
  const txCount = useLiveQuery(() => db.transactions.count(), [], 0);

  if (!f.ready) return <div className="skeleton" />;

  const { result, settings } = f;
  const below = firstBelow(result.points, settings.threshold);
  const change = result.end - f.today;
  const next = f.items.filter((i) => i.date <= addDays(today(), 14)).slice(0, 4);
  const needsBackup = (txCount > 0 || f.hasPlans) && (!lastBackup || lastBackup < addDays(today(), -7));

  return (
    <>
      <header className="page-head">
        <h1>Previsione</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => onOpen('simulate')}>🤔 Posso permettermelo?</button>
      </header>

      {needsBackup && (
        <div className="banner">
          <span>💾 {lastBackup ? `Ultimo backup: ${shortDate(lastBackup)}` : 'Non hai ancora fatto un backup'}</span>
          <button onClick={() => onGo('altro/backup')}>Fai backup</button>
        </div>
      )}

      {!f.hasBalance && (
        <section className="card onboarding">
          <h2>1 · Quanto hai oggi?</h2>
          <p className="small muted">Inserisci il saldo attuale dei tuoi conti: la previsione parte da qui. Non serve registrare il passato.</p>
          <button className="btn primary block" onClick={() => onOpen('balance')}>Imposta il saldo di oggi</button>
        </section>
      )}
      {f.hasBalance && !f.hasPlans && (
        <section className="card onboarding">
          <h2>2 · Cosa entra e cosa esce?</h2>
          <p className="small muted">Aggiungi stipendio, affitto, bollette, abbonamenti, rate e le spese che già conosci.</p>
          <button className="btn primary block" onClick={() => onOpen('add')}>+ Aggiungi entrate e uscite</button>
        </section>
      )}

      <section className="card hero">
        <button className="hero-today" onClick={() => onOpen('balance')}>
          <span className="label">Saldo di oggi · tocca per aggiornare</span>
          <span className="big">{fmt(f.today)}</span>
          {f.usd !== undefined && <span className="muted">+ {fmt(f.usd, 'USD')}</span>}
        </button>

        <Segmented value={String(days)} onChange={(v) => setDays(Number(v))} options={HORIZONS.map(([d, l]) => [String(d), l] as [string, string])} />

        <div className="forecast-head">
          <div>
            <div className="label muted">Fra {horizonLabel(days)}</div>
            <div className={`mid ${result.end < settings.threshold ? 'neg' : ''}`}>{fmt(result.end)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="label muted">Variazione</div>
            <div className={`mid ${change < 0 ? 'neg' : 'pos'}`}>{change > 0 ? '+' : ''}{fmt(change)}</div>
          </div>
        </div>
        <Sparkline points={result.points} threshold={settings.threshold} height={110} />
        <div className="axis"><span>Oggi</span><span>{shortDate(result.points[Math.floor(result.points.length / 2)].date)}</span><span>{shortDate(result.points[result.points.length - 1].date)}</span></div>

        {below ? (
          <p className="alert">
            ⚠️ Il {shortDate(below.date)} scendi sotto {settings.threshold ? `la soglia di ${fmt(settings.threshold)}` : 'zero'}: {fmt(below.balance)}.
            Punto più basso {fmt(result.min.balance)} il {shortDate(result.min.date)}.
          </p>
        ) : (
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            ✅ Punto più basso: {fmt(result.min.balance)} il {shortDate(result.min.date)}
            {settings.threshold ? ` · soglia ${fmt(settings.threshold)}` : ''}
          </p>
        )}
        <label className="toggle small" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>
            Includi spese variabili {f.variableMonthly ? `(${fmt(f.variableMonthly)}/mese)` : ''}
            {!f.variableMonthly && <button type="button" className="link-btn inline" onClick={() => onGo('variabili')}>imposta la stima</button>}
          </span>
          <input type="checkbox" checked={settings.includeVariable} disabled={!f.variableMonthly} onChange={(e) => saveSettings({ includeVariable: e.target.checked })} />
        </label>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Prossimi 14 giorni</h2>
          <button onClick={() => onGo('scadenze')}>Tutte le scadenze</button>
        </div>
        {next.length === 0 ? (
          <Empty icon="🗓️">Niente in arrivo. Tocca + per aggiungere entrate e uscite future.</Empty>
        ) : (
          <ul className="list">
            {next.map((u) => (
              <li className="row" key={u.key}>
                <CatIcon category={u.categoryId ? catMap.get(u.categoryId) : undefined} icon={u.scheduled?.planId ? '💳' : u.categoryId ? undefined : u.type === 'income' ? '💰' : '💸'} />
                <div className="grow">
                  <div className="title">{u.description}</div>
                  <div className="sub">{u.date < today() ? <span className="warn">Scaduta il {shortDate(u.date)}</span> : shortDate(u.date)}</div>
                </div>
                <Amount cents={u.amount} type={u.type} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Mese per mese</h2></div>
        <div className="table-wrap">
          <table className="months">
            <thead>
              <tr><th>Mese</th><th className="num">Entrate</th><th className="num">Uscite</th><th className="num">Fine mese</th></tr>
            </thead>
            <tbody>
              {result.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month, true)}{m.month === result.months[0].month ? ' (resto)' : ''}</td>
                  <td className="num pos">{fmt(m.income)}</td>
                  <td className="num neg" title={m.variable ? `di cui variabili ${fmt(m.variable)}` : undefined}>{fmt(m.expense + m.variable)}</td>
                  <td className={`num strong ${m.endBalance < settings.threshold ? 'neg' : ''}`}>{fmt(m.endBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {f.variableMonthly > 0 && settings.includeVariable && <p className="small muted">Le uscite comprendono le spese variabili stimate.</p>}
      </section>
    </>
  );
}

// ---------- Saldo di oggi e soglia ----------

export function BalanceSheet({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const txs = useLiveQuery(() => db.transactions.toArray(), [], undefined);
  const settings = useSettings();
  const balances = useMemo(() => accountBalances(accounts, txs ?? []), [accounts, txs]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [threshold, setThreshold] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = async () => {
    for (const a of accounts) {
      const raw = values[a.id!];
      if (raw === undefined) continue;
      const cents = evalAmount(raw);
      if (cents === null) return setError(`Importo non valido per ${a.name}.`);
      if (cents !== balances.get(a.id!)) await setCurrentBalance(a.id!, cents);
    }
    if (threshold !== null) {
      const t = threshold.trim() ? evalAmount(threshold) : 0;
      if (t === null) return setError('Soglia non valida.');
      await saveSettings({ threshold: t });
    }
    haptic();
    toast('Saldi aggiornati');
    onClose();
  };

  if (!txs) return null;
  return (
    <Sheet title="Saldo di oggi" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="small muted" style={{ marginTop: 0 }}>Scrivi quanto vedi oggi sull'app della banca. Puoi riallinearlo quando vuoi: la previsione riparte da qui.</p>
        {accounts.map((a, i) => (
          <label className="field" key={a.id}>
            <span>{a.name} ({a.currency})</span>
            <input
              className="input"
              inputMode="decimal"
              autoFocus={i === 0}
              value={values[a.id!] ?? toInput(balances.get(a.id!) ?? 0)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setValues({ ...values, [a.id!]: e.target.value })}
            />
          </label>
        ))}
        <label className="field">
          <span>Avvisami se il saldo previsto scende sotto</span>
          <input className="input" inputMode="decimal" value={threshold ?? (settings.threshold ? toInput(settings.threshold) : '')} placeholder="0,00" onChange={(e) => setThreshold(e.target.value)} />
        </label>
        {error && <p className="notice err">{error}</p>}
        <button className="btn primary block" type="submit">Salva</button>
      </form>
    </Sheet>
  );
}

// ---------- Posso permettermelo? ----------

const SIM_MODES: { label: string; count: number; frequency: PlanFrequency; provider?: string }[] = [
  { label: 'Subito', count: 1, frequency: 'monthly' },
  { label: 'PayPal 3', count: 3, frequency: 'monthly', provider: 'PayPal' },
  { label: 'Klarna 3', count: 3, frequency: 'days30', provider: 'Klarna' },
  { label: 'Scalapay 4', count: 4, frequency: 'monthly', provider: 'Scalapay' },
  { label: '12 rate', count: 12, frequency: 'monthly', provider: 'Finanziamento' },
];

export function Simulator({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts().filter((a) => a.currency === 'EUR');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState(0);
  const [description, setDescription] = useState('');
  const [days] = useHorizon();
  const horizon = Math.max(days, 90);
  const cents = evalAmount(amount) ?? 0;
  const accountId = accounts[0]?.id ?? 1;
  const m = SIM_MODES[mode];

  const extra = useMemo<UpcomingItem[]>(
    () => (cents > 0 ? hypotheticalItems({ amount: cents, date, count: m.count, frequency: m.frequency, accountId }) : []),
    [cents, date, m.count, m.frequency, accountId],
  );
  const before = useForecast(horizon);
  const after = useForecast(horizon, extra);
  const threshold = before.settings.threshold;
  const belowAfter = firstBelow(after.result.points, threshold);
  const belowBefore = firstBelow(before.result.points, threshold);
  const verdict = !cents ? null : belowAfter && !belowBefore ? 'no' : belowAfter ? 'already' : after.result.min.balance - threshold < cents ? 'tight' : 'yes';

  const add = async () => {
    if (!cents || !description.trim()) return;
    if (m.count === 1) {
      await db.scheduled.add({ date, amount: cents, type: 'expense', accountId, description: description.trim(), autoCreate: true });
    } else {
      await createPlan({ description: description.trim(), provider: m.provider ?? 'Rate', total: cents, count: m.count, frequency: m.frequency, firstDate: date, accountId });
    }
    haptic();
    toast('Aggiunto alla previsione');
    onClose();
  };

  return (
    <Sheet title="Posso permettermelo?" onClose={onClose}>
      <input className="amount-input neg" inputMode="decimal" autoFocus placeholder="0,00 €" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Prezzo" />
      <div className="chips" style={{ justifyContent: 'center' }}>
        {SIM_MODES.map((s, i) => (
          <button type="button" key={s.label} className={`chip${mode === i ? ' active' : ''}`} onClick={() => { setMode(i); haptic(5); }}>{s.label}</button>
        ))}
      </div>
      <label className="field"><span>{m.count === 1 ? 'Quando' : 'Prima rata'}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} /></label>

      {cents > 0 && (
        <div className={`verdict ${verdict}`}>
          <div className="verdict-title">
            {verdict === 'yes' && '✅ Sì, puoi permettertelo'}
            {verdict === 'tight' && '🟡 Sì, ma resti con poco margine'}
            {verdict === 'no' && '⛔ Meglio di no, per ora'}
            {verdict === 'already' && '⚠️ Il saldo scende già sotto la soglia'}
          </div>
          <Sparkline points={after.result.points} compare={before.result.points} threshold={threshold} height={80} />
          <div className="stats">
            <div><span className="label muted">Punto più basso</span><span className={`amount ${after.result.min.balance < threshold ? 'neg' : ''}`}>{fmt(after.result.min.balance)}</span></div>
            <div><span className="label muted">Senza acquisto</span><span className="amount">{fmt(before.result.min.balance)}</span></div>
            <div><span className="label muted">{m.count > 1 ? `${m.count} rate da` : 'Fra ' + horizonLabel(horizon)}</span><span className="amount">{m.count > 1 ? fmt(Math.ceil(cents / m.count)) : fmt(after.result.end)}</span></div>
          </div>
          {belowAfter && <p className="small neg" style={{ margin: '8px 0 0' }}>Il {shortDate(belowAfter.date)} il saldo previsto sarebbe {fmt(belowAfter.balance)}.</p>}
        </div>
      )}

      {cents > 0 && (
        <>
          <label className="field" style={{ marginTop: 12 }}><span>Se lo compri, cosa è?</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Telefono nuovo" /></label>
          <button className="btn primary block" disabled={!description.trim()} onClick={add}>Aggiungi alla previsione</button>
        </>
      )}
      {!cents && <p className="small muted">Scrivi il prezzo: vedi subito come cambia il saldo nei prossimi {horizonLabel(horizon)}, pagando subito o a rate.</p>}
    </Sheet>
  );
}
