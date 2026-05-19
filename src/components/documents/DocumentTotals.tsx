import type { ReactNode } from 'react';

export function DocumentTotals({ rows }: { rows: Array<[string, ReactNode, boolean?]> }) {
  return (
    <div className="document-totals avoid-break">
      {rows.map(([label, value, strong]) => (
        <div key={label} className={strong ? 'document-total-strong' : ''}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
