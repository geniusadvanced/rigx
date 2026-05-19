'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentCurrency, formatDocumentDate, invoiceDeviceInfo, receiptNo } from '@/components/documents/documentUtils';
import { getInvoiceById, getPayments } from '@/features/pos/posService';
import { buildReceiptWhatsAppLink } from '@/features/pos/whatsappService';
import type { PosInvoice, PosPayment } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';

export default function ReceiptPrintPage() {
  const params = useParams<{ receiptId: string }>();
  const { profile, loading } = useUser();
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [payment, setPayment] = useState<PosPayment | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getPayments(profile)
      .then(async (rows) => {
        const nextPayment = rows.find((row) => row.paymentId === params.receiptId);
        if (!nextPayment) throw new Error('Receipt not found');
        const nextInvoice = await getInvoiceById(nextPayment.invoiceId, profile);
        if (!cancelled) {
          setPayment(nextPayment);
          setInvoice(nextInvoice);
        }
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load receipt'); });
    return () => { cancelled = true; };
  }, [params.receiptId, profile]);

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading receipt</div>;
  if (!invoice || !payment) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Receipt not found'}</div>;

  return (
    <GeniusDocumentLayout
      title="PAYMENT RECEIPT"
      documentNumber={`Receipt No: ${receiptNo(payment)}`}
      date={formatDocumentDate(payment.receivedAt)}
      status={payment.status || 'completed'}
      branchName={invoice.branchId}
      actions={(
        <DocumentActions backHref={`/dashboard/pos/invoices/${invoice.invoiceId}`}>
          <button type="button" disabled={!invoice.customerPhone} onClick={() => window.open(buildReceiptWhatsAppLink(invoice, payment), '_blank', 'noopener,noreferrer')}>WhatsApp Receipt</button>
          {!invoice.customerPhone ? <span className="text-sm text-zinc-500">Customer phone number is missing.</span> : null}
        </DocumentActions>
      )}
    >
      <DocumentSection title="Receipt Details">
        <DocumentFieldGrid rows={[
          ['Receipt No', receiptNo(payment)],
          ['Payment Date', formatDocumentDate(payment.receivedAt)],
          ['Received From', invoice.customerName],
          ['Phone Number', invoice.customerPhone],
        ]} />
      </DocumentSection>
      <DocumentSection title="Payment For">
        <DocumentFieldGrid rows={[
          ['Invoice No', invoice.invoiceNo],
          ['Job ID', invoice.jobId],
          ['Device / Service', invoiceDeviceInfo(invoice)],
          ['Service Summary', invoice.items.map((item) => item.name).join(', ')],
        ]} />
      </DocumentSection>
      <DocumentSection title="Payment Details">
        <DocumentFieldGrid rows={[
          ['Amount Paid', formatDocumentCurrency(payment.amount)],
          ['Payment Method', payment.method],
          ['Reference No', payment.referenceNo],
          ['Payment Status', payment.status || 'completed'],
          ['Received By', payment.receivedBy],
          ['Balance Remaining', formatDocumentCurrency(payment.balanceAfterPayment ?? invoice.balance)],
        ]} />
      </DocumentSection>
      <DocumentSection title="Receipt Note">
        <p className="text-xs leading-5 text-gray-900">This receipt confirms payment received by Genius Advanced. This is a computer-generated receipt and does not require a signature.</p>
        {invoice.jobId ? <Link href={`/dashboard/jobs/${invoice.jobId}`} className="no-print mt-2 inline-flex text-orange-700">Open Job</Link> : null}
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
