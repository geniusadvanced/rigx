import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { Role } from '@/types';
import type { AuditLog, CreateAuditLogInput } from '../types';

function sanitizeAuditValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value === 'object') {
    if ('toDate' in value || 'toMillis' in value) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sanitizeAuditValue(nestedValue),
      ]),
    );
  }
  return value;
}

function sanitizeChanges(changes: CreateAuditLogInput['changes']) {
  return changes
    .filter((change) => change.field.trim())
    .map((change) => ({
      field: change.field.trim(),
      before: sanitizeAuditValue(change.before),
      after: sanitizeAuditValue(change.after),
    }));
}

export async function writeAuditLog(input: CreateAuditLogInput): Promise<void> {
  const changes = sanitizeChanges(input.changes);

  await addDoc(collection(db, 'auditLogs'), {
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changedBy: input.changedBy,
    changedByDisplayName: input.changedByDisplayName?.trim() || 'Unknown User',
    changes,
    note: input.note?.trim() || '',
    createdAt: serverTimestamp(),
  });
}

export async function getAuditLogs(role: Role): Promise<AuditLog[]> {
  assertCan(role, 'auditLogs.view');
  const snapshot = await getDocs(collection(db, 'auditLogs'));
  return snapshot.docs
    .map((auditDoc) => ({
      ...(auditDoc.data() as Omit<AuditLog, 'auditLogId'>),
      auditLogId: auditDoc.id,
    }))
    .sort((left, right) => {
      const leftTime = left.createdAt?.toMillis?.() || 0;
      const rightTime = right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}

export async function getAuditLogsForEntity(role: Role, entityType: AuditLog['entityType'], entityId: string): Promise<AuditLog[]> {
  assertCan(role, 'auditLogs.view');
  const snapshot = await getDocs(query(
    collection(db, 'auditLogs'),
    where('entityType', '==', entityType),
    where('entityId', '==', entityId),
  ));
  return snapshot.docs
    .map((auditDoc) => ({
      ...(auditDoc.data() as Omit<AuditLog, 'auditLogId'>),
      auditLogId: auditDoc.id,
    }))
    .sort((left, right) => {
      const leftTime = left.createdAt?.toMillis?.() || 0;
      const rightTime = right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}
