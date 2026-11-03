import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction, type TxType } from '../db';
import { parseAmount, toInput } from '../money';
import { today } from '../dates';
import { learnRule, parseTags, suggestCategory } from '../logic';
import { Sheet, useAccounts, useCategories } from '../ui';

const LAST_ACCOUNT = 'fp:lastAccount';

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
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  const descriptions = useLiveQuery(async () => {
    const recent = await db.transactions.orderBy('date').reverse().limit(400).toArray();
    return [...new Set(recent.map((t) => t.description).filter(Boolean))].slice(0, 80);
  }, [], [] as string[]);

  useEffect(() => {
    if (!tx) amountRef.current?.focus();
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
      setSuggested(id);
      if (!pickedByUser && id !== undefined) setCategoryId(id);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [description, type, pickedByUser]);

  const kindCategories = useMemo(() => categories.filter((c) => c.kind === type), [categories, type]);
  const from = accounts.find((a) => a.id === accountId);
  const to = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === 'transfer' && from && to && from.currency !== to.currency;

  const changeType = (t: TxType) => {
    setType(t);
    if (categories.find((c) => c.id === categoryId)?.kind !== t) {
      setCategoryId(undefined);
      setPickedByUser(false);
    }
  };

  const save = async () => {
    const cents = parseAmount(amount);
    if (!cents || cents <= 0) return setError('Inserisci un importo valido.');
    if (!accountId) return setError('Scegli un conto.');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Scegli un conto di destinazione diverso.');
    const toCents = crossCurrency ? parseAmount(toAmount) : null;
    if (crossCurrency && (!toCents || toCents <= 0)) return setError(`Inserisci l'importo accreditato in ${to!.currency}.`);

    const data: Transaction = {
      date,
      amount: Math.abs(cents),
      type,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      toAmount: crossCurrency ? Math.abs(toCents!) : undefined,
      categoryId: type === 'transfer' ? undefined : categoryId,
      description: description.trim() || (type === 'transfer' ? 'Trasferimento' : ''),
      tags: parseTags(tags),
      note: note.trim() || undefined,
      recurringId: tx?.recurringId,
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
    onClose();
  };

  const remove = async () => {
    if (tx?.id && confirm('Eliminare questo movimento?')) {
      await db.transactions.delete(tx.id);
      onClose();
    }
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
          placeholder={`0,00 ${from?.currency === 'USD' ? '$' : '€'}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Importo"
        />

        <label className="field">
          <span>Descrizione</span>
          <input
            className="input"
            list="descriptions"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === 'transfer' ? 'Trasferimento' : 'es. Esselunga'}
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
              {kindCategories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`chip${categoryId === c.id ? ' active' : ''}`}
                  onClick={() => {
                    setCategoryId(categoryId === c.id ? undefined : c.id);
                    setPickedByUser(true);
                  }}
                >
                  {c.icon} {c.name}
                  {suggested === c.id && !pickedByUser && <span className="suggested">auto</span>}
                </button>
              ))}
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

        <label className="field">
          <span>Tag (separati da virgola)</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="es. vacanze, lavoro" />
        </label>
        <label className="field">
          <span>Nota</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <p className="notice err">{error}</p>}

        <div className="btn-row">
          {tx?.id && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button type="submit" className="btn primary">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}
