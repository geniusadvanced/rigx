import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db } from '@/lib/firebase/init';
import { generateCustomerNumber } from '@/lib/numbering/publicNumberService';
import { assertCan } from '@/lib/rbac/can';
import { normalizeCustomerPhone } from '@/features/customers/services/customerService';
import type { UserData } from '@/types';
import type {
  PosWhatsAppMessageStatus,
  PosWhatsAppMessageType,
  PosWhatsAppRelatedEntityType,
} from './whatsappService';

export interface PosWhatsAppMessageLog {
  messageId: string;
  branchId: string;
  senderNumber: string;
  recipientPhone: string;
  messageType: PosWhatsAppMessageType;
  relatedEntityType?: PosWhatsAppRelatedEntityType;
  relatedEntityId?: string;
  retryOfMessageId?: string;
  messageBody: string;
  status: PosWhatsAppMessageStatus;
  providerMessageId?: string;
  errorMessage?: string;
  sentBy?: string;
  sentAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type PosWhatsAppInboundStatus = 'received' | 'read' | 'archived';
export type PosWhatsAppInboundMessageType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'unknown';

export interface PosWhatsAppInboundMessage {
  inboundMessageId: string;
  providerMessageId?: string;
  branchId?: string;
  receiverNumber?: string;
  senderPhone: string;
  senderName?: string;
  messageType: PosWhatsAppInboundMessageType;
  textBody?: string;
  mediaId?: string;
  mediaStoragePath?: string;
  mediaDownloadUrl?: string;
  mediaFileName?: string;
  mediaSizeBytes?: number;
  mediaMimeType?: string;
  mediaCaption?: string;
  relatedEntityType?: PosWhatsAppRelatedEntityType;
  relatedEntityId?: string;
  matchedCustomerId?: string;
  status: PosWhatsAppInboundStatus;
  receivedAt: Timestamp;
  createdAt: Timestamp;
  rawPayloadStored?: boolean;
}

export type PosWhatsAppConversationStatus = 'open' | 'pending_customer' | 'pending_staff' | 'resolved' | 'archived';
export type PosWhatsAppConversationPriority = 'low' | 'normal' | 'high';

export interface PosWhatsAppConversationNote {
  note: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface PosWhatsAppConversation {
  conversationId: string;
  phone: string;
  customerName?: string;
  matchedCustomerId?: string;
  branchId?: string;
  latestMessageAt?: Timestamp;
  latestMessagePreview?: string;
  unreadCount: number;
  status: PosWhatsAppConversationStatus;
  assignedTo?: string;
  assignedToName?: string;
  assignedAt?: Timestamp;
  assignedBy?: string;
  priority?: PosWhatsAppConversationPriority;
  relatedEntityType?: PosWhatsAppRelatedEntityType;
  relatedEntityId?: string;
  lastStaffReplyAt?: Timestamp;
  lastCustomerReplyAt?: Timestamp;
  nextFollowUpAt?: Timestamp | null;
  internalNotes?: PosWhatsAppConversationNote[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function mapWhatsAppMessage(id: string, data: Record<string, unknown>): PosWhatsAppMessageLog {
  return { ...(data as Omit<PosWhatsAppMessageLog, 'messageId'>), messageId: id };
}

function mapInboundMessage(id: string, data: Record<string, unknown>): PosWhatsAppInboundMessage {
  return { ...(data as Omit<PosWhatsAppInboundMessage, 'inboundMessageId'>), inboundMessageId: id };
}

function mapConversation(id: string, data: Record<string, unknown>): PosWhatsAppConversation {
  return { ...(data as Omit<PosWhatsAppConversation, 'conversationId'>), conversationId: id };
}

function sortLatest(rows: PosWhatsAppMessageLog[]): PosWhatsAppMessageLog[] {
  return rows.sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0));
}

export async function getWhatsAppMessages(user: UserData): Promise<PosWhatsAppMessageLog[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'whatsAppMessages'));
  return sortLatest(snapshot.docs.map((messageDoc) => mapWhatsAppMessage(messageDoc.id, messageDoc.data())));
}

export async function getWhatsAppMessagesForEntity(
  user: UserData,
  relatedEntityType: PosWhatsAppRelatedEntityType,
  relatedEntityId: string,
): Promise<PosWhatsAppMessageLog[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(
    collection(db, 'whatsAppMessages'),
    where('relatedEntityType', '==', relatedEntityType),
    where('relatedEntityId', '==', relatedEntityId),
  ));
  return sortLatest(snapshot.docs.map((messageDoc) => mapWhatsAppMessage(messageDoc.id, messageDoc.data())));
}

