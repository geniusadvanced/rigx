'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentDate, warrantyPeriod } from '@/components/documents/documentUtils';
import { buildWarrantyWhatsAppLink } from '@/features/pos/whatsappService';
import { ensureWarrantySignatureToken, getInvoiceById, getWarrantyById, logWarrantyTermsWhatsAppSent } from '@/features/pos/posService';
import type { PosInvoice, PosWarranty } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';

export default function WarrantyPrintPage() {
  const params = useParams<{ warrantyId: string }>();
  const { profile, loading } = useUser();
  const [warranty, setWarranty] = useState<PosWarranty | null>(null);
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getWarrantyById(params.warrantyId, profile)
      .then(async (row) => {
        const nextInvoice = await getInvoiceById(row.invoiceId, profile).catch(() => null);
        if (!cancelled) {
          setWarranty(row);
          setInvoice(nextInvoice);
        }
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load warranty'); });
    return () => { cancelled = true; };
  }, [params.warrantyId, profile]);

  async function openWhatsApp() {
    if (!profile || !warranty) return;
    const token = await ensureWarrantySignatureToken(warranty, profile);
    const nextWarranty = { ...warranty, publicWarrantyToken: token };
    setWarranty(nextWarranty);
    window.open(buildWarrantyWhatsAppLink(nextWarranty), '_blank', 'noopener,noreferrer');
    await logWarrantyTermsWhatsAppSent(nextWarranty, profile).catch(() => undefined);
  }

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading warranty</div>;
  if (!warranty) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Warranty not found'}</div>;
  const signedSnapshot = warranty.signedWarrantySnapshot;
  const displayTitle = signedSnapshot?.warrantyTitle || warranty.itemName;
  const displayDuration = signedSnapshot ? `${signedSnapshot.warrantyDurationDays} days` : warrantyPeriod(warranty);
  const displayStartDate = signedSnapshot?.startDate || warranty.startDate;
  const displayEndDate = signedSnapshot?.endDate || warranty.endDate;
  const displayTerms = signedSnapshot
    ? signedSnapshot.termsText || [
        ...(signedSnapshot.terms?.coverage || []),
        ...(signedSnapshot.terms?.exclusions || []),
        ...(signedSnapshot.terms?.claimProcess || []),
        signedSnapshot.terms?.claimLimit || '',
        ...(signedSnapshot.terms?.voidConditions || []),
        signedSnapshot.terms?.acknowledgement || '',
      ].filter(Boolean).join('\n')
    : 'Warranty applies only to the specific parts or services stated in this warranty document. Warranty does not cover unrelated faults, new issues, physical damage, liquid damage, software issues, data loss, misuse, third-party repair attempts, accessories, consumables or damage caused after the device has been collected. All warranty claims are subject to inspection and verification by Genius Advanced.';
  const signedName = signedSnapshot?.signerName || warranty.warrantySignedName || '-';
  const signedPhone = signedSnapshot?.signerPhone || warranty.warrantySignedPhone || '-';
  const signedAt = signedSnapshot?.signedAt || warranty.warrantySignedAt;
  const signatureDataUrl = signedSnapshot?.signatureDataUrl || warranty.warrantySignatureDataUrl;
  const typedSignature = signedSnapshot?.typedSignature || warranty.warrantyTypedSignature;

  return (
    <GeniusDocumentLayout
      title="WARRANTY CERTIFICATE"
      documentNumber={`Warranty ID: ${warranty.warrantyId}`}
      date={formatDocumentDate(warranty.startDate)}
      status={warranty.status}
      branchName={warranty.branchId}
      legalFooter
      actions={(
        <DocumentActions backHref={`/dashboard/warranties/${warranty.warrantyId}`}>
          <button type="button" onClick={openWhatsApp}>WhatsApp Warranty Terms</button>
          <button type="button" onClick={() => window.print()}>Print / Save PDF</button>
        </DocumentActions>
      )}
    >
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', warranty.customerName],
          ['Phone Number', warranty.customerPhone],
          ['Customer ID', warranty.customerId],
          ['Branch', warranty.branchId],
        ]} />
      </DocumentSection>
      <DocumentSection title="Job / Invoice Details">
        <DocumentFieldGrid rows={[
          ['Job ID', warranty.jobId],
          ['Invoice ID', warranty.invoiceId],
          ['Invoice No', invoice?.invoiceNo],
          ['Device ID', warranty.deviceId || invoice?.deviceId],
        ]} />
      </DocumentSection>
      <DocumentSection title="Warranty Item / Part / Service">
        <DocumentFieldGrid rows={[
          ['Covered Item', displayTitle],
          ['Warranty Period', displayDuration],
          ['Warranty Start Date', formatDocumentDate(displayStartDate)],
          ['Warranty Expiry Date', formatDocumentDate(displayEndDate)],
          ['Claim Limit', 'Unlimited claims within warranty period, subject to inspection and verification'],
        ]} />
      </DocumentSection>
      <DocumentSection title="Warranty Terms">
        <p className="whitespace-pre-line text-xs leading-5 text-gray-900">{displayTerms}</p>
      </DocumentSection>
      <DocumentSection title="Signed Warranty Agreement">
        <DocumentFieldGrid rows={[
          ['Status', signedAt ? 'Signed' : 'Pending signature'],
          ['Signed Name', signedName],
          ['Signed Phone', signedPhone],
          ['Signed At', formatDocumentDate(signedAt)],
          ['Terms Version', signedSnapshot?.termsVersion || warranty.warrantyTermsVersion || '-'],
        ]} />
        {signatureDataUrl ? <img src={signatureDataUrl} alt="Customer signature" className="mt-3 h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
        {!signatureDataUrl && typedSignature ? <div className="mt-3 text-lg font-semibold italic text-gray-900">{typedSignature}</div> : null}
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
