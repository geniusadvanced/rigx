'use client';

import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, DocumentSignatureBlock, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails, officialRepairTerms } from '@/components/documents/documentConfig';
import { formatDocumentDate, jobDeviceInfo, jobNumber, officialCustomerNo } from '@/components/documents/documentUtils';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';

export default function JobSheetPrintPage() {
  const params = useParams<{ jobId: string }>();
  const { profile, loading: userLoading } = useUser();
  const { jobs, loading } = useJobs(profile?.role ? profile : null);
  const job = jobs.find((row) => row.docId === params.jobId);

  if (userLoading || loading) return <div className="text-sm text-zinc-400">Loading job sheet</div>;
  if (!job) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">Job not found or unavailable for this role.</div>;
  const branch = getGeniusBranchDetails(job.branchId);
  const signed = job.jobSheetConsentStatus === 'signed';

  return (
    <GeniusDocumentLayout
      title="REPAIR JOB SHEET"
      documentNumber={`Job ID: ${jobNumber(job)}`}
      date={formatDocumentDate(job.receivedAt)}
      status={String(job.lifecycleStatus || job.status || 'received')}
      branchName={branch.branchName}
      companyName={branch.companyName}
      branchAddress={branch.address}
      branchPhone={branch.whatsapp}
      email={branch.email}
      website={branch.website}
      legalFooter
      actions={<DocumentActions backHref="/dashboard/jobs" />}
    >
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', job.customerName],
          ['Phone Number', job.customerPhone],
          ['Email', '-'],
          ['Customer ID', officialCustomerNo({ customerId: job.customerId || '', customerName: job.customerName })],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>
      <DocumentSection title="Device Details">
        <DocumentFieldGrid rows={[
          ['Device Type', job.deviceType || job.device],
          ['Brand / Model', jobDeviceInfo(job)],
          ['Serial Number / IMEI', job.serialNumber],
          ['Accessories Received', '-'],
          ['Device Condition Upon Receiving', '-'],
          ['Reported Problem', job.issueDescription],
          ['Initial Diagnosis / Technician Notes', job.diagnosisNote || job.diagnosisSummaryPublic],
          ['Data Backup Required', '-'],
          ['Password / PIN Provided', '-'],
          ['Estimated Diagnosis Time', '-'],
        ]} />
      </DocumentSection>
      <DocumentSection title="Service Status">
        <DocumentFieldGrid rows={[
          ['Job ID', jobNumber(job)],
          ['Current Status', String(job.lifecycleStatus || job.status || '-')],
          ['Branch', job.branchId],
          ['Technician Assigned', job.technicianName || job.technicianId],
          ['Date Received', formatDocumentDate(job.receivedAt)],
        ]} />
      </DocumentSection>
      <DocumentSection title="Customer Consent Checklist">
        <div className="space-y-1 text-xs text-gray-900">
          {[
            'I authorise Genius Advanced to inspect and diagnose my device.',
            'I understand that Genius Advanced is not responsible for any data loss, corruption or damage.',
            'I understand that pre-existing faults, hidden defects, previous repair attempts or the overall condition of the device may affect the repair outcome.',
            'I agree that approval given through WhatsApp, SMS, phone call, email or any electronic communication is valid authorisation to proceed with repair.',
            'I agree to the Repair Terms & Conditions stated in this document.',
          ].map((item) => <div key={item}>{signed ? '☑' : '☐'} {item}</div>)}
        </div>
      </DocumentSection>
      <DocumentSection title="Repair Terms & Conditions">
        <div className="space-y-3 text-xs leading-5 text-gray-900">
          {officialRepairTerms.map((term) => (
            <div key={term.title}>
              <strong>{term.title}</strong>
              {term.body.split('\n').filter(Boolean).map((line, index) => <p key={index} className="mt-1">{line}</p>)}
            </div>
          ))}
        </div>
      </DocumentSection>
      <DocumentSection title="Signature Block">
        {signed ? (
          <div className="grid gap-3">
            <DocumentFieldGrid rows={[
              ['Customer / Representative Name', job.jobSheetSigner?.name || job.jobSheetManualConsentName || '-'],
              ['IC / Passport No.', job.jobSheetSigner?.icOrPassportNo || '-'],
              ['Phone Number', job.jobSheetSigner?.phone || job.jobSheetManualConsentPhone || '-'],
              ['Signed Date', formatDocumentDate(job.jobSheetSigner?.signedDate || job.jobSheetSignedAt)],
              ['Consent Method', job.jobSheetConsentMethod || '-'],
            ]} />
            {job.jobSheetSignature?.signatureData ? (
              <img src={job.jobSheetSignature.signatureData} alt="Customer signature" className="h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" />
            ) : null}
          </div>
        ) : (
          <DocumentSignatureBlock />
        )}
      </DocumentSection>
      <DocumentSection title="For Genius Advanced Use Only">
        <DocumentFieldGrid rows={[
          ['Received By', profile?.displayName],
          ['Technician', job.technicianName || job.technicianId],
          ['Branch', job.branchId],
          ['Internal Notes', job.repairNote || job.qcNote || '-'],
          ['Staff Signature', ''],
          ['Date', formatDocumentDate(new Date())],
        ]} />
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
