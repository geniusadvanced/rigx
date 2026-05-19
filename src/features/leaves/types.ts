import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type LeaveType = 'annual' | 'emergency' | 'medical' | 'unpaid' | 'other';
export type LeaveEntitlementType = 'annual' | 'medical' | 'emergency' | 'others';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  leaveId: string;
  userId: string;
  technicianId?: string;
  branchId?: string;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  reason: string;
  status: LeaveStatus;
  createdAt: Timestamp;
  createdBy: string;
  mcFileUrl?: string;
  mcFilePath?: string;
  mcFileName?: string;
  mcFileType?: string;
  mcFileSize?: number;
  mcUploadedAt?: Timestamp;
  approvedAt?: Timestamp;
  approvedBy?: string;
  rejectedAt?: Timestamp;
  rejectedBy?: string;
  rejectionReason?: string;
  cancelledAt?: Timestamp;
}

export interface CreateLeaveRequestInput {
  userId: string;
  branchId?: string;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  reason: string;
  createdBy: string;
  createdByRole: Role;
  createdByDisplayName?: string;
  mcFile?: File | null;
}

export interface LeaveEntitlement {
  technicianId: string;
  annual: number;
  medical: number;
  emergency: number;
  others: number;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

export interface LeaveBalanceItem {
  type: LeaveEntitlementType;
  entitlement: number;
  available: number;
  used: number;
  remaining: number;
  overused: number;
}

export type LeaveBalance = Record<LeaveEntitlementType, LeaveBalanceItem>;
