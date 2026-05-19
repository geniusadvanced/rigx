import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type NoticeType = 'warning' | 'reminder' | 'meeting' | 'announcement';
export type NoticeTargetType = 'individual' | 'broadcast';
export type NoticePriority = 'low' | 'normal' | 'high';
export type NoticeStatus = 'active';

export interface Notice {
  noticeId: string;
  title: string;
  message: string;
  type: NoticeType;
  targetType: NoticeTargetType;
  targetUserIds: string[];
  createdBy: string;
  createdByDisplayName?: string;
  createdAt: Timestamp;
  priority: NoticePriority;
  status: NoticeStatus;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  deletedByName?: string;
  deleteReason?: string;
  restoredAt?: Timestamp;
  restoredBy?: string;
}

export interface NoticeRead {
  readId: string;
  noticeId: string;
  userId: string;
  readAt: Timestamp;
}

export interface CreateNoticeInput {
  title: string;
  message: string;
  type: NoticeType;
  priority: NoticePriority;
  targetType: NoticeTargetType;
  targetUserIds: string[];
  createdBy: string;
  createdByRole: Role;
  createdByDisplayName?: string;
}
