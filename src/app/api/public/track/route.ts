import { NextRequest, NextResponse } from 'next/server';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { getWhatsAppSenderForBranch, normalizeWhatsAppPhoneNumber } from '@/features/pos/whatsappService';

const statusMap: Record<string, { status: string; label: string; progress: number }> = {
  received: { status: 'received', label: 'Device Received', progress: 10 },
  diagnosis: { status: 'diagnosis', label: 'Diagnosis In Progress', progress: 25 },
  quotation_pending: { status: 'quotation_required', label: 'Quotation Preparing', progress: 35 },
  quotation_required: { status: 'quotation_required', label: 'Quotation Preparing', progress: 35 },
  quotation_sent: { status: 'quotation_sent', label: 'Waiting for Customer Approval', progress: 45 },
  customer_approved: { status: 'quotation_approved', label: 'Quotation Approved', progress: 55 },
  customer_rejected: { status: 'customer_rejected', label: 'Quotation Rejected', progress: 45 },
  quotation_approved: { status: 'quotation_approved', label: 'Quotation Approved', progress: 55 },
  in_repair: { status: 'repair_in_progress', label: 'Repair In Progress', progress: 70 },
  repair_in_progress: { status: 'repair_in_progress', label: 'Repair In Progress', progress: 70 },
  completed: { status: 'repair_completed', label: 'Repair Completed', progress: 85 },
  repair_completed: { status: 'repair_completed', label: 'Repair Completed', progress: 85 },
  ready_for_collection: { status: 'ready_for_collection', label: 'Ready for Collection', progress: 90 },
  ready_for_pickup: { status: 'ready_for_collection', label: 'Ready for Collection', progress: 90 },
  delivered: { status: 'closed', label: 'Completed', progress: 100 },
  warranty_active: { status: 'warranty_active', label: 'Warranty Activated', progress: 98 },
  warranty_expired: { status: 'warranty_expired', label: 'Warranty Expired', progress: 100 },
  collected: { status: 'closed', label: 'Completed', progress: 100 },
  closed: { status: 'closed', label: 'Completed', progress: 100 },
  cancelled: { status: 'cancelled', label: 'Cancelled', progress: 0 },
};

function genericError() {
  return NextResponse.json({ error: 'No repair record found for this phone number. Please check the number or contact Genius Advanced.' }, { status: 404 });
}

function legacyError() {
  return NextResponse.json({ error: 'Repair record not found. Please check your Repair ID and tracking code.' }, { status: 404 });
}

