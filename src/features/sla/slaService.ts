import { normalizeJobStatus, type JobStatus } from '@/features/jobs/types';
import {
  getCurrentRepairLifecycleStatus,
  repairLifecycleLabels,
  type RepairLifecycleStatus,
} from '@/features/jobs/services/jobLifecycleService';
import type { PartsOrder } from '@/features/parts-orders/types';
import type { Job } from '@/types';

export type SlaStatus = 'normal' | 'warning' | 'overdue';
export type SlaFlag =
  | 'diagnosis_delay'
  | 'quotation_delay'
  | 'customer_delay'
  | 'repair_delay'
  | 'parts_delay'
  | 'collection_delay'
  | 'payment_issue';

export interface SlaResult {
  status: SlaStatus;
  flags: SlaFlag[];
  primaryFlag: SlaFlag | null;
  reason: string;
  currentStage: string;
  elapsedHours: number;
  thresholdHours: number | null;
}

const thresholds: Partial<Record<RepairLifecycleStatus, { flag: SlaFlag; hours: number; label: string }>> = {
  received: { flag: 'diagnosis_delay', hours: 24, label: 'Diagnosis pending' },
  diagnosis: { flag: 'quotation_delay', hours: 24, label: 'Quotation pending' },
  quotation_pending: { flag: 'quotation_delay', hours: 24, label: 'Quotation pending' },
  quotation_sent: { flag: 'customer_delay', hours: 72, label: 'Waiting for customer decision' },
  customer_approved: { flag: 'repair_delay', hours: 24, label: 'Repair not started' },
  repair_in_progress: { flag: 'repair_delay', hours: 72, label: 'Repair in progress' },
  repair_completed: { flag: 'collection_delay', hours: 24, label: 'Ready for pickup pending' },
  ready_for_pickup: { flag: 'collection_delay', hours: 168, label: 'Ready for collection' },
};

const terminalLifecycleStatuses = new Set<RepairLifecycleStatus>([
  'cancelled',
  'delivered',
  'warranty_active',
  'warranty_expired',
]);

const lifecycleTimestampFields: Partial<Record<RepairLifecycleStatus, keyof Job>> = {
  received: 'receivedAt',
  diagnosis: 'diagnosisStartedAt',
  quotation_pending: 'diagnosisCompletedAt',
  quotation_sent: 'quotationSentAt',
  customer_approved: 'customerApprovedAt',
  customer_rejected: 'customerRejectedAt',
  repair_in_progress: 'repairStartedAt',
  repair_completed: 'repairCompletedAt',
  ready_for_pickup: 'readyForPickupAt',
  delivered: 'deliveredAt',
  warranty_active: 'warrantyStartedAt',
  warranty_expired: 'warrantyExpiresAt',
  cancelled: 'cancelledAt',
};

const flagLabels: Record<SlaFlag, string> = {
  diagnosis_delay: 'Diagnosis delay',
  quotation_delay: 'Quotation delay',
  customer_delay: 'Waiting for customer decision',
  repair_delay: 'Repair delay',
  parts_delay: 'Waiting parts ETA passed',
  collection_delay: 'Collection delay',
  payment_issue: 'Payment not fully paid',
};

function toMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('toMillis' in value)) return null;
  const toMillisFn = (value as { toMillis?: unknown }).toMillis;
  return typeof toMillisFn === 'function' ? toMillisFn.call(value) : null;
}

function getJobTimestamp(job: Job, key: 'createdAt' | 'updatedAt'): number | null {
  return toMillis((job as Job & { createdAt?: unknown; updatedAt?: unknown })[key]);
}

function getStageStartMillis(job: Job, status: JobStatus): number {
  const matchingHistory = (job.statusHistory || [])
    .filter((history) => normalizeJobStatus(history.status) === status)
    .at(-1);
  return (
    toMillis(matchingHistory?.changedAt) ||
    getJobTimestamp(job, 'updatedAt') ||
    getJobTimestamp(job, 'createdAt') ||
    Date.now()
  );
}

