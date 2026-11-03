import type { Currency } from './db';

const formatters = new Map<string, Intl.NumberFormat>();

export function fmt(cents: number, currency: Currency = 'EUR'): string {
  let f = formatters.get(currency);
  if (!f) {
    // 'always': in italiano Intl non separa le migliaia sotto 10.000 ("1850,00 €")
    f = new Intl.NumberFormat('it-IT', { style: 'currency', currency, useGrouping: 'always' });
    formatters.set(currency, f);
  }
  return f.format(cents / 100);
}

/** Valore in centesimi da mostrare in un campo di input ("12,50"). */
export function toInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

// Primo gruppo da 1 a 3 cifre, poi gruppi esatti da 3: "1.234.567"
function validGroups(s: string, sep: string): boolean {
  const parts = s.split(sep);
  return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

/**
 * Converte "1.234,56", "1,234.56", "-12,5", "€ 12", "45,00-" in centesimi (con segno).
 * Con un solo separatore seguito da esattamente 3 cifre ("1.000") lo considera separatore delle migliaia,
 * altrimenti decimale. Restituisce null per input ambigui o malformati.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[€$\s  '’]/g, '').replace(/EUR|USD/gi, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }

  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  let intPart = s;
  let frac = '';
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    if ((dec === '.' ? dots : commas) !== 1) return null;
    [intPart, frac] = s.split(dec);
    if (!validGroups(intPart, thousands)) return null;
    intPart = intPart.split(thousands).join('');
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!validGroups(s, sep)) return null;
      intPart = parts.join('');
    } else if (parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0])) {
      intPart = parts.join('');
    } else {
      [intPart, frac] = parts;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (!intPart && !frac)) return null;

  // Calcolo sulle cifre invece che con parseFloat * 100, che sbaglia casi come 4,35
  const cents = Number(intPart || '0') * 100 + Number((frac + '00').slice(0, 2)) + (frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Come parseAmount, ma accetta somme e sottrazioni: "12+5,50-3". */
export function evalAmount(input: string): number | null {
  const s = input.replace(/\s/g, '');
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== s) return null;
  let total = 0;
  for (const t of terms) {
    const value = parseAmount(t.replace(/^[+-]/, ''));
    if (value === null) return null;
    total += t.startsWith('-') ? -value : value;
  }
  return total;
}

export function isExpression(input: string): boolean {
  return /\d\s*[+-]\s*\d/.test(input);
}
