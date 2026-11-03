import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { COLORS, db, type Account, type AccountType, type Category, type Currency, type Kind, type Rule } from '../db';
import { fmt, parseAmount, toInput } from '../money';
import { accountBalances, applyRulesToUncategorized, normalizeDescription } from '../logic';
import { byId, CatIcon, Empty, PageHeader, Sheet, useAccounts, useCategories } from '../ui';
import { ImportCsv } from './ImportCsv';
import { Backup } from './Backup';

const PAGES = [
  ['conti', '🏦', 'Conti', 'Conti correnti, carte, contanti, risparmi'],
  ['categorie', '🏷️', 'Categorie', 'Personalizza nomi e icone'],
  ['regole', '🪄', 'Regole automatiche', 'Descrizione → categoria'],
  ['import', '📄', 'Importa estratto conto', 'File CSV della banca'],
  ['backup', '💾', 'Backup e sincronizzazione', 'Esporta o importa i dati tra telefono e PC'],
] as const;

export function Altro({ page, onPage }: { page?: string; onPage: (p?: string) => void }) {
  const back = () => onPage(undefined);
  switch (page) {
    case 'conti': return <Conti back={back} />;
    case 'categorie': return <Categorie back={back} />;
    case 'regole': return <Regole back={back} />;
    case 'import': return <ImportCsv back={back} />;
    case 'backup': return <Backup back={back} />;
  }
  return (
    <>
      <PageHeader title="Altro" />
      <section className="card">
        <ul className="list">
          {PAGES.map(([id, icon, title, sub]) => (
            <li key={id}>
              <button className="row" onClick={() => onPage(id)}>
                <span className="cat-icon" style={{ background: 'var(--surface-2)' }}>{icon}</span>
                <div className="grow">
                  <div className="title">{title}</div>
                  <div className="sub">{sub}</div>
                </div>
                <span className="muted">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p className="small muted" style={{ textAlign: 'center' }}>
        I dati sono salvati solo su questo dispositivo. Usa il backup per portarli sugli altri.
      </p>
    </>
  );
}

const ACCOUNT_TYPES: [AccountType, string, string][] = [
  ['conto', 'Conto corrente', '🏦'],
  ['carta', 'Carta', '💳'],
  ['contanti', 'Contanti', '💶'],
  ['risparmio', 'Risparmio', '🐷'],
  ['investimenti', 'Investimenti', '📈'],
];

function Conti({ back }: { back: () => void }) {
  const accounts = useAccounts(true);
  const txs = useLiveQuery(() => db.transactions.toArray(), [], []);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const balances = accountBalances(accounts, txs);
  return (
    <>
      <PageHeader title="Conti" back={back} action={<button className="btn" onClick={() => setEditing('new')}>+ Nuovo</button>} />
      <section className="card">
        <ul className="list">
          {accounts.map((a) => (
            <li key={a.id}>
              <button className="row" onClick={() => setEditing(a)} style={{ opacity: a.archived ? 0.5 : 1 }}>
                <span className="cat-icon" style={{ background: 'var(--surface-2)' }}>{ACCOUNT_TYPES.find((t) => t[0] === a.type)?.[2]}</span>
                <div className="grow">
                  <div className="title">{a.name}</div>
                  <div className="sub">{ACCOUNT_TYPES.find((t) => t[0] === a.type)?.[1]} · {a.currency}{a.archived ? ' · archiviato' : ''}</div>
                </div>
                <span className={`amount ${(balances.get(a.id!) ?? 0) < 0 ? 'neg' : ''}`}>{fmt(balances.get(a.id!) ?? 0, a.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {editing && <AccountForm account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'conto');
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? 'EUR');
  const [initial, setInitial] = useState(account ? toInput(account.initial) : '');
  const [archived, setArchived] = useState(!!account?.archived);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return setError('Inserisci un nome.');
    const data: Account = { name: name.trim(), type, currency, initial: parseAmount(initial) ?? 0, archived };
    if (account?.id) await db.accounts.put({ ...data, id: account.id });
    else await db.accounts.add(data);
    onClose();
  };

  const remove = async () => {
    const id = account!.id!;
    const used = await db.transactions.filter((t) => t.accountId === id || t.toAccountId === id).count();
    if (used > 0) return setError(`Il conto ha ${used} movimenti: puoi archiviarlo invece di eliminarlo.`);
    const planned = (await db.recurring.filter((r) => r.accountId === id).count()) + (await db.scheduled.filter((s) => s.accountId === id && !s.doneTxId).count());
    if (planned > 0) return setError(`Il conto ha ${planned} pagamenti pianificati: spostali o eliminali prima.`);
    if (confirm('Eliminare il conto?')) {
      await db.accounts.delete(account!.id!);
      onClose();
    }
  };

  return (
    <Sheet title={account ? 'Modifica conto' : 'Nuovo conto'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field"><span>Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!account} /></label>
        <div className="grid-2">
          <label className="field">
            <span>Tipo</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Valuta</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Saldo iniziale</span><input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0,00" /></label>
        {account && (
          <label className="toggle"><span>Archiviato (nascosto dalle scelte)</span><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /></label>
        )}
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {account && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}

function Categorie({ back }: { back: () => void }) {
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | Kind | null>(null);
  return (
    <>
      <PageHeader title="Categorie" back={back} />
      {(['expense', 'income'] as const).map((kind) => (
        <section key={kind}>
          <div className="card-head" style={{ margin: '16px 4px 8px' }}>
            <h3 style={{ margin: 0 }}>{kind === 'expense' ? 'Uscite' : 'Entrate'}</h3>
            <button className="chip" onClick={() => setEditing(kind)}>+ Aggiungi</button>
          </div>
          <div className="card">
            <ul className="list">
              {categories.filter((c) => c.kind === kind).map((c) => (
                <li key={c.id}>
                  <button className="row" onClick={() => setEditing(c)}>
                    <CatIcon category={c} />
                    <div className="grow title">{c.name}</div>
                    <span className="dot" style={{ background: c.color }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
      {editing && (
        <CategoryForm
          category={typeof editing === 'string' ? undefined : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CategoryForm({ category, kind, onClose }: { category?: Category; kind: Kind; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '📦');
  const [color, setColor] = useState(category?.color ?? COLORS[0]);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return setError('Inserisci un nome.');
    const data: Category = { name: name.trim(), icon: icon.trim() || '📦', color, kind };
    if (category?.id) await db.categories.put({ ...data, id: category.id });
    else await db.categories.add(data);
    onClose();
  };

  const remove = async () => {
    const used = await db.transactions.where('categoryId').equals(category!.id!).count();
    const msg = used > 0 ? `${used} movimenti resteranno senza categoria. Eliminare?` : 'Eliminare la categoria?';
    if (!confirm(msg)) return;
    await db.transaction('rw', [db.transactions, db.categories, db.rules, db.budgets, db.recurring, db.scheduled, db.plans], async () => {
      await db.transactions.where('categoryId').equals(category!.id!).modify((t) => { delete t.categoryId; });
      await db.rules.where('categoryId').equals(category!.id!).delete();
      await db.budgets.where('categoryId').equals(category!.id!).delete();
      await db.recurring.filter((r) => r.categoryId === category!.id).modify((r) => { delete r.categoryId; });
      await db.scheduled.filter((s) => s.categoryId === category!.id).modify((s) => { delete s.categoryId; });
      await db.plans.filter((p) => p.categoryId === category!.id).modify((p) => { delete p.categoryId; });
      await db.categories.delete(category!.id!);
    });
    onClose();
  };

  return (
    <Sheet title={category ? 'Modifica categoria' : 'Nuova categoria'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid-2" style={{ gridTemplateColumns: '80px 1fr' }}>
          <label className="field"><span>Icona</span><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ textAlign: 'center', fontSize: 20 }} /></label>
          <label className="field"><span>Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!category} /></label>
        </div>
        <div className="field"><span>Colore</span></div>
        <div className="color-pick">
          {COLORS.map((c) => (
            <button type="button" key={c} className={color === c ? 'active' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {category && <button type="button" className="btn danger" onClick={remove}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}

function Regole({ back }: { back: () => void }) {
  const rules = useLiveQuery(() => db.rules.orderBy('pattern').toArray(), [], []);
  const categories = useCategories();
  const catMap = byId(categories);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [message, setMessage] = useState('');

  const apply = async () => {
    const n = await applyRulesToUncategorized();
    setMessage(n ? `Categoria assegnata a ${n} movimenti.` : 'Nessun movimento senza categoria corrisponde alle regole.');
  };

  return (
    <>
      <PageHeader title="Regole automatiche" back={back} action={<button className="btn" onClick={() => setEditing('new')}>+ Nuova</button>} />
      <p className="small muted">
        Quando la descrizione di un movimento contiene il testo della regola, la categoria viene proposta da sola.
        Le regole si creano anche da sole: ogni volta che scegli una categoria, l'app la ricorda.
      </p>
      <button className="btn block" onClick={apply} style={{ marginBottom: 12 }}>Applica ai movimenti senza categoria</button>
      {message && <p className="notice ok">{message}</p>}
      <section className="card">
        {rules.length === 0 ? <Empty>Ancora nessuna regola.</Empty> : (
          <ul className="list">
            {rules.map((r) => (
              <li key={r.id}>
                <button className="row" onClick={() => setEditing(r)}>
                  <CatIcon category={catMap.get(r.categoryId)} />
                  <div className="grow">
                    <div className="title">“{r.pattern}”</div>
                    <div className="sub">→ {catMap.get(r.categoryId)?.name ?? '?'}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <RuleForm rule={editing === 'new' ? undefined : editing} categories={categories} onClose={() => setEditing(null)} />}
    </>
  );
}

function RuleForm({ rule, categories, onClose }: { rule?: Rule; categories: Category[]; onClose: () => void }) {
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? categories[0]?.id);
  const [error, setError] = useState('');
  const save = async () => {
    const p = normalizeDescription(pattern);
    if (p.length < 2) return setError('Il testo deve avere almeno 2 lettere.');
    if (!categoryId) return setError('Scegli una categoria.');
    if (rule?.id) await db.rules.put({ id: rule.id, pattern: p, categoryId });
    else await db.rules.add({ pattern: p, categoryId });
    onClose();
  };
  return (
    <Sheet title={rule ? 'Modifica regola' : 'Nuova regola'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field"><span>Se la descrizione contiene</span><input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="es. esselunga" autoFocus /></label>
        <label className="field">
          <span>Categoria</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name} ({c.kind === 'expense' ? 'uscita' : 'entrata'})</option>)}
          </select>
        </label>
        {error && <p className="notice err">{error}</p>}
        <div className="btn-row">
          {rule && <button type="button" className="btn danger" onClick={async () => { await db.rules.delete(rule.id!); onClose(); }}>Elimina</button>}
          <button className="btn primary" type="submit">Salva</button>
        </div>
      </form>
    </Sheet>
  );
}
