import type { PosLineItem } from '@/features/pos/types';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export function DocumentItemTable({ items }: { items: PosLineItem[] }) {
  return (
    <table className="document-table avoid-break">
      <thead>
        <tr>
          <th>No</th>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Discount</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={`${item.name}-${index}`}>
            <td>{index + 1}</td>
            <td>{item.name}</td>
            <td>{item.quantity}</td>
            <td>{formatCurrency(item.unitPrice)}</td>
            <td>{formatCurrency(Number(item.discount || 0))}</td>
            <td>{formatCurrency(item.total)}</td>
          </tr>
        ))}
        {items.length === 0 ? (
          <tr>
            <td colSpan={6}>No items recorded.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
