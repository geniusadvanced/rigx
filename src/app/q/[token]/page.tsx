'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { DocumentFieldGrid, DocumentItemTable, DocumentSection, DocumentTotals, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails, officialRepairTerms } from '@/components/documents/documentConfig';
import { formatDocumentCurrency, formatDocumentDate, officialCustomerNo } from '@/components/documents/documentUtils';
import { buildWaMeLink } from '@/features/pos/whatsappService';
import type { PosLineItem } from '@/features/pos/types';

interface PublicQuotation {
  quotationNo: string;
  jobId?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  branchId: string;
  deviceModel?: string;
  issueReported?: string;
  items: PosLineItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  status: string;
  quotationApprovalStatus?: string;
  validUntil?: string | null;
  customerRejectionReason?: string;
}

function expiryMessage(value?: string | null): string {
  if (!value) return '';
  const diffDays = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 'Quotation link is invalid or expired.';
  if (diffDays <= 2) return 'This quotation is near expiry.';
  return '';
}

function publicJobDeviceLabel(quotation: PublicQuotation): string {
  return [quotation.jobId, quotation.deviceModel && quotation.deviceModel !== 'Not specified' ? quotation.deviceModel : '']
    .filter(Boolean)
    .join(' · ') || 'Not linked';
}

export default function PublicQuotationPage() {
  const params = useParams<{ token: string }>();
  const [quotation, setQuotation] = useState<PublicQuotation | null>(null);
  const [reason, setReason] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  async function loadQuotation() {
    setLoading(true);
    try {
      const response = await fetch(`/api/public/quotation/${params.token}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load quotation');
      setQuotation(payload.quotation);
      setCustomerName(payload.quotation.customerName || '');
      setCustomerPhone(payload.quotation.customerPhone || '');
    } catch (error) {
      setMessage(error instanceof Error ? 'Quotation link is invalid or expired.' : 'Quotation link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQuotation();
  }, [params.token]);

  async function submitAction(action: 'approve' | 'reject', event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (action === 'approve' && !termsAccepted) return;
    setActionLoading(true);
    setMessage('');
    try {
      if (!customerName.trim() || !customerPhone.trim()) {
        setMessage('Customer name and phone are required.');
        return;
      }
      const response = await fetch(`/api/public/quotations/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, customerName, customerPhone }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update quotation');
      setQuotation(payload.quotation);
      setRejecting(false);
      setMessage(action === 'approve'
        ? 'Quotation approved. Genius Advanced has been notified and will proceed with the repair.'
        : 'Quotation response received. Genius Advanced has been notified.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update quotation');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-white p-6 text-gray-900">Loading quotation</main>;
  if (!quotation) return <main className="min-h-screen bg-white p-6 text-gray-900">{message || 'Quotation link is invalid or expired.'}</main>;

  const branch = getGeniusBranchDetails(quotation.branchId);
  const approvalStatus = quotation.quotationApprovalStatus || quotation.status;
  const canAct = approvalStatus === 'draft' || approvalStatus === 'sent' || approvalStatus === 'pending';
  const validityWarning = expiryMessage(quotation.validUntil);
  const approved = approvalStatus === 'approved';
  const rejected = approvalStatus === 'rejected';

  return (
    <GeniusDocumentLayout
      title="QUOTATION"
      documentNumber={`Quotation No: ${quotation.quotationNo}`}
      date={formatDocumentDate(new Date())}
      status={approvalStatus}
      branchName={branch.branchName}
      companyName={branch.companyName}
      branchAddress={branch.address}
      branchPhone={branch.whatsapp}
      email={branch.email}
      website={branch.website}
      actions={(
        <>
          <button type="button" onClick={() => window.print()}>Print</button>
          <a href={buildWaMeLink({ branch: quotation.branchId })} target="_blank" rel="noreferrer">WhatsApp Contact</a>
        </>
      )}
    >
      {message ? <div className="no-print mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{message}</div> : null}
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', quotation.customerName],
          ['Phone Number', quotation.customerPhone],
          ['Customer ID', officialCustomerNo({ customerId: quotation.customerId, customerName: quotation.customerName })],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>
      <DocumentSection title="Job / Device Details">
        <DocumentFieldGrid rows={[
          ['Device / Job', publicJobDeviceLabel(quotation)],
          ['Job', quotation.jobId || 'Not linked'],
          ['Device', quotation.deviceModel || 'Not specified'],
          ['Issue Reported', quotation.issueReported || '-'],
        ]} />
      </DocumentSection>
      <DocumentSection title="Recommended Repair / Service">
        <DocumentItemTable items={quotation.items} />
        <DocumentTotals rows={[
          ['Subtotal', formatDocumentCurrency(quotation.subtotal)],
          ['Discount', formatDocumentCurrency(quotation.discountAmount)],
          ['Total Quoted Amount', formatDocumentCurrency(quotation.total), true],
        ]} />
      </DocumentSection>
      <DocumentSection title="Quotation Details">
        <DocumentFieldGrid rows={[
          ['Valid Until', formatDocumentDate(quotation.validUntil)],
          ['Status', approvalStatus],
        ]} />
        {validityWarning ? <p className="no-print mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{validityWarning}</p> : null}
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
      <div className="no-print mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
        {approved ? <p className="text-sm font-semibold text-emerald-700">This quotation has already been approved.</p> : null}
        {rejected ? <p className="text-sm font-semibold text-red-700">This quotation has already been rejected.</p> : null}
        {canAct ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                required
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Customer name"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
              <input
                required
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="Phone number"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <label className="flex gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span>I agree to Genius Advanced Terms & Conditions and authorise Genius Advanced to proceed with the repair.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={actionLoading || !termsAccepted || !customerName.trim() || !customerPhone.trim()} onClick={() => submitAction('approve')} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve Quotation</button>
              <button type="button" disabled={actionLoading} onClick={() => setRejecting((current) => !current)} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Reject Quotation</button>
            </div>
            {rejecting ? (
              <form onSubmit={(event) => submitAction('reject', event)} className="grid gap-2">
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for rejection (optional)" className="min-h-20 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
                <button disabled={actionLoading} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Submit Rejection</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </GeniusDocumentLayout>
  );
}
