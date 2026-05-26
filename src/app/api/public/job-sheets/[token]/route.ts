import { NextRequest, NextResponse } from 'next/server';
import { createApprovalNotification } from '@/features/notifications/serverNotificationService';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

function serializeTimestamp(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
}

async function getJobByToken(token: string) {
  const snapshot = await adminDb.collection('jobs').where('jobSheetConsentToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { jobId: doc.id, data: doc.data() };
}

function displayJobNumber(data: FirebaseFirestore.DocumentData) {
  return data.jobNo || data.jobNumber || data.jobSheetNo || '';
}

function deviceModel(data: FirebaseFirestore.DocumentData) {
  return [data.deviceBrand, data.deviceModel || data.device].filter(Boolean).join(' ') || 'Not specified';
}

function isClosed(data: FirebaseFirestore.DocumentData) {
  return ['cancelled', 'collected', 'delivered'].includes(String(data.lifecycleStatus || data.status || ''));
}

function safeJob(jobId: string, data: FirebaseFirestore.DocumentData) {
  const signed = data.jobSheetConsentStatus === 'signed';
  return {
    jobId: displayJobNumber(data),
    dateReceived: serializeTimestamp(data.receivedAt || data.createdAt),
    status: String(data.lifecycleStatus || data.status || ''),
    branchId: data.branchId || '',
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    customerEmail: data.customerEmail || '',
    officialCustomerId: data.customerNumber || data.officialCustomerId || data.customerNo || '',
    deviceType: data.deviceType || data.device || '',
    deviceModel: deviceModel(data),
    serialNumber: data.serialNumber || '',
    accessoriesReceived: data.accessoriesReceived || '',
    deviceCondition: data.deviceCondition || '',
    reportedProblem: data.issueDescription || '',
    initialDiagnosis: data.diagnosisNote || data.diagnosisSummaryPublic || '',
    dataBackupRequired: data.dataBackupRequired || '',
    passwordProvided: data.passwordProvided || '',
    estimatedDiagnosisTime: data.estimatedDiagnosisTime || '',
    technicianName: data.technicianName || '',
    signed,
    signedAt: serializeTimestamp(data.jobSheetSignedAt),
    signer: data.jobSheetSigner || null,
    signatureData: signed ? data.jobSheetSignature?.signatureData || '' : '',
    canSign: !signed && !isClosed(data),
    tokenStatus: data.jobSheetConsentToken ? 'active' : 'missing',
  };
}

function consentSnapshot(data: FirebaseFirestore.DocumentData) {
  return {
    jobId: displayJobNumber(data),
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    deviceModel: deviceModel(data),
    reportedProblem: data.issueDescription || '',
    branch: data.branchId || '',
    termsVersion: '2026-05-08',
    signedAt: new Date().toISOString(),
  };
}

async function writePublicAudit(jobId: string, action: string, note: string) {
  await adminDb.collection('auditLogs').add({
    entityType: 'job',
    entityId: jobId,
    action,
    changedBy: 'public_link',
    changedByDisplayName: 'Customer',
    changes: [],
    note,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function createNotification(jobId: string, data: FirebaseFirestore.DocumentData) {
  const jobNumber = displayJobNumber(data);
  const customerName = data.customerName || 'Customer';
  const technicianId = data.technicianId ? String(data.technicianId) : '';
  const nextAction = 'Start diagnosis.';
  await createApprovalNotification({
    sourceEventId: `job_sheet_signed:${jobId}`,
    type: 'job_sheet_signed',
    title: 'Job Sheet signed',
    message: `${customerName} has signed the Repair Job Sheet for ${jobNumber}. Next step: start diagnosis.`,
    branchId: data.branchId || '',
    targetUserIds: technicianId ? [technicianId] : [],
    relatedModule: 'job',
    actionUrl: `/dashboard/jobs?jobId=${encodeURIComponent(jobId)}`,
    metadata: {
      jobId,
      jobNumber,
      customerId: data.customerId || '',
      customerName,
      technicianId: data.technicianId || '',
      branch: data.branchId || '',
      deviceModel: deviceModel(data),
      signedAt: new Date().toISOString(),
      nextAction,
      actionUrl: `/dashboard/jobs?jobId=${encodeURIComponent(jobId)}`,
    },
    relatedEntityType: 'job',
    relatedEntityId: jobId,
  });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const job = await getJobByToken(token);
    if (!job) return NextResponse.json({ error: 'Job Sheet link is invalid or expired.' }, { status: 404 });
    return NextResponse.json({ jobSheet: safeJob(job.jobId, job.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Job Sheet' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json() as {
      signerName?: string;
      icOrPassportNo?: string;
      phone?: string;
      signedDate?: string;
      signatureData?: string;
      checklist?: Record<string, boolean>;
    };
    const job = await getJobByToken(token);
    if (!job) return NextResponse.json({ error: 'Job Sheet link is invalid or expired.' }, { status: 404 });
    if (job.data.jobSheetConsentStatus === 'signed') return NextResponse.json({ error: 'This Job Sheet has already been signed.' }, { status: 409 });
    if (isClosed(job.data)) return NextResponse.json({ error: 'This Job Sheet can no longer be signed.' }, { status: 410 });

    const signerName = String(body.signerName || '').trim();
    const phone = String(body.phone || '').trim();
    const signatureData = String(body.signatureData || '').trim();
    const checklist = body.checklist || {};
    const allChecked = [
      'inspectionDiagnosisAuthorised',
      'dataLossAcknowledged',
      'preExistingFaultAcknowledged',
      'electronicApprovalAccepted',
      'termsAccepted',
    ].every((key) => checklist[key] === true);

    if (!signerName) return NextResponse.json({ error: 'Customer / Representative Name is required.' }, { status: 400 });
    if (!phone) return NextResponse.json({ error: 'Phone Number is required.' }, { status: 400 });
    if (!allChecked) return NextResponse.json({ error: 'Please tick all consent checklist items.' }, { status: 400 });
    if (!signatureData.startsWith('data:image/png;base64,')) return NextResponse.json({ error: 'Digital signature is required.' }, { status: 400 });
    if (signatureData.length > 500000) return NextResponse.json({ error: 'Signature image is too large. Please clear and sign again.' }, { status: 400 });

    await adminDb.collection('jobs').doc(job.jobId).update({
      jobSheetConsentStatus: 'signed',
      jobSheetSignedAt: FieldValue.serverTimestamp(),
      jobSheetSignedBy: 'customer',
      jobSheetConsentMethod: 'public_link',
      jobSheetConsentToken: token,
      jobSheetTermsAccepted: true,
      consentCompleted: true,
      jobSheetConsentChecklist: {
        inspectionDiagnosisAuthorised: true,
        dataLossAcknowledged: true,
        preExistingFaultAcknowledged: true,
        electronicApprovalAccepted: true,
        termsAccepted: true,
      },
      jobSheetSigner: {
        name: signerName,
        icOrPassportNo: String(body.icOrPassportNo || '').trim(),
        phone,
        signedDate: String(body.signedDate || '').trim(),
      },
      jobSheetSignature: {
        signatureData,
      },
      jobSheetConsentSnapshot: consentSnapshot(job.data),
      jobSheetSignedFrom: {
        ipAddress: request.headers.get('x-forwarded-for') || '',
        userAgent: request.headers.get('user-agent') || '',
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writePublicAudit(job.jobId, 'job_sheet_customer_signed', 'Repair Job Sheet signed from public link');
    await createNotification(job.jobId, job.data);
    const latest = await adminDb.collection('jobs').doc(job.jobId).get();
    return NextResponse.json({
      jobSheet: safeJob(job.jobId, latest.data() || job.data),
      message: 'Job Sheet submitted. Genius Advanced has received your consent.',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit Job Sheet' }, { status: 500 });
  }
}
