'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentDate } from '@/components/documents/documentUtils';
import { geniusAdvancedWarrantyPolicyText, getJobDocumentRecordById } from '@/features/job-documents/services/jobDocumentRecordService';
import type { JobDocumentRecord } from '@/features/job-documents/types';
import { useUser } from '@/lib/hooks/useUser';

export default function JobWarrantyPrintPage() {
  const params = useParams<{ documentId: string }>();
  const { profile, loading } = useUser();
  const [record, setRecord] = useState<JobDocumentRecord | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getJobDocumentRecordById(params.documentId)
      .then((row) => { if (!cancelled) setRecord(row); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load signed warranty'); });
    return () => { cancelled = true; };
  }, [params.documentId, profile]);

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading signed warranty</div>;
  if (!record) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Signed warranty not found'}</div>;

  const snapshot = record.signedWarrantySnapshot;
  const title = snapshot?.warrantyTitle || record.title || 'Job Warranty';
  const signedAt = snapshot?.signedAt || record.warrantySignedAt;
  const signerName = snapshot?.signerName || record.warrantySignedName || '-';
  const signerPhone = snapshot?.signerPhone || record.warrantySignedPhone || '-';
  const signatureDataUrl = snapshot?.signatureDataUrl || record.warrantySignatureDataUrl;
  const typedSignature = snapshot?.typedSignature || record.warrantyTypedSignature;
  const terms = snapshot?.termsText || record.warrantyPolicyText || geniusAdvancedWarrantyPolicyText;
  const startDate = snapshot?.startDate || record.warrantyStartDate;
  const endDate = snapshot?.endDate || record.warrantyEndDate;

  return (
    <GeniusDocumentLayout
      title="SIGNED JOB WARRANTY"
      documentNumber={`Warranty ID: ${record.documentId}`}
      date={formatDocumentDate(startDate)}
      status={signedAt ? 'signed' : 'pending signature'}
      branchName={snapshot?.branchId || ''}
      legalFooter
      actions={(
        <DocumentActions backHref={`/dashboard/jobs`}>
          <button type="button" onClick={() => window.print()}>Print / Save PDF</button>
        </DocumentActions>
      )}
    >
      <DocumentSection title="Customer / Job Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', snapshot?.customerName || '-'],
          ['Phone Number', snapshot?.customerPhone || '-'],
          ['Job No', snapshot?.jobNumber || record.jobSheetNo],
          ['Device', snapshot?.deviceName || '-'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Warranty Details">
        <DocumentFieldGrid rows={[
          ['Warranty Title', title],
          ['Description', snapshot?.description || record.description || '-'],
          ['Warranty Period', `${snapshot?.warrantyDurationDays || record.warrantyPeriodDays || 0} days`],
          ['Warranty Start Date', formatDocumentDate(startDate)],
          ['Warranty End Date', formatDocumentDate(endDate)],
          ['Claim Limit', snapshot?.claimLimit || 'Unlimited within active warranty period'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Warranty Terms">
        <p className="whitespace-pre-line text-xs leading-5 text-gray-900">{terms}</p>
      </DocumentSection>

      <DocumentSection title="Customer Signature">
        <DocumentFieldGrid rows={[
          ['Status', signedAt ? 'Signed' : 'Pending signature'],
          ['Signed Name', signerName],
          ['Signed Phone', signerPhone],
          ['Signed At', formatDocumentDate(signedAt)],
          ['Terms Version', snapshot?.termsVersion || '-'],
        ]} />
        {signatureDataUrl ? <img src={signatureDataUrl} alt="Customer signature" className="mt-3 h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
        {!signatureDataUrl && typedSignature ? <div className="mt-3 text-lg font-semibold italic text-gray-900">{typedSignature}</div> : null}
      </DocumentSection>

      <div className="no-print mt-4 text-xs text-gray-500">
        <Link href="/dashboard/jobs" className="underline">Back to Jobs</Link>
      </div>
    </GeniusDocumentLayout>
  );
}
