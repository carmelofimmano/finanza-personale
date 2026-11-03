# Finanza Personale

App per spese, budget e risparmi che funziona su telefono e PC. È una PWA "local-first": i dati restano nel browser del dispositivo (IndexedDB) e non passano da nessun server.

## Comandi

```bash
npm run dev      # sviluppo, http://localhost:5173 (anche dalla rete locale)
npm test         # test della logica
npm run build    # crea la versione installabile in dist/
npm run preview  # prova la build su http://localhost:4173
npm run deploy   # test + build + pubblicazione su GitHub Pages (ramo gh-pages)
```

App pubblicata: https://carmelofimmano.github.io/finanza-personale/

## Cosa c'è (fase 1)

- Conti in EUR e USD, saldo iniziale, trasferimenti anche tra valute diverse
- Movimenti con categoria, tag e nota; ricerca e filtri
- Regole automatiche: l'app ricorda la categoria scelta per una descrizione e la propone le volte successive
- Import CSV degli estratti conto, con riconoscimento delle colonne e dei duplicati
- Budget mensili per categoria, con avviso quando si spende troppo in fretta
- Ricorrenze automatiche o promemoria (affitto, stipendio, abbonamenti) e scadenze in Home
- Backup su file, facoltativamente cifrato (AES-GCM), per allineare telefono e PC

## Struttura

- `src/db.ts`: schema del database e categorie predefinite
- `src/logic.ts`: saldi, regole, ricorrenze, statistiche
- `src/csv.ts`, `src/backup.ts`: import ed export
- `src/screens/`: schermate

Gli importi sono salvati in centesimi interi. Le statistiche mensili considerano solo i conti in EUR.
