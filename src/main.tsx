import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

registerSW({ immediate: true });

// Senza StrictMode: il doppio montaggio in sviluppo sbilancerebbe la cronologia usata dalle schede
createRoot(document.getElementById('root')!).render(<App />);
