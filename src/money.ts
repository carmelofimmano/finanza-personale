import type { Currency } from './db';

const formatters = new Map<string, Intl.NumberFormat>();

export function fmt(cents: number, currency: Currency = 'EUR'): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('it-IT', { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f.format(cents / 100);
}

/** Valore in centesimi da mostrare in un campo di input ("12,50"). */
export function toInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Converte "1.234,56", "1,234.56", "-12,5", "€ 12" in centesimi (con segno).
 * Con un solo separatore lo considera decimale, tranne quando ce ne sono più di uno uguali (migliaia).
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[€$\s ]/g, '').replace(/EUR|USD/gi, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    s = (s.match(/,/g)!.length > 1 ? s.split(',').join('') : s.replace(',', '.'));
  } else if (lastDot >= 0 && s.match(/\./g)!.length > 1) {
    s = s.split('.').join('');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.' ) return null;
  const value = Math.round(parseFloat(s) * 100);
  if (Number.isNaN(value)) return null;
  return negative ? -value : value;
}
