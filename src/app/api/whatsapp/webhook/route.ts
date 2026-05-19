import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminBucket, adminDb, FieldValue } from '@/lib/firebase/admin';
import { normalizeWhatsAppPhoneNumber, type PosWhatsAppRelatedEntityType } from '@/features/pos/whatsappService';

type InboundMessageType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'unknown';

function branchFromReceiver(receiverNumber: string): string {
  const normalized = normalizeWhatsAppPhoneNumber(receiverNumber);
  if (normalized === '601114888499') return 'bangi';
  if (normalized === '60199933371') return 'cyberjaya';
  return 'unknown';
}

function notificationTypeForEntity(entityType?: string): 'pos_payment' | 'pos_quotation' | 'system' {
  if (entityType === 'invoice' || entityType === 'paymentSubmission') return 'pos_payment';
  if (entityType === 'quotation') return 'pos_quotation';
  return 'system';
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/ogg') return 'ogg';
  if (mimeType === 'video/mp4') return 'mp4';
  return 'bin';
}

async function findCustomerByPhone(senderPhone: string): Promise<{ customerId: string; customerName: string }> {
  const normalizedSender = normalizeWhatsAppPhoneNumber(senderPhone);
  const snapshot = await adminDb.collection('customers').get();
  const match = snapshot.docs.find((customerDoc) => normalizeWhatsAppPhoneNumber(String(customerDoc.data().phone || '')) === normalizedSender);
  return {
    customerId: match?.id || '',
    customerName: match ? String(match.data().fullName || '') : '',
  };
}

async function findLatestRelatedOutbound(senderPhone: string): Promise<{ relatedEntityType?: PosWhatsAppRelatedEntityType; relatedEntityId?: string }> {
  const normalizedSender = normalizeWhatsAppPhoneNumber(senderPhone);
  const cutoff = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const snapshot = await adminDb.collection('whatsAppMessages').where('recipientPhone', '==', normalizedSender).get();
  const latest = snapshot.docs
    .map((messageDoc) => messageDoc.data())
    .filter((message) => {
      const createdAt = message.createdAt;
      return createdAt && typeof createdAt.toMillis === 'function' && createdAt.toMillis() >= cutoff.toMillis();
    })
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))[0];
  return {
    relatedEntityType: latest?.relatedEntityType || undefined,
    relatedEntityId: latest?.relatedEntityId || undefined,
  };
}

async function writeAudit(entityId: string, note: string) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId,
    action: 'whatsapp_inbound_message_received',
    changedBy: 'whatsapp_webhook',
    changedByDisplayName: 'WhatsApp Webhook',
    changes: [],
    note,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
}

