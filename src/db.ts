import Dexie, { type Table } from 'dexie';

// Tutti gli importi sono interi in centesimi, sempre positivi: il segno dipende da `type`.

export type TxType = 'expense' | 'income' | 'transfer';
export type Kind = 'expense' | 'income';
export type Currency = 'EUR' | 'USD';
export type AccountType = 'conto' | 'carta' | 'contanti' | 'risparmio' | 'investimenti';
export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface Account {
  id?: number;
  name: string;
  type: AccountType;
  currency: Currency;
  initial: number;
  archived?: boolean;
}

export interface Category {
  id?: number;
  name: string;
  kind: Kind;
  icon: string;
  color: string;
}

export interface Transaction {
  id?: number;
  date: string; // YYYY-MM-DD
  amount: number;
  type: TxType;
  accountId: number;
  toAccountId?: number;
  toAmount?: number; // importo accreditato se il conto di destinazione ha un'altra valuta
  categoryId?: number;
  description: string;
  tags: string[];
  note?: string;
  recurringId?: number;
  importHash?: string;
  createdAt: number;
}

export interface Rule {
  id?: number;
  pattern: string; // testo normalizzato cercato nella descrizione
  categoryId: number;
}

export interface Budget {
  id?: number;
  categoryId: number;
  amount: number; // mensile
}

export interface Recurring {
  id?: number;
  description: string;
  amount: number;
  type: Kind;
  accountId: number;
  categoryId?: number;
  frequency: Frequency;
  day: number; // giorno di riferimento per le cadenze mensili/annuali
  nextDate: string;
  autoCreate: boolean; // true: registra da solo; false: solo promemoria
  active: boolean;
}

export interface Meta {
  key: string;
  value: unknown;
}

export const TABLES = ['accounts', 'categories', 'transactions', 'rules', 'budgets', 'recurring', 'meta'] as const;

class FinanzaDB extends Dexie {
  accounts!: Table<Account, number>;
  categories!: Table<Category, number>;
  transactions!: Table<Transaction, number>;
  rules!: Table<Rule, number>;
  budgets!: Table<Budget, number>;
  recurring!: Table<Recurring, number>;
  meta!: Table<Meta, string>;

  constructor() {
    super('finanza-personale');
    this.version(1).stores({
      accounts: '++id, name',
      categories: '++id, kind, name',
      transactions: '++id, date, accountId, toAccountId, categoryId, type, recurringId, importHash',
      rules: '++id, pattern, categoryId',
      budgets: '++id, &categoryId',
      recurring: '++id, nextDate',
      meta: 'key',
    });
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES);
      tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS);
    });
  }
}

export const db = new FinanzaDB();

const PALETTE = ['#3ddc97', '#5b8def', '#f2a541', '#e05d5d', '#a477f2', '#3cc6d6', '#f27ab8', '#9aa5b1'];

export const DEFAULT_CATEGORIES: Category[] = [
  ['Spesa alimentare', '🛒'],
  ['Ristoranti e bar', '🍽️'],
  ['Casa e affitto', '🏠'],
  ['Bollette', '⚡'],
  ['Trasporti', '🚗'],
  ['Carburante', '⛽'],
  ['Salute', '💊'],
  ['Abbonamenti', '📺'],
  ['Shopping', '🛍️'],
  ['Svago', '🎉'],
  ['Viaggi', '✈️'],
  ['Istruzione', '📚'],
  ['Regali', '🎁'],
  ['Tasse e commissioni', '🧾'],
  ['Altro', '📦'],
]
  .map(([name, icon], i): Category => ({ name, icon, kind: 'expense', color: PALETTE[i % PALETTE.length] }))
  .concat(
    [
      ['Stipendio', '💼'],
      ['Entrate extra', '💰'],
      ['Interessi e dividendi', '📈'],
      ['Rimborsi', '↩️'],
    ].map(([name, icon], i): Category => ({ name, icon, kind: 'income', color: PALETTE[i % PALETTE.length] })),
  );

const DEFAULT_ACCOUNTS: Account[] = [
  { name: 'Conto corrente', type: 'conto', currency: 'EUR', initial: 0 },
  { name: 'Contanti', type: 'contanti', currency: 'EUR', initial: 0 },
];

export const COLORS = PALETTE;

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
