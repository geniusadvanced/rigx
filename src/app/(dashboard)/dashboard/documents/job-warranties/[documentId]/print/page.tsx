'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails } from '@/components/documents/documentConfig';
import { formatDocumentDate } from '@/components/documents/documentUtils';
import { geniusAdvancedWarrantyPolicyText, getJobDocumentRecordById } from '@/features/job-documents/services/jobDocumentRecordService';
import type { JobDocumentRecord } from '@/features/job-documents/types';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import type { Job } from '@/types';
import { doc, getDoc } from 'firebase/firestore';

function cleanText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text === '-' ? '' : text;
}

function meaningfulRows(rows: Array<[string, unknown]>): Array<[string, string]> {
  return rows
    .map(([label, value]) => [label, cleanText(value)] as [string, string])
    .filter(([, value]) => Boolean(value));
}

function jobNumberFrom(job?: Job | null, record?: JobDocumentRecord | null, snapshot?: JobDocumentRecord['signedWarrantySnapshot']): string {
  return cleanText(snapshot?.jobNumber)
    || cleanText(job?.jobNo)
    || cleanText(job?.jobNumber)
    || cleanText(job?.jobSheetNo)
    || cleanText(job?.agnJobNumber)
    || cleanText(record?.jobSheetNo)
    || cleanText(record?.jobId);
}

function warrantyNumberFor(record: JobDocumentRecord, job: Job | null): string {
  const snapshot = record.signedWarrantySnapshot;
  const docIdReference = `JW-${record.documentId.slice(0, 8).toUpperCase()}`;
  const existing = cleanText(snapshot?.warrantyDisplayReference || snapshot?.warrantyNumber);
  if (existing && existing !== docIdReference && existing !== record.documentId) return existing;
  const jobNo = jobNumberFrom(job, record, snapshot);
  return jobNo ? `JW-${jobNo}` : 'Job Warranty';
}

function periodLabel(days?: number | null): string {
  const value = Number(days || 0);
  if (!value) return '';
  if (value === 7) return '7 Days';
  if (value % 30 === 0) return `${value / 30} Month${value / 30 > 1 ? 's' : ''}`;
  return `${value} Days`;
}

export default function JobWarrantyPrintPage() {
  const params = useParams<{ documentId: string }>();
  const { profile, loading } = useUser();
  const [record, setRecord] = useState<JobDocumentRecord | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    getJobDocumentRecordById(params.documentId)
      .then(async (row) => {
        const jobSnapshot = row.jobId ? await getDoc(doc(db, 'jobs', row.jobId)).catch(() => null) : null;
        const nextJob = jobSnapshot?.exists() ? ({ docId: jobSnapshot.id, ...jobSnapshot.data() } as Job) : null;
        if (!cancelled) {
          setRecord(row);
          setJob(nextJob);
        }
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load signed warranty'); });
    return () => { cancelled = true; };
  }, [params.documentId, profile]);

  if (loading || !profile) return <div className="text-sm text-zinc-400">Loading signed warranty</div>;
  if (!record) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">{message || 'Signed warranty not found'}</div>;

  const snapshot = record.signedWarrantySnapshot;
  const title = snapshot?.warrantyTitle || record.title || 'Job Warranty';
  const signedAt = snapshot?.signedAt || record.warrantySignedAt;
  const signerName = snapshot?.signerName || record.warrantySignedName || '';
  const signerPhone = snapshot?.signerPhone || record.warrantySignedPhone || '';
  const signatureDataUrl = snapshot?.signatureDataUrl || record.warrantySignatureDataUrl;
  const typedSignature = snapshot?.typedSignature || record.warrantyTypedSignature;
  const terms = snapshot?.termsText || record.warrantyPolicyText || geniusAdvancedWarrantyPolicyText;
  const startDate = snapshot?.startDate || record.warrantyStartDate;
  const endDate = snapshot?.endDate || record.warrantyEndDate;
  const jobNo = jobNumberFrom(job, record, snapshot);
  const branch = getGeniusBranchDetails(
    snapshot?.branchId
    || job?.branchId
    || profile.branchId
    || '',
  );
  const branchName = cleanText(snapshot?.branchName) || branch.branchName;
  const branchAddress = cleanText(snapshot?.branchAddress) || branch.address;
  const branchPhone = cleanText(snapshot?.branchPhone || snapshot?.branchWhatsapp) || branch.whatsapp;
  const deviceName = cleanText(snapshot?.deviceName)
    || [job?.deviceBrand, job?.deviceModel].map(cleanText).filter(Boolean).join(' ')
    || cleanText(job?.device)
    || cleanText(job?.deviceType);
  const serialOrImei = cleanText(snapshot?.deviceSerialOrImei) || cleanText(job?.serialNumber);
  const description = cleanText(snapshot?.description || record.description);
  const claimLimit = cleanText(snapshot?.claimLimit) || (record.warrantyClaimLimit ? 'Unlimited within active warranty period' : '');

  return (
    <GeniusDocumentLayout
      title="SIGNED JOB WARRANTY"
      documentNumber={`Warranty No: ${warrantyNumberFor(record, job)}`}
      date={formatDocumentDate(signedAt || startDate)}
      status={signedAt ? 'signed' : 'pending signature'}
      branchName={branchName}
      companyName={branch.companyName}
      branchAddress={branchAddress}
      branchPhone={branchPhone}
      email={branch.email}
      website={branch.website}
      legalFooter
      actions={(
        <DocumentActions backHref={`/dashboard/jobs`}>
          <button type="button" onClick={() => window.print()}>Print / Save PDF</button>
        </DocumentActions>
      )}
    >
      <DocumentSection title="Customer / Job Details">
        <DocumentFieldGrid rows={meaningfulRows([
          ['Customer Name', snapshot?.customerName || job?.customerName],
          ['Phone Number', snapshot?.customerPhone || job?.customerPhone],
          ['Device', deviceName],
          ['Serial / IMEI', serialOrImei],
          ['Job No', jobNo],
        ])} />
      </DocumentSection>

      <DocumentSection title="Warranty Details">
        <DocumentFieldGrid rows={meaningfulRows([
          ['Warranty Title', title],
          ['Warranty Period', periodLabel(snapshot?.warrantyDurationDays || record.warrantyPeriodDays)],
          ['Start Date', formatDocumentDate(startDate)],
          ['End Date', formatDocumentDate(endDate)],
          ['Claim Limit / Coverage Summary', claimLimit],
          ['Description', description],
        ])} />
      </DocumentSection>

      <DocumentSection title="Warranty Terms">
        <p className="whitespace-pre-line text-xs leading-5 text-gray-900">{terms}</p>
      </DocumentSection>

      <DocumentSection title="Customer Signature">
        <DocumentFieldGrid rows={meaningfulRows([
          ['Status', signedAt ? 'Signed' : 'Pending signature'],
          ['Signed Name', signerName],
          ['Signed Phone', signerPhone],
          ['Signed At', formatDocumentDate(signedAt)],
        ])} />
        {signatureDataUrl ? <img src={signatureDataUrl} alt="Customer signature" className="mt-3 h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
        {!signatureDataUrl && typedSignature ? <div className="mt-3 text-lg font-semibold italic text-gray-900">{typedSignature}</div> : null}
      </DocumentSection>

      <div className="no-print mt-4 text-xs text-gray-500">
        <Link href="/dashboard/jobs" className="underline">Back to Jobs</Link>
      </div>
    </GeniusDocumentLayout>
  );
}
