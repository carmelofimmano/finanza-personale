import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from './db';
import { processDue } from './logic';
import { Previsione, BalanceSheet, Simulator } from './screens/Previsione';
import { Scadenze } from './screens/Scadenze';
import { Budget } from './screens/Budget';
import { Altro } from './screens/Altro';
import { Pianificati, PlanForm, RecurringForm, ScheduledForm, type PlannedView } from './screens/Pianificati';
import { TxForm } from './screens/TxForm';
import { haptic, Sheet, toast, Toaster } from './ui';

const TABS = [
  ['home', '📈', 'Previsione'],
  ['scadenze', '🗓️', 'Scadenze'],
  ['pianificati', '🔁', 'Pianificati'],
  ['variabili', '🛒', 'Variabili'],
  ['altro', '⚙️', 'Altro'],
] as const;

const PLANNED_VIEWS: PlannedView[] = ['ricorrenti', 'unatantum', 'rate'];

// Vecchi indirizzi, per chi ha salvato un collegamento
const ALIASES: Record<string, string> = { 'altro/ricorrenti': 'pianificati', budget: 'variabili', movimenti: 'altro/storico' };

type SheetKind = 'add' | 'balance' | 'simulate' | 'out' | 'in' | 'recurring' | 'plan' | 'spent';

// La navigazione vive nell'hash (#scadenze, #altro/backup) così il tasto indietro di Android funziona
function useRoute(): [string, (r: string, replace?: boolean) => void] {
  const read = () => {
    const r = window.location.hash.slice(1) || 'home';
    return ALIASES[r] ?? r;
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
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [tab, sub] = route.split('/');

  useEffect(() => {
    const run = () =>
      processDue().then((n) => {
        if (n) toast(n === 1 ? '1 scadenza automatica registrata' : `${n} scadenze automatiche registrate`);
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
  const closeSheet = useCallback(() => setSheet(null), []);
  const activeTab = TABS.some((t) => t[0] === tab) ? tab : 'home';
  const plannedView = PLANNED_VIEWS.includes(sub as PlannedView) ? (sub as PlannedView) : 'ricorrenti';

  return (
    <>
      <main>
        <div className="screen" key={route}>
          {activeTab === 'scadenze' ? (
            <Scadenze />
          ) : activeTab === 'pianificati' ? (
            <Pianificati view={plannedView} onView={(v) => go(`pianificati/${v}`, true)} />
          ) : activeTab === 'variabili' ? (
            <Budget />
          ) : activeTab === 'altro' ? (
            <Altro page={sub} onPage={(p) => go(p ? `altro/${p}` : 'altro')} onEdit={setEditing} />
          ) : (
            <Previsione onGo={go} onOpen={setSheet} />
          )}
        </div>
      </main>

      <button className={`fab${fabHidden ? ' hidden' : ''}`} onClick={() => { haptic(5); setSheet('add'); }} aria-label="Aggiungi">+</button>

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
      {sheet === 'add' && <AddChooser onPick={(k) => (k === 'spent' ? (setSheet(null), setEditing('new')) : setSheet(k))} onClose={closeSheet} />}
      {sheet === 'balance' && <BalanceSheet onClose={closeSheet} />}
      {sheet === 'simulate' && <Simulator onClose={closeSheet} />}
      {sheet === 'out' && <ScheduledForm initialType="expense" onClose={closeSheet} />}
      {sheet === 'in' && <ScheduledForm initialType="income" onClose={closeSheet} />}
      {sheet === 'recurring' && <RecurringForm onClose={closeSheet} />}
      {sheet === 'plan' && <PlanForm onClose={closeSheet} />}
      {editing && <TxForm tx={editing === 'new' ? undefined : editing} onClose={closeForm} />}
    </>
  );
}

const CHOICES: [SheetKind, string, string, string][] = [
  ['out', '💸', 'Uscita futura', 'Bollo, assicurazione, una visita'],
  ['in', '💰', 'Entrata futura', 'Rimborso, bonus, una vendita'],
  ['recurring', '🔁', 'Ricorrente', 'Stipendio, affitto, abbonamenti'],
  ['plan', '💳', 'Acquisto a rate', 'PayPal, Klarna, Scalapay'],
  ['simulate', '🤔', 'Posso permettermelo?', 'Prova un acquisto senza salvarlo'],
  ['balance', '🏦', 'Aggiorna saldo', 'Riallinea con la banca'],
  ['spent', '🧾', 'Spesa già fatta', 'Scala subito dal saldo'],
];

function AddChooser({ onPick, onClose }: { onPick: (k: SheetKind) => void; onClose: () => void }) {
  return (
    <Sheet title="Aggiungi" onClose={onClose}>
      <div className="choices">
        {CHOICES.map(([k, icon, title, sub]) => (
          <button key={k} className="choice" onClick={() => { haptic(5); onPick(k); }}>
            <span className="choice-icon">{icon}</span>
            <span className="choice-title">{title}</span>
            <span className="choice-sub">{sub}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
