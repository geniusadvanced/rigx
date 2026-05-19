import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { Role } from '@/types';
import type { AttendanceRecord, AttendanceStatus } from '../types';

interface AttendanceFilters {
  month: string;
  role: Role;
  branchId?: string;
  technicianId?: string;
  status?: AttendanceStatus | 'all';
}

interface AddCorrectionNoteParams {
  attendanceId: string;
  note: string;
  updatedBy: string;
  updatedByRole: Role;
}

interface OverrideAttendanceStatusParams {
  attendanceId: string;
  nextStatus: AttendanceStatus;
  reason: string;
  overriddenBy: string;
  overriddenByRole: Role;
}

function createAuditRef() {
  return doc(collection(db, 'audit_logs'));
}

function getMonthEndDate(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function mapAttendanceDocument(attendanceId: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    ...(data as Omit<AttendanceRecord, 'attendanceId'>),
    attendanceId,
  };
}

export async function getAttendanceForReview(filters: AttendanceFilters): Promise<AttendanceRecord[]> {
  assertCan(filters.role, 'attendance.view.all');
  const monthStartDate = `${filters.month}-01`;
  const monthEndDate = getMonthEndDate(filters.month);
  const snapshot = await getDocs(
    query(
      collection(db, 'attendance'),
      where('date', '>=', monthStartDate),
      where('date', '<=', monthEndDate),
    ),
  );
  const records = snapshot.docs.map((attendanceDoc) =>
    mapAttendanceDocument(attendanceDoc.id, attendanceDoc.data()),
  );

  return records
    .filter((record) => !filters.branchId || record.branchId === filters.branchId)
    .filter((record) => !filters.technicianId || record.userId === filters.technicianId)
    .filter((record) => !filters.status || filters.status === 'all' || record.status === filters.status)
    .sort((left, right) => right.date.localeCompare(left.date));
}

export async function getMyAttendanceForReview(userId: string, month: string): Promise<AttendanceRecord[]> {
  const monthStartDate = `${month}-01`;
  const monthEndDate = getMonthEndDate(month);
  const snapshot = await getDocs(
    query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      where('date', '>=', monthStartDate),
      where('date', '<=', monthEndDate),
    ),
  );

  return snapshot.docs
    .map((attendanceDoc) => mapAttendanceDocument(attendanceDoc.id, attendanceDoc.data()))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export async function addAttendanceCorrectionNote(params: AddCorrectionNoteParams): Promise<void> {
  assertCan(params.updatedByRole, 'attendance.view.all');

  if (!params.note.trim()) {
    throw new Error('Correction note is required');
  }

  await runTransaction(db, async (transaction) => {
    transaction.update(doc(db, 'attendance', params.attendanceId), {
      correctionNote: params.note.trim(),
      correctionUpdatedBy: params.updatedBy,
      correctionUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function overrideAttendanceStatus(params: OverrideAttendanceStatusParams): Promise<void> {
  assertCan(params.overriddenByRole, 'attendance.override');

  if (!params.reason.trim()) {
    throw new Error('Override reason is required');
  }

  const attendanceRef = doc(db, 'attendance', params.attendanceId);

  await runTransaction(db, async (transaction) => {
    const attendanceSnapshot = await transaction.get(attendanceRef);

    if (!attendanceSnapshot.exists()) {
      throw new Error('Attendance record not found');
    }

    const attendance = attendanceSnapshot.data() as AttendanceRecord;
    const previousStatus = attendance.status;
    const month = attendance.date.slice(0, 7);
    const monthSnapshot = await transaction.get(doc(db, 'payroll_months', month));

    if (monthSnapshot.exists() && monthSnapshot.data().status === 'closed') {
      throw new Error(`Attendance override is blocked because payroll month ${month} is closed`);
    }

    transaction.update(attendanceRef, {
      status: params.nextStatus,
      statusOverride: {
        previousStatus,
        nextStatus: params.nextStatus,
        reason: params.reason.trim(),
        overriddenBy: params.overriddenBy,
        overriddenAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.overriddenBy,
      action: 'attendance.status_overridden',
      targetCollection: 'attendance',
      targetId: params.attendanceId,
      attendanceId: params.attendanceId,
      userId: params.overriddenBy,
      generatedAt: serverTimestamp(),
      metadata: {
        attendanceUserId: attendance.userId,
        date: attendance.date,
        previousStatus,
        nextStatus: params.nextStatus,
        reason: params.reason.trim(),
      },
      createdAt: serverTimestamp(),
    });
  });
}
