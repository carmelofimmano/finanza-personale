import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction, type TxType } from '../db';
import { evalAmount, fmt, isExpression, toInput } from '../money';
import { shortDate, today } from '../dates';
import { categoryUsage, learnRule, parseTags, processDue, suggestCategory } from '../logic';
import { haptic, Sheet, toast, useAccounts, useCategories } from '../ui';

const LAST_ACCOUNT = 'fp:lastAccount';
const MAX_CENTS = 100_000_000_00; // un miliardo: oltre è quasi certamente un errore di battitura
const TOP_CATEGORIES = 8;

function readLastAccount(): number | undefined {
  try {
    return Number(localStorage.getItem(LAST_ACCOUNT)) || undefined;
  } catch {
    return undefined;
  }
}

export function TxForm({ tx, onClose }: { tx?: Transaction; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense');
  const [amount, setAmount] = useState(tx ? toInput(tx.amount) : '');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [categoryId, setCategoryId] = useState<number | undefined>(tx?.categoryId);
  const [suggested, setSuggested] = useState<number | undefined>();
  const [pickedByUser, setPickedByUser] = useState(!!tx?.categoryId);
  const [accountId, setAccountId] = useState<number | undefined>(tx?.accountId ?? readLastAccount());
  const [toAccountId, setToAccountId] = useState<number | undefined>(tx?.toAccountId);
  const [toAmount, setToAmount] = useState(tx?.toAmount ? toInput(tx.toAmount) : '');
  const [date, setDate] = useState(tx?.date ?? today());
  const [tags, setTags] = useState(tx?.tags.join(', ') ?? '');
  const [note, setNote] = useState(tx?.note ?? '');
  const [showAll, setShowAll] = useState(false);
  const [showMore, setShowMore] = useState(!!(tx?.tags.length || tx?.note));
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  const recent = useLiveQuery(() => db.transactions.orderBy('date').reverse().limit(400).toArray(), [], [] as Transaction[]);
  const { descriptions, usage, templates } = useMemo(() => {
    const seen = new Set<string>();
    const templates: Transaction[] = [];
    for (const t of recent) {
      const key = t.description.trim().toLowerCase();
      if (!key || seen.has(key) || t.type === 'transfer' || t.recurringId || t.scheduledId) continue;
      seen.add(key);
      templates.push(t);
    }
    return { descriptions: templates.slice(0, 80).map((t) => t.description), usage: categoryUsage(recent), templates: templates.slice(0, 6) };
  }, [recent]);

  useEffect(() => {
    if (!tx) setTimeout(() => amountRef.current?.focus(), 50);
  }, [tx]);

  // Conto predefinito se l'ultimo usato non esiste più
  useEffect(() => {
    if (accounts.length && !accounts.some((a) => a.id === accountId)) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  // Propone la categoria dalla descrizione, finché l'utente non ne sceglie una a mano
  useEffect(() => {
    if (type === 'transfer' || !description.trim()) {
      setSuggested(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const id = await suggestCategory(description);
      if (cancelled) return;
      const valid = id !== undefined && categories.find((c) => c.id === id)?.kind === type ? id : undefined;
      setSuggested(valid);
      if (!pickedByUser && valid !== undefined) setCategoryId(valid);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [description, type, pickedByUser, categories]);

  // Le più usate prima; la categoria scelta resta sempre visibile
  const kindCategories = useMemo(
    () => categories.filter((c) => c.kind === type).sort((a, b) => (usage.get(b.id!) ?? 0) - (usage.get(a.id!) ?? 0) || a.name.localeCompare(b.name)),
    [categories, type, usage],
  );
  const visibleCategories = showAll ? kindCategories : kindCategories.filter((c, i) => i < TOP_CATEGORIES || c.id === categoryId);
  const from = accounts.find((a) => a.id === accountId);
  const to = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === 'transfer' && from && to && from.currency !== to.currency;
  const isNew = !tx?.id;
  const future = isNew && type !== 'transfer' && date > today();
  const computed = isExpression(amount) ? evalAmount(amount) : null;

  const changeType = (t: TxType) => {
    setType(t);
    haptic(5);
    if (categories.find((c) => c.id === categoryId)?.kind !== t) {
      setCategoryId(undefined);
      setPickedByUser(false);
    }
  };

  const applyTemplate = (t: Transaction) => {
    setType(t.type);
    setDescription(t.description);
    setCategoryId(t.categoryId);
    setPickedByUser(!!t.categoryId);
    setAccountId(t.accountId);
    if (!amount) setAmount(toInput(t.amount));
    haptic(5);
    amountRef.current?.focus();
  };

  const save = async () => {
    const cents = evalAmount(amount);
    if (!cents || cents <= 0) return setError('Inserisci un importo valido.');
    if (cents > MAX_CENTS) return setError('Importo troppo grande: controlla le cifre.');
    if (!accountId) return setError('Scegli un conto.');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Scegli un conto di destinazione diverso.');
    const toCents = crossCurrency ? evalAmount(toAmount) : null;
    if (crossCurrency && (!toCents || toCents <= 0)) return setError(`Inserisci l'importo accreditato in ${to!.currency}.`);

    const desc = description.trim() || (type === 'transfer' ? 'Trasferimento' : '');
    const cat = type === 'transfer' ? undefined : categoryId;

    if (future) {
      // Una spesa con data futura diventa un pagamento pianificato, così non altera il saldo di oggi
      await db.scheduled.add({ date, amount: cents, type: type as 'expense' | 'income', accountId, categoryId: cat, description: desc, note: note.trim() || undefined, autoCreate: true });
      if (cat && desc) await learnRule(desc, cat);
      haptic();
      toast(`Pianificato per ${shortDate(date)}`);
      return onClose();
    }

    const data: Transaction = {
      date,
      amount: cents,
      type,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      toAmount: crossCurrency ? toCents! : undefined,
      categoryId: cat,
      description: desc,
      tags: parseTags(tags),
      note: note.trim() || undefined,
      recurringId: tx?.recurringId,
      scheduledId: tx?.scheduledId,
      importHash: tx?.importHash,
      createdAt: tx?.createdAt ?? Date.now(),
    };
    if (tx?.id) await db.transactions.put({ ...data, id: tx.id });
    else await db.transactions.add(data);
    if (data.categoryId && data.description) await learnRule(data.description, data.categoryId);
    try {
      localStorage.setItem(LAST_ACCOUNT, String(accountId));
    } catch {
      /* solo una comodità */
    }
    haptic();
    toast(tx ? 'Modifiche salvate' : `${type === 'income' ? 'Entrata' : type === 'expense' ? 'Spesa' : 'Trasferimento'} di ${fmt(cents, from?.currency)} salvata`);
    onClose();
    processDue();
  };

  const remove = async () => {
    if (!tx?.id) return;
    await db.transactions.delete(tx.id);
    haptic(15);
    toast('Movimento eliminato', { label: 'Annulla', run: () => db.transactions.put(tx) });
    onClose();
  };

  return (
    <Sheet title={tx ? 'Modifica movimento' : 'Nuovo movimento'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="segmented">
          {(['expense', 'income', 'transfer'] as const).map((t) => (
            <button type="button" key={t} className={type === t ? 'active' : ''} onClick={() => changeType(t)}>
              {t === 'expense' ? 'Uscita' : t === 'income' ? 'Entrata' : 'Trasferimento'}
            </button>
          ))}
        </div>

        <input
          ref={amountRef}
          className={`amount-input ${type === 'expense' ? 'neg' : type === 'income' ? 'pos' : ''}`}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder={`0,00 ${from?.currency === 'USD' ? '$' : '€'}`}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setError(''); }}
          aria-label="Importo"
        />
        <div className="amount-hint">{computed !== null ? `= ${fmt(computed, from?.currency)}` : isExpression(amount) ? 'Espressione non valida' : ' '}</div>

        {isNew && templates.length > 0 && !description && (
          <div className="chips templates" aria-label="Recenti">
            {templates.map((t) => (
              <button type="button" key={t.id} className="chip" onClick={() => applyTemplate(t)}>
                {categories.find((c) => c.id === t.categoryId)?.icon ?? '↺'} {t.description}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Descrizione</span>
          <input
            className="input"
            list="descriptions"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === 'transfer' ? 'Trasferimento' : 'es. Esselunga'}
            enterKeyHint="next"
          />
          <datalist id="descriptions">
            {descriptions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>

        {type !== 'transfer' && (
          <>
            <div className="field"><span>Categoria</span></div>
            <div className="chips">
              {visibleCategories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`chip${categoryId === c.id ? ' active' : ''}`}
                  onClick={() => {
                    setCategoryId(categoryId === c.id ? undefined : c.id);
                    setPickedByUser(true);
                    haptic(5);
                  }}
                >
                  {c.icon} {c.name}
                  {suggested === c.id && !pickedByUser && <span className="suggested">auto</span>}
                </button>
              ))}
              {kindCategories.length > TOP_CATEGORIES && (
                <button type="button" className="chip ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Meno' : `Altre ${kindCategories.length - visibleCategories.length} ▾`}
                </button>
              )}
            </div>
          </>
        )}

        <div className="grid-2">
          <label className="field">
            <span>{type === 'transfer' ? 'Da conto' : 'Conto'}</span>
            <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.currency !== 'EUR' ? ` (${a.currency})` : ''}</option>
              ))}
            </select>
          </label>
          {type === 'transfer' ? (
            <label className="field">
              <span>A conto</span>
              <select className="input" value={toAccountId ?? ''} onChange={(e) => setToAccountId(Number(e.target.value) || undefined)}>
                <option value="">—</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.currency !== 'EUR' ? ` (${a.currency})` : ''}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Data</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
            </label>
          )}
        </div>

        {type === 'transfer' && (
          <div className="grid-2">
            <label className="field">
              <span>Data</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
            </label>
            {crossCurrency && (
              <label className="field">
                <span>Accreditato in {to!.currency}</span>
                <input className="input" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder="0,00" />
              </label>
            )}
          </div>
        )}

        {future && <p className="notice">📅 Data futura: verrà registrato automaticamente il {shortDate(date)} e lo trovi in Pianificati.</p>}

        {showMore ? (
          <>
            <label className="field">
              <span>Tag (separati da virgola)</span>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="es. vacanze, lavoro" />
            </label>
            <label className="field">
              <span>Nota</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        ) : (
          <button type="button" className="link-btn" onClick={() => setShowMore(true)}>+ Tag e nota</button>
        )}

        {error && <p className="notice err" role="alert">{error}</p>}

        <div className="btn-row">
          {tx?.id && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button type="submit" className="btn primary">{future ? 'Pianifica' : 'Salva'}</button>
        </div>
      </form>
    </Sheet>
  );
}
