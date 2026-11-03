import Papa from 'papaparse';
import { parseAmount } from './money';
import { parseDate } from './dates';
import { normalizeDescription } from './logic';

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
      const out_ = parseAmount(row[m.debit] ?? '') ?? 0;
      const in_ = parseAmount(row[m.credit] ?? '') ?? 0;
      cents = in_ - Math.abs(out_) || null;
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