function normalizeRepairId(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeTrackingCode(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function normalizePhone(value: string): string {
  return normalizeWhatsAppPhoneNumber(value);
}

function phoneVariants(value: string): string[] {
  const raw = String(value || '').trim();
  const normalized = normalizePhone(raw);
  const local = normalized.startsWith('60') ? `0${normalized.slice(2)}` : '';
  return Array.from(new Set([raw, normalized, local, normalized ? `+${normalized}` : ''].filter(Boolean)));
}

function timestampToJson(value: unknown) {
  return value && typeof (value as { toDate?: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;
}

function timestampMillis(value: unknown): number {
  return value && typeof (value as { toMillis?: () => number }).toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : 0;
}

function branchName(branchId: string): string {
  if (branchId === 'bangi') return 'Genius Advanced Bangi';
  if (branchId === 'cyberjaya') return 'Genius Advanced Cyberjaya';
  if (branchId === 'ampang') return 'Genius Advanced Ampang';
  return 'Genius Advanced';
}

async function findJob(repairId: string) {
  const trimmed = normalizeRepairId(repairId);
  const direct = await adminDb.collection('jobs').doc(trimmed).get();
  if (direct.exists) return direct;
  const byJobNo = await adminDb.collection('jobs').where('jobNo', '==', trimmed).limit(1).get();
  if (!byJobNo.empty) return byJobNo.docs[0];
  const byJobNumber = await adminDb.collection('jobs').where('jobNumber', '==', trimmed).limit(1).get();
  if (!byJobNumber.empty) return byJobNumber.docs[0];
  const bySheet = await adminDb.collection('jobs').where('jobSheetNo', '==', trimmed).limit(1).get();
  if (!bySheet.empty) return bySheet.docs[0];
  const byAgn = await adminDb.collection('jobs').where('agnJobNumber', '==', trimmed).limit(1).get();
  if (!byAgn.empty) return byAgn.docs[0];
  return null;
}

function jobPhoneCandidates(job: FirebaseFirestore.DocumentData): string[] {
  const nestedCustomer = job.customer && typeof job.customer === 'object' ? job.customer as Record<string, unknown> : {};
  return [
    job.customerPhone,
    job.normalizedPhone,
    job.phone,
    nestedCustomer.phone,
    job.phoneSnapshot,
    job.customerPhoneSnapshot,
  ].map((value) => String(value || '')).filter(Boolean);
}

function jobMatchesPhone(job: FirebaseFirestore.DocumentData, normalizedPhone: string): boolean {
  return jobPhoneCandidates(job).some((value) => normalizePhone(value) === normalizedPhone);
}

function mapPublicJob(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const job = doc.data() || {};
  const branchId = String(job.branchId || 'cyberjaya');
  const internalStatus = String(job.publicStatus || job.customerStatus || job.lifecycleStatus || job.status || 'received');
  const mapped = statusMap[internalStatus] || statusMap.received;
  const jobNo = String(job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || '');
  return {
    repairId: jobNo,
    jobNo,
    branchId,
    branchName: branchName(branchId),
    deviceBrand: String(job.deviceBrand || ''),
    deviceModel: String(job.deviceModel || job.device || job.deviceType || 'Device'),
    publicStatus: mapped.status,
    publicStatusLabel: mapped.label,
    progressPercentage: mapped.progress,
    receivedAt: timestampToJson(job.receivedAt || job.createdAt),
    lastUpdatedAt: timestampToJson(job.updatedAt || job.createdAt),
    estimatedCompletionAt: timestampToJson(job.estimatedCompletionAt),
    diagnosisSummaryPublic: String(job.diagnosisSummaryPublic || ''),
    repairSummaryPublic: String(job.repairSummaryPublic || ''),
    branchWhatsAppNumber: getWhatsAppSenderForBranch(branchId),
  };
}

async function linkedCustomerIds(normalizedPhone: string, variants: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const customerFields = ['normalizedPhone', 'phone'];
  for (const field of customerFields) {
    for (const value of field === 'normalizedPhone' ? [normalizedPhone] : variants) {
      const snapshot = await adminDb.collection('customers').where(field, '==', value).limit(10).get();
      snapshot.docs.forEach((doc) => ids.add(doc.id));
    }
  }
  return Array.from(ids);
}

async function findJobsByPhone(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return [];
  const variants = phoneVariants(phone);
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();
  const jobFields = ['normalizedPhone', 'customerPhone', 'phone', 'phoneSnapshot', 'customerPhoneSnapshot', 'customer.phone'];

  for (const field of jobFields) {
    for (const value of field === 'normalizedPhone' ? [normalizedPhone] : variants) {
      const snapshot = await adminDb.collection('jobs').where(field, '==', value).limit(10).get();
      snapshot.docs.forEach((doc) => docs.set(doc.id, doc));
    }
  }

  const customerIds = await linkedCustomerIds(normalizedPhone, variants);
  for (const customerId of customerIds.slice(0, 10)) {
    const snapshot = await adminDb.collection('jobs').where('customerId', '==', customerId).limit(10).get();
    snapshot.docs.forEach((doc) => docs.set(doc.id, doc));
  }

  return Array.from(docs.values())
    .filter((doc) => jobMatchesPhone(doc.data() || {}, normalizedPhone) || customerIds.includes(String((doc.data() || {}).customerId || '')))
    .sort((left, right) => timestampMillis((right.data() || {}).updatedAt || (right.data() || {}).createdAt) - timestampMillis((left.data() || {}).updatedAt || (left.data() || {}).createdAt))
    .slice(0, 10);
}

async function recordPublicView(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  await doc.ref.update({
    customerFirstTrackedAt: (doc.data() || {}).customerFirstTrackedAt || FieldValue.serverTimestamp(),
    customerLastTrackedAt: FieldValue.serverTimestamp(),
    customerTrackViewCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
  await adminDb.collection('auditLogs').add({
    entityType: 'job',
    entityId: doc.id,
    action: 'public_repair_tracking_viewed',
    changedBy: 'public_tracking',
    changedByDisplayName: 'Public Tracking',
    changes: [],
    note: 'Customer viewed public repair tracking',
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { repairId?: string; trackingCode?: string; phone?: string };
    const repairId = normalizeRepairId(String(body.repairId || ''));
    const trackingCode = normalizeTrackingCode(String(body.trackingCode || ''));
    const phone = String(body.phone || '');

    if (!repairId && phone) {
      const jobs = await findJobsByPhone(phone);
      if (jobs.length === 0) return genericError();
      if (jobs.length === 1) {
        await recordPublicView(jobs[0]);
        return NextResponse.json({ result: mapPublicJob(jobs[0]), results: [] });
      }
      return NextResponse.json({ results: jobs.map(mapPublicJob) });
    }

    if (!repairId || !trackingCode) return legacyError();
    const jobDoc = await findJob(repairId);
    if (!jobDoc?.exists) return legacyError();
    const job = jobDoc.data() || {};
    const existingTrackingCode = normalizeTrackingCode(String(job.publicTrackingCode || ''));
    if (!existingTrackingCode || existingTrackingCode !== trackingCode) return legacyError();

    await recordPublicView(jobDoc);
    return NextResponse.json({ result: mapPublicJob(jobDoc), results: [] });
  } catch {
    return genericError();
  }
}
