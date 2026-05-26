import { adminDb, FieldValue } from '@/lib/firebase/admin';

export type ApprovalNotificationType =
  | 'quotation_approved'
  | 'job_sheet_signed'
  | 'device_checklist_signed'
  | 'warranty_terms_signed'
  | 'payment_proof_submitted';

export interface ApprovalNotificationInput {
  sourceEventId: string;
  type: ApprovalNotificationType;
  title: string;
  message: string;
  branchId?: string;
  relatedModule?: string;
  actionUrl?: string;
  targetRoles?: string[];
  targetUserIds?: string[];
  relatedEntityType: string;
  relatedEntityId: string;
  metadata?: Record<string, unknown>;
}

function uniqueStrings(values: string[] = []): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export async function createApprovalNotification(input: ApprovalNotificationInput): Promise<void> {
  const existing = await adminDb
    .collection('notifications')
    .where('sourceEventId', '==', input.sourceEventId)
    .limit(1)
    .get();
  if (!existing.empty) return;

  await adminDb.collection('notifications').add({
    title: input.title,
    message: input.message,
    type: input.type,
    branchId: input.branchId || '',
    targetRoles: uniqueStrings(input.targetRoles?.length ? input.targetRoles : ['admin', 'manager']),
    targetUserIds: uniqueStrings(input.targetUserIds),
    metadata: input.metadata || {},
    relatedModule: input.relatedModule || input.relatedEntityType,
    actionUrl: input.actionUrl || '',
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    sourceEventId: input.sourceEventId,
    readBy: [],
    createdAt: FieldValue.serverTimestamp(),
  });
}
