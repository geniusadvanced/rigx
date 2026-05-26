import type { Job } from '@/types';

type JobReferenceSource = Partial<Job> & {
  id?: string | null;
  repairId?: string | null;
};

function cleanReference(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getReadableJobReference(job?: JobReferenceSource | null): string {
  if (!job) return '';

  return (
    cleanReference(job.jobNo) ||
    cleanReference(job.jobNumber) ||
    cleanReference(job.jobSheetNo) ||
    cleanReference(job.agnJobNumber) ||
    cleanReference(job.repairId) ||
    cleanReference(job.docId) ||
    cleanReference(job.id)
  );
}

export function findJobByReference(jobs: Job[], reference?: string | null): Job | undefined {
  const normalizedReference = cleanReference(reference).toLowerCase();
  if (!normalizedReference) return undefined;

  return jobs.find((job) => {
    const values = [
      job.docId,
      (job as JobReferenceSource).id,
      job.jobNo,
      job.jobNumber,
      job.jobSheetNo,
      job.agnJobNumber,
      (job as JobReferenceSource).repairId,
    ];
    return values.some((value) => cleanReference(value).toLowerCase() === normalizedReference);
  });
}
