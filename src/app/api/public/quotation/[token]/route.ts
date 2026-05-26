import { NextRequest, NextResponse } from 'next/server';
import { createApprovalNotification } from '@/features/notifications/serverNotificationService';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

function serializeTimestamp(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
}

async function getQuotationByToken(token: string) {
  let snapshot = await adminDb.collection('quotations').where('publicToken', '==', token).limit(1).get();
  if (snapshot.empty) {
    snapshot = await adminDb.collection('quotations').where('quotationApprovalToken', '==', token).limit(1).get();
  }
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { quotationId: doc.id, data: doc.data() };
}

async function getLinkedJob(jobId?: string) {
  if (!jobId) return null;
  const snapshot = await adminDb.collection('jobs').doc(jobId).get();
  if (!snapshot.exists) return null;
  return { jobId: snapshot.id, data: snapshot.data() || {} };
}

async function getLinkedCustomer(customerId?: string) {
  if (!customerId) return null;
  const snapshot = await adminDb.collection('customers').doc(customerId).get();
  if (!snapshot.exists) return null;
  return { customerId: snapshot.id, data: snapshot.data() || {} };
}

async function writePublicAudit(entityId: string, action: string, note: string) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId,
    action,
    changedBy: 'public_link',
    changedByDisplayName: 'Customer',
    changes: [],
    note,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function createNotification(input: {
  title: string;
  message: string;
  type?: string;
  branchId?: string;
  relatedEntityId: string;
  metadata?: Record<string, unknown>;
  targetUserIds?: string[];
}) {
  await adminDb.collection('notifications').add({
    title: input.title,
    message: input.message,
    type: input.type || 'pos_quotation',
    branchId: input.branchId || '',
    targetRoles: ['admin', 'manager'],
    targetUserIds: input.targetUserIds || [],
    metadata: { ...(input.metadata || {}), actionUrl: `/dashboard/pos/quotations/${input.relatedEntityId}` },
    relatedModule: 'quotation',
    actionUrl: `/dashboard/pos/quotations/${input.relatedEntityId}`,
    relatedEntityType: 'quotation',
    relatedEntityId: input.relatedEntityId,
    readBy: [],
    createdAt: FieldValue.serverTimestamp(),
  });
}

function displayJobNumber(job: { data: FirebaseFirestore.DocumentData } | null, fallback?: string) {
  return job?.data.jobNo || job?.data.jobNumber || job?.data.jobSheetNo || (/^RIGX-\d{6}$/.test(String(fallback || '')) ? fallback : 'Not linked');
}

function displayCustomerNumber(customer: { data: FirebaseFirestore.DocumentData } | null, quotationData: FirebaseFirestore.DocumentData) {
  return customer?.data.customerNumber || quotationData.customerNumber || 'Pending ID';
}

function displayQuotationNumber(data: FirebaseFirestore.DocumentData) {
  return data.quotationNumber || (/^QT-\d{6}$/.test(String(data.quotationNo || '')) ? data.quotationNo : 'Pending ID');
}

function deviceModel(job: { data: FirebaseFirestore.DocumentData } | null, data: FirebaseFirestore.DocumentData) {
  return [job?.data.deviceBrand, job?.data.deviceModel].filter(Boolean).join(' ')
    || job?.data.deviceModel
    || job?.data.device
    || data.deviceLabel
    || [data.deviceBrand, data.deviceModel].filter(Boolean).join(' ')
    || data.deviceName
    || data.items?.[0]?.name
    || 'Not specified';
}

function approvalSnapshot(data: FirebaseFirestore.DocumentData, job: { jobId: string; data: FirebaseFirestore.DocumentData } | null) {
  return {
    quotationNo: displayQuotationNumber(data),
    jobId: displayJobNumber(job, data.jobId),
    sourceJobId: data.jobId || '',
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    deviceModel: deviceModel(job, data),
    totalAmount: Number(data.total || 0),
    items: Array.isArray(data.items) ? data.items : [],
    termsVersion: '2026-05-08',
  };
}

