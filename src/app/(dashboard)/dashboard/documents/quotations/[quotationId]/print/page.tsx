'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentItemTable, DocumentSection, DocumentTotals, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentCurrency, formatDocumentDate, formatJobDeviceLabel, officialCustomerNo, officialQuotationNo, quotationDeviceInfo } from '@/components/documents/documentUtils';
import { buildQuotationWhatsAppLink, ensureQuotationPublicToken, getQuotationById } from '@/features/pos/posService';
import type { PosQuotation } from '@/features/pos/types';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import type { Job } from '@/types';
import type { Customer } from '@/features/customers/types';
import { doc, getDoc } from 'firebase/firestore';

export default function QuotationPrintPage() {
  const params = useParams<{ quotationId: string }>();
  const { profile, loading } = useUser();
  const [quotation, setQuotation] = useState<PosQuotation | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [device, setDevice] = useState<Record<string, unknown> | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getQuotationById(params.quotationId, profile)
      .then(async (row) => {
        const [jobSnapshot, customerSnapshot, deviceSnapshot] = await Promise.all([
          row.jobId ? getDoc(doc(db, 'jobs', row.jobId)).catch(() => null) : Promise.resolve(null),
          row.customerId ? getDoc(doc(db, 'customers', row.customerId)).catch(() => null) : Promise.resolve(null),
          row.deviceId ? getDoc(doc(db, 'devices', row.deviceId)).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setQuotation(row);
        setJob(jobSnapshot?.exists() ? ({ docId: jobSnapshot.id, ...jobSnapshot.data() } as Job) : null);
        setDevice(deviceSnapshot?.exists() ? deviceSnapshot.data() : null);
        setCustomer(customerSnapshot?.exists() ? ({ customerId: customerSnapshot.id, ...customerSnapshot.data() } as Customer) : null);
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load quotation'); });
    return () => { cancelled = true; };
  }, [params.quotationId, profile]);

  async function openWhatsApp() {
    if (!profile || !quotation) return;
    const token = await ensureQuotationPublicToken(quotation.quotationId, profile);
    const nextQuotation = { ...quotation, publicToken: token };
    setQuotation(nextQuotation);
    window.open(buildQuotationWhatsAppLink(nextQuotation), '_blank', 'noopener,noreferrer');
  }

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading quotation</div>;
  if (!quotation) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Quotation not found'}</div>;
  const displayQuotationNo = officialQuotationNo(quotation);
  const displayCustomerNo = officialCustomerNo({
    customerNumber: quotation.customerNumber || customer?.customerNumber,
    customerId: quotation.customerNumber || customer?.customerNumber ? undefined : '',
    customerName: quotation.customerName,
    createdAt: quotation.createdAt,
  });
  const displayJobNo = quotation.jobNumber || job?.jobNo || job?.jobNumber || job?.jobSheetNo || 'Not linked';
  const displayDevice = formatJobDeviceLabel({
    deviceBrand: job?.deviceBrand || String(device?.brand || ''),
    deviceModel: job?.deviceModel || String(device?.model || ''),
    device: job?.device || String(device?.deviceName || device?.name || ''),
    deviceType: job?.deviceType || String(device?.deviceType || ''),
  });

  return (
    <GeniusDocumentLayout
      title="QUOTATION"
      documentNumber={`Quotation No: ${displayQuotationNo}`}
      date={formatDocumentDate(quotation.createdAt)}
      status={quotation.status}
      branchName={quotation.branchId}
      actions={<DocumentActions backHref={`/dashboard/pos/quotations/${quotation.quotationId}`}><button type="button" onClick={openWhatsApp}>WhatsApp Quotation</button></DocumentActions>}
    >
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', quotation.customerName],
          ['Phone Number', quotation.customerPhone],
          ['Customer ID', displayCustomerNo],
          ['Branch', quotation.branchId],
        ]} />
      </DocumentSection>
      <DocumentSection title="Device / Job Details">
        <DocumentFieldGrid rows={[
          ['Job', displayJobNo],
          ['Device / Service', quotationDeviceInfo(quotation)],
          ['Device', displayDevice],
          ['Issue Reported', '-'],
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
          ['Approval Status', quotation.status],
          ['Notes', quotation.discountReason || '-'],
        ]} />
      </DocumentSection>
      <DocumentSection title="Approval Note">
        <p className="text-xs leading-5 text-gray-900">By approving this quotation via signature, WhatsApp, SMS, phone call, email or any electronic communication method, the Customer authorises Genius Advanced to proceed with the repair based on the quoted scope and price. Full Repair Terms & Conditions apply.</p>
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
