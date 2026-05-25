import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { getAfterRepairChecklistByJob } from '@/features/device-checklists/deviceChecklistService';
import { db } from '@/lib/firebase/init';
import { can, isAdminOrManager } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';

export type RepairLifecycleStatus =
  | 'received'
  | 'diagnosis'
  | 'quotation_pending'
  | 'quotation_sent'
  | 'customer_approved'
  | 'customer_rejected'
  | 'repair_in_progress'
  | 'repair_completed'
  | 'ready_for_pickup'
  | 'delivered'
  | 'warranty_active'
  | 'warranty_expired'
  | 'cancelled';

export interface JobLifecycleHistoryItem {
  status: RepairLifecycleStatus;
  changedBy: string;
  changedByDisplayName: string;
  changedAt: Timestamp;
  note: string;
  overrideUsed?: boolean;
}

export const repairLifecycleStatuses: RepairLifecycleStatus[] = [
  'received',
  'diagnosis',
  'quotation_pending',
  'quotation_sent',
  'customer_approved',
  'customer_rejected',
  'repair_in_progress',
  'repair_completed',
  'ready_for_pickup',
  'delivered',
  'warranty_active',
  'warranty_expired',
  'cancelled',
];

export const repairLifecycleLabels: Record<RepairLifecycleStatus, string> = {
  received: 'Received',
  diagnosis: 'Diagnosis',
  quotation_pending: 'Quotation Pending',
  quotation_sent: 'Quotation Sent',
  customer_approved: 'Customer Approved',
  customer_rejected: 'Customer Rejected',
  repair_in_progress: 'Repair In Progress',
  repair_completed: 'Repair Completed',
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  warranty_active: 'Warranty Active',
  warranty_expired: 'Warranty Expired',
  cancelled: 'Cancelled',
};

export const repairLifecycleActionLabels: Record<RepairLifecycleStatus, string> = {
  received: 'Mark Received',
  diagnosis: 'Start Diagnosis',
  quotation_pending: 'Mark Diagnosis Done',
  quotation_sent: 'Send Quotation',
  customer_approved: 'Mark Customer Approved',
  customer_rejected: 'Mark Customer Rejected',
  repair_in_progress: 'Start Repair',
  repair_completed: 'Mark Repair Completed',
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Mark Delivered',
  warranty_active: 'Activate Warranty',
  warranty_expired: 'Expire Warranty',
  cancelled: 'Cancel Job',
};

const transitionMap: Record<RepairLifecycleStatus, RepairLifecycleStatus[]> = {
  received: ['diagnosis', 'cancelled'],
  diagnosis: ['quotation_pending', 'cancelled'],
  quotation_pending: ['quotation_sent', 'cancelled'],
  quotation_sent: ['customer_approved', 'customer_rejected', 'cancelled'],
  customer_approved: ['repair_in_progress', 'cancelled'],
  customer_rejected: ['quotation_pending', 'cancelled'],
  repair_in_progress: ['repair_completed', 'cancelled'],
  repair_completed: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['delivered', 'cancelled'],
  delivered: ['warranty_active'],
  warranty_active: ['warranty_expired'],
  warranty_expired: [],
  cancelled: [],
};

const technicianAllowed: Partial<Record<RepairLifecycleStatus, RepairLifecycleStatus[]>> = {
  received: ['diagnosis'],
  diagnosis: ['quotation_pending'],
  quotation_pending: ['quotation_sent'],
  customer_approved: ['repair_in_progress'],
  repair_in_progress: ['repair_completed'],
  repair_completed: ['ready_for_pickup'],
};

const legacyStatusByLifecycle: Record<RepairLifecycleStatus, string> = {
  received: 'received',
  diagnosis: 'diagnosis',
  quotation_pending: 'quotation_pending',
  quotation_sent: 'quotation_sent',
  customer_approved: 'customer_approved',
  customer_rejected: 'quotation_sent',
  repair_in_progress: 'in_repair',
  repair_completed: 'completed',
  ready_for_pickup: 'ready_for_collection',
  delivered: 'collected',
  warranty_active: 'collected',
  warranty_expired: 'collected',
  cancelled: 'cancelled',
};

