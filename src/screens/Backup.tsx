import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../db';
import { backupFileName, buildBackup, downloadText, isEncrypted, markBackupDone, restoreBackup, shareText } from '../backup';
import { shortDate } from '../dates';
import { PageHeader } from '../ui';

export function Backup({ back }: { back: () => void }) {
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackup'), [], undefined);
  const count = useLiveQuery(() => db.transactions.count(), [], 0);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator.canShare === 'function';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const exportFile = (share: boolean) =>
    run(async () => {
      const text = await buildBackup(password || undefined);
      const name = backupFileName();
      if (share) {
        if (!(await shareText(text, name))) return;
      } else {
        downloadText(text, name);
      }
      await markBackupDone();
      setMessage({ ok: true, text: `Backup creato${password ? ' e protetto da password' : ''}.` });
    });

  const restore = () =>
    run(async () => {
      if (!file) return;
      if (!confirm('I dati attuali su questo dispositivo verranno sostituiti da quelli del backup. Continuare?')) return;
      await restoreBackup(file.text, restorePassword || undefined);
      setFile(null);
      setRestorePassword('');
      setMessage({ ok: true, text: 'Dati ripristinati.' });
    });

  return (
    <>
      <PageHeader title="Backup e sincronizzazione" back={back} />

      <section className="card">
        <div className="card-head"><h2>Esporta</h2></div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {count} movimenti · {lastBackup ? `ultimo backup ${shortDate(lastBackup)}` : 'nessun backup fatto'}
        </p>
        <label className="field">
          <span>Password (facoltativa, consigliata se salvi il file online)</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="btn-row" style={{ marginTop: 0 }}>
          {canShare && <button className="btn primary" disabled={busy} onClick={() => exportFile(true)}>Condividi…</button>}
          <button className={`btn${canShare ? '' : ' primary'}`} disabled={busy} onClick={() => exportFile(false)}>Scarica file</button>
        </div>
        <p className="small muted">Se perdi la password, il backup protetto non si può aprire.</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Importa</h2></div>
        <label className="field">
          <span>File di backup</span>
          <input
            className="input"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setMessage(null);
              setFile(f ? { name: f.name, text: await f.text() } : null);
            }}
          />
        </label>
        {file && isEncrypted(file.text) && (
          <label className="field">
            <span>Password del backup</span>
            <input className="input" type="password" autoComplete="current-password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} />
          </label>
        )}
        <button className="btn block" disabled={!file || busy} onClick={restore}>Ripristina da {file?.name ?? 'file'}</button>
      </section>

      {message && <p className={`notice ${message.ok ? 'ok' : 'err'}`}>{message.text}</p>}

      <section className="card small">
        <div className="card-head"><h2>Come tenere allineati telefono e PC</h2></div>
        <ol style={{ margin: 0, paddingLeft: 18 }} className="muted">
          <li>Sul dispositivo dove hai inserito le ultime spese tocca <b>Condividi…</b> e salva il file su Google Drive (o mandalo a te stesso).</li>
          <li>Sull'altro dispositivo apri <b>Importa</b> e scegli quel file.</li>
          <li>Il ripristino sostituisce tutto: inserisci le spese su un solo dispositivo alla volta tra un passaggio e l'altro.</li>
        </ol>
      </section>
    </>
  );
}
