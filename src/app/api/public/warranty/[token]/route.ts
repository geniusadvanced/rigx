import { NextRequest, NextResponse } from 'next/server';
import { createApprovalNotification } from '@/features/notifications/serverNotificationService';
import { defaultWarrantyTermsSnapshot, type WarrantyTermsSnapshot } from '@/features/pos/warrantyTerms';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

function serializeTimestamp(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
}

async function getWarrantyByToken(token: string) {
  const snapshot = await adminDb.collection('warranties').where('publicWarrantyToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { warrantyId: doc.id, data: doc.data() };
}

async function getJobWarrantyByToken(token: string) {
  const snapshot = await adminDb.collection('jobDocuments')
    .where('publicWarrantyToken', '==', token)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  if (doc.data().type !== 'warranty') return null;
  return { warrantyId: doc.id, data: doc.data() };
}

async function getLinkedJob(jobId?: string) {
  if (!jobId) return null;
  const snapshot = await adminDb.collection('jobs').doc(jobId).get();
  return snapshot.exists ? snapshot.data() || null : null;
}

async function getLinkedInvoice(invoiceId?: string) {
  if (!invoiceId) return null;
  const snapshot = await adminDb.collection('invoices').doc(invoiceId).get();
  return snapshot.exists ? snapshot.data() || null : null;
}

function displayJobNumber(data: FirebaseFirestore.DocumentData, job: FirebaseFirestore.DocumentData | null): string {
  return [
    data.jobNumber,
    data.jobSheetNo,
    job?.jobNo,
    job?.jobNumber,
    job?.jobSheetNo,
    job?.agnJobNumber,
    data.jobId,
  ].map((value) => String(value || '').trim()).find(Boolean) || '-';
}

function deviceDisplay(data: FirebaseFirestore.DocumentData, job: FirebaseFirestore.DocumentData | null, invoice: FirebaseFirestore.DocumentData | null): string {
  return [
    String(invoice?.deviceLabel || '').trim(),
    [invoice?.deviceBrand, invoice?.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    String(invoice?.deviceName || '').trim(),
    [job?.deviceBrand, job?.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    String(job?.device || '').trim(),
    Array.isArray(invoice?.items) ? String(invoice?.items?.[0]?.name || '').trim() : '',
    data.itemName,
    data.deviceId,
  ].map((value) => String(value || '').trim()).find(Boolean) || 'Device';
}

function termsSnapshot(data: FirebaseFirestore.DocumentData): WarrantyTermsSnapshot {
  const snapshot = data.warrantyTermsSnapshot as WarrantyTermsSnapshot | undefined;
  return snapshot?.version ? snapshot : defaultWarrantyTermsSnapshot;
}

function jobWarrantyTermsSnapshot(data: FirebaseFirestore.DocumentData): WarrantyTermsSnapshot {
  const lines = String(data.warrantyPolicyText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return defaultWarrantyTermsSnapshot;
  return {
    ...defaultWarrantyTermsSnapshot,
    coverage: lines,
    acknowledgement: 'I acknowledge and accept the warranty terms and conditions for this repair/service.',
  };
}

function isExpired(data: FirebaseFirestore.DocumentData): boolean {
  const expiresAt = data.publicWarrantyTokenExpiresAt?.toDate?.();
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
}

function safeWarranty(
  warrantyId: string,
  data: FirebaseFirestore.DocumentData,
  job: FirebaseFirestore.DocumentData | null,
  invoice: FirebaseFirestore.DocumentData | null,
) {
  const signed = Boolean(data.warrantySignedAt || data.warrantyTermsAccepted || data.acceptedTerms);
  return {
    warrantyId,
    warrantyNumber: `WTY-${warrantyId.slice(0, 8).toUpperCase()}`,
    jobNumber: displayJobNumber(data, job),
    invoiceNo: invoice?.invoiceNo || data.invoiceId || '',
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    branchId: data.branchId || '',
    deviceName: deviceDisplay(data, job, invoice),
    coveredItem: data.itemName || '',
    warrantyDurationDays: Number(data.warrantyDurationDays || 0),
    startDate: serializeTimestamp(data.startDate),
    endDate: serializeTimestamp(data.endDate),
    claimLimit: 'Unlimited within warranty period',
    status: data.status || 'active',
    terms: termsSnapshot(data),
    signed,
    canSign: !signed && data.status !== 'void' && !isExpired(data) && data.publicWarrantyTokenStatus !== 'revoked',
    warrantySignedAt: serializeTimestamp(data.warrantySignedAt),
    warrantySignedName: data.warrantySignedName || '',
    warrantySignedPhone: data.warrantySignedPhone || '',
    warrantySignatureDataUrl: signed ? data.warrantySignatureDataUrl || data.warrantySignature?.dataUrl || '' : '',
    warrantyTypedSignature: signed ? data.warrantyTypedSignature || data.warrantySignature?.typedSignature || '' : '',
    warrantySignatureTokenUsed: signed ? data.warrantySignatureTokenUsed || data.warrantySignature?.tokenUsed || '' : '',
    warrantyTermsVersion: data.warrantyTermsVersion || termsSnapshot(data).version,
  };
}

function safeJobWarranty(
  warrantyId: string,
  data: FirebaseFirestore.DocumentData,
  job: FirebaseFirestore.DocumentData | null,
) {
  const signed = Boolean(data.warrantySignedAt || data.acceptedTerms);
  const terms = jobWarrantyTermsSnapshot(data);
  const branchId = String(job?.branchId || data.branchId || 'cyberjaya');
  const deviceName = [
    [job?.deviceBrand, job?.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    String(job?.device || '').trim(),
    String(data.description || '').trim(),
  ].find(Boolean) || 'Device';
  return {
    warrantyId,
    warrantyNumber: `JW-${warrantyId.slice(0, 8).toUpperCase()}`,
    jobNumber: displayJobNumber(data, job),
    invoiceNo: '',
    customerName: job?.customerName || data.customerName || '',
    customerPhone: job?.customerPhone || data.customerPhone || '',
    branchId,
    deviceName,
    coveredItem: data.title || 'Repair Warranty',
    warrantyDurationDays: Number(data.warrantyPeriodDays || 0),
    startDate: serializeTimestamp(data.warrantyStartDate),
    endDate: serializeTimestamp(data.warrantyEndDate),
    claimLimit: 'Unlimited within active warranty period',
    status: data.warrantyEndDate?.toMillis?.() >= Date.now() ? 'active' : 'expired',
    terms,
    signed,
    canSign: !signed && data.publicWarrantyTokenStatus !== 'revoked',
    warrantySignedAt: serializeTimestamp(data.warrantySignedAt),
    warrantySignedName: data.warrantySignedName || '',
    warrantySignedPhone: data.warrantySignedPhone || '',
    warrantySignatureDataUrl: signed ? data.warrantySignatureDataUrl || '' : '',
    warrantyTypedSignature: signed ? data.warrantyTypedSignature || '' : '',
    warrantySignatureTokenUsed: signed ? data.warrantySignatureTokenUsed || '' : '',
    warrantyTermsVersion: terms.version,
  };
}

async function writePublicAudit(warrantyId: string, data: FirebaseFirestore.DocumentData) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId: warrantyId,
    action: 'warranty_terms_signed',
    changedBy: 'public_link',
    changedByDisplayName: data.customerName || 'Customer',
    changes: [],
    note: 'Warranty terms signed from public link',
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const warranty = await getWarrantyByToken(token);
    if (!warranty) {
      const jobWarranty = await getJobWarrantyByToken(token);
      if (!jobWarranty) return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 404 });
      if (jobWarranty.data.publicWarrantyTokenStatus === 'revoked') {
        return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 410 });
      }
      const job = await getLinkedJob(String(jobWarranty.data.jobId || '')).catch(() => null);
      return NextResponse.json({ warranty: safeJobWarranty(jobWarranty.warrantyId, jobWarranty.data, job) });
    }
    if (warranty.data.publicWarrantyTokenStatus === 'revoked' || isExpired(warranty.data)) {
      return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 410 });
    }
    const [job, invoice] = await Promise.all([
      getLinkedJob(String(warranty.data.jobId || '')).catch(() => null),
      getLinkedInvoice(String(warranty.data.invoiceId || '')).catch(() => null),
    ]);
    return NextResponse.json({ warranty: safeWarranty(warranty.warrantyId, warranty.data, job, invoice) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load warranty' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json() as {
      signerName?: string;
      signerPhone?: string;
      signatureDataUrl?: string;
      typedSignature?: string;
      acknowledged?: boolean;
    };
    const warranty = await getWarrantyByToken(token);
    if (!warranty) {
      const jobWarranty = await getJobWarrantyByToken(token);
      if (!jobWarranty) return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 404 });
      if (jobWarranty.data.publicWarrantyTokenStatus === 'revoked') {
        return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 410 });
      }
      if (jobWarranty.data.warrantySignedAt || jobWarranty.data.acceptedTerms) {
        return NextResponse.json({ error: 'This warranty agreement has already been signed.' }, { status: 409 });
      }

      const signerName = String(body.signerName || '').trim();
      const signerPhone = String(body.signerPhone || '').trim();
      const signatureDataUrl = String(body.signatureDataUrl || '').trim();
      const typedSignature = String(body.typedSignature || '').trim();
      if (!signerName) return NextResponse.json({ error: 'Signer name is required.' }, { status: 400 });
      if (!signerPhone) return NextResponse.json({ error: 'Signer phone is required.' }, { status: 400 });
      if (body.acknowledged !== true) return NextResponse.json({ error: 'Please confirm the warranty acknowledgement.' }, { status: 400 });
      if (!typedSignature && !signatureDataUrl.startsWith('data:image/png;base64,')) {
        return NextResponse.json({ error: 'Digital signature or typed signature is required.' }, { status: 400 });
      }
      if (signatureDataUrl && signatureDataUrl.length > 500000) {
        return NextResponse.json({ error: 'Signature image is too large. Please clear and sign again.' }, { status: 400 });
      }

      await adminDb.collection('jobDocuments').doc(jobWarranty.warrantyId).update({
        acceptedTerms: true,
        warrantySignedAt: FieldValue.serverTimestamp(),
        warrantySignedName: signerName,
        warrantySignedPhone: signerPhone,
        warrantySignatureDataUrl: signatureDataUrl,
        warrantyTypedSignature: typedSignature,
        warrantySignatureTokenUsed: token,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await adminDb.collection('auditLogs').add({
        entityType: 'job',
        entityId: jobWarranty.data.jobId || jobWarranty.warrantyId,
        action: 'job_warranty_terms_signed',
        changedBy: 'public_link',
        changedByDisplayName: signerName || 'Customer',
        changes: [],
        note: 'Job warranty terms signed from public link',
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);
      const latest = await adminDb.collection('jobDocuments').doc(jobWarranty.warrantyId).get();
      const job = await getLinkedJob(String(jobWarranty.data.jobId || '')).catch(() => null);
      return NextResponse.json({
        warranty: safeJobWarranty(jobWarranty.warrantyId, latest.data() || jobWarranty.data, job),
        message: 'Warranty agreement signed. Genius Advanced has received your acknowledgement.',
      });
    }
    if (warranty.data.publicWarrantyTokenStatus === 'revoked' || isExpired(warranty.data)) {
      return NextResponse.json({ error: 'Warranty link is invalid or expired.' }, { status: 410 });
    }
    if (warranty.data.warrantySignedAt || warranty.data.warrantyTermsAccepted || warranty.data.acceptedTerms) {
      return NextResponse.json({ error: 'This warranty agreement has already been signed.' }, { status: 409 });
    }

    const signerName = String(body.signerName || '').trim();
    const signerPhone = String(body.signerPhone || '').trim();
    const signatureDataUrl = String(body.signatureDataUrl || '').trim();
    const typedSignature = String(body.typedSignature || '').trim();
    if (!signerName) return NextResponse.json({ error: 'Signer name is required.' }, { status: 400 });
    if (!signerPhone) return NextResponse.json({ error: 'Signer phone is required.' }, { status: 400 });
    if (body.acknowledged !== true) return NextResponse.json({ error: 'Please confirm the warranty acknowledgement.' }, { status: 400 });
    if (!typedSignature && !signatureDataUrl.startsWith('data:image/png;base64,')) {
      return NextResponse.json({ error: 'Digital signature or typed signature is required.' }, { status: 400 });
    }
    if (signatureDataUrl && signatureDataUrl.length > 500000) {
      return NextResponse.json({ error: 'Signature image is too large. Please clear and sign again.' }, { status: 400 });
    }

    await adminDb.collection('warranties').doc(warranty.warrantyId).update({
      warrantyTermsAccepted: true,
      acceptedTerms: true,
      warrantySignedAt: FieldValue.serverTimestamp(),
      warrantySignedName: signerName,
      warrantySignedPhone: signerPhone,
      warrantySignatureDataUrl: signatureDataUrl,
      warrantyTypedSignature: typedSignature,
      warrantySignatureTokenUsed: token,
      warrantyTermsVersion: warranty.data.warrantyTermsVersion || termsSnapshot(warranty.data).version,
      warrantyTermsSnapshot: termsSnapshot(warranty.data),
      warrantySignedIp: request.headers.get('x-forwarded-for') || '',
      warrantySignedUserAgent: request.headers.get('user-agent') || '',
      warrantySignature: {
        name: signerName,
        phone: signerPhone,
        dataUrl: signatureDataUrl,
        typedSignature,
        signedAt: FieldValue.serverTimestamp(),
        tokenUsed: token,
      },
    });
    await writePublicAudit(warranty.warrantyId, warranty.data);
    const [job, invoice] = await Promise.all([
      getLinkedJob(String(warranty.data.jobId || '')).catch(() => null),
      getLinkedInvoice(String(warranty.data.invoiceId || '')).catch(() => null),
    ]);
    const jobNumber = displayJobNumber(warranty.data, job);
    const customerName = warranty.data.customerName || 'Customer';
    const technicianId = String(job?.technicianId || '').trim();
    const nextAction = 'Warranty record is acknowledged.';
    await createApprovalNotification({
      sourceEventId: `warranty_terms_signed:${warranty.warrantyId}`,
      type: 'warranty_terms_signed',
      title: 'Warranty Terms Signed',
      message: `${customerName} has signed Warranty Terms for ${jobNumber}. Next step: warranty acknowledged.`,
      branchId: warranty.data.branchId || invoice?.branchId || job?.branchId || '',
      targetUserIds: technicianId ? [technicianId] : [],
      relatedEntityType: 'warranty',
      relatedEntityId: warranty.warrantyId,
      metadata: {
        warrantyId: warranty.warrantyId,
        jobId: warranty.data.jobId || '',
        jobNumber,
        customerName,
        technicianId,
        nextAction,
      },
    });
    const latest = await adminDb.collection('warranties').doc(warranty.warrantyId).get();
    return NextResponse.json({
      warranty: safeWarranty(warranty.warrantyId, latest.data() || warranty.data, job, invoice),
      message: 'Warranty agreement signed. Genius Advanced has received your acknowledgement.',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit warranty agreement' }, { status: 500 });
  }
}
