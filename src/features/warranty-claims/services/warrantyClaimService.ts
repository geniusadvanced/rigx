import {
  addDoc,
  arrayUnion,
  collection,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  doc,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { getWarrantyStatus } from '@/features/job-documents/services/jobDocumentRecordService';
import { db } from '@/lib/firebase/init';
import { assertCan, can } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import type { JobDocumentRecord } from '@/features/job-documents/types';
import type {
  CreateWarrantyClaimInput,
  WarrantyClaim,
  WarrantyClaimStatus,
  WarrantyClaimType,
} from '../types';

const allowedClaimTypes: WarrantyClaimType[] = ['repair_issue', 'part_failure', 'other'];

const allowedTransitions: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  created: ['inspection'],
  inspection: ['approved', 'rejected'],
  approved: ['in_repair'],
  rejected: [],
  in_repair: ['completed'],
  completed: [],
};

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function normalizeText(value: string): string {
  return value.trim();
}

function mapClaim(claimId: string, data: Record<string, unknown>): WarrantyClaim {
  return {
    ...(data as Omit<WarrantyClaim, 'claimId'>),
    claimId,
  };
}

function activeWarrantyForClaim(records: JobDocumentRecord[]): JobDocumentRecord | null {
  return records
    .filter((record) => getWarrantyStatus(record) === 'active')
    .sort((left, right) => {
      const leftEnd = left.warrantyEndDate?.toMillis?.() || 0;
      const rightEnd = right.warrantyEndDate?.toMillis?.() || 0;
      return rightEnd - leftEnd;
    })[0] || null;
}

function assertCanHandleClaim(user: UserData, claim: WarrantyClaim, nextStatus: WarrantyClaimStatus) {
  if (can(user.role, 'jobs.manageWarranty')) return;

  if (user.role !== 'technician' || claim.technicianId !== user.uid) {
    throw new Error('You do not have permission to update this warranty claim');
  }

  if (nextStatus === 'approved' || nextStatus === 'rejected') {
    throw new Error('Only admin or manager can approve or reject warranty claims');
  }
}

function assertValidTransition(currentStatus: WarrantyClaimStatus, nextStatus: WarrantyClaimStatus) {
  if (!allowedTransitions[currentStatus]?.includes(nextStatus)) {
    throw new Error(`Invalid warranty claim transition from ${currentStatus} to ${nextStatus}`);
  }
}

function auditActionForStatus(nextStatus: WarrantyClaimStatus) {
  if (nextStatus === 'inspection') return 'warranty_claim_inspection_updated' as const;
  if (nextStatus === 'approved') return 'warranty_claim_approved' as const;
  if (nextStatus === 'rejected') return 'warranty_claim_rejected' as const;
  if (nextStatus === 'completed') return 'warranty_claim_completed' as const;
  return 'status_change' as const;
}

export function getActiveWarrantyRecord(records: JobDocumentRecord[]): JobDocumentRecord | null {
  return activeWarrantyForClaim(records);
}

export function canCreateWarrantyClaim(user: UserData | null): boolean {
  return can(user?.role, 'jobs.createWarrantyClaim');
}

export function canUpdateWarrantyClaim(user: UserData | null, claim: WarrantyClaim | null): boolean {
  if (!user || !claim) return false;
  if (can(user.role, 'jobs.manageWarranty')) return allowedTransitions[claim.status].length > 0;
  return user.role === 'technician' && claim.technicianId === user.uid && ['created', 'approved', 'in_repair'].includes(claim.status);
}

