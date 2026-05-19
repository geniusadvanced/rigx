'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentActions, DocumentFieldGrid, DocumentItemTable, DocumentSection, DocumentTotals, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails, officialRepairTerms } from '@/components/documents/documentConfig';
import { formatDocumentCurrency, formatDocumentDate, officialCustomerNo } from '@/components/documents/documentUtils';
import { buildWaMeLink } from '@/features/pos/whatsappService';
import type { PosLineItem } from '@/features/pos/types';

interface PublicInvoice {
  invoiceNo: string;
  officialInvoiceNo?: string;
  branchId: string;
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  jobNumber?: string;
  deviceModel?: string;
  items: PosLineItem[];
  subtotal: number;
  discountAmount: number;
  discountReason?: string;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
  createdAt?: string | null;
}

function displayPaymentStatus(status: string): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'unpaid') return 'Unpaid';
  return status || 'Unpaid';
}

export default function PublicInvoiceDocumentPage() {
  const params = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadInvoice() {
      setLoading(true);
      try {
        const response = await fetch(`/api/public/invoice/${params.token}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load invoice');
        if (!cancelled) setInvoice(payload.invoice);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Invoice link is invalid or expired.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInvoice();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  if (loading) return <main className="min-h-screen bg-white p-6 text-gray-900">Loading invoice</main>;
  if (!invoice) return <main className="min-h-screen bg-white p-6 text-gray-900">{message || 'Invoice link is invalid or expired.'}</main>;

  const branch = getGeniusBranchDetails(invoice.branchId);
  const invoiceNumber = invoice.officialInvoiceNo || invoice.invoiceNo;
  const paymentStatus = displayPaymentStatus(invoice.paymentStatus);
  const isPaid = invoice.paymentStatus === 'paid' || Number(invoice.balance || 0) <= 0;

  return (
    <GeniusDocumentLayout
      title="INVOICE"
      documentNumber={`Invoice No: ${invoiceNumber}`}
      date={formatDocumentDate(invoice.createdAt)}
      status={paymentStatus}
      branchName={branch.branchName}
      companyName={branch.companyName}
      branchAddress={branch.address}
      branchPhone={branch.whatsapp}
      email={branch.email}
      website={branch.website}
      actions={(
        <DocumentActions>
          <a href={buildWaMeLink({ branch: invoice.branchId })} target="_blank" rel="noreferrer">WhatsApp Contact</a>
        </DocumentActions>
      )}
    >
      {isPaid ? (
        <div className="no-print mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          PAID
        </div>
      ) : null}
      {message ? <div className="no-print mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{message}</div> : null}

      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', invoice.customerName],
          ['Phone Number', invoice.customerPhone || '-'],
          ['Customer ID', officialCustomerNo({ customerId: invoice.customerId, customerName: invoice.customerName, createdAt: invoice.createdAt })],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>

      <DocumentSection title="Job / Device Details">
        <DocumentFieldGrid rows={[
          ['Job', invoice.jobNumber || 'Not linked'],
          ['Device', invoice.deviceModel || 'Not specified'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Invoice Items">
        <DocumentItemTable items={invoice.items} />
        <DocumentTotals rows={[
          ['Subtotal', formatDocumentCurrency(invoice.subtotal)],
          ['Discount', formatDocumentCurrency(invoice.discountAmount)],
          ['Total', formatDocumentCurrency(invoice.total), true],
          ['Amount Paid', formatDocumentCurrency(invoice.amountPaid)],
          ['Balance Due', formatDocumentCurrency(invoice.balance), true],
        ]} />
      </DocumentSection>

      <DocumentSection title="Payment Status">
        <DocumentFieldGrid rows={[
          ['Status', paymentStatus],
          ['Invoice Date', formatDocumentDate(invoice.createdAt)],
          ['Invoice Reference', invoiceNumber],
          ['Notes', invoice.discountReason || '-'],
        ]} />
      </DocumentSection>

      {!isPaid ? (
        <DocumentSection title="Payment Instruction">
          <DocumentFieldGrid rows={[
            ['Bank', branch.bank],
            ['Account Name', branch.accountName],
            ['Account Number', branch.accountNumber],
            ['Reference', invoiceNumber],
          ]} />
          <div className="no-print mt-3">
            <a href={`/pay/${params.token}`} className="inline-flex rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white">
              Submit Payment Proof
            </a>
          </div>
        </DocumentSection>
      ) : null}

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
