import { NextRequest, NextResponse } from 'next/server';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

function serializeTimestamp(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
}

async function getInvoiceByToken(token: string) {
  const snapshot = await adminDb.collection('invoices').where('publicPaymentToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { invoiceId: doc.id, data: doc.data() };
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

async function createNotification(data: FirebaseFirestore.DocumentData, invoiceId: string) {
  await adminDb.collection('notifications').add({
    title: 'Customer opened payment page',
    message: `${data.customerName || 'Customer'} opened ${data.invoiceNo || 'invoice'} payment page`,
    type: 'pos_payment',
    branchId: data.branchId || '',
    targetRoles: ['admin', 'manager'],
    relatedEntityType: 'invoice',
    relatedEntityId: invoiceId,
    readBy: [],
    createdAt: FieldValue.serverTimestamp(),
  });
}

function invalidInvoiceReason(data: FirebaseFirestore.DocumentData) {
  if (!data.publicPaymentToken || data.publicPaymentTokenStatus === 'revoked') return 'Invoice payment link has been revoked';
  if (data.paymentStatus === 'void') return 'Invoice is void';
  return '';
}

async function getLinkedJob(data: FirebaseFirestore.DocumentData) {
  const jobId = String(data.jobId || '').trim();
  if (!jobId) return null;
  const snapshot = await adminDb.collection('jobs').doc(jobId).get();
  return snapshot.exists ? snapshot.data() || null : null;
}

async function getLinkedDevice(data: FirebaseFirestore.DocumentData) {
  const deviceId = String(data.deviceId || '').trim();
  if (!deviceId) return null;
  const snapshot = await adminDb.collection('devices').doc(deviceId).get();
  return snapshot.exists ? snapshot.data() || null : null;
}

function publicJobNumber(data: FirebaseFirestore.DocumentData, job: FirebaseFirestore.DocumentData | null): string {
  return [
    data.jobNumber,
    job?.jobNo,
    job?.jobNumber,
    job?.jobSheetNo,
    job?.agnJobNumber,
  ].map((value) => String(value || '').trim()).find((value) => /^RIGX-\d{6}$/.test(value)) || 'Not linked';
}

function publicDeviceModel(
  data: FirebaseFirestore.DocumentData,
  job: FirebaseFirestore.DocumentData | null,
  device: FirebaseFirestore.DocumentData | null,
): string {
  return [
    String(data.deviceLabel || '').trim(),
    [data.deviceBrand, data.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    String(data.deviceName || '').trim(),
    [job?.deviceBrand, job?.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    [device?.brand, device?.model].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    String(job?.device || '').trim(),
    String(device?.deviceName || device?.name || '').trim(),
    Array.isArray(data.items) ? String(data.items[0]?.name || '').trim() : '',
  ].find(Boolean) || 'Not specified';
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invoice = await getInvoiceByToken(token);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const data = invoice.data;
    const invalidReason = invalidInvoiceReason(data);
    if (invalidReason) return NextResponse.json({ error: invalidReason }, { status: 410 });
    if (!data.customerPaymentPageViewedAt) {
      await adminDb.collection('invoices').doc(invoice.invoiceId).update({
        customerPaymentPageViewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writePublicAudit(invoice.invoiceId, 'pos_invoice_payment_page_viewed', 'Invoice payment page viewed from public link');
      await createNotification(data, invoice.invoiceId);
    }
    const [job, device] = await Promise.all([
      getLinkedJob(data).catch(() => null),
      getLinkedDevice(data).catch(() => null),
    ]);
    const submissions = await adminDb.collection('paymentSubmissions').where('invoiceId', '==', invoice.invoiceId).get();
    return NextResponse.json({
      invoice: {
        invoiceNo: data.invoiceNo || '',
        officialInvoiceNo: data.officialInvoiceNo || '',
        branchId: data.branchId || '',
        customerName: data.customerName || '',
        customerPhone: data.customerPhone || '',
        customerId: data.customerId || '',
        jobNumber: publicJobNumber(data, job),
        deviceModel: publicDeviceModel(data, job, device),
        items: Array.isArray(data.items) ? data.items.map((item) => ({
          name: item.name || '',
          category: item.category || '',
          type: item.type || 'service',
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          discount: Number(item.discount || 0),
          total: Number(item.total || 0),
        })) : [],
        subtotal: Number(data.subtotal || 0),
        discountAmount: Number(data.discountAmount || 0),
        discountReason: data.discountReason || '',
        total: Number(data.total || 0),
        amountPaid: Number(data.amountPaid || 0),
        balance: Number(data.balance || 0),
        paymentStatus: data.paymentStatus || '',
        createdAt: serializeTimestamp(data.createdAt),
      },
      submissions: submissions.docs.map((submissionDoc) => {
        const submission = submissionDoc.data();
        return {
          submissionReference: `SUB-${submissionDoc.id.slice(0, 8).toUpperCase()}`,
          amountClaimed: Number(submission.amountClaimed || 0),
          method: submission.method || '',
          status: submission.status || '',
          createdAt: serializeTimestamp(submission.createdAt),
          rejectionReason: submission.rejectionReason || '',
        };
      }).sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')).slice(0, 3),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load invoice' }, { status: 500 });
  }
}
