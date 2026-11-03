import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { evalAmount, fmt, parseAmount } from './money';
import { addDays, daysInMonth, isoDate, parseDate, today } from './dates';
import { applyMapping, guessMapping, readCsv, selectNew, transactionsToCsv, type ParsedRow } from './csv';
import {
  accountBalances, detectSubscriptions, installmentDates, matchRule, nextOccurrence,
  processDue, splitInstallments, createPlan, forecast, upcomingAll,
} from './logic';
import { db, type Account, type Transaction } from './db';
import { buildBackup, restoreBackup } from './backup';

// Generatore pseudo-casuale riproducibile, così un fallimento si può rigiocare
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}
const rand = rng(42);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const base: Omit<Transaction, 'amount' | 'type' | 'accountId' | 'date'> = { description: '', tags: [], createdAt: 0 };

describe('importi: fuzz', () => {
  it('rilegge 5000 importi scritti in tutti i formati', () => {
    for (let i = 0; i < 5000; i++) {
      const cents = int(-99_999_999_99, 99_999_999_99);
      const abs = Math.abs(cents);
      const sign = cents < 0 ? '-' : '';
      const euros = Math.floor(abs / 100);
      const dec = String(abs % 100).padStart(2, '0');
      const groupIt = euros.toLocaleString('it-IT', { useGrouping: 'always' });
      const groupEn = euros.toLocaleString('en-US');
      const forms = [
        `${sign}${euros},${dec}`,
        `${sign}${euros}.${dec}`,
        `${sign}${groupIt},${dec}`,
        `${sign}${groupEn}.${dec}`,
        `${sign}€ ${groupIt},${dec}`,
        `${groupIt},${dec}${sign}`,
        fmt(cents),
      ];
      for (const f of forms) expect(parseAmount(f), f).toBe(cents);
    }
  });

  it('interpreta "1.000" e "12.500" come migliaia, "0,500" come decimale', () => {
    expect(parseAmount('1.000')).toBe(100000);
    expect(parseAmount('12.500')).toBe(1250000);
    expect(parseAmount('1,000')).toBe(100000);
    expect(parseAmount('0,500')).toBe(50);
    expect(parseAmount('1.5')).toBe(150);
    expect(parseAmount("1'234.50")).toBe(123450);
  });

  it('arrotonda al centesimo senza errori di virgola mobile', () => {
    expect(parseAmount('1234,565')).toBe(123457);
    expect(parseAmount('0,005')).toBe(1);
    expect(parseAmount('0,1')).toBe(10);
    expect(parseAmount('19,99')).toBe(1999);
    expect(parseAmount('4,35')).toBe(435);
  });

  it('rifiuta input malformati', () => {
    for (const s of ['1.2.3', '1,,2', '--5', '1e5', 'NaN', 'Infinity', '12abc', '.', ',', '1.23,4.5', '0x10', '١٢']) {
      expect(parseAmount(s), s).toBeNull();
    }
  });

  it('calcola espressioni nel campo importo', () => {
    expect(evalAmount('12+5,50')).toBe(1750);
    expect(evalAmount('100 - 20,5 + 0,5')).toBe(8000);
    expect(evalAmount('30')).toBe(3000);
    expect(evalAmount('12+')).toBeNull();
    expect(evalAmount('')).toBeNull();
  });
});

describe('date: fuzz', () => {
  it('rilegge 3000 date casuali in 4 formati', () => {
    for (let i = 0; i < 3000; i++) {
      const y = int(2000, 2099);
      const m = int(1, 12);
      const d = int(1, daysInMonth(y, m));
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dd = String(d).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      for (const f of [iso, `${dd}/${mm}/${y}`, `${d}-${m}-${String(y).slice(2)}`, `${dd}.${mm}.${y}`]) {
        expect(parseDate(f), f).toBe(iso);
      }
    }
  });

  it('addDays attraversa anni e cambi ora legale', () => {
    let d = '2026-01-01';
    for (let i = 0; i < 800; i++) {
      const next = addDays(d, 1);
      expect(next > d).toBe(true);
      d = next;
    }
    expect(d).toBe('2028-03-11');
  });
});

describe('ricorrenze: 20 anni', () => {
  it('mensile il 31 non perde né salta mesi', () => {
    let d = '2026-01-31';
    for (let i = 0; i < 240; i++) {
      const next = nextOccurrence(d, 'monthly', 31);
      const [y, m] = next.split('-').map(Number);
      const [py, pm] = d.split('-').map(Number);
      expect((y - py) * 12 + (m - pm)).toBe(1);
      expect(Number(next.slice(8))).toBe(daysInMonth(y, m));
      d = next;
    }
  });

  it('annuale il 29 febbraio torna al 29 negli anni bisestili', () => {
    let d = '2028-02-29';
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) seen.push((d = nextOccurrence(d, 'yearly', 29)));
    expect(seen).toContain('2032-02-29');
    expect(seen).toContain('2036-02-29');
  });
});

