import type { ReactNode } from 'react';
import { GeniusDocumentFooter } from './GeniusDocumentFooter';
import { GeniusDocumentHeader, type GeniusDocumentHeaderProps } from './GeniusDocumentHeader';

interface GeniusDocumentLayoutProps extends GeniusDocumentHeaderProps {
  children: ReactNode;
  actions?: ReactNode;
  legalFooter?: boolean;
  className?: string;
}

export function GeniusDocumentLayout({ children, actions, legalFooter, className = '', ...headerProps }: GeniusDocumentLayoutProps) {
  return (
    <main className="document-shell">
      {actions ? <div className="no-print document-actions">{actions}</div> : null}
      <article className={`print-page document-page ${className}`}>
        <GeniusDocumentHeader {...headerProps} />
        <div className="document-content">{children}</div>
        <GeniusDocumentFooter legal={legalFooter} />
      </article>
    </main>
  );
}
