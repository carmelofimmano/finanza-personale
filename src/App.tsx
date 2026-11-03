import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from './db';
import { processRecurring } from './logic';
import { Home } from './screens/Home';
import { Movimenti } from './screens/Movimenti';
import { Budget } from './screens/Budget';
import { Altro } from './screens/Altro';
import { TxForm } from './screens/TxForm';

const TABS = [
  ['home', '🏠', 'Home'],
  ['movimenti', '📋', 'Movimenti'],
  ['budget', '🎯', 'Budget'],
  ['altro', '⚙️', 'Altro'],
] as const;

// La navigazione vive nell'hash (#movimenti, #altro/backup) così il tasto indietro di Android funziona
function useRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.slice(1) || 'home';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: string) => {
    window.location.hash = r === 'home' ? '' : r;
    window.scrollTo(0, 0);
  }, []);
  return [route, go];
}

export function App() {
  const [route, go] = useRoute();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [tab, sub] = route.split('/');

  useEffect(() => {
    processRecurring();
    const onVisible = () => document.visibilityState === 'visible' && processRecurring();
    document.addEventListener('visibilitychange', onVisible);
    // Chiede al browser di non cancellare i dati quando lo spazio scarseggia
    navigator.storage?.persist?.();
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const closeForm = useCallback(() => setEditing(null), []);

  return (
    <>
      <main>
        {tab === 'movimenti' ? (
          <Movimenti onEdit={setEditing} />
        ) : tab === 'budget' ? (
          <Budget />
        ) : tab === 'altro' ? (
          <Altro page={sub} onPage={(p) => go(p ? `altro/${p}` : 'altro')} />
        ) : (
          <Home onEdit={setEditing} onGo={go} />
        )}
      </main>

      <button className="fab" onClick={() => setEditing('new')} aria-label="Nuovo movimento">+</button>

      <nav className="tabbar">
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id || (id === 'home' && !TABS.some((t) => t[0] === tab)) ? 'active' : ''} onClick={() => go(id)}>
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {editing && <TxForm tx={editing === 'new' ? undefined : editing} onClose={closeForm} />}
    </>
  );
}