function getLifecycleStageStartMillis(job: Job, status: RepairLifecycleStatus): number {
  const timestampField = lifecycleTimestampFields[status];
  const directTimestamp = timestampField ? toMillis(job[timestampField]) : null;
  if (directTimestamp) return directTimestamp;

  const matchingHistory = (job.lifecycleHistory || [])
    .filter((history) => history.status === status)
    .at(-1);

  return (
    toMillis(matchingHistory?.changedAt) ||
    getStageStartMillis(job, normalizeJobStatus(job.status)) ||
    getJobTimestamp(job, 'updatedAt') ||
    getJobTimestamp(job, 'createdAt') ||
    Date.now()
  );
}

function latestEtaMillis(partsOrders: PartsOrder[]): number | null {
  const etaValues = partsOrders
    .map((order) => toMillis(order.etaDate))
    .filter((value): value is number => value !== null);
  if (etaValues.length === 0) return null;
  return Math.max(...etaValues);
}

export function getSlaFlagLabel(flag: SlaFlag | null): string {
  return flag ? flagLabels[flag] : 'Normal';
}

export function calculateJobSla(job: Job, partsOrders: PartsOrder[] = [], now = Date.now()): SlaResult {
  const currentStatus = normalizeJobStatus(job.status);
  const currentLifecycleStatus = getCurrentRepairLifecycleStatus(job);
  const flags: SlaFlag[] = [];
  let status: SlaStatus = 'normal';
  let reason = 'Within SLA';
  let elapsedHours = 0;
  let thresholdHours: number | null = null;
  let currentStage = repairLifecycleLabels[currentLifecycleStatus] || currentLifecycleStatus.replaceAll('_', ' ');

  if (terminalLifecycleStatuses.has(currentLifecycleStatus)) {
    return {
      status,
      flags,
      primaryFlag: null,
      reason,
      currentStage,
      elapsedHours,
      thresholdHours,
    };
  }

  const threshold = thresholds[currentLifecycleStatus];
  if (threshold) {
    const stageStart = getLifecycleStageStartMillis(job, currentLifecycleStatus);
    elapsedHours = Math.max(0, (now - stageStart) / (1000 * 60 * 60));
    thresholdHours = threshold.hours;
    currentStage = threshold.label;

    if (elapsedHours > threshold.hours) {
      status = 'overdue';
      flags.push(threshold.flag);
      reason = `Overdue: ${threshold.label} (${Math.floor(elapsedHours)}h+)`;
    } else if (elapsedHours >= threshold.hours * 0.75) {
      status = 'warning';
      reason = `Warning: ${threshold.label} nearing SLA`;
    }
  }

  if (currentStatus === 'waiting_parts') {
    const eta = latestEtaMillis(partsOrders);
    currentStage = 'Waiting for parts';
    thresholdHours = eta ? Math.max(0, (eta - getStageStartMillis(job, currentStatus)) / (1000 * 60 * 60)) : null;
    elapsedHours = Math.max(0, (now - getStageStartMillis(job, currentStatus)) / (1000 * 60 * 60));
    if (eta && now > eta) {
      status = 'overdue';
      flags.push('parts_delay');
      reason = 'Overdue: parts ETA has passed';
    } else if (eta && now >= eta - 12 * 60 * 60) {
      status = status === 'overdue' ? status : 'warning';
      reason = status === 'overdue' ? reason : 'Warning: parts ETA approaching';
    }
  }

  if (
    (currentLifecycleStatus === 'ready_for_pickup' || currentLifecycleStatus === 'repair_completed') &&
    job.paymentStatus !== 'paid'
  ) {
    flags.push('payment_issue');
    if (status !== 'overdue') {
      status = 'warning';
      reason = 'Payment issue: balance is not fully paid';
    }
  }

  return {
    status,
    flags,
    primaryFlag: flags[0] || null,
    reason,
    currentStage,
    elapsedHours,
    thresholdHours,
  };
}

export function slaBadgeClass(status: SlaStatus): string {
  if (status === 'overdue') return 'border-red-500/40 bg-red-500/10 text-red-300';
  if (status === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
}
