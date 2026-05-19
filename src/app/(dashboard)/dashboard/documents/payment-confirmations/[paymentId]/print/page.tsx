'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentCurrency, formatDocumentDate, invoiceDeviceInfo, receiptNo } from '@/components/documents/documentUtils';
import { getInvoiceById, getPayments } from '@/features/pos/posService';
import { buildReceiptWhatsAppLink } from '@/features/pos/whatsappService';
import type { PosInvoice, PosPayment } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';

export default function PaymentConfirmationPrintPage() {
  const params = useParams<{ paymentId: string }>();
  const { profile, loading } = useUser();
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [payment, setPayment] = useState<PosPayment | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getPayments(profile)
      .then(async (rows) => {
        const nextPayment = rows.find((row) => row.paymentId === params.paymentId);
        if (!nextPayment) throw new Error('Payment confirmation not found');
        const nextInvoice = await getInvoiceById(nextPayment.invoiceId, profile);
        if (!cancelled) {
          setPayment(nextPayment);
          setInvoice(nextInvoice);
        }
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load payment confirmation'); });
    return () => { cancelled = true; };
  }, [params.paymentId, profile]);

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading payment confirmation</div>;
  if (!invoice || !payment) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Payment confirmation not found'}</div>;

  return (
    <GeniusDocumentLayout
      title="PAYMENT CONFIRMATION"
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
      <DocumentSection title="Payment Confirmation">
        <DocumentFieldGrid rows={[
          ['Receipt No', receiptNo(payment)],
          ['Payment Date', formatDocumentDate(payment.receivedAt)],
          ['Received From', invoice.customerName],
          ['Phone Number', invoice.customerPhone],
          ['Payment For', invoice.invoiceNo || invoice.jobId],
          ['Device / Service', invoiceDeviceInfo(invoice)],
          ['Amount Paid', formatDocumentCurrency(payment.amount)],
          ['Payment Method', payment.method],
          ['Reference No', payment.referenceNo],
          ['Payment Status', payment.status || 'completed'],
          ['Received By', payment.receivedBy],
          ['Balance Remaining', formatDocumentCurrency(payment.balanceAfterPayment ?? invoice.balance)],
        ]} />
      </DocumentSection>
      <DocumentSection title="Confirmation Note">
        <p className="text-xs leading-5 text-gray-900">This document confirms payment received by Genius Advanced. This is a computer-generated confirmation and does not require a signature.</p>
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
