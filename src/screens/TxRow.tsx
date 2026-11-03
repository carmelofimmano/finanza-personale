import type { Account, Category, Transaction } from '../db';
import { Amount, CatIcon } from '../ui';

export function TxRow({
  tx,
  categories,
  accounts,
  onClick,
  showDate,
}: {
  tx: Transaction;
  categories: Map<number, Category>;
  accounts: Map<number, Account>;
  onClick: () => void;
  showDate?: string;
}) {
  const cat = tx.categoryId ? categories.get(tx.categoryId) : undefined;
  const account = accounts.get(tx.accountId);
  const to = tx.toAccountId ? accounts.get(tx.toAccountId) : undefined;
  const sub =
    tx.type === 'transfer'
      ? `${account?.name ?? '?'} → ${to?.name ?? '?'}`
      : [cat?.name ?? 'Senza categoria', account?.name, ...tx.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ');
  return (
    <li>
      <button className="row" onClick={onClick}>
        {tx.type === 'transfer' ? <CatIcon category={{ name: '', kind: 'expense', icon: '⇄', color: '#5b8def' }} /> : <CatIcon category={cat} />}
        <div className="grow">
          <div className="title">{tx.description || cat?.name || 'Movimento'}</div>
          <div className="sub">{showDate ? `${showDate} · ` : ''}{sub}</div>
        </div>
        <Amount cents={tx.amount} type={tx.type} currency={account?.currency} />
      </button>
    </li>
  );
}