export async function getWhatsAppInboundMessages(user: UserData): Promise<PosWhatsAppInboundMessage[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'whatsAppInboundMessages'));
  return snapshot.docs
    .map((messageDoc) => mapInboundMessage(messageDoc.id, messageDoc.data()))
    .sort((left, right) => (right.receivedAt?.toMillis?.() || 0) - (left.receivedAt?.toMillis?.() || 0));
}

export async function getWhatsAppConversations(user: UserData): Promise<PosWhatsAppConversation[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'whatsAppConversations'));
  return snapshot.docs
    .map((conversationDoc) => mapConversation(conversationDoc.id, conversationDoc.data()))
    .sort((left, right) => (right.latestMessageAt?.toMillis?.() || 0) - (left.latestMessageAt?.toMillis?.() || 0));
}

export async function getWhatsAppInboundMessagesForEntity(
  user: UserData,
  relatedEntityType: PosWhatsAppRelatedEntityType,
  relatedEntityId: string,
): Promise<PosWhatsAppInboundMessage[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(
    collection(db, 'whatsAppInboundMessages'),
    where('relatedEntityType', '==', relatedEntityType),
    where('relatedEntityId', '==', relatedEntityId),
  ));
  return snapshot.docs
    .map((messageDoc) => mapInboundMessage(messageDoc.id, messageDoc.data()))
    .sort((left, right) => (right.receivedAt?.toMillis?.() || 0) - (left.receivedAt?.toMillis?.() || 0));
}

export async function updateWhatsAppInboundMessagesStatus(
  messageIds: string[],
  status: PosWhatsAppInboundStatus,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await Promise.all(messageIds.map((messageId) => updateDoc(doc(db, 'whatsAppInboundMessages', messageId), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })));
  await writeAuditLog({
    entityType: 'pos',
    entityId: messageIds[0] || 'whatsapp_inbound',
    action: status === 'read' ? 'whatsapp_inbound_message_marked_read' : 'whatsapp_inbound_message_archived',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [{ field: 'status', before: 'received', after: status }],
    note: `${messageIds.length} inbound WhatsApp message(s) updated`,
  }).catch(() => undefined);
}

export async function assignWhatsAppConversation(
  conversation: PosWhatsAppConversation,
  assignee: { uid: string; displayName: string } | null,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const conversationRef = doc(db, 'whatsAppConversations', conversation.conversationId);
  if (assignee) {
    await updateDoc(conversationRef, {
      assignedTo: assignee.uid,
      assignedToName: assignee.displayName,
      assignedAt: serverTimestamp(),
      assignedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(conversationRef, {
      assignedTo: '',
      assignedToName: '',
      assignedAt: null,
      assignedBy: '',
      updatedAt: serverTimestamp(),
    });
  }
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: assignee ? 'whatsapp_conversation_assigned' : 'whatsapp_conversation_unassigned',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [{ field: 'assignedTo', before: conversation.assignedTo || '', after: assignee?.uid || '' }],
    note: assignee ? `Assigned to ${assignee.displayName}` : 'Conversation unassigned',
  }).catch(() => undefined);
}

export async function updateWhatsAppConversationControls(
  conversation: PosWhatsAppConversation,
  input: {
    status?: PosWhatsAppConversationStatus;
    priority?: PosWhatsAppConversationPriority;
    nextFollowUpAt?: string;
  },
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  let action: 'whatsapp_conversation_status_updated' | 'whatsapp_conversation_priority_updated' | 'whatsapp_conversation_followup_set' = 'whatsapp_conversation_status_updated';

  if (input.status && input.status !== conversation.status) {
    updates.status = input.status;
    changes.push({ field: 'status', before: conversation.status, after: input.status });
    action = 'whatsapp_conversation_status_updated';
  }
  if (input.priority && input.priority !== (conversation.priority || 'normal')) {
    updates.priority = input.priority;
    changes.push({ field: 'priority', before: conversation.priority || 'normal', after: input.priority });
    action = 'whatsapp_conversation_priority_updated';
  }
  if (input.nextFollowUpAt !== undefined) {
    updates.nextFollowUpAt = input.nextFollowUpAt ? Timestamp.fromDate(new Date(`${input.nextFollowUpAt}T00:00:00+08:00`)) : null;
    changes.push({ field: 'nextFollowUpAt', before: conversation.nextFollowUpAt || null, after: input.nextFollowUpAt || null });
    action = 'whatsapp_conversation_followup_set';
  }
  if (changes.length === 0) return;

  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), updates);
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action,
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes,
    note: 'WhatsApp conversation controls updated',
  }).catch(() => undefined);
}

