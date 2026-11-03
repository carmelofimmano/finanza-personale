import Papa from 'papaparse';
import { parseAmount } from './money';
import { parseDate } from './dates';
import { normalizeDescription } from './logic';
import type { Account, Category, Transaction } from './db';

export interface CsvMapping {
  skipRows: number;
  date: number;
  description: number;
  amount: number; // -1 se si usano colonne separate entrate/uscite
  debit: number;
  credit: number;
  invert: boolean; // alcune banche esportano le spese come positive
}

export interface ParsedRow {
  date: string;
  description: string;
  cents: number; // con segno: negativo = uscita
}

export function readCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return result.data.map((row) => row.map((c) => (c ?? '').trim()));
}

/** Prima colonna che contiene una delle parole, in ordine di priorità delle parole. */
function find(headers: string[], words: string[], exclude: number[] = []): number {
  for (const w of words) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && h.toLowerCase().includes(w));
    if (i >= 0) return i;
  }
  return -1;
}

/** Prova a indovinare la riga di intestazione e le colonne dai nomi tipici delle banche italiane. */
export function guessMapping(rows: string[][]): CsvMapping {
  let skipRows = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (find(rows[i], ['data', 'date']) >= 0 && rows[i].length >= 3) {
      skipRows = i;
      break;
    }
  }
  const headers = rows[skipRows] ?? [];
  const debit = find(headers, ['uscit', 'addebit', 'dare', 'debit']);
  const credit = find(headers, ['entrat', 'accredit', 'avere', 'credit']);
  const amount = find(headers, ['importo', 'amount', 'ammontare', 'valore']);
  const date = Math.max(0, find(headers, ['data contabile', 'data operazione', 'data', 'date']));
  const description = find(headers, ['descrizione', 'causale', 'description', 'dettagli', 'beneficiario', 'operazione'], [date]);
  return {
    skipRows,
    date,
    description: description >= 0 ? description : date === 0 ? 1 : 0,
    amount: amount >= 0 || debit < 0 ? Math.max(amount, 0) : -1,
    debit,
    credit,
    invert: false,
  };
}

export function applyMapping(rows: string[][], m: CsvMapping): { rows: ParsedRow[]; errors: number } {
  const out: ParsedRow[] = [];
  let errors = 0;
  for (const row of rows.slice(m.skipRows + 1)) {
    const date = parseDate(row[m.date] ?? '');
    let cents: number | null;
    if (m.amount >= 0) {
      cents = parseAmount(row[m.amount] ?? '');
    } else {
      const debit = parseAmount(row[m.debit] ?? '') ?? 0;
      const credit = parseAmount(row[m.credit] ?? '') ?? 0;
      cents = Math.abs(credit) - Math.abs(debit) || null;
    }
    if (!date || cents === null || cents === 0) {
      errors++;
      continue;
    }
    out.push({ date, description: (row[m.description] ?? '').replace(/\s+/g, ' '), cents: m.invert ? -cents : cents });
  }
  return { rows: out, errors };
}

/** Impronta per riconoscere un movimento già importato. */
export function importHash(accountId: number, r: ParsedRow): string {
  return `${accountId}|${r.date}|${r.cents}|${normalizeDescription(r.description)}`;
}

export interface FreshRow extends ParsedRow {
  hash: string;
}

/**
 * Separa le righe nuove da quelle già presenti sul conto. Movimenti identici (due caffè
 * uguali lo stesso giorno) si contano: se nel file ce ne sono più di quanti già salvati, i nuovi entrano.
 */
export function selectNew(accountId: number, rows: ParsedRow[], existing: Transaction[]): { fresh: FreshRow[]; dupes: number } {
  const stored = new Map<string, number>();
  for (const t of existing) {
    if (t.accountId !== accountId || t.type === 'transfer') continue;
    const h = t.importHash ?? importHash(accountId, { date: t.date, description: t.description, cents: t.type === 'income' ? t.amount : -t.amount });
    stored.set(h, (stored.get(h) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const fresh: FreshRow[] = [];
  let dupes = 0;
  for (const r of rows) {
    const hash = importHash(accountId, r);
    const n = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, n);
    if (n > (stored.get(hash) ?? 0)) fresh.push({ ...r, hash });
    else dupes++;
  }
  return { fresh, dupes };
}

// Excel esegue come formula le celle che iniziano con = + - @: le neutralizza con un apostrofo
function textCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV per Excel in italiano: separatore ";", virgola decimale, BOM per gli accenti. */
export function transactionsToCsv(txs: Transaction[], accounts: Map<number, Account>, categories: Map<number, Category>): string {
  const header = ['Data', 'Tipo', 'Descrizione', 'Categoria', 'Conto', 'Importo', 'Valuta', 'Tag', 'Nota'];
  const lines = [header.join(';')];
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  for (const t of sorted) {
    const account = accounts.get(t.accountId);
    const signed = t.type === 'income' ? t.amount : -t.amount;
    const accountName = t.type === 'transfer' ? `${account?.name ?? ''} → ${accounts.get(t.toAccountId!)?.name ?? ''}` : account?.name ?? '';
    lines.push([
      t.date,
      t.type === 'income' ? 'Entrata' : t.type === 'expense' ? 'Uscita' : 'Trasferimento',
      textCell(t.description),
      textCell(t.categoryId ? categories.get(t.categoryId)?.name ?? '' : ''),
      textCell(accountName),
      (signed / 100).toFixed(2).replace('.', ','),
      account?.currency ?? 'EUR',
      textCell(t.tags.join(', ')),
      textCell(t.note ?? ''),
    ].join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
