import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, rootCollections } from '@/lib/firebase/firestore';

interface AuditLogInput {
  actorId: string;
  action: string;
  targetCollection?: keyof typeof rootCollections;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export function writeAuditLog(input: AuditLogInput) {
  return addDoc(collection(db, rootCollections.auditLogs), {
    ...input,
    createdAt: serverTimestamp(),
  });
}