const timestampFieldByLifecycle: Partial<Record<RepairLifecycleStatus, string>> = {
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

function isCustomerReleaseStatus(status: RepairLifecycleStatus): boolean {
  return ['ready_for_pickup', 'delivered', 'warranty_active', 'warranty_expired'].includes(status);
}

export function normalizeRepairLifecycleStatus(status?: string): RepairLifecycleStatus {
  if (repairLifecycleStatuses.includes(status as RepairLifecycleStatus)) return status as RepairLifecycleStatus;
  if (status === 'pending' || status === 'pending_approval' || status === 'approved') return 'received';
  if (status === 'diagnosing') return 'diagnosis';
  if (status === 'quotation_required') return 'quotation_pending';
  if (status === 'quoted') return 'quotation_sent';
  if (status === 'quotation_approved') return 'customer_approved';
  if (status === 'in_progress' || status === 'in_repair' || status === 'waiting_parts') return 'repair_in_progress';
  if (status === 'done' || status === 'completed') return 'repair_completed';
  if (status === 'ready' || status === 'ready_for_collection') return 'ready_for_pickup';
  if (status === 'collected') return 'delivered';
  return 'received';
}

export function getCurrentRepairLifecycleStatus(job: Pick<Job, 'status'> & { lifecycleStatus?: string }): RepairLifecycleStatus {
  return normalizeRepairLifecycleStatus(job.lifecycleStatus || job.status);
}

export function getAllowedRepairLifecycleTransitions(job: Job, user: UserData | null): RepairLifecycleStatus[] {
  if (!user) return [];
  const current = getCurrentRepairLifecycleStatus(job);
  if (user.role === 'technician') {
    if (job.technicianId !== user.uid) return [];
    return technicianAllowed[current] || [];
  }
  if (user.role === 'admin' || user.role === 'manager') return transitionMap[current] || [];
  return [];
}

export function validateRepairLifecycleTransition(
  currentStatus: RepairLifecycleStatus,
  nextStatus: RepairLifecycleStatus,
  user: UserData,
  job: Job,
  overrideReason?: string,
): { overrideUsed: boolean } {
  const normalAllowed = (transitionMap[currentStatus] || []).includes(nextStatus);
  const technicianAllowedTransition = user.role === 'technician'
    && job.technicianId === user.uid
    && (technicianAllowed[currentStatus] || []).includes(nextStatus);

  if (user.role === 'technician') {
    if (!technicianAllowedTransition) throw new Error('Invalid lifecycle transition for technician');
    return { overrideUsed: false };
  }

  if (isAdminOrManager(user.role)) {
    if (normalAllowed) return { overrideUsed: false };
    if (!overrideReason?.trim()) throw new Error('Override reason is required for this lifecycle transition');
    return { overrideUsed: true };
  }

  throw new Error('Invalid lifecycle transition');
}

function lifecycleErrorDetails(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : undefined,
    errorCode: typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined,
    errorStack: error instanceof Error ? error.stack : undefined,
    errorString: String(error),
  };
}

function getLifecycleLogJobNumber(job: Job): string {
  return job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || job.docId || '';
}

function lifecycleCheckpoint(
  checkpoint: string,
  params: {
    jobId: string;
    jobNumber: string;
    nextStatus: RepairLifecycleStatus;
    legacyStatus: string;
    user: UserData;
    phase: 'started' | 'succeeded' | 'failed';
    error?: unknown;
  },
) {
  console.warn('[JOB LIFECYCLE CHECKPOINT JSON]', JSON.stringify({
    checkpoint,
    jobDocId: params.jobId,
    jobNumber: params.jobNumber,
    lifecycleStatus: params.nextStatus,
    legacyStatus: params.legacyStatus,
    userUid: params.user.uid,
    userRole: params.user.role,
    started: params.phase === 'started',
    succeeded: params.phase === 'succeeded',
    failed: params.phase === 'failed',
    ...(params.error === undefined ? {} : lifecycleErrorDetails(params.error)),
  }, null, 2));
}

