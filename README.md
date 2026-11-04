# Finanza Personale

App per prevedere i flussi di cassa: parte dal saldo di oggi e mostra come cambierà con entrate, uscite, rate e spese variabili future. Funziona su telefono e PC. È una PWA "local-first": i dati restano nel browser del dispositivo (IndexedDB) e non passano da nessun server.

## Comandi

```bash
npm run dev      # sviluppo, http://localhost:5173 (anche dalla rete locale)
npm test         # test della logica, inclusi stress test (fuzz e grandi volumi)
npm run build    # crea la versione installabile in dist/
npm run preview  # prova la build su http://localhost:4173
npm run deploy   # test + build + pubblicazione su GitHub Pages (ramo gh-pages)
```

App pubblicata: https://carmelofimmano.github.io/finanza-personale/

## Cosa c'è

- Previsione del saldo a 1, 3, 6 o 12 mesi con soglia di sicurezza e riepilogo mese per mese
- Scadenze: linea del tempo con saldo previsto per giorno; conferma con l'importo reale o salta
- Spese variabili stimate al mese, distribuite giorno per giorno nella previsione
- "Posso permettermelo?": simula un acquisto, subito o a rate, prima di confermarlo
- Saldo di oggi riallineabile con la banca in un tocco, senza ricostruire il passato

- Conti in EUR e USD, saldo iniziale, trasferimenti anche tra valute diverse
- Movimenti con categoria, tag e nota; ricerca e filtri
- Regole automatiche: l'app ricorda la categoria scelta per una descrizione e la propone le volte successive
- Import CSV degli estratti conto, con riconoscimento delle colonne e dei duplicati
- Budget mensili per categoria, con avviso quando si spende troppo in fretta
- Pianificati: ricorrenze (automatiche o promemoria), pagamenti una tantum e acquisti a rate
  (PayPal in 3 rate, Klarna, Scalapay, finanziamenti) con avanzamento e debito residuo
- Previsione del saldo a 60 giorni e avviso se andrebbe in negativo
- Abbonamenti rilevati dai movimenti che si ripetono ogni mese
- Campo importo con calcolatrice ("12+5,50"), categorie ordinate per uso, movimenti recenti da ripetere
- Una spesa con data futura diventa automaticamente un pagamento pianificato
- Annulla dopo un'eliminazione, tasto indietro di Android che chiude le schede, schede trascinabili
- Export CSV per Excel (con protezione dalle formule) e backup su file, facoltativamente cifrato (AES-GCM)

## Struttura

- `src/db.ts`: schema del database e categorie predefinite
- `src/logic.ts`: saldi, regole, ricorrenze, statistiche
- `src/csv.ts`, `src/backup.ts`: import ed export
- `src/screens/`: schermate

Gli importi sono salvati in centesimi interi. Le statistiche mensili considerano solo i conti in EUR.
