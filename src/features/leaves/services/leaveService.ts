import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { Role } from '@/types';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import type { CreateLeaveRequestInput, LeaveRequest, LeaveStatus } from '../types';
import {
  assertCanCancelLeave,
  assertCanReviewLeave,
  assertNoOverlappingActiveLeave,
  assertValidLeaveDateRange,
} from '../utils/leaveWorkflow';

const allowedMcFileTypes = ['application/pdf', 'image/jpeg', 'image/png'];
const maxMcFileSize = 5 * 1024 * 1024;

interface ApproveLeaveRequestParams {
  leaveId: string;
  approvedBy: string;
  approvedByRole: Role;
  approvedByDisplayName?: string;
}

interface RejectLeaveRequestParams {
  leaveId: string;
  rejectedBy: string;
  rejectedByRole: Role;
  rejectedByDisplayName?: string;
  rejectionReason: string;
}

interface CancelLeaveRequestParams {
  leaveId: string;
  userId: string;
}

function createAuditRef() {
  return doc(collection(db, 'audit_logs'));
}

function getMonthsBetweenDates(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const months: string[] = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function mapLeaveDocument(leaveId: string, data: Record<string, unknown>): LeaveRequest {
  return {
    ...(data as Omit<LeaveRequest, 'leaveId'>),
    leaveId,
  };
}

function sortLeavesByCreatedAtDesc(leaves: LeaveRequest[]): LeaveRequest[] {
  return [...leaves].sort((left, right) => {
    const leftDate = left.createdAt?.toMillis?.() || 0;
    const rightDate = right.createdAt?.toMillis?.() || 0;
    return rightDate - leftDate;
  });
}

function sanitizeStorageFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'medical-certificate';
}

async function uploadMedicalCertificate(userId: string, leaveId: string, file?: File | null) {
  if (!file) return null;

  if (!allowedMcFileTypes.includes(file.type)) {
    throw new Error('Please upload a PDF, JPG, or PNG file under 5MB.');
  }

  if (file.size > maxMcFileSize) {
    throw new Error('Please upload a PDF, JPG, or PNG file under 5MB.');
  }

  const safeName = sanitizeStorageFileName(file.name);
  const filePath = `leave-mc/${userId}/${leaveId}/${Date.now()}-${safeName}`;
  const uploadSnapshot = await uploadBytes(ref(storage, filePath), file, {
    contentType: file.type,
    customMetadata: {
      leaveRequestId: leaveId,
      userId,
    },
  });
  const fileUrl = await getDownloadURL(uploadSnapshot.ref);

  return {
    fileUrl,
    filePath,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export async function createLeaveRequest(input: CreateLeaveRequestInput): Promise<{ leaveId: string }> {
  assertCan(input.createdByRole, 'leaves.create');
  assertValidLeaveDateRange(input.startDate, input.endDate);

  if (!input.reason.trim()) {
    throw new Error('Leave reason is required');
  }

  const [existingLeavesSnapshot, attendanceSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'leaves'), where('technicianId', '==', input.userId))),
    getDocs(
      query(
        collection(db, 'attendance'),
        where('userId', '==', input.userId),
        where('date', '>=', input.startDate),
        where('date', '<=', input.endDate),
      ),
    ),
  ]);
  const existingLeaves = existingLeavesSnapshot.docs.map((leaveDoc) =>
    mapLeaveDocument(leaveDoc.id, leaveDoc.data()),
  );

  assertNoOverlappingActiveLeave(existingLeaves, input.startDate, input.endDate);

  const clockedInAttendance = attendanceSnapshot.docs.find((attendanceDoc) => attendanceDoc.data().clockIn?.timestamp);
  if (clockedInAttendance) {
    throw new Error('Leave cannot be requested for a date with existing clock-in attendance');
  }

  const leaveRef = doc(collection(db, 'leaves'));
  let mcMetadata: Awaited<ReturnType<typeof uploadMedicalCertificate>> = null;

  if (input.leaveType === 'medical') {
    try {
      mcMetadata = await uploadMedicalCertificate(input.userId, leaveRef.id, input.mcFile);
    } catch (error) {
      if (error instanceof Error && error.message === 'Please upload a PDF, JPG, or PNG file under 5MB.') {
        throw error;
      }
      throw new Error('Leave request was not submitted because MC upload failed. Please try again.');
    }
  }

  await runTransaction(db, async (transaction) => {
    const payload: Record<string, unknown> = {
      userId: input.userId,
      technicianId: input.userId,
      branchId: input.branchId || '',
      startDate: input.startDate,
      endDate: input.endDate,
      leaveType: input.leaveType,
      reason: input.reason.trim(),
      status: 'pending' satisfies LeaveStatus,
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
    };

    if (mcMetadata) {
      payload.mcFileUrl = mcMetadata.fileUrl;
      payload.mcFilePath = mcMetadata.filePath;
      payload.mcFileName = mcMetadata.fileName;
      payload.mcFileType = mcMetadata.fileType;
      payload.mcFileSize = mcMetadata.fileSize;
      payload.mcUploadedAt = serverTimestamp();
    }

    transaction.set(leaveRef, payload);
  });

  if (mcMetadata) {
    await writeAuditLog({
      entityType: 'leave',
      entityId: leaveRef.id,
      action: 'leave_mc_uploaded',
      changedBy: input.createdBy,
      changedByDisplayName: input.createdByDisplayName || 'Unknown User',
      changes: [
        { field: 'mcFileName', before: null, after: mcMetadata.fileName },
        { field: 'mcFileType', before: null, after: mcMetadata.fileType },
        { field: 'mcFileSize', before: null, after: mcMetadata.fileSize },
      ],
      note: 'Medical certificate uploaded with leave request',
    });
  }

  return { leaveId: leaveRef.id };
}

