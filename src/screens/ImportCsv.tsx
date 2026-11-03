import { useEffect, useMemo, useState } from 'react';
import { db, type Rule, type Transaction } from '../db';
import { applyMapping, guessMapping, importHash, readCsv, type CsvMapping } from '../csv';
import { fmt } from '../money';
import { shortDate } from '../dates';
import { matchRule, normalizeDescription } from '../logic';
import { byId, PageHeader, useAccounts, useCategories } from '../ui';

export function ImportCsv({ back }: { back: () => void }) {
  const accounts = useAccounts();
  const catMap = byId(useCategories());
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [accountId, setAccountId] = useState<number | undefined>();
  const [rules, setRules] = useState<Rule[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    db.rules.toArray().then(setRules);
  }, []);

  // Impronte dei movimenti già presenti sul conto, per non importarli due volte
  useEffect(() => {
    if (!accountId) return;
    db.transactions.where('accountId').equals(accountId).toArray().then((txs) => {
      setExisting(new Set(txs.map((t) => t.importHash ?? importHash(accountId, {
        date: t.date,
        description: t.description,
        cents: t.type === 'income' ? t.amount : -t.amount,
      }))));
    });
  }, [accountId, result]);

  const onFile = async (file: File) => {
    setResult('');
    const buf = await file.arrayBuffer();
    // Molte banche italiane esportano in Windows-1252 invece che UTF-8
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    const parsed = readCsv(text);
    setRows(parsed);
    setFileName(file.name);
    setMapping(guessMapping(parsed));
  };

  const parsed = useMemo(() => (rows && mapping ? applyMapping(rows, mapping) : null), [rows, mapping]);
  const headers = rows && mapping ? rows[mapping.skipRows] ?? [] : [];
  const fresh = parsed && accountId ? parsed.rows.filter((r) => !existing.has(importHash(accountId, r))) : [];
  const dupes = parsed ? parsed.rows.length - fresh.length : 0;

  const doImport = async () => {
    if (!accountId || !fresh.length) return;
    setBusy(true);
    const now = Date.now();
    const txs: Transaction[] = fresh.map((r, i) => {
      const type = r.cents < 0 ? 'expense' : 'income';
      const rule = matchRule(r.description, rules);
      const ruleKind = rule ? catMap.get(rule.categoryId)?.kind : undefined;
      return {
        date: r.date,
        amount: Math.abs(r.cents),
        type,
        accountId,
        categoryId: ruleKind === type ? rule!.categoryId : undefined,
        description: r.description,
        tags: [],
        importHash: importHash(accountId, r),
        createdAt: now + i,
      };
    });
    await db.transactions.bulkAdd(txs);
    const categorized = txs.filter((t) => t.categoryId).length;
    setResult(`Importati ${txs.length} movimenti (${categorized} già categorizzati).`);
    setBusy(false);
  };

  const set = (patch: Partial<CsvMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const colSelect = (value: number, onChange: (v: number) => void, allowNone = false) => (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {allowNone && <option value={-1}>—</option>}
      {headers.map((h, i) => <option key={i} value={i}>{h || `Colonna ${i + 1}`}</option>)}
    </select>
  );

  return (
    <>
      <PageHeader title="Importa CSV" back={back} />
      <p className="small muted">
        Scarica l'estratto conto dalla tua banca in formato CSV e caricalo qui. I movimenti già importati vengono saltati.
        Se hai un file Excel, aprilo e salvalo come CSV.
      </p>

      <section className="card">
        <label className="field">
          <span>File</span>
          <input className="input" type="file" accept=".csv,.txt,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <label className="field">
          <span>Nel conto</span>
          <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </section>

      {rows && mapping && (
        <section className="card">
          <div className="card-head"><h2>Colonne di {fileName}</h2></div>
          <div className="grid-2">
            <label className="field">
              <span>Riga intestazione</span>
              <input className="input" type="number" min={1} max={rows.length} value={mapping.skipRows + 1} onChange={(e) => set({ skipRows: Math.max(0, Number(e.target.value) - 1) })} />
            </label>
            <label className="field"><span>Data</span>{colSelect(mapping.date, (v) => set({ date: v }))}</label>
          </div>
          <label className="field"><span>Descrizione</span>{colSelect(mapping.description, (v) => set({ description: v }))}</label>
          <div className="segmented">
            <button type="button" className={mapping.amount >= 0 ? 'active' : ''} onClick={() => set({ amount: Math.max(0, mapping.debit, mapping.credit) })}>Un importo con segno</button>
            <button type="button" className={mapping.amount < 0 ? 'active' : ''} onClick={() => set({ amount: -1, debit: Math.max(mapping.debit, 0), credit: Math.max(mapping.credit, 0) })}>Entrate e uscite separate</button>
          </div>
          {mapping.amount >= 0 ? (
            <label className="field"><span>Importo</span>{colSelect(mapping.amount, (v) => set({ amount: v }))}</label>
          ) : (
            <div className="grid-2">
              <label className="field"><span>Uscite</span>{colSelect(mapping.debit, (v) => set({ debit: v }), true)}</label>
              <label className="field"><span>Entrate</span>{colSelect(mapping.credit, (v) => set({ credit: v }), true)}</label>
            </div>
          )}
          <label className="toggle"><span>Inverti segno (le spese risultano positive)</span><input type="checkbox" checked={mapping.invert} onChange={(e) => set({ invert: e.target.checked })} /></label>
        </section>
      )}

      {parsed && (
        <section className="card">
          <div className="card-head"><h2>Anteprima</h2></div>
          <p className="small muted" style={{ marginTop: 0 }}>
            {parsed.rows.length} movimenti letti
            {dupes > 0 && ` · ${dupes} già presenti`}
            {parsed.errors > 0 && ` · ${parsed.errors} righe ignorate`}
          </p>
          <div className="table-wrap">
            <table className="preview">
              <tbody>
                {fresh.slice(0, 12).map((r, i) => {
                  const rule = matchRule(r.description, rules);
                  return (
                    <tr key={i}>
                      <td>{shortDate(r.date)}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.description}>{r.description || normalizeDescription(r.description)}</td>
                      <td>{rule ? `${catMap.get(rule.categoryId)?.icon ?? ''}` : ''}</td>
                      <td className={`num ${r.cents < 0 ? 'neg' : 'pos'}`}>{fmt(r.cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fresh.length > 12 && <p className="small muted">…e altri {fresh.length - 12}</p>}
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={!fresh.length || busy} onClick={doImport}>
            {fresh.length ? `Importa ${fresh.length} movimenti` : 'Niente di nuovo da importare'}
          </button>
        </section>
      )}

      {result && <p className="notice ok">{result} Puoi assegnare le categorie mancanti da Movimenti → “Senza categoria”.</p>}
    </>
  );
}
