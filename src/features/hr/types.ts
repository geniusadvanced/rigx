import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type EmploymentType = 'full_time' | 'part_time' | 'intern' | 'contract';
export type InviteEmailStatus = 'pending' | 'sent' | 'failed';

export interface StaffProfile {
  uid: string;
  staffId: string;
  name: string;
  displayName?: string;
  email: string;
  role: Role;
  branchId: string;
  isActive: boolean;
  baseSalary: number;
  phone?: string;
  icNumber?: string;
  employmentType?: EmploymentType;
  authUid?: string;
  hasLogin?: boolean;
  inviteEmailSent?: boolean;
  inviteEmailStatus?: InviteEmailStatus;
  createdAt?: Timestamp;
  joinedAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StaffProfileUpdate {
  staffId: string;
  name: string;
  email: string;
  role: Role;
  branchId: string;
  isActive: boolean;
  phone?: string;
  icNumber?: string;
  employmentType?: EmploymentType;
}

export interface StaffProfileCreate extends StaffProfileUpdate {
  uid?: string;
  baseSalary: number;
  joinedAt?: string;
}