function safeQuotation(
  quotationId: string,
  data: FirebaseFirestore.DocumentData,
  job: { jobId: string; data: FirebaseFirestore.DocumentData } | null,
  customer: { customerId: string; data: FirebaseFirestore.DocumentData } | null,
) {
  const quotationNo = displayQuotationNumber(data);
  return {
    publicReference: quotationNo,
    quotationNo,
    jobId: displayJobNumber(job, data.jobId),
    customerId: displayCustomerNumber(customer, data),
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    branchId: data.branchId || '',
    deviceModel: deviceModel(job, data),
    issueReported: job?.data.issueDescription || '',
    items: Array.isArray(data.items) ? data.items.map((item) => ({
      name: item.name || '',
      type: item.type || '',
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      discount: Number(item.discount || 0),
      total: Number(item.total || 0),
      warrantyDurationDays: Number(item.warrantyDurationDays || 0),
    })) : [],
    subtotal: Number(data.subtotal || 0),
    discountAmount: Number(data.discountAmount || 0),
    total: Number(data.total || 0),
    status: data.status || '',
    quotationApprovalStatus: data.quotationApprovalStatus || data.status || '',
    validUntil: serializeTimestamp(data.validUntil),
    customerViewedAt: serializeTimestamp(data.customerViewedAt),
    customerApprovedAt: serializeTimestamp(data.customerApprovedAt),
    customerRejectedAt: serializeTimestamp(data.customerRejectedAt),
    customerRejectionReason: data.customerRejectionReason || '',
    publicTokenStatus: data.publicTokenStatus || 'active',
  };
}

function isExpired(data: FirebaseFirestore.DocumentData) {
  const validUntil = data.validUntil?.toDate?.();
  return validUntil ? validUntil.getTime() < Date.now() : false;
}

