import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  addDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { UserData } from '@/types';
import type { CreateNoticeInput, Notice, NoticeRead } from '../types';

function mapNotice(noticeId: string, data: Record<string, unknown>): Notice {
  return {
    ...(data as Omit<Notice, 'noticeId'>),
    noticeId,
  };
}

function mapNoticeRead(readId: string, data: Record<string, unknown>): NoticeRead {
  return {
    ...(data as Omit<NoticeRead, 'readId'>),
    readId,
  };
}

function sortNoticesByLatest(notices: Notice[]): Notice[] {
  return [...notices].sort((left, right) => {
    const leftTime = left.createdAt?.toMillis?.() ?? 0;
    const rightTime = right.createdAt?.toMillis?.() ?? 0;
    return rightTime - leftTime;
  });
}

function activeNotice(notice: Notice): boolean {
  return notice.isDeleted !== true;
}

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || user.email || '';
}

export async function createNotice(input: CreateNoticeInput): Promise<string> {
  assertCan(input.createdByRole, 'notices.manage');
  const title = input.title.trim();
  const message = input.message.trim();

  if (!title) throw new Error('Title is required');
  if (!message) throw new Error('Message is required');
  if (input.targetType === 'individual' && input.targetUserIds.length === 0) {
    throw new Error('Select at least one technician');
  }

  const noticeRef = await addDoc(collection(db, 'notices'), {
    title,
    message,
    type: input.type,
    targetType: input.targetType,
    targetUserIds: input.targetType === 'broadcast' ? [] : input.targetUserIds,
    createdBy: input.createdBy,
    createdByDisplayName: input.createdByDisplayName || 'Unknown User',
    createdAt: serverTimestamp(),
    priority: input.priority,
    status: 'active',
  });

  return noticeRef.id;
}

export async function getSentNotices(): Promise<Notice[]> {
  const snapshot = await getDocs(collection(db, 'notices'));
  return sortNoticesByLatest(snapshot.docs.map((noticeDoc) => mapNotice(noticeDoc.id, noticeDoc.data())).filter(activeNotice));
}

export async function getTechnicianNotices(userId: string): Promise<Notice[]> {
  const [broadcastSnapshot, individualSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'notices'), where('targetType', '==', 'broadcast'), where('status', '==', 'active'))),
    getDocs(query(collection(db, 'notices'), where('targetUserIds', 'array-contains', userId), where('status', '==', 'active'))),
  ]);

  const noticesById = new Map<string, Notice>();
  [...broadcastSnapshot.docs, ...individualSnapshot.docs].forEach((noticeDoc) => {
    const notice = mapNotice(noticeDoc.id, noticeDoc.data());
    if (activeNotice(notice)) noticesById.set(noticeDoc.id, notice);
  });

  return sortNoticesByLatest(Array.from(noticesById.values()));
}

export async function softDeleteNotice(noticeId: string, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'notices.manage');
  const noticeRef = doc(db, 'notices', noticeId);
  const snapshot = await getDoc(noticeRef);
  if (!snapshot.exists()) throw new Error('Notice not found');
  const notice = mapNotice(snapshot.id, snapshot.data());
  const deleteReason = reason.trim();

  await updateDoc(noticeRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: user.uid,
    deletedByName: displayNameForUser(user),
    deleteReason,
  });

  await writeAuditLog({
    entityType: 'notice',
    entityId: noticeId,
    action: 'notice_deleted',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'noticeId', before: noticeId, after: noticeId },
      { field: 'noticeTitle', before: notice.title || '', after: notice.title || '' },
      { field: 'deletedBy', before: '', after: user.uid },
      { field: 'deletedByRole', before: '', after: user.role },
      { field: 'deleteReason', before: '', after: deleteReason },
      { field: 'isDeleted', before: notice.isDeleted === true, after: true },
    ],
    note: 'Notice soft deleted',
  });
}

export async function restoreNotice(noticeId: string, user: UserData): Promise<void> {
  assertCan(user.role, 'notices.manage');
  const noticeRef = doc(db, 'notices', noticeId);
  const snapshot = await getDoc(noticeRef);
  if (!snapshot.exists()) throw new Error('Notice not found');
  const notice = mapNotice(snapshot.id, snapshot.data());

  await updateDoc(noticeRef, {
    isDeleted: false,
    restoredAt: serverTimestamp(),
    restoredBy: user.uid,
  });

  await writeAuditLog({
    entityType: 'notice',
    entityId: noticeId,
    action: 'notice_restored',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'noticeId', before: noticeId, after: noticeId },
      { field: 'noticeTitle', before: notice.title || '', after: notice.title || '' },
      { field: 'isDeleted', before: notice.isDeleted === true, after: false },
    ],
    note: 'Notice restored',
  });
}

export async function getNoticeReadsForUser(userId: string): Promise<NoticeRead[]> {
  const snapshot = await getDocs(query(collection(db, 'noticeReads'), where('userId', '==', userId)));
  return snapshot.docs.map((readDoc) => mapNoticeRead(readDoc.id, readDoc.data()));
}

export async function markNoticeRead(noticeId: string, userId: string): Promise<void> {
  if (!noticeId || !userId) throw new Error('Notice and user are required');

  await setDoc(
    doc(db, 'noticeReads', `${noticeId}_${userId}`),
    {
      noticeId,
      userId,
      readAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getUnreadNoticeCount(userId: string): Promise<number> {
  const [notices, reads] = await Promise.all([getTechnicianNotices(userId), getNoticeReadsForUser(userId)]);
  const readNoticeIds = new Set(reads.map((read) => read.noticeId));
  return notices.filter((notice) => !readNoticeIds.has(notice.noticeId)).length;
}
