'use client';

import { useParams } from 'next/navigation';
import { DocumentActions, DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { formatDocumentDate, jobDeviceInfo, jobNumber } from '@/components/documents/documentUtils';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';

export default function RepairReportPrintPage() {
  const params = useParams<{ reportId: string }>();
  const { profile, loading: userLoading } = useUser();
  const { jobs, loading } = useJobs(profile?.role ? profile : null);
  const job = jobs.find((row) => row.docId === params.reportId);

  if (userLoading || loading) return <div className="text-sm text-zinc-400">Loading repair report</div>;
  if (!job) return <div className="rounded-3xl border border-white/10 bg-[#151515] p-6 text-sm text-zinc-400">Repair report not found or unavailable for this role.</div>;

  return (
    <GeniusDocumentLayout
      title="REPAIR REPORT"
      documentNumber={`Job ID: ${jobNumber(job)}`}
      date={formatDocumentDate(job.repairCompletedAt)}
      status={String(job.lifecycleStatus || job.status || '-')}
      branchName={job.branchId || 'Genius Advanced'}
      actions={<DocumentActions backHref="/dashboard/jobs" />}
    >
      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', job.customerName],
          ['Phone Number', job.customerPhone],
          ['Customer ID', job.customerId],
        ]} />
      </DocumentSection>
      <DocumentSection title="Job / Device Details">
        <DocumentFieldGrid rows={[
          ['Job ID', jobNumber(job)],
          ['Device', jobDeviceInfo(job)],
          ['Serial Number / IMEI', job.serialNumber],
          ['Branch', job.branchId],
        ]} />
      </DocumentSection>
      <DocumentSection title="Repair Findings">
        <DocumentFieldGrid rows={[
          ['Reported Problem', job.issueDescription],
          ['Diagnosis Findings', job.diagnosisNote || job.diagnosisSummaryPublic],
          ['Work Performed', job.repairSummaryPublic || job.repairNote],
          ['Parts Replaced', '-'],
          ['Test Results', job.qcNote || '-'],
          ['Before / After Notes', job.collectionNote || '-'],
          ['Technician Remarks', job.repairNote || job.qcNote || '-'],
          ['Technician Name', job.technicianName || job.technicianId],
          ['Completion Date', formatDocumentDate(job.repairCompletedAt)],
        ]} />
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