export async function getWarrantyClaimsForUser(user: UserData): Promise<WarrantyClaim[]> {
  if (can(user.role, 'jobs.manageWarranty')) {
    // Admin/manager can read all warranty claims through the operational jobs warranty permission.
  } else {
    assertCan(user.role, 'jobs.view.assigned');
  }

  const claimQuery =
    can(user.role, 'jobs.manageWarranty')
      ? collection(db, 'warrantyClaims')
      : query(collection(db, 'warrantyClaims'), where('technicianId', '==', user.uid));
  const snapshot = await getDocs(claimQuery);
  return snapshot.docs
    .map((claimDoc) => mapClaim(claimDoc.id, claimDoc.data()))
    .sort((left, right) => {
      const leftTime = left.updatedAt?.toMillis?.() || left.createdAt?.toMillis?.() || 0;
      const rightTime = right.updatedAt?.toMillis?.() || right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}

export async function getWarrantyClaimsByJob(jobId: string): Promise<WarrantyClaim[]> {
  const snapshot = await getDocs(query(collection(db, 'warrantyClaims'), where('originalJobId', '==', jobId)));
  return snapshot.docs
    .map((claimDoc) => mapClaim(claimDoc.id, claimDoc.data()))
    .sort((left, right) => {
      const leftTime = left.updatedAt?.toMillis?.() || left.createdAt?.toMillis?.() || 0;
      const rightTime = right.updatedAt?.toMillis?.() || right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}

export async function createWarrantyClaim(
  job: Job,
  warrantyRecords: JobDocumentRecord[],
  input: CreateWarrantyClaimInput,
  user: UserData,
): Promise<string> {
  assertCan(user.role, 'jobs.createWarrantyClaim');

  const claimReason = normalizeText(input.claimReason);
  if (!claimReason) throw new Error('Claim reason is required');
  if (!allowedClaimTypes.includes(input.claimType)) throw new Error('Invalid claim type');

  const warrantyRecord = activeWarrantyForClaim(warrantyRecords);
  if (!warrantyRecord) throw new Error('No active warranty found for this job');

  const historyItem = {
    status: 'created' satisfies WarrantyClaimStatus,
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changedAt: Timestamp.now(),
    note: claimReason,
  };

  const claimRef = await addDoc(collection(db, 'warrantyClaims'), {
    originalJobId: job.docId,
    originalJobSheetNo: job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber,
    warrantyDocumentId: warrantyRecord.documentId,
    warrantyStartDate: warrantyRecord.warrantyStartDate,
    warrantyEndDate: warrantyRecord.warrantyEndDate,
    technicianId: job.technicianId,
    branchId: job.branchId || '',
    customerName: job.customerName || '',
    deviceBrand: job.deviceBrand || '',
    deviceModel: job.deviceModel || job.device || '',
    claimReason,
    claimType: input.claimType,
    status: 'created',
    inspectionNote: '',
    decisionNote: '',
    handledBy: user.uid,
    handledByDisplayName: displayNameForUser(user),
    statusHistory: [historyItem],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'warranty_claim',
    entityId: claimRef.id,
    action: 'warranty_claim_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'status', before: null, after: 'created' },
      { field: 'originalJobSheetNo', before: null, after: job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber },
    ],
    note: claimReason,
  });

  return claimRef.id;
}

export async function updateWarrantyClaimStatus(
  claim: WarrantyClaim,
  nextStatus: WarrantyClaimStatus,
  note: string,
  user: UserData,
): Promise<void> {
  const cleanNote = normalizeText(note);
  assertValidTransition(claim.status, nextStatus);
  assertCanHandleClaim(user, claim, nextStatus);
  if (nextStatus === 'rejected' && !cleanNote) throw new Error('Rejection reason is required');

  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    handledBy: user.uid,
    handledByDisplayName: displayNameForUser(user),
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: nextStatus,
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changedAt: Timestamp.now(),
      note: cleanNote,
    }),
  };

  if (nextStatus === 'inspection') updatePayload.inspectionNote = cleanNote;
  if (nextStatus === 'approved' || nextStatus === 'rejected' || nextStatus === 'completed') {
    updatePayload.decisionNote = cleanNote;
  }

  await updateDoc(doc(db, 'warrantyClaims', claim.claimId), updatePayload);

  await writeAuditLog({
    entityType: 'warranty_claim',
    entityId: claim.claimId,
    action: auditActionForStatus(nextStatus),
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: claim.status, after: nextStatus }],
    note: cleanNote,
  });
}
