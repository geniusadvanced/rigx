import type { ReactNode } from 'react';

export interface GeniusDocumentHeaderProps {
  title: string;
  documentNumber?: string;
  date?: string;
  status?: string;
  branchName?: string;
  companyName?: string;
  branchAddress?: string;
  branchPhone?: string;
  email?: string;
  website?: string;
  meta?: ReactNode;
}

export function GeniusDocumentHeader({
  title,
  documentNumber,
  date,
  status,
  branchName = 'Genius Advanced Bangi',
  companyName = 'Genius Advanced Technology',
  branchAddress = '11-1-1B, Jalan Medan PB2A,\nSeksyen 9, Bandar Baru Bangi,\n43650 Bangi, Selangor.',
  branchPhone = '01114888499',
  email = 'hq.geniusadvanced@gmail.com',
  website = 'www.geniusadvanced.com',
  meta,
}: GeniusDocumentHeaderProps) {
  return (
    <header className="document-header avoid-break">
      <div className="document-brand">
        <img src="/branding/genius-logo-transparent.png" alt="Genius Advanced" className="document-logo" />
        <div>
          <div className="document-company">Genius Advanced</div>
          <div className="document-tagline">Laptop Repair | Phone Repair | Data Recovery</div>
          <div className="document-branch">{branchName}</div>
          <div>Company / Account Name: {companyName}</div>
          <div className="document-address">{branchAddress}</div>
          <div>WhatsApp: {branchPhone}</div>
          <div>{email} · {website}</div>
        </div>
      </div>
      <div className="document-title-block">
        <h1>{title}</h1>
        {documentNumber ? <div className="document-number">{documentNumber}</div> : null}
        {date ? <div>Date: {date}</div> : null}
        {status ? <span className="document-status">{status}</span> : null}
        {meta}
      </div>
    </header>
  );
}
