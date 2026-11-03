import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from './db';
import { processDue } from './logic';
import { Home } from './screens/Home';
import { Movimenti } from './screens/Movimenti';
import { Budget } from './screens/Budget';
import { Altro } from './screens/Altro';
import { Pianificati, type PlannedView } from './screens/Pianificati';
import { TxForm } from './screens/TxForm';
import { haptic, toast, Toaster } from './ui';

const TABS = [
  ['home', '🏠', 'Home'],
  ['movimenti', '📋', 'Movimenti'],
  ['pianificati', '📅', 'Pianificati'],
  ['budget', '🎯', 'Budget'],
  ['altro', '⚙️', 'Altro'],
] as const;

const PLANNED_VIEWS: PlannedView[] = ['ricorrenti', 'unatantum', 'rate'];

// La navigazione vive nell'hash (#movimenti, #altro/backup) così il tasto indietro di Android funziona
function useRoute(): [string, (r: string, replace?: boolean) => void] {
  const read = () => {
    const r = window.location.hash.slice(1) || 'home';
    return r === 'altro/ricorrenti' ? 'pianificati' : r;
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: string, replace = false) => {
    const url = r === 'home' ? window.location.pathname + window.location.search : `#${r}`;
    if (replace) {
      history.replaceState(null, '', url);
      setRoute(read());
    } else if (r === 'home') {
      history.pushState(null, '', url);
      setRoute('home');
    } else {
      window.location.hash = r;
    }
    window.scrollTo(0, 0);
  }, []);
  return [route, go];
}

export function App() {
  const [route, go] = useRoute();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [tab, sub] = route.split('/');

  useEffect(() => {
    const run = () =>
      processDue().then((n) => {
        if (n) toast(n === 1 ? '1 pagamento pianificato registrato' : `${n} pagamenti pianificati registrati`);
      });
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    // Chiede al browser di non cancellare i dati quando lo spazio scarseggia
    navigator.storage?.persist?.();
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Il + si nasconde scorrendo verso il basso per non coprire gli importi, e torna risalendo
  const [fabHidden, setFabHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setFabHidden(y > last && y > 80);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => setFabHidden(false), [route]);

  const closeForm = useCallback(() => setEditing(null), []);
  const activeTab = TABS.some((t) => t[0] === tab) ? tab : 'home';
  const plannedView = PLANNED_VIEWS.includes(sub as PlannedView) ? (sub as PlannedView) : 'ricorrenti';

  return (
    <>
      <main>
        <div className="screen" key={route}>
          {activeTab === 'movimenti' ? (
            <Movimenti onEdit={setEditing} />
          ) : activeTab === 'pianificati' ? (
            <Pianificati view={plannedView} onView={(v) => go(`pianificati/${v}`, true)} />
          ) : activeTab === 'budget' ? (
            <Budget />
          ) : activeTab === 'altro' ? (
            <Altro page={sub} onPage={(p) => go(p ? `altro/${p}` : 'altro')} />
          ) : (
            <Home onEdit={setEditing} onGo={go} />
          )}
        </div>
      </main>

      <button className={`fab${fabHidden ? ' hidden' : ''}`} onClick={() => { haptic(5); setEditing('new'); }} aria-label="Nuovo movimento">+</button>

      <nav className="tabbar">
        {TABS.map(([id, icon, label]) => (
          <button
            key={id}
            className={activeTab === id ? 'active' : ''}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => {
              if (activeTab === id && !sub) return window.scrollTo({ top: 0, behavior: 'smooth' });
              haptic(5);
              go(id);
            }}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Toaster />
      {editing && <TxForm tx={editing === 'new' ? undefined : editing} onClose={closeForm} />}
    </>
  );
}