async function validatePublicQuotation(quotation: { quotationId: string; data: FirebaseFirestore.DocumentData }, action: 'view' | 'decide') {
  if (!quotation.data.publicToken || quotation.data.publicTokenStatus === 'revoked') {
    return 'Quotation link has been revoked';
  }
  const invoiceSnapshot = await adminDb.collection('invoices').where('quotationId', '==', quotation.quotationId).limit(1).get();
  if (!invoiceSnapshot.empty && action === 'decide') return 'Quotation has already been converted';
  if (quotation.data.status === 'expired' || isExpired(quotation.data)) return 'Quotation is expired';
  if (action === 'decide' && (quotation.data.status === 'approved' || quotation.data.status === 'rejected')) {
    return 'Quotation already has a customer decision';
  }
  if (action === 'decide' && !['draft', 'sent', 'pending'].includes(String(quotation.data.status || ''))) {
    return 'Quotation link is invalid or expired';
  }
  return '';
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const quotation = await getQuotationByToken(token);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    const invalidReason = await validatePublicQuotation(quotation, 'view');
    if (invalidReason) return NextResponse.json({ error: invalidReason }, { status: 410 });
    const job = await getLinkedJob(String(quotation.data.jobId || ''));
    const customer = await getLinkedCustomer(String(quotation.data.customerId || ''));
    if (!quotation.data.customerViewedAt) {
      await adminDb.collection('quotations').doc(quotation.quotationId).update({
        customerViewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writePublicAudit(quotation.quotationId, 'pos_quotation_customer_viewed', 'Quotation viewed from public link');
      await createNotification({
        title: 'Customer viewed quotation',
        message: `${quotation.data.customerName || 'Customer'} viewed ${displayQuotationNumber(quotation.data)}`,
        branchId: quotation.data.branchId || job?.data.branchId || '',
        relatedEntityId: quotation.quotationId,
      });
    }
    const latest = await adminDb.collection('quotations').doc(quotation.quotationId).get();
    return NextResponse.json({ quotation: safeQuotation(quotation.quotationId, latest.data() || quotation.data, job, customer) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load quotation' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json() as { action?: string; reason?: string; customerName?: string; customerPhone?: string };
    const customerName = String(body.customerName || '').trim();
    const customerPhone = String(body.customerPhone || '').trim();
    if (!customerName) return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    if (!customerPhone) return NextResponse.json({ error: 'Customer phone is required' }, { status: 400 });
    const quotation = await getQuotationByToken(token);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    const invalidReason = await validatePublicQuotation(quotation, 'decide');
    if (invalidReason) return NextResponse.json({ error: invalidReason }, { status: 400 });
    const job = await getLinkedJob(String(quotation.data.jobId || ''));
    const customer = await getLinkedCustomer(String(quotation.data.customerId || ''));
    const metadata = {
      jobId: job ? job.jobId : quotation.data.jobId || '',
      quotationId: quotation.quotationId,
      quotationNo: displayQuotationNumber(quotation.data),
      customerId: quotation.data.customerId || '',
      technicianId: job?.data.technicianId || '',
      totalAmount: Number(quotation.data.total || 0),
      approvalMethod: 'public_link',
      actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
    };
    const targetUserIds = job?.data.technicianId ? [String(job.data.technicianId)] : [];

    if (body.action === 'approve') {
      await adminDb.collection('quotations').doc(quotation.quotationId).update({
        status: 'approved',
        quotationApprovalStatus: 'approved',
        approvedBy: 'customer',
        approvalMethod: 'public_link',
        termsAccepted: true,
        approvalToken: token,
        quotationApprovalToken: token,
        quotationApprovedByName: customerName,
        quotationApprovedByPhone: customerPhone,
        approvalSnapshot: approvalSnapshot(quotation.data, job),
        approvedFrom: {
          ipAddress: request.headers.get('x-forwarded-for') || '',
          userAgent: request.headers.get('user-agent') || '',
        },
        customerApprovedAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
        quotationApprovedAt: FieldValue.serverTimestamp(),
        customerActionSource: 'public_link',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (job) {
        await adminDb.collection('jobs').doc(job.jobId).update({
          quotationStatus: 'approved',
          quotationApprovalStatus: 'approved',
          lifecycleStatus: 'repair_in_progress',
          status: 'repair_in_progress',
          approvedQuotationId: quotation.quotationId,
          quotationApprovedAt: FieldValue.serverTimestamp(),
          customerApprovedAt: FieldValue.serverTimestamp(),
          repairStartedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await writePublicAudit(quotation.quotationId, 'quotation_approved_public', 'Quotation approved from public link');
      const jobNumber = displayJobNumber(job, quotation.data.jobId);
      const notificationCustomerName = quotation.data.customerName || 'Customer';
      const nextAction = 'Proceed with repair.';
      await createApprovalNotification({
        sourceEventId: `quotation_approved:${quotation.quotationId}`,
        type: 'quotation_approved',
        title: 'Customer approved quotation',
        message: `${notificationCustomerName} has approved quotation for ${jobNumber}. Next step: proceed with repair.`,
        branchId: quotation.data.branchId,
        relatedModule: 'quotation',
        actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
        relatedEntityType: 'quotation',
        relatedEntityId: quotation.quotationId,
        metadata: {
          ...metadata,
          jobNumber,
          customerName: notificationCustomerName,
          nextAction,
        },
        targetUserIds,
      });
    } else if (body.action === 'reject') {
      const reason = String(body.reason || '').trim();
      await adminDb.collection('quotations').doc(quotation.quotationId).update({
        status: 'rejected',
        quotationApprovalStatus: 'rejected',
        rejectedBy: 'customer',
        rejectionMethod: 'public_link',
        quotationApprovedByName: customerName,
        quotationApprovedByPhone: customerPhone,
        customerRejectedAt: FieldValue.serverTimestamp(),
        rejectedAt: FieldValue.serverTimestamp(),
        quotationRejectedAt: FieldValue.serverTimestamp(),
        customerRejectionReason: reason,
        rejectionReason: reason,
        quotationRejectionReason: reason,
        customerActionSource: 'public_link',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (job) {
        await adminDb.collection('jobs').doc(job.jobId).update({
          quotationStatus: 'rejected',
          quotationApprovalStatus: 'rejected',
          lifecycleStatus: 'customer_rejected',
          status: 'customer_rejected',
          quotationRejectedAt: FieldValue.serverTimestamp(),
          quotationRejectedReason: reason,
          customerRejectedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await writePublicAudit(quotation.quotationId, 'quotation_rejected_public', reason);
      await createNotification({
        title: 'Customer rejected quotation',
        message: `${quotation.data.customerName || 'Customer'} rejected quotation ${displayQuotationNumber(quotation.data)} for job ${displayJobNumber(job, quotation.data.jobId)}.`,
        type: 'quotation_rejected',
        branchId: quotation.data.branchId,
        relatedEntityId: quotation.quotationId,
        metadata,
        targetUserIds,
      });
    } else {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const latest = await adminDb.collection('quotations').doc(quotation.quotationId).get();
    return NextResponse.json({ quotation: safeQuotation(quotation.quotationId, latest.data() || {}, job, customer) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update quotation' }, { status: 500 });
  }
}