export async function updateJobLifecycleStatus(params: {
  job: Job;
  user: UserData;
  nextStatus: RepairLifecycleStatus;
  note: string;
  overrideReason?: string;
  pickupNotification?: boolean;
}): Promise<void> {
  if (!params.job?.docId) throw new Error('Job ID is required for lifecycle update');
  if (!params.user?.uid) throw new Error('User identity is required for lifecycle update');
  if (!repairLifecycleStatuses.includes(params.nextStatus)) throw new Error('Invalid lifecycle status');
  if (!can(params.user.role, 'jobs.update') && !can(params.user.role, 'jobs.view.assigned')) {
    throw new Error('Permission denied');
  }
  const currentStatus = getCurrentRepairLifecycleStatus(params.job);
  const { overrideUsed } = validateRepairLifecycleTransition(
    currentStatus,
    params.nextStatus,
    params.user,
    params.job,
    params.overrideReason,
  );
  if (params.nextStatus === 'repair_in_progress' && currentStatus !== 'customer_approved' && !overrideUsed) {
    throw new Error('Cannot start repair before customer approval');
  }
  if (params.nextStatus === 'warranty_active' && !['delivered', 'repair_completed'].includes(currentStatus) && !overrideUsed) {
    throw new Error('Cannot activate warranty before delivery or completion');
  }
  if (isCustomerReleaseStatus(params.nextStatus)) {
    const afterRepairChecklist = await getAfterRepairChecklistByJob({
      jobId: params.job.docId,
      user: params.user,
      jobBranchId: params.job.branchId,
      jobTechnicianId: params.job.technicianId,
    });
    if (
      afterRepairChecklist?.checklistType !== 'after_repair'
      || afterRepairChecklist.checklistStatus !== 'completed'
      || !afterRepairChecklist.completedAt
    ) {
      throw new Error('Please complete After Repair Checklist before handing over the device to customer.');
    }
  }

  const timestampField = timestampFieldByLifecycle[params.nextStatus];
  const now = Timestamp.now();
  const updates: Record<string, unknown> = {
    lifecycleStatus: params.nextStatus,
    status: legacyStatusByLifecycle[params.nextStatus],
    lifecycleHistory: arrayUnion({
      status: params.nextStatus,
      changedBy: params.user.uid,
      changedByDisplayName: params.user.displayName || params.user.name || 'Unknown User',
      changedAt: now,
      note: params.note || params.overrideReason || '',
      overrideUsed,
    }),
    statusHistory: arrayUnion({
      status: legacyStatusByLifecycle[params.nextStatus],
      changedBy: params.user.uid,
      changedByDisplayName: params.user.displayName || params.user.name || 'Unknown User',
      changedAt: now,
      note: params.note || params.overrideReason || '',
    }),
    updatedAt: serverTimestamp(),
  };
  if (timestampField) updates[timestampField] = serverTimestamp();
  if (params.nextStatus === 'customer_approved') {
    updates.customerApprovalStatus = 'approved';
    updates.quotationStatus = 'approved';
  }
  if (params.nextStatus === 'customer_rejected') {
    updates.customerApprovalStatus = 'rejected';
    updates.quotationStatus = 'rejected';
  }
  if (params.nextStatus === 'quotation_sent') {
    updates.quotationStatus = 'sent';
  }
  if (params.nextStatus === 'ready_for_pickup' && params.pickupNotification) {
    updates.readyForPickupBy = params.user.uid;
    updates.readyForPickupByDisplayName = params.user.displayName || params.user.name || 'Unknown User';
    updates.pickupNotifiedAt = serverTimestamp();
    updates.pickupNotifiedBy = params.user.uid;
    updates.pickupNotifiedByDisplayName = params.user.displayName || params.user.name || 'Unknown User';
    updates.repairSummaryPublic = 'Your device is ready for pickup at Genius Advanced.';
  }

  const jobNumber = getLifecycleLogJobNumber(params.job);
  const legacyStatus = legacyStatusByLifecycle[params.nextStatus];

  lifecycleCheckpoint('lifecycle:updateDoc:start', {
    jobId: params.job.docId,
    jobNumber,
    nextStatus: params.nextStatus,
    legacyStatus,
    user: params.user,
    phase: 'started',
  });
  try {
    await updateDoc(doc(db, 'jobs', params.job.docId), updates);
    lifecycleCheckpoint('lifecycle:updateDoc:success', {
      jobId: params.job.docId,
      jobNumber,
      nextStatus: params.nextStatus,
      legacyStatus,
      user: params.user,
      phase: 'succeeded',
    });
  } catch (error) {
    lifecycleCheckpoint('lifecycle:updateDoc:failed', {
      jobId: params.job.docId,
      jobNumber,
      nextStatus: params.nextStatus,
      legacyStatus,
      user: params.user,
      phase: 'failed',
      error,
    });
    throw error;
  }
  const lifecycleAuditPayload = {
    entityType: 'job' as const,
    entityId: params.job.docId,
    action: params.nextStatus === 'cancelled'
      ? 'job_cancelled' as const
      : params.nextStatus === 'delivered'
        ? 'job_delivered' as const
        : params.nextStatus === 'warranty_active'
          ? 'warranty_activated' as const
          : params.nextStatus === 'warranty_expired'
            ? 'warranty_expired' as const
            : overrideUsed
              ? 'job_lifecycle_override_used' as const
              : 'job_lifecycle_status_changed' as const,
    changedBy: params.user.uid,
    changedByDisplayName: params.user.displayName || params.user.name || 'Unknown User',
    changes: [{ field: 'lifecycleStatus', before: currentStatus, after: params.nextStatus }],
    note: overrideUsed ? params.overrideReason || params.note : params.note,
  };
  lifecycleCheckpoint('lifecycle:audit:normal:start', {
    jobId: params.job.docId,
    jobNumber,
    nextStatus: params.nextStatus,
    legacyStatus,
    user: params.user,
    phase: 'started',
  });
  try {
    await writeAuditLog(lifecycleAuditPayload);
    lifecycleCheckpoint('lifecycle:audit:normal:success', {
      jobId: params.job.docId,
      jobNumber,
      nextStatus: params.nextStatus,
      legacyStatus,
      user: params.user,
      phase: 'succeeded',
    });
  } catch (error) {
    lifecycleCheckpoint('lifecycle:audit:normal:failed', {
      jobId: params.job.docId,
      jobNumber,
      nextStatus: params.nextStatus,
      legacyStatus,
      user: params.user,
      phase: 'failed',
      error,
    });
    throw error;
  }
  if (params.nextStatus === 'ready_for_pickup' && params.pickupNotification) {
    const pickupAuditPayload = {
      entityType: 'job' as const,
      entityId: params.job.docId,
      action: 'job_ready_for_pickup_whatsapp_sent' as const,
      changedBy: params.user.uid,
      changedByDisplayName: params.user.displayName || params.user.name || 'Unknown User',
      changes: [
        { field: 'pickupNotifiedAt', before: params.job.pickupNotifiedAt || null, after: 'sent' },
      ],
      note: 'Ready for pickup WhatsApp message prepared',
    };
    lifecycleCheckpoint('lifecycle:audit:readyPickupWhatsapp:start', {
      jobId: params.job.docId,
      jobNumber,
      nextStatus: params.nextStatus,
      legacyStatus,
      user: params.user,
      phase: 'started',
    });
    try {
      await writeAuditLog(pickupAuditPayload);
      lifecycleCheckpoint('lifecycle:audit:readyPickupWhatsapp:success', {
        jobId: params.job.docId,
        jobNumber,
        nextStatus: params.nextStatus,
        legacyStatus,
        user: params.user,
        phase: 'succeeded',
      });
    } catch (error) {
      lifecycleCheckpoint('lifecycle:audit:readyPickupWhatsapp:failed', {
        jobId: params.job.docId,
        jobNumber,
        nextStatus: params.nextStatus,
        legacyStatus,
        user: params.user,
        phase: 'failed',
        error,
      });
      console.warn('[JOB LIFECYCLE CHECKPOINT JSON]', JSON.stringify({
        checkpoint: 'lifecycle:audit:readyPickupWhatsapp:nonBlocking',
        jobDocId: params.job.docId,
        jobNumber,
        lifecycleStatus: params.nextStatus,
        legacyStatus,
        userUid: params.user.uid,
        userRole: params.user.role,
        ...lifecycleErrorDetails(error),
      }, null, 2));
    }
  }
}
