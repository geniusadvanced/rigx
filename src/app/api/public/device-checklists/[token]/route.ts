import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeAccessories,
  normalizeChecklistItems,
  normalizeInternalComponents,
} from '@/features/device-checklists/types';
import { createApprovalNotification } from '@/features/notifications/serverNotificationService';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

function serializeTimestamp(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
}

async function getChecklistByToken(token: string) {
  const snapshot = await adminDb.collection('deviceChecklists').where('publicSignatureToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { checklistId: doc.id, data: doc.data() };
}

function isExpired(data: FirebaseFirestore.DocumentData): boolean {
  const expiresAt = data.publicSignatureTokenExpiresAt?.toDate?.();
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
}

function safeChecklist(checklistId: string, data: FirebaseFirestore.DocumentData) {
  const signed = data.checklistStatus === 'customer_signed';
  return {
    checklistId,
    jobNumber: data.jobNumber || '',
    customerName: data.customerNameSnapshot || '',
    customerPhone: data.customerPhoneSnapshot || '',
    customerEmail: data.customerEmailSnapshot || '',
    deviceCategory: data.deviceCategorySnapshot || '',
    deviceBrandModel: data.deviceBrandModelSnapshot || '',
    deviceSerialOrImei: data.deviceSerialOrImeiSnapshot || '',
    reportedIssue: data.reportedIssueSnapshot || '',
    branchId: data.branchId || '',
    items: normalizeChecklistItems(data.items),
    accessories: normalizeAccessories(data.accessories, data.accessoriesReceived || ''),
    internalComponents: normalizeInternalComponents(data.internalComponents, data.internalComponentInventory || ''),
    technicianVerification: data.technicianVerification
      ? {
        ...data.technicianVerification,
        checkedAt: serializeTimestamp(data.technicianVerification.checkedAt),
      }
      : null,
    externalConditionSummary: data.externalConditionSummary || '',
    functionalChecklist: data.functionalChecklist || '',
    accessoriesReceived: data.accessoriesReceived || '',
    internalComponentInventory: data.internalComponentInventory || '',
    disclaimer: data.disclaimer || '',
    checklistStatus: data.checklistStatus || 'draft',
    signed,
    canSign: !signed && !isExpired(data) && data.checklistStatus !== 'signature_overridden',
    customerSignedAt: serializeTimestamp(data.customerSignedAt),
    customerSignedName: data.customerSignedName || '',
    customerSignedPhone: data.customerSignedPhone || '',
    customerSignatureDataUrl: signed ? data.customerSignatureDataUrl || '' : '',
    customerTypedSignature: signed ? data.customerTypedSignature || '' : '',
    publicSignatureTokenUsed: signed ? data.publicSignatureTokenUsed || data.customerSignature?.tokenUsed || '' : '',
  };
}

async function writePublicAudit(checklistId: string, data: FirebaseFirestore.DocumentData) {
  await adminDb.collection('auditLogs').add({
    entityType: 'device_checklist',
    entityId: checklistId,
    action: 'device_checklist_customer_signed',
    changedBy: 'public_link',
    changedByDisplayName: data.customerNameSnapshot || 'Customer',
    changes: [],
    note: 'Device checklist signed from public link',
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function getLinkedJob(data: FirebaseFirestore.DocumentData) {
  const jobId = String(data.jobId || '').trim();
  if (!jobId) return null;
  const snapshot = await adminDb.collection('jobs').doc(jobId).get();
  return snapshot.exists ? snapshot.data() || null : null;
}

function displayJobNumber(data: FirebaseFirestore.DocumentData, job: FirebaseFirestore.DocumentData | null): string {
  return [
    data.jobNumber,
    job?.jobNo,
    job?.jobNumber,
    job?.jobSheetNo,
    data.jobId,
  ].map((value) => String(value || '').trim()).find(Boolean) || '-';
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const checklist = await getChecklistByToken(token);
    if (!checklist) return NextResponse.json({ error: 'Device Checklist link is invalid or expired.' }, { status: 404 });
    if (isExpired(checklist.data)) return NextResponse.json({ error: 'Device Checklist link has expired.' }, { status: 410 });
    return NextResponse.json({ checklist: safeChecklist(checklist.checklistId, checklist.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Device Checklist' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json() as {
      customerSignedName?: string;
      customerSignedPhone?: string;
      customerSignatureDataUrl?: string;
      customerTypedSignature?: string;
      customerAcknowledgedDisclaimer?: boolean;
    };
    const checklist = await getChecklistByToken(token);
    if (!checklist) return NextResponse.json({ error: 'Device Checklist link is invalid or expired.' }, { status: 404 });
    if (isExpired(checklist.data)) return NextResponse.json({ error: 'Device Checklist link has expired.' }, { status: 410 });
    if (checklist.data.checklistStatus === 'customer_signed') return NextResponse.json({ error: 'This Device Checklist has already been signed.' }, { status: 409 });
    if (checklist.data.checklistStatus === 'signature_overridden') return NextResponse.json({ error: 'This Device Checklist has already been overridden internally.' }, { status: 409 });

    const customerSignedName = String(body.customerSignedName || '').trim();
    const customerSignedPhone = String(body.customerSignedPhone || '').trim();
    const signatureData = String(body.customerSignatureDataUrl || '').trim();
    const typedSignature = String(body.customerTypedSignature || '').trim();

    if (!customerSignedName) return NextResponse.json({ error: 'Customer name is required.' }, { status: 400 });
    if (!customerSignedPhone) return NextResponse.json({ error: 'Customer phone confirmation is required.' }, { status: 400 });
    if (body.customerAcknowledgedDisclaimer !== true) return NextResponse.json({ error: 'Please confirm the acknowledgement checkbox.' }, { status: 400 });
    if (!typedSignature && !signatureData.startsWith('data:image/png;base64,')) {
      return NextResponse.json({ error: 'Digital signature or typed signature is required.' }, { status: 400 });
    }
    if (signatureData && signatureData.length > 500000) return NextResponse.json({ error: 'Signature image is too large. Please clear and sign again.' }, { status: 400 });

    await adminDb.collection('deviceChecklists').doc(checklist.checklistId).update({
      checklistStatus: 'customer_signed',
      customerSignedAt: FieldValue.serverTimestamp(),
      customerSignedName,
      customerSignedPhone,
      customerSignatureDataUrl: signatureData,
      customerTypedSignature: typedSignature,
      customerAcknowledgedDisclaimer: true,
      customerSignature: {
        name: customerSignedName,
        phone: customerSignedPhone,
        dataUrl: signatureData,
        typedSignature,
        signedAt: FieldValue.serverTimestamp(),
        tokenUsed: token,
      },
      publicSignatureTokenUsed: token,
      customerSignedIp: request.headers.get('x-forwarded-for') || '',
      customerSignedUserAgent: request.headers.get('user-agent') || '',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writePublicAudit(checklist.checklistId, checklist.data);
    const linkedJob = await getLinkedJob(checklist.data).catch(() => null);
    const jobNumber = displayJobNumber(checklist.data, linkedJob);
    const customerName = checklist.data.customerNameSnapshot || 'Customer';
    const technicianId = String(checklist.data.assignedTechnicianId || checklist.data.technicianId || linkedJob?.technicianId || '').trim();
    const nextAction = 'Continue inspection and update diagnosis.';
    await createApprovalNotification({
      sourceEventId: `device_checklist_signed:${checklist.checklistId}`,
      type: 'device_checklist_signed',
      title: 'Device Checklist Approved',
      message: `${customerName} has approved Device Checklist for ${jobNumber}. Next step: continue inspection.`,
      branchId: checklist.data.branchId || linkedJob?.branchId || '',
      targetUserIds: technicianId ? [technicianId] : [],
      relatedModule: 'job',
      actionUrl: checklist.data.jobId ? `/dashboard/jobs?jobId=${encodeURIComponent(String(checklist.data.jobId))}` : '/dashboard/jobs',
      relatedEntityType: 'deviceChecklist',
      relatedEntityId: checklist.checklistId,
      metadata: {
        jobId: checklist.data.jobId || '',
        jobNumber,
        customerName,
        technicianId,
        checklistId: checklist.checklistId,
        nextAction,
        actionUrl: checklist.data.jobId ? `/dashboard/jobs?jobId=${encodeURIComponent(String(checklist.data.jobId))}` : '/dashboard/jobs',
      },
    });
    const latest = await adminDb.collection('deviceChecklists').doc(checklist.checklistId).get();
    return NextResponse.json({
      checklist: safeChecklist(checklist.checklistId, latest.data() || checklist.data),
      message: 'Device Checklist submitted. Genius Advanced has received your acknowledgement.',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit Device Checklist' }, { status: 500 });
  }
}