describe('regole', () => {
  it('confronta parole intere, non pezzi di parola', () => {
    const rules = [{ id: 1, pattern: 'bar', categoryId: 1 }, { id: 2, pattern: 'eni', categoryId: 2 }];
    expect(matchRule('Bar Sport', rules)?.categoryId).toBe(1);
    expect(matchRule('Farmacia Lombardia', rules)).toBeUndefined();
    expect(matchRule('Pagamento ENI station', rules)?.categoryId).toBe(2);
    expect(matchRule('Venice tour', rules)).toBeUndefined();
  });
});

describe('CSV: casi ostili', () => {
  it('separatori diversi, virgolette, CRLF, BOM, righe di totale', () => {
    const variants = [
      '﻿Data;Descrizione;Importo\r\n01/11/2026;"Bar; caffè";-1,20\r\n02/11/2026;Stipendio;1.850,00\r\nSaldo finale;;1.848,80\r\n',
      'Data,Descrizione,Importo\n01/11/2026,"Bar, caffè",-1.20\n02/11/2026,Stipendio,"1,850.00"\n',
      'Data\tDescrizione\tImporto\n01/11/2026\tBar\t-1,20\n02/11/2026\tStipendio\t1850\n',
    ];
    for (const v of variants) {
      const rows = readCsv(v);
      const { rows: parsed } = applyMapping(rows, guessMapping(rows));
      expect(parsed.map((r) => r.cents), v).toEqual([-120, 185000]);
    }
  });

  it('non scarta movimenti identici nello stesso file, ma li salta al secondo import', () => {
    const rows: ParsedRow[] = [
      { date: '2026-11-01', description: 'Caffè', cents: -120 },
      { date: '2026-11-01', description: 'Caffè', cents: -120 },
      { date: '2026-11-02', description: 'Pane', cents: -250 },
    ];
    const first = selectNew(1, rows, []);
    expect(first.fresh.length).toBe(3);
    const stored = first.fresh.map((r) => ({ ...base, date: r.date, amount: Math.abs(r.cents), type: 'expense' as const, accountId: 1, description: r.description, importHash: r.hash }));
    const second = selectNew(1, rows, stored);
    expect(second.fresh.length).toBe(0);
    expect(second.dupes).toBe(3);
    // Un terzo caffè nello stesso giorno in un nuovo estratto viene importato
    const third = selectNew(1, [...rows, rows[0]], stored);
    expect(third.fresh.length).toBe(1);
  });

  it('10.000 righe in meno di un secondo', () => {
    const lines = ['Data;Descrizione;Importo'];
    for (let i = 0; i < 10000; i++) lines.push(`${String(int(1, 28)).padStart(2, '0')}/0${int(1, 9)}/2026;Negozio ${i % 300};-${int(1, 500)},${int(10, 99)}`);
    const t0 = performance.now();
    const rows = readCsv(lines.join('\n'));
    const { rows: parsed } = applyMapping(rows, guessMapping(rows));
    selectNew(1, parsed, []);
    expect(parsed.length).toBe(10000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("l'export CSV neutralizza le formule di Excel", () => {
    const csv = transactionsToCsv(
      [{ ...base, date: '2026-11-01', amount: 1234, type: 'expense', accountId: 1, description: '=HYPERLINK("http://x")', tags: ['a'], note: 'riga;con;punti\nevirgola' }],
      new Map([[1, { id: 1, name: 'Conto', type: 'conto', currency: 'EUR', initial: 0 } as Account]]),
      new Map(),
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('-12,34');
    expect(csv).toContain('"riga;con;punti\nevirgola"');
  });
});

describe('saldi: volume', () => {
  it('100.000 movimenti in meno di 150 ms', () => {
    const accounts: Account[] = [1, 2, 3].map((id) => ({ id, name: `C${id}`, type: 'conto', currency: 'EUR', initial: 0 }));
    const txs: Transaction[] = [];
    let expected = 0;
    for (let i = 0; i < 100000; i++) {
      const amount = int(1, 100000);
      const type = rand() < 0.3 ? 'income' : 'expense';
      expected += type === 'income' ? amount : -amount;
      txs.push({ ...base, date: '2026-01-01', amount, type, accountId: int(1, 3) });
    }
    const t0 = performance.now();
    const b = accountBalances(accounts, txs);
    expect(performance.now() - t0).toBeLessThan(150);
    expect(b.get(1)! + b.get(2)! + b.get(3)!).toBe(expected);
  });
});

describe('rate', () => {
  it('la somma delle rate è sempre uguale al totale', () => {
    for (let i = 0; i < 2000; i++) {
      const total = int(1, 10_000_00);
      const count = int(1, 48);
      const parts = splitInstallments(total, count);
      expect(parts.length).toBe(count);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThan(count);
    }
  });

  it('date delle rate per ogni frequenza', () => {
    expect(installmentDates('2026-01-31', 3, 'monthly')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(installmentDates('2026-11-03', 3, 'days30')).toEqual(['2026-11-03', '2026-12-03', '2027-01-02']);
    expect(installmentDates('2026-11-03', 3, 'biweekly')).toEqual(['2026-11-03', '2026-11-17', '2026-12-01']);
  });
});

describe('database: scadenze e rate', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.accounts.add({ id: 1, name: 'Conto', type: 'conto', currency: 'EUR', initial: 100000 });
  });

  it('una ricorrenza di 3 anni fa viene recuperata una volta sola, anche con chiamate in parallelo', async () => {
    const start = isoDate(new Date(new Date().getFullYear() - 3, new Date().getMonth(), 1));
    await db.recurring.add({ description: 'Affitto', amount: 50000, type: 'expense', accountId: 1, frequency: 'monthly', day: 1, nextDate: start, autoCreate: true, active: true });
    await Promise.all([processDue(), processDue(), processDue()]);
    const n = await db.transactions.count();
    expect(n).toBeGreaterThanOrEqual(36);
    expect(n).toBeLessThanOrEqual(37);
    await processDue();
    expect(await db.transactions.count()).toBe(n);
    expect((await db.recurring.toArray())[0].nextDate > today()).toBe(true);
  });

  it('PayPal in 3 rate: la prima si paga oggi, le altre restano pianificate', async () => {
    const id = await createPlan({ description: 'Cuffie', provider: 'PayPal', total: 10000, count: 3, frequency: 'monthly', firstDate: today(), accountId: 1 });
    const txs = await db.transactions.toArray();
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(3334);
    const pending = (await db.scheduled.where('planId').equals(id).toArray()).filter((s) => !s.doneTxId);
    expect(pending.map((s) => s.amount)).toEqual([3333, 3333]);
    await processDue();
    expect(await db.transactions.count()).toBe(1);
  });

  it('la previsione include rate e ricorrenze e trova il punto più basso', async () => {
    await createPlan({ description: 'TV', provider: 'Klarna', total: 90000, count: 3, frequency: 'days30', firstDate: addDays(today(), 1), accountId: 1 });
    const upcoming = upcomingAll([], await db.scheduled.toArray(), 90);
    const f = forecast(100000, upcoming, new Set([1]), 90);
    expect(f.points.length).toBe(91);
    expect(f.end).toBe(10000);
    expect(f.min.balance).toBe(10000);
  });

  // Il database finto dei test impiega ~3 s per scrivere 20.000 righe: si misura solo la cifratura
  it('backup con 20.000 movimenti, cifrato in meno di 1 secondo e ripristinato intatto', async () => {
    const txs: Transaction[] = Array.from({ length: 20000 }, (_, i) => ({ ...base, date: '2026-01-01', amount: i + 1, type: 'expense', accountId: 1, description: `Spesa ${i} àèìòù €` }));
    await db.transactions.bulkAdd(txs);
    const t0 = performance.now();
    const text = await buildBackup('pw');
    expect(performance.now() - t0).toBeLessThan(1000);
    await db.transactions.clear();
    await restoreBackup(text, 'pw');
    expect(await db.transactions.count()).toBe(20000);
    expect((await db.transactions.orderBy(':id').last())?.description).toBe('Spesa 19999 àèìòù €');
  }, 30000);

  it('il ripristino rifiuta file corrotti con un messaggio chiaro senza toccare i dati', async () => {
    await db.transactions.add({ ...base, date: '2026-01-01', amount: 1, type: 'expense', accountId: 1 });
    for (const bad of ['', 'non json', '{}', '{"app":"altro"}', '{"app":"finanza-personale","data":{}}']) {
      await expect(restoreBackup(bad)).rejects.toThrow(/backup|file/i);
    }
    expect(await db.transactions.count()).toBe(1);
  });
});

describe('abbonamenti', () => {
  it('riconosce una spesa mensile simile, non la spesa al supermercato', () => {
    const txs: Transaction[] = [];
    const t = today();
    for (let m = 0; m < 5; m++) {
      const d = addDays(t, -m * 30 - 2);
      txs.push({ ...base, date: d, amount: 1299 + (m % 2), type: 'expense', accountId: 1, description: `NETFLIX.COM ${m}` });
      for (let w = 0; w < 4; w++) txs.push({ ...base, date: addDays(d, -w * 7), amount: int(2000, 9000), type: 'expense', accountId: 1, description: 'Esselunga' });
    }
    const found = detectSubscriptions(txs, []);
    expect(found.map((f) => f.description)).toEqual(['NETFLIX.COM 0']);
    expect(found[0].amount).toBeGreaterThanOrEqual(1299);
  });
});
