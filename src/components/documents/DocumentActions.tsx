'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export function DocumentActions({ children, backHref }: { children?: ReactNode; backHref?: string }) {
  return (
    <>
      <button type="button" onClick={() => window.print()}>Print</button>
      <button type="button" onClick={() => window.print()}>Download PDF</button>
      {children}
      {backHref ? <Link href={backHref}>Back</Link> : null}
    </>
  );
}
