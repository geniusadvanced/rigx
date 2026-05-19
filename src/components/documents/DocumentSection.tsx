import type { ReactNode } from 'react';

export function DocumentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="document-section avoid-break">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function DocumentFieldGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="document-field-grid">
      {rows.map(([label, value]) => (
        <div key={label} className="document-field">
          <span>{label}</span>
          <strong>{value || '-'}</strong>
        </div>
      ))}
    </div>
  );
}
