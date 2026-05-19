import type { Timestamp } from 'firebase/firestore';

export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'absent' | 'rejected' | 'cancelled';

export interface AttendanceRecord {
  attendanceId: string;
  userId: string;
  branchId: string;
  date: string;
  status: AttendanceStatus;
  attendanceType?: 'full' | 'half';
  totalHours?: number;
  lateMinutes?: number;
  clockIn?: {
    timestamp?: Timestamp;
  };
  clockOut?: {
    timestamp?: Timestamp;
  };
  correctionNote?: string;
  correctionUpdatedAt?: Timestamp;
  correctionUpdatedBy?: string;
  statusOverride?: {
    previousStatus: AttendanceStatus;
    nextStatus: AttendanceStatus;
    reason: string;
    overriddenAt: Timestamp;
    overriddenBy: string;
  };
}