export async function approveLeaveRequest(params: ApproveLeaveRequestParams): Promise<void> {
  assertCan(params.approvedByRole, 'leaves.approve');
  const leaveRef = doc(db, 'leaves', params.leaveId);
  let previousStatus: LeaveStatus = 'pending';

  await runTransaction(db, async (transaction) => {
    const leaveSnapshot = await transaction.get(leaveRef);

    if (!leaveSnapshot.exists()) {
      throw new Error('Leave request not found');
    }

    const leave = leaveSnapshot.data() as LeaveRequest;
    previousStatus = leave.status;
    assertCanReviewLeave(leave.status);
    const affectedMonthRefs = getMonthsBetweenDates(leave.startDate, leave.endDate).map((month) =>
      doc(db, 'payroll_months', month),
    );
    const affectedMonthSnapshots = await Promise.all(affectedMonthRefs.map((monthRef) => transaction.get(monthRef)));

    if (affectedMonthSnapshots.some((monthSnapshot) => monthSnapshot.exists() && monthSnapshot.data().status === 'closed')) {
      throw new Error('Leave approval is blocked because an affected payroll month is closed');
    }

    transaction.update(leaveRef, {
      status: 'approved',
      approvedAt: serverTimestamp(),
      approvedBy: params.approvedBy,
    });

    transaction.set(createAuditRef(), {
      actorId: params.approvedBy,
      action: 'leave.approved',
      targetCollection: 'leaves',
      targetId: params.leaveId,
      leaveId: params.leaveId,
      userId: params.approvedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        leaveUserId: leave.userId,
        startDate: leave.startDate,
        endDate: leave.endDate,
      },
      createdAt: serverTimestamp(),
    });
  });

  await writeAuditLog({
    entityType: 'leave',
    entityId: params.leaveId,
    action: 'status_change',
    changedBy: params.approvedBy,
    changedByDisplayName: params.approvedByDisplayName || 'Unknown User',
    changes: [{ field: 'status', before: previousStatus, after: 'approved' }],
    note: 'Leave request approved',
  });
}

export async function rejectLeaveRequest(params: RejectLeaveRequestParams): Promise<void> {
  assertCan(params.rejectedByRole, 'leaves.approve');

  if (!params.rejectionReason.trim()) {
    throw new Error('Rejection reason is required');
  }

  const leaveRef = doc(db, 'leaves', params.leaveId);
  let previousStatus: LeaveStatus = 'pending';

  await runTransaction(db, async (transaction) => {
    const leaveSnapshot = await transaction.get(leaveRef);

    if (!leaveSnapshot.exists()) {
      throw new Error('Leave request not found');
    }

    const leave = leaveSnapshot.data() as LeaveRequest;
    previousStatus = leave.status;
    assertCanReviewLeave(leave.status);

    transaction.update(leaveRef, {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
      rejectedBy: params.rejectedBy,
      rejectionReason: params.rejectionReason.trim(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.rejectedBy,
      action: 'leave.rejected',
      targetCollection: 'leaves',
      targetId: params.leaveId,
      leaveId: params.leaveId,
      userId: params.rejectedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        leaveUserId: leave.userId,
        startDate: leave.startDate,
        endDate: leave.endDate,
      },
      createdAt: serverTimestamp(),
    });
  });

  await writeAuditLog({
    entityType: 'leave',
    entityId: params.leaveId,
    action: 'status_change',
    changedBy: params.rejectedBy,
    changedByDisplayName: params.rejectedByDisplayName || 'Unknown User',
    changes: [
      { field: 'status', before: previousStatus, after: 'rejected' },
      { field: 'rejectionReason', before: null, after: params.rejectionReason.trim() },
    ],
    note: 'Leave request rejected',
  });
}

export async function cancelLeaveRequest(params: CancelLeaveRequestParams): Promise<void> {
  const leaveRef = doc(db, 'leaves', params.leaveId);

  await runTransaction(db, async (transaction) => {
    const leaveSnapshot = await transaction.get(leaveRef);

    if (!leaveSnapshot.exists()) {
      throw new Error('Leave request not found');
    }

    const leave = leaveSnapshot.data() as LeaveRequest;

    if (leave.userId !== params.userId) {
      throw new Error('You can only cancel your own leave request');
    }

    assertCanCancelLeave(leave.status);

    transaction.update(leaveRef, {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.userId,
      action: 'leave.cancelled',
      targetCollection: 'leaves',
      targetId: params.leaveId,
      leaveId: params.leaveId,
      userId: params.userId,
      generatedAt: serverTimestamp(),
      metadata: {
        startDate: leave.startDate,
        endDate: leave.endDate,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function getMyLeaveRequests(userId: string): Promise<LeaveRequest[]> {
  const snapshot = await getDocs(query(collection(db, 'leaves'), where('technicianId', '==', userId)));
  return sortLeavesByCreatedAtDesc(snapshot.docs.map((leaveDoc) => mapLeaveDocument(leaveDoc.id, leaveDoc.data())));
}

export async function getAllLeaveRequests(): Promise<LeaveRequest[]> {
  const snapshot = await getDocs(collection(db, 'leaves'));
  return sortLeavesByCreatedAtDesc(snapshot.docs.map((leaveDoc) => mapLeaveDocument(leaveDoc.id, leaveDoc.data())));
}