async function createNotification(input: {
  senderPhone: string;
  branchId: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  await adminDb.collection('notifications').add({
    title: 'WhatsApp message received',
    message: `New WhatsApp message from ${input.senderPhone}`,
    type: notificationTypeForEntity(input.relatedEntityType),
    branchId: input.branchId,
    targetRoles: ['admin', 'manager'],
    relatedEntityType: input.relatedEntityType || '',
    relatedEntityId: input.relatedEntityId || '',
    readBy: [],
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
}

async function upsertConversation(input: {
  phone: string;
  senderName?: string;
  matchedCustomerId?: string;
  customerName?: string;
  branchId: string;
  preview: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  const conversationId = `${input.phone}_${input.branchId || 'unknown'}`;
  const conversationRef = adminDb.collection('whatsAppConversations').doc(conversationId);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(conversationRef);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const currentStatus = String(current.status || 'open');
    const nextStatus = currentStatus === 'archived' ? 'archived' : 'pending_staff';
    transaction.set(conversationRef, {
      phone: input.phone,
      customerName: input.customerName || input.senderName || current.customerName || '',
      matchedCustomerId: input.matchedCustomerId || current.matchedCustomerId || '',
      branchId: input.branchId || current.branchId || 'unknown',
      latestMessageAt: FieldValue.serverTimestamp(),
      latestMessagePreview: input.preview,
      unreadCount: FieldValue.increment(1),
      status: nextStatus,
      priority: current.priority || 'normal',
      relatedEntityType: input.relatedEntityType || current.relatedEntityType || '',
      relatedEntityId: input.relatedEntityId || current.relatedEntityId || '',
      lastCustomerReplyAt: FieldValue.serverTimestamp(),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function getMessagePayload(message: Record<string, unknown>): {
  messageType: InboundMessageType;
  textBody: string;
  mediaId: string;
  mediaMimeType: string;
  mediaCaption: string;
  mediaFileName: string;
} {
  const type = String(message.type || 'unknown') as InboundMessageType;
  if (type === 'text') {
    const text = typeof message.text === 'object' && message.text ? message.text as Record<string, unknown> : {};
    return { messageType: 'text', textBody: String(text.body || ''), mediaId: '', mediaMimeType: '', mediaCaption: '', mediaFileName: '' };
  }
  if (['image', 'document', 'audio', 'video'].includes(type)) {
    const media = typeof message[type] === 'object' && message[type] ? message[type] as Record<string, unknown> : {};
    return {
      messageType: type,
      textBody: '',
      mediaId: String(media.id || ''),
      mediaMimeType: String(media.mime_type || ''),
      mediaCaption: String(media.caption || ''),
      mediaFileName: String(media.filename || ''),
    };
  }
  return { messageType: 'unknown', textBody: '', mediaId: '', mediaMimeType: '', mediaCaption: '', mediaFileName: '' };
}

async function downloadWhatsAppMedia(input: {
  mediaId: string;
  mediaMimeType: string;
  mediaFileName: string;
  branchId: string;
  senderPhone: string;
  providerMessageId: string;
}): Promise<{
  mediaStoragePath?: string;
  mediaFileName?: string;
  mediaSizeBytes?: number;
  mediaMimeType?: string;
}> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken || !input.mediaId) return {};
  try {
    const mediaInfoResponse = await fetch(`https://graph.facebook.com/v19.0/${input.mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaInfoResponse.ok) return {};
    const mediaInfo = await mediaInfoResponse.json() as { url?: string; mime_type?: string; file_size?: number };
    if (!mediaInfo.url) return {};
    const mediaResponse = await fetch(mediaInfo.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaResponse.ok) return {};
    const mimeType = mediaInfo.mime_type || input.mediaMimeType || 'application/octet-stream';
    const buffer = Buffer.from(await mediaResponse.arrayBuffer());
    const fallbackFileName = `${input.providerMessageId}.${extensionForMimeType(mimeType)}`;
    const safeName = String(input.mediaFileName || fallbackFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `whatsapp-media/${input.branchId || 'unknown'}/${input.senderPhone}/${input.providerMessageId}/${safeName}`;
    await adminBucket.file(storagePath).save(buffer, {
      resumable: false,
      metadata: { contentType: mimeType },
    });
    return {
      mediaStoragePath: storagePath,
      mediaFileName: safeName,
      mediaSizeBytes: Number(mediaInfo.file_size || buffer.byteLength),
      mediaMimeType: mimeType,
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') || '';
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Invalid verification token' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let storedCount = 0;

    for (const entry of entries) {
      const changes = typeof entry === 'object' && entry && 'changes' in entry && Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = typeof change === 'object' && change && 'value' in change ? change.value as Record<string, unknown> : {};
        const metadata = typeof value.metadata === 'object' && value.metadata ? value.metadata as Record<string, unknown> : {};
        const receiverNumber = normalizeWhatsAppPhoneNumber(String(metadata.display_phone_number || ''));
        const branchId = branchFromReceiver(receiverNumber);
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        const messages = Array.isArray(value.messages) ? value.messages : [];

        for (const message of messages) {
          if (!message || typeof message !== 'object') continue;
          const messageRecord = message as Record<string, unknown>;
          const providerMessageId = String(messageRecord.id || '');
          if (!providerMessageId) continue;
          const duplicate = await adminDb.collection('whatsAppInboundMessages').where('providerMessageId', '==', providerMessageId).limit(1).get();
          if (!duplicate.empty) continue;

          const senderPhone = normalizeWhatsAppPhoneNumber(String(messageRecord.from || ''));
          if (!senderPhone) continue;
          const contact = contacts.find((item) => typeof item === 'object' && item && String((item as Record<string, unknown>).wa_id || '') === senderPhone) as Record<string, unknown> | undefined;
          const profile = typeof contact?.profile === 'object' && contact.profile ? contact.profile as Record<string, unknown> : {};
          const senderName = String(profile.name || '');
          const payload = getMessagePayload(messageRecord);
          const mediaDownload = await downloadWhatsAppMedia({
            mediaId: payload.mediaId,
            mediaMimeType: payload.mediaMimeType,
            mediaFileName: payload.mediaFileName,
            branchId,
            senderPhone,
            providerMessageId,
          });
          const matchedCustomer = await findCustomerByPhone(senderPhone);
          const related = await findLatestRelatedOutbound(senderPhone);
          const inboundRef = adminDb.collection('whatsAppInboundMessages').doc();
          await inboundRef.set({
            providerMessageId,
            branchId,
            receiverNumber,
            senderPhone,
            senderName,
            ...payload,
            ...mediaDownload,
            relatedEntityType: related.relatedEntityType || (matchedCustomer.customerId ? 'customer' : ''),
            relatedEntityId: related.relatedEntityId || matchedCustomer.customerId || '',
            matchedCustomerId: matchedCustomer.customerId,
            status: 'received',
            receivedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            rawPayloadStored: false,
          });
          await upsertConversation({
            phone: senderPhone,
            senderName,
            matchedCustomerId: matchedCustomer.customerId,
            customerName: matchedCustomer.customerName,
            branchId,
            preview: payload.textBody || payload.mediaCaption || payload.messageType,
            relatedEntityType: related.relatedEntityType || (matchedCustomer.customerId ? 'customer' : ''),
            relatedEntityId: related.relatedEntityId || matchedCustomer.customerId || '',
          });
          await writeAudit(inboundRef.id, `Inbound WhatsApp message from ${senderPhone}`);
          await createNotification({
            senderPhone,
            branchId,
            relatedEntityType: related.relatedEntityType,
            relatedEntityId: related.relatedEntityId,
          });
          storedCount += 1;
        }
      }
    }

    return NextResponse.json({ ok: true, storedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process WhatsApp webhook';
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
