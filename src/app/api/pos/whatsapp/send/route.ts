import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';
import { getWhatsAppSenderForBranch, normalizeWhatsAppPhoneNumber, type SendPosWhatsAppInput } from '@/features/pos/whatsappService';

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

async function assertPosOperator(request: NextRequest): Promise<{ uid: string; displayName: string; role: string }> {
  const token = getBearerToken(request);
  if (!token) throw new Error('Authentication token is required');

  const decodedToken = await adminAuth.verifyIdToken(token);
  const profileSnapshot = await adminDb.collection('users').doc(decodedToken.uid).get();
  const profile = profileSnapshot.data() || {};
  const role = String(profile.role || '');
  if (role !== 'admin' && role !== 'manager') {
    throw new Error('Admin or manager access required');
  }

  return {
    uid: decodedToken.uid,
    displayName: String(profile.displayName || profile.name || decodedToken.name || 'Unknown User'),
    role,
  };
}

function phoneNumberIdForBranch(branchId?: string): string {
  const normalized = String(branchId || '').toLowerCase();
  if (normalized === 'bangi') {
    return process.env.WHATSAPP_BANGI_PHONE_NUMBER_ID
      || process.env.WHATSAPP_PHONE_NUMBER_ID
      || '';
  }
  return process.env.WHATSAPP_CYBERJAYA_PHONE_NUMBER_ID
    || process.env.WHATSAPP_PHONE_NUMBER_ID
    || '';
}

function graphApiVersion(): string {
  return process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
}

async function writeMessageAudit(input: {
  actor: { uid: string; displayName: string };
  entityId: string;
  action: string;
  note: string;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  providerMessageId?: string;
  error?: string;
}) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId: input.entityId,
    action: input.action,
    changedBy: input.actor.uid,
    changedByDisplayName: input.actor.displayName,
    changes: [
      { field: 'senderPhone', before: null, after: input.senderPhone },
      { field: 'recipientPhone', before: null, after: input.recipientPhone },
      { field: 'messageType', before: null, after: input.messageType },
      ...(input.providerMessageId ? [{ field: 'providerMessageId', before: null, after: input.providerMessageId }] : []),
      ...(input.error ? [{ field: 'error', before: null, after: input.error }] : []),
    ],
    note: input.note,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
}

async function createMessageLog(input: {
  branchId?: string;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  retryOfMessageId?: string;
  messageBody: string;
  sentBy: string;
}) {
  const messageRef = adminDb.collection('whatsAppMessages').doc();
  await messageRef.set({
    branchId: input.branchId || 'cyberjaya',
    senderNumber: input.senderPhone,
    recipientPhone: input.recipientPhone,
    messageType: input.messageType,
    relatedEntityType: input.relatedEntityType || '',
    relatedEntityId: input.relatedEntityId || '',
    retryOfMessageId: input.retryOfMessageId || '',
    messageBody: input.messageBody,
    status: 'draft',
    sentBy: input.sentBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return messageRef;
}

async function upsertConversationAfterOutbound(input: {
  phone: string;
  branchId?: string;
  preview: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  const branchId = input.branchId || 'cyberjaya';
  const conversationId = `${input.phone}_${branchId}`;
  const conversationRef = adminDb.collection('whatsAppConversations').doc(conversationId);
  await conversationRef.set({
    phone: input.phone,
    branchId,
    latestMessageAt: FieldValue.serverTimestamp(),
    latestMessagePreview: input.preview,
    unreadCount: 0,
    status: 'pending_customer',
    priority: 'normal',
    relatedEntityType: input.relatedEntityType || '',
    relatedEntityId: input.relatedEntityId || '',
    lastStaffReplyAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function POST(request: NextRequest) {
  let actor: { uid: string; displayName: string; role: string } | null = null;
  let body: SendPosWhatsAppInput | null = null;
  try {
    actor = await assertPosOperator(request);
    body = (await request.json()) as SendPosWhatsAppInput;
    const recipientPhone = normalizeWhatsAppPhoneNumber(body.recipientPhone);
    const message = String(body.message || '').trim();
    if (!recipientPhone) return NextResponse.json({ error: 'Recipient phone is required' }, { status: 400 });
    if (!message) return NextResponse.json({ error: 'WhatsApp message is required' }, { status: 400 });

    const senderPhone = getWhatsAppSenderForBranch(body.branchId);
    const messageLogRef = await createMessageLog({
      branchId: body.branchId,
      senderPhone,
      recipientPhone,
      messageType: body.messageType,
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
      retryOfMessageId: body.retryOfMessageId,
      messageBody: message,
      sentBy: actor.uid,
    });
    const phoneNumberId = phoneNumberIdForBranch(body.branchId);
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_BUSINESS_ACCESS_TOKEN || '';
    if (!phoneNumberId || !accessToken) {
      const error = 'WhatsApp Business API is not configured. Use wa.me fallback link.';
      await messageLogRef.update({
        status: 'failed',
        errorMessage: error,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeMessageAudit({
        actor,
        entityId: body.relatedEntityId || body.messageType || 'whatsapp',
        action: body.messageType === 'custom'
          ? 'whatsapp_inbox_reply_failed'
          : body.retryOfMessageId ? 'whatsapp_message_retry_failed' : 'whatsapp_message_failed',
        note: error,
        senderPhone,
        recipientPhone,
        messageType: body.messageType,
        error,
      });
      return NextResponse.json({ error, senderPhone, messageLogId: messageLogRef.id }, { status: 400 });
    }

    const response = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: {
          preview_url: true,
          body: message,
        },
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const error = typeof payload.error === 'object' && payload.error && 'message' in payload.error
        ? String(payload.error.message)
        : `WhatsApp Business API failed (${response.status})`;
      await messageLogRef.update({
        status: 'failed',
        errorMessage: error,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeMessageAudit({
        actor,
        entityId: body.relatedEntityId || body.messageType || 'whatsapp',
        action: body.messageType === 'custom'
          ? 'whatsapp_inbox_reply_failed'
          : body.retryOfMessageId ? 'whatsapp_message_retry_failed' : 'whatsapp_message_failed',
        note: error,
        senderPhone,
        recipientPhone,
        messageType: body.messageType,
        error,
      });
      return NextResponse.json({ error, senderPhone, messageLogId: messageLogRef.id }, { status: 400 });
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const firstMessage = messages[0];
    const messageId = typeof firstMessage === 'object' && firstMessage && 'id' in firstMessage ? String(firstMessage.id) : '';
    await messageLogRef.update({
      status: 'sent',
      providerMessageId: messageId,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await upsertConversationAfterOutbound({
      phone: recipientPhone,
      branchId: body.branchId || 'cyberjaya',
      preview: message,
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
    });
    await writeMessageAudit({
      actor,
      entityId: body.relatedEntityId || body.messageType || 'whatsapp',
      action: body.messageType === 'custom'
        ? 'whatsapp_inbox_reply_sent'
        : body.retryOfMessageId ? 'whatsapp_message_retry_sent' : 'whatsapp_message_sent',
      note: 'WhatsApp Business API message sent',
      senderPhone,
      recipientPhone,
      messageType: body.messageType,
      providerMessageId: messageId,
    });

    return NextResponse.json({
      ok: true,
      provider: 'whatsapp_business_api',
      senderPhone,
      messageLogId: messageLogRef.id,
      messageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send WhatsApp message';
    const status = message.includes('access') || message.includes('Authentication token') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
