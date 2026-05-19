'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentItemTable, DocumentSection, DocumentTotals, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails, officialRepairTerms } from '@/components/documents/documentConfig';
import { formatDocumentCurrency, formatDocumentDate, officialCustomerNo, officialInvoiceNo } from '@/components/documents/documentUtils';
import { getDevices } from '@/features/customers/services/customerService';
import { buildInvoiceWhatsAppLink, ensureInvoicePaymentToken, getInvoiceById, getPaymentsByInvoice } from '@/features/pos/posService';
import type { PosInvoice, PosPayment } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';

export default function InvoicePrintPage() {
  const params = useParams<{ invoiceId: string }>();
  const { profile, loading } = useUser();
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [latestPayment, setLatestPayment] = useState<PosPayment | null>(null);
  const [deviceModel, setDeviceModel] = useState('Not specified');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getInvoiceById(params.invoiceId, profile)
      .then(async (row) => {
        const [devices, payments] = await Promise.all([
          getDevices(profile.role).catch(() => []),
          getPaymentsByInvoice(row.invoiceId, profile).catch(() => []),
        ]);
        const device = devices.find((item) => item.deviceId === row.deviceId);
        const nextDeviceModel = [device?.brand, device?.model].filter(Boolean).join(' ') || row.items?.[0]?.name || 'Not specified';
        if (!cancelled) {
          setInvoice(row);
          setLatestPayment(payments[payments.length - 1] || null);
          setDeviceModel(nextDeviceModel);
        }
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load invoice'); });
    return () => { cancelled = true; };
  }, [params.invoiceId, profile]);

  async function openWhatsApp() {
    if (!profile || !invoice) return;
    const token = await ensureInvoicePaymentToken(invoice.invoiceId, profile);
    const nextInvoice = { ...invoice, invoiceNo: officialInvoiceNo(invoice), publicPaymentToken: token };
    setInvoice(nextInvoice);
    window.open(buildInvoiceWhatsAppLink(nextInvoice), '_blank', 'noopener,noreferrer');
  }

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading invoice</div>;
  if (!invoice) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Invoice not found'}</div>;
  const branch = getGeniusBranchDetails(invoice.branchId);
  const displayInvoiceNo = officialInvoiceNo(invoice);
  const serviceDescription = invoice.items.map((item) => item.name).filter(Boolean).join(', ') || 'Repair service';

  return (
    <GeniusDocumentLayout
      title="INVOICE"
      documentNumber={`Invoice No: ${displayInvoiceNo}`}
      date={formatDocumentDate(invoice.createdAt)}
      status={invoice.paymentStatus}
      branchName={branch.branchName}
      companyName={branch.companyName}
      branchAddress={branch.address}
      branchPhone={branch.whatsapp}
      email={branch.email}
      website={branch.website}
      className="official-invoice-document"
      actions={<DocumentActions backHref={`/dashboard/pos/invoices/${invoice.invoiceId}`}><button type="button" onClick={openWhatsApp}>WhatsApp Invoice</button></DocumentActions>}
    >
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', invoice.customerName],
          ['Phone Number', invoice.customerPhone],
          ['Customer ID', officialCustomerNo({ customerId: invoice.customerId, customerName: invoice.customerName, createdAt: invoice.createdAt })],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>
      <DocumentSection title="Job / Device Details">
        <DocumentFieldGrid rows={[
          ['Job ID', invoice.jobId],
          ['Quotation ID', invoice.quotationId],
          ['Device Model', deviceModel || 'Not specified'],
          ['Service / Repair Description', serviceDescription],
        ]} />
      </DocumentSection>
      <DocumentSection title="Invoice Items">
        <DocumentItemTable items={invoice.items} />
        <DocumentTotals rows={[
          ['Subtotal', formatDocumentCurrency(invoice.subtotal)],
          ['Discount', formatDocumentCurrency(invoice.discountAmount)],
          ['Total', formatDocumentCurrency(invoice.total), true],
          ['Paid', formatDocumentCurrency(invoice.amountPaid)],
          ['Balance Due', formatDocumentCurrency(invoice.balance), true],
        ]} />
      </DocumentSection>
      <DocumentSection title="Payment Status">
        <DocumentFieldGrid rows={[
          ['Status', invoice.paymentStatus],
          ['Payment Method', latestPayment?.method || '-'],
          ['Reference No', latestPayment?.referenceNo || '-'],
          ['Invoice Reference', displayInvoiceNo],
        ]} />
      </DocumentSection>
      <DocumentSection title="Payment Instruction">
        <DocumentFieldGrid rows={[
          ['Bank', branch.bank],
          ['Account Name', branch.accountName],
          ['Account Number', branch.accountNumber],
          ['Reference', displayInvoiceNo],
        ]} />
      </DocumentSection>
      <DocumentSection title="Terms & Conditions">
        <div className="document-terms">
          {officialRepairTerms.map((term) => (
            <div key={term.title} className="mt-2">
              <div className={term.body ? 'font-bold' : 'document-terms-title'}>{term.title}</div>
              {term.body.split('\n').filter(Boolean).map((line, index) => <p key={index} className="mt-1">{line}</p>)}
            </div>
          ))}
        </div>
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
