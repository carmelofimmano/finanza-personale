import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Recurring } from './db';
import { addDays, daysInMonth, monthBounds, currentMonth, shiftMonth, today } from './dates';
import {
  accountBalances, confirmRecurring, firstBelow, forecast, hypotheticalItems, processDue,
  setCurrentBalance, skipRecurring, skipScheduled, upcomingAll, upcomingOccurrences, type UpcomingItem,
} from './logic';

const EUR = new Set([1]);
const item = (date: string, amount: number, type: 'income' | 'expense' = 'expense'): UpcomingItem => ({
  key: `${date}${amount}${type}`, date, description: 'x', amount, type, accountId: 1, auto: true, confirmable: false,
});
const rec = (over: Partial<Recurring> = {}): Recurring => ({
  description: 'Affitto', amount: 50000, type: 'expense', accountId: 1, frequency: 'monthly', day: 1,
  nextDate: today(), autoCreate: true, active: true, ...over,
});

describe('previsione', () => {
  it('distribuisce le spese variabili: nel mese corrente solo la parte non ancora spesa', () => {
    const f = forecast(100000, [], EUR, 70, { monthly: 30000, spentThisMonth: 10000 });
    const endOfMonth = monthBounds(currentMonth())[1];
    const nextEnd = monthBounds(shiftMonth(currentMonth(), 1))[1];
    expect(f.points.find((p) => p.date === endOfMonth)!.balance).toBe(80000);
    expect(f.points.find((p) => p.date === nextEnd)!.balance).toBe(50000);
    expect(f.months[0].variable).toBe(20000);
    expect(f.months[1].variable).toBe(30000);
  });

  it('se il budget del mese è già superato non toglie altro nel mese corrente', () => {
    const f = forecast(100000, [], EUR, 0, { monthly: 30000, spentThisMonth: 45000 });
    expect(f.end).toBe(100000);
  });

  it('il riepilogo mensile torna con le voci e col saldo di fine mese', () => {
    const items = [item(today(), 1000), item(addDays(today(), 40), 200000, 'income'), item(addDays(today(), 41), 5000)];
    const f = forecast(0, items, EUR, 120);
    const sum = f.months.reduce((s, m) => s + m.income - m.expense, 0);
    expect(sum).toBe(194000);
    expect(f.end).toBe(194000);
    for (const m of f.months) expect(m.endBalance).toBe(f.points.filter((p) => p.date.startsWith(m.month)).at(-1)!.balance);
  });

  it('ignora i conti in altre valute e porta a oggi le scadenze passate', () => {
    const f = forecast(0, [{ ...item(today(), 999), accountId: 2 }, item(addDays(today(), -10), 300)], EUR, 5);
    expect(f.points[0].balance).toBe(-300);
  });

  it('il simulatore mostra l\'effetto di un acquisto a rate sul punto più basso', () => {
    const base = [item(addDays(today(), 20), 90000)];
    const before = forecast(100000, base, EUR, 90);
    const after = forecast(100000, [...base, ...hypotheticalItems({ amount: 30000, date: today(), count: 3, frequency: 'monthly', accountId: 1 })], EUR, 90);
    expect(before.min.balance).toBe(10000);
    expect(after.min.balance).toBe(-20000);
    expect(firstBelow(after.points, 0)!.date >= today()).toBe(true);
    expect(firstBelow(before.points, 0)).toBeUndefined();
  });

  it('un anno di previsione con ricorrenze settimanali resta veloce', () => {
    const many = Array.from({ length: 50 }, (_, i) => rec({ id: i, frequency: 'weekly', amount: 100 + i }));
    const t0 = performance.now();
    const f = forecast(0, upcomingAll(many, [], 365), EUR, 365, { monthly: 100000, spentThisMonth: 0 });
    expect(performance.now() - t0).toBeLessThan(100);
    expect(f.points.length).toBe(366);
  });
});

describe('ricorrenze con data di fine', () => {
  it('non genera occorrenze dopo la data di fine', () => {
    const r = rec({ id: 1, endDate: addDays(today(), 65) });
    const n = upcomingOccurrences([r], 365).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
  });
});

describe('database: conferme, salti, saldo', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.accounts.add({ id: 1, name: 'Conto', type: 'conto', currency: 'EUR', initial: 0 });
  });

  it('una ricorrenza scaduta oltre la data di fine non registra le occorrenze successive', async () => {
    await db.recurring.add(rec({ nextDate: addDays(today(), -100), endDate: addDays(today(), -40), day: Number(addDays(today(), -100).slice(8)) }));
    await processDue();
    const dates = (await db.transactions.toArray()).map((t) => t.date);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(dates.every((d) => d <= addDays(today(), -40))).toBe(true);
  });

  it('conferma con importo reale e non duplica con doppio tocco', async () => {
    const id = await db.recurring.add(rec({ description: 'Bolletta luce', autoCreate: false, amount: 8000, nextDate: addDays(today(), -2) }));
    const r = (await db.recurring.get(id))!;
    await Promise.all([confirmRecurring(r, 9350), confirmRecurring(r, 9350)]);
    const txs = await db.transactions.toArray();
    expect(txs.map((t) => t.amount)).toEqual([9350]);
    expect((await db.recurring.get(id))!.nextDate > r.nextDate).toBe(true);
  });

  it('saltare una scadenza la toglie dalla previsione senza registrare nulla', async () => {
    const rid = await db.recurring.add(rec({ autoCreate: false, nextDate: addDays(today(), 3) }));
    const sid = await db.scheduled.add({ date: addDays(today(), -1), amount: 1000, type: 'expense', accountId: 1, description: 'Visita', autoCreate: true });
    await skipRecurring((await db.recurring.get(rid))!);
    await skipScheduled((await db.scheduled.get(sid))!);
    await processDue();
    expect(await db.transactions.count()).toBe(0);
    const upcoming = upcomingAll(await db.recurring.toArray(), await db.scheduled.toArray(), 20);
    expect(upcoming.some((u) => u.scheduled)).toBe(false);
    expect(upcoming.every((u) => u.date > addDays(today(), 3))).toBe(true);
  });

  it('riallinea il saldo al valore reale senza creare movimenti', async () => {
    await db.transactions.bulkAdd([
      { date: today(), amount: 12345, type: 'expense', accountId: 1, description: '', tags: [], createdAt: 0 },
      { date: today(), amount: 5000, type: 'income', accountId: 1, description: '', tags: [], createdAt: 0 },
    ]);
    await setCurrentBalance(1, 250000);
    const balance = accountBalances(await db.accounts.toArray(), await db.transactions.toArray()).get(1);
    expect(balance).toBe(250000);
    expect(await db.transactions.count()).toBe(2);
  });
});

describe('date di servizio', () => {
  it('daysInMonth per febbraio bisestile', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});
