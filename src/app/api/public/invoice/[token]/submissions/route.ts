import { NextRequest, NextResponse } from 'next/server';
import { createApprovalNotification } from '@/features/notifications/serverNotificationService';
import { adminBucket, adminDb, FieldValue } from '@/lib/firebase/admin';

const allowedMethods = ['bank_transfer', 'duitnow', 'ewallet', 'other'];
const allowedFileTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxFileSize = 10 * 1024 * 1024;

async function getInvoiceByToken(token: string) {
  const snapshot = await adminDb.collection('invoices').where('publicPaymentToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { invoiceId: doc.id, data: doc.data() };
}

async function writePublicAudit(entityId: string, note: string) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId,
    action: 'pos_payment_submission_created',
    changedBy: 'public_link',
    changedByDisplayName: 'Customer',
    changes: [],
    note,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function createNotification(data: FirebaseFirestore.DocumentData, invoiceId: string, submissionId: string) {
  const jobId = String(data.jobId || '').trim();
  const jobSnapshot = jobId ? await adminDb.collection('jobs').doc(jobId).get().catch(() => null) : null;
  const job = jobSnapshot?.exists ? jobSnapshot.data() || null : null;
  const jobNumber = [
    data.jobNumber,
    job?.jobNo,
    job?.jobNumber,
    job?.jobSheetNo,
    jobId,
  ].map((value) => String(value || '').trim()).find(Boolean) || data.invoiceNo || 'invoice';
  const customerName = data.customerName || 'Customer';
  const technicianId = String(job?.technicianId || '').trim();
  const nextAction = 'Verify payment.';
  await createApprovalNotification({
    sourceEventId: `payment_proof_submitted:${submissionId}`,
    type: 'payment_proof_submitted',
    title: 'Payment Proof Submitted',
    message: `${customerName} has submitted payment proof for ${jobNumber}. Next step: verify payment.`,
    branchId: data.branchId || '',
    targetUserIds: technicianId ? [technicianId] : [],
    relatedEntityType: 'paymentSubmission',
    relatedEntityId: submissionId,
    metadata: {
      subtype: 'payment_proof_submitted',
      invoiceId,
      submissionId,
      jobId,
      jobNumber,
      customerName,
      technicianId,
      nextAction,
    },
  });
}

function invalidInvoiceReason(data: FirebaseFirestore.DocumentData) {
  if (!data.publicPaymentToken || data.publicPaymentTokenStatus === 'revoked') return 'Invoice payment link has been revoked';
  if (data.paymentStatus === 'void') return 'Cannot submit payment proof for void invoice';
  if (data.paymentStatus === 'paid' || Number(data.balance || 0) <= 0) return 'Invoice is already fully paid';
  return '';
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invoice = await getInvoiceByToken(token);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const invalidReason = invalidInvoiceReason(invoice.data);
    if (invalidReason) return NextResponse.json({ error: invalidReason }, { status: 400 });

    const formData = await request.formData();
    const amountClaimed = Number(formData.get('amountClaimed') || 0);
    const method = String(formData.get('method') || '');
    const referenceNo = String(formData.get('referenceNo') || '').trim();
    const note = String(formData.get('note') || '').trim();
    const proof = formData.get('proofImage');
    if (!Number.isFinite(amountClaimed) || amountClaimed <= 0) return NextResponse.json({ error: 'Payment amount must be valid' }, { status: 400 });
    if (amountClaimed > Number(invoice.data.balance || 0)) return NextResponse.json({ error: 'Payment amount exceeds invoice balance' }, { status: 400 });
    if (!allowedMethods.includes(method)) return NextResponse.json({ error: 'Payment method is invalid' }, { status: 400 });

    const submissionRef = adminDb.collection('paymentSubmissions').doc();
    let proofImageUrl = '';
    if (proof instanceof File && proof.size > 0) {
      if (!allowedFileTypes.includes(proof.type)) return NextResponse.json({ error: 'Only JPG, PNG, or PDF proof files are allowed' }, { status: 400 });
      if (proof.size > maxFileSize) return NextResponse.json({ error: 'Payment proof must be 10MB or smaller' }, { status: 400 });
      const buffer = Buffer.from(await proof.arrayBuffer());
      const safeName = proof.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `payment-submissions/${invoice.invoiceId}/${submissionRef.id}/${Date.now()}_${safeName}`;
      const file = adminBucket.file(filePath);
      await file.save(buffer, { contentType: proof.type, resumable: false });
      const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      proofImageUrl = signedUrl;
    }

    await submissionRef.set({
      invoiceId: invoice.invoiceId,
      invoiceNo: invoice.data.invoiceNo || '',
      branchId: invoice.data.branchId || '',
      customerName: invoice.data.customerName || '',
      customerPhone: invoice.data.customerPhone || '',
      amountClaimed,
      method,
      referenceNo,
      proofImageUrl,
      note,
      status: 'pending_review',
      createdAt: FieldValue.serverTimestamp(),
    });
    await writePublicAudit(invoice.invoiceId, `Payment submission ${submissionRef.id} created`);
    await createNotification(invoice.data, invoice.invoiceId, submissionRef.id);
    return NextResponse.json({ submissionReference: `SUB-${submissionRef.id.slice(0, 8).toUpperCase()}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit payment proof' }, { status: 500 });
  }
}
