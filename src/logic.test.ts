import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseAmount } from './money';
import { parseDate } from './dates';
import { applyMapping, guessMapping, readCsv } from './csv';
import { accountBalances, matchRule, nextOccurrence, normalizeDescription, upcomingOccurrences } from './logic';
import { db, type Recurring } from './db';
import { buildBackup, isEncrypted, restoreBackup } from './backup';

describe('backup', () => {
  it('esporta e ripristina con password', async () => {
    await db.transactions.add({ date: '2026-11-01', amount: 999, type: 'expense', accountId: 1, description: 'Test', tags: [], createdAt: 1 });
    const text = await buildBackup('segreta');
    expect(isEncrypted(text)).toBe(true);
    expect(text).not.toContain('Test');
    await db.transactions.clear();
    await expect(restoreBackup(text, 'sbagliata')).rejects.toThrow('Password errata');
    await restoreBackup(text, 'segreta');
    expect((await db.transactions.toArray()).map((t) => t.description)).toEqual(['Test']);
    expect(await db.categories.count()).toBeGreaterThan(10);
  });
});

describe('parseAmount', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['-45,00', -4500],
    ['€ 1.000.000', 100000000],
    ['45,00-', -4500],
    ['(10,00)', -1000],
    ['+3', 300],
  ])('%s → %i', (input, cents) => expect(parseAmount(input)).toBe(cents));

  it('rifiuta testo non numerico', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['31/12/2026', '2026-12-31'],
    ['1-2-26', '2026-02-01'],
    ['05.03.2026', '2026-03-05'],
    ['2026-11-03', '2026-11-03'],
    ['2026-11-03T10:00:00', '2026-11-03'],
  ])('%s → %s', (input, iso) => expect(parseDate(input)).toBe(iso));

  it('rifiuta date impossibili', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('ciao')).toBeNull();
  });
});

describe('CSV', () => {
  it('riconosce intestazione dopo righe di preambolo e colonne separate', () => {
    const text = [
      'Estratto conto;;;',
      'Conto n. 123;;;',
      'Data operazione;Descrizione;Uscite;Entrate',
      '01/11/2026;PAGAMENTO POS ESSELUNGA 1234;45,30;',
      '02/11/2026;STIPENDIO OTTOBRE;;1.850,00',
      'Totale;;;',
    ].join('\n');
    const rows = readCsv(text);
    const m = guessMapping(rows);
    expect(m.skipRows).toBe(2);
    expect(m.amount).toBe(-1);
    const { rows: parsed, errors } = applyMapping(rows, m);
    expect(parsed).toEqual([
      { date: '2026-11-01', description: 'PAGAMENTO POS ESSELUNGA 1234', cents: -4530 },
      { date: '2026-11-02', description: 'STIPENDIO OTTOBRE', cents: 185000 },
    ]);
    expect(errors).toBe(1);
  });

  it('usa una colonna importo con segno', () => {
    const rows = readCsv('Date,Description,Amount\n2026-11-01,Coffee,-3.50\n');
    const { rows: parsed } = applyMapping(rows, guessMapping(rows));
    expect(parsed[0]).toEqual({ date: '2026-11-01', description: 'Coffee', cents: -350 });
  });
});

describe('regole', () => {
  it('normalizza e sceglie la regola più specifica', () => {
    expect(normalizeDescription('PAGAMENTO POS ESSELUNGA 1234 MI')).toBe('pagamento pos esselunga mi');
    const rules = [
      { id: 1, pattern: 'pagamento pos', categoryId: 1 },
      { id: 2, pattern: 'esselunga', categoryId: 2 },
    ];
    expect(matchRule('PAGAMENTO POS ESSELUNGA 1234', rules)?.categoryId).toBe(1);
    expect(matchRule('Esselunga', rules)?.categoryId).toBe(2);
    expect(matchRule('Bar', rules)).toBeUndefined();
  });
});

describe('ricorrenze', () => {
  it('mantiene il giorno di riferimento nei mesi corti', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(nextOccurrence('2026-12-15', 'monthly', 15)).toBe('2027-01-15');
    expect(nextOccurrence('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
    expect(nextOccurrence('2026-12-29', 'weekly', 29)).toBe('2027-01-05');
  });

  it('elenca più occorrenze settimanali nella finestra', () => {
    const r: Recurring = {
      id: 1, description: 'Palestra', amount: 1000, type: 'expense', accountId: 1,
      frequency: 'weekly', day: 1, nextDate: new Date().toISOString().slice(0, 10), autoCreate: false, active: true,
    };
    expect(upcomingOccurrences([r], 30).length).toBeGreaterThanOrEqual(4);
  });
});

describe('saldi', () => {
  it('calcola saldi con trasferimenti tra valute', () => {
    const accounts = [
      { id: 1, name: 'Conto', type: 'conto' as const, currency: 'EUR' as const, initial: 100000 },
      { id: 2, name: 'Broker', type: 'investimenti' as const, currency: 'USD' as const, initial: 0 },
    ];
    const base = { tags: [], description: '', createdAt: 0, date: '2026-11-01' };
    const balances = accountBalances(accounts, [
      { ...base, type: 'expense', amount: 2000, accountId: 1 },
      { ...base, type: 'income', amount: 5000, accountId: 1 },
      { ...base, type: 'transfer', amount: 10000, accountId: 1, toAccountId: 2, toAmount: 10800 },
    ]);
    expect(balances.get(1)).toBe(93000);
    expect(balances.get(2)).toBe(10800);
  });
});
