import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type ScheduleBranch = 'bangi' | 'cyberjaya' | 'all';
export type ScheduleTargetType = 'all' | 'role' | 'user';
export type ScheduleStatus = 'active' | 'done' | 'cancelled';

export interface ScheduleItem {
  scheduleId: string;
  title: string;
  description?: string;
  scheduleDate: string;
  time?: string;
  branch?: ScheduleBranch;
  createdBy: string;
  createdByName: string;
  createdByRole: Role;
  targetType: ScheduleTargetType;
  targetRole?: Role;
  targetUserId?: string;
  status: ScheduleStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateScheduleInput {
  title: string;
  description?: string;
  scheduleDate: string;
  time?: string;
  branch?: ScheduleBranch;
  createdBy: string;
  createdByName: string;
  createdByRole: Role;
  targetType: ScheduleTargetType;
  targetRole?: Role;
  targetUserId?: string;
}
