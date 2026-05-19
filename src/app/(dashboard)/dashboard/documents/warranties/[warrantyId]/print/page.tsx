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

  return (
    <GeniusDocumentLayout
      title="WARRANTY CERTIFICATE"
      documentNumber={`Warranty ID: ${warranty.warrantyId}`}
      date={formatDocumentDate(warranty.startDate)}
      status={warranty.status}
      branchName={warranty.branchId}
      legalFooter
      actions={<DocumentActions backHref={`/dashboard/warranties/${warranty.warrantyId}`}><button type="button" onClick={openWhatsApp}>WhatsApp Warranty Terms</button></DocumentActions>}
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
          ['Covered Item', warranty.itemName],
          ['Warranty Period', warrantyPeriod(warranty)],
          ['Warranty Start Date', formatDocumentDate(warranty.startDate)],
          ['Warranty Expiry Date', formatDocumentDate(warranty.endDate)],
          ['Claim Limit', 'Unlimited claims within warranty period, subject to inspection and verification'],
        ]} />
      </DocumentSection>
      <DocumentSection title="Warranty Terms">
        <p className="text-xs leading-5 text-gray-900">Warranty applies only to the specific parts or services stated in this warranty document. Warranty does not cover unrelated faults, new issues, physical damage, liquid damage, software issues, data loss, misuse, third-party repair attempts, accessories, consumables or damage caused after the device has been collected. All warranty claims are subject to inspection and verification by Genius Advanced.</p>
      </DocumentSection>
      <DocumentSection title="Signed Warranty Agreement">
        <DocumentFieldGrid rows={[
          ['Status', warranty.warrantySignedAt ? 'Signed' : 'Pending signature'],
          ['Signed Name', warranty.warrantySignedName || '-'],
          ['Signed Phone', warranty.warrantySignedPhone || '-'],
          ['Signed At', formatDocumentDate(warranty.warrantySignedAt)],
          ['Terms Version', warranty.warrantyTermsVersion || '-'],
        ]} />
        {warranty.warrantySignatureDataUrl ? <img src={warranty.warrantySignatureDataUrl} alt="Customer signature" className="mt-3 h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
        {!warranty.warrantySignatureDataUrl && warranty.warrantyTypedSignature ? <div className="mt-3 text-lg font-semibold italic text-gray-900">{warranty.warrantyTypedSignature}</div> : null}
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