export async function addWhatsAppConversationNote(
  conversation: PosWhatsAppConversation,
  note: string,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const cleanNote = note.trim();
  if (!cleanNote) throw new Error('Note is required');
  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), {
    internalNotes: arrayUnion({
      note: cleanNote,
      createdBy: user.displayName || user.name || user.uid,
      createdAt: Timestamp.now(),
    }),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_note_added',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [{ field: 'internalNotes', before: null, after: cleanNote }],
    note: 'WhatsApp conversation note added',
  }).catch(() => undefined);
}

export async function linkWhatsAppConversationCustomer(
  conversation: PosWhatsAppConversation,
  customer: { customerId: string; fullName: string },
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), {
    matchedCustomerId: customer.customerId,
    customerName: customer.fullName,
    relatedEntityType: 'customer',
    relatedEntityId: customer.customerId,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_customer_linked',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [
      { field: 'matchedCustomerId', before: conversation.matchedCustomerId || '', after: customer.customerId },
      { field: 'customerName', before: conversation.customerName || '', after: customer.fullName },
    ],
    note: 'WhatsApp conversation linked to customer',
  }).catch(() => undefined);
}

export async function unlinkWhatsAppConversationCustomer(
  conversation: PosWhatsAppConversation,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), {
    matchedCustomerId: '',
    customerName: '',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_customer_unlinked',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [{ field: 'matchedCustomerId', before: conversation.matchedCustomerId || '', after: '' }],
    note: 'WhatsApp conversation customer link removed',
  }).catch(() => undefined);
}

export async function createCustomerFromWhatsAppConversation(
  conversation: PosWhatsAppConversation,
  input: { fullName: string; branch: 'bangi' | 'cyberjaya' | 'unknown' },
  user: UserData,
): Promise<string> {
  assertCan(user.role, 'customers.manage');
  const name = input.fullName.trim();
  if (!name) throw new Error('Customer name is required');
  const customerNumber = await generateCustomerNumber();
  const customerRef = await addDoc(collection(db, 'customers'), {
    customerNumber,
    fullName: name,
    phone: conversation.phone,
    normalizedPhone: normalizeCustomerPhone(conversation.phone),
    email: '',
    address: '',
    branch: input.branch,
    createdBy: user.uid,
    createdByDisplayName: user.displayName || user.name || 'Unknown User',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await linkWhatsAppConversationCustomer(conversation, { customerId: customerRef.id, fullName: name }, user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_customer_created',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [{ field: 'matchedCustomerId', before: '', after: customerRef.id }],
    note: 'Customer created from WhatsApp conversation',
  }).catch(() => undefined);
  return customerRef.id;
}

export async function linkWhatsAppConversationEntity(
  conversation: PosWhatsAppConversation,
  input: { relatedEntityType: PosWhatsAppRelatedEntityType; relatedEntityId: string },
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const entityId = input.relatedEntityId.trim();
  if (!entityId) throw new Error('Related entity ID is required');
  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), {
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: entityId,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_entity_linked',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [
      { field: 'relatedEntityType', before: conversation.relatedEntityType || '', after: input.relatedEntityType },
      { field: 'relatedEntityId', before: conversation.relatedEntityId || '', after: entityId },
    ],
    note: 'WhatsApp conversation linked to related entity',
  }).catch(() => undefined);
}

export async function unlinkWhatsAppConversationEntity(
  conversation: PosWhatsAppConversation,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await updateDoc(doc(db, 'whatsAppConversations', conversation.conversationId), {
    relatedEntityType: '',
    relatedEntityId: '',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: conversation.conversationId,
    action: 'whatsapp_conversation_entity_unlinked',
    changedBy: user.uid,
    changedByDisplayName: user.displayName || user.name || 'Unknown User',
    changes: [
      { field: 'relatedEntityType', before: conversation.relatedEntityType || '', after: '' },
      { field: 'relatedEntityId', before: conversation.relatedEntityId || '', after: '' },
    ],
    note: 'WhatsApp conversation related entity link removed',
  }).catch(() => undefined);
}

export async function ensureWhatsAppConversationForPhone(
  phone: string,
  branchId: string,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const conversationId = `${phone}_${branchId || 'unknown'}`;
  await setDoc(doc(db, 'whatsAppConversations', conversationId), {
    phone,
    branchId: branchId || 'unknown',
    unreadCount: 0,
    status: 'open',
    priority: 'normal',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
