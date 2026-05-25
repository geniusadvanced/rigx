import { NextRequest, NextResponse } from 'next/server';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { getWhatsAppSenderForBranch } from '@/features/pos/whatsappService';
import { malaysiaPhoneVariants, maskPhoneForLog, normalizeMalaysiaPhoneNumber } from '@/lib/utils/phone';

const TRACK_DEBUG_LABEL = '[PUBLIC TRACK DEBUG]';
const TRACK_LOOKUP_VERSION = 'phone-lookup-v2';

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
  return normalizeMalaysiaPhoneNumber(value);
}

function phoneVariants(value: string): string[] {
  return malaysiaPhoneVariants(value);
}

function normalizeUnknownError(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode:
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined,
    errorString: String(error),
  };
}

function trackDebug(payload: Record<string, unknown>) {
  console.warn(TRACK_DEBUG_LABEL, JSON.stringify(payload));
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function maskDocId(id: string): string {
  if (!id) return '';
  if (id.length <= 8) return `${id.slice(0, 2)}***`;
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
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
  const [direct, byJobNo, byJobNumber, bySheet, byAgn] = await Promise.all([
    adminDb.collection('jobs').doc(trimmed).get(),
    adminDb.collection('jobs').where('jobNo', '==', trimmed).limit(1).get(),
    adminDb.collection('jobs').where('jobNumber', '==', trimmed).limit(1).get(),
    adminDb.collection('jobs').where('jobSheetNo', '==', trimmed).limit(1).get(),
    adminDb.collection('jobs').where('agnJobNumber', '==', trimmed).limit(1).get(),
  ]);
  if (direct.exists) return direct;
  if (!byJobNo.empty) return byJobNo.docs[0];
  if (!byJobNumber.empty) return byJobNumber.docs[0];
  if (!bySheet.empty) return bySheet.docs[0];
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
    job.customerContact,
    nestedCustomer.customerPhone,
    nestedCustomer.customerContact,
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

async function linkedCustomerIds(normalizedPhone: string): Promise<{ ids: string[]; queryCount: number; firestoreMs: number }> {
  const startedAt = Date.now();
  const ids = new Set<string>();
  const queryTargets = [
    { field: 'normalizedPhone', values: [normalizedPhone] },
  ].flatMap(({ field, values }) => values.map((value) => ({ field, value })));

  const uniqueTargets = Array.from(new Map(
    queryTargets
      .filter(({ value }) => Boolean(value))
      .map((target) => [`${target.field}:${target.value}`, target]),
  ).values());

  const snapshots = await Promise.all(
    uniqueTargets.map(({ field, value }) => adminDb.collection('customers').where(field, '==', value).limit(10).get()),
  );
  snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => ids.add(doc.id)));

  return { ids: Array.from(ids), queryCount: uniqueTargets.length, firestoreMs: elapsedMs(startedAt) };
}

async function findJobsByPhone(phone: string) {
  const startedAt = Date.now();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { jobs: [], lookupMs: elapsedMs(startedAt), firestoreMs: 0, queryCount: 0, customerMatchCount: 0 };
  const variants = phoneVariants(phone);
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();

  const jobQueryStartedAt = Date.now();
  const normalizedJobsSnapshot = await adminDb.collection('jobs').where('normalizedPhone', '==', normalizedPhone).limit(10).get();
  normalizedJobsSnapshot.docs.forEach((doc) => docs.set(doc.id, doc));
  let firestoreMs = elapsedMs(jobQueryStartedAt);
  let queryCount = 1;

  const customerLookup = await linkedCustomerIds(normalizedPhone);
  const customerIds = customerLookup.ids;
  firestoreMs += customerLookup.firestoreMs;
  queryCount += customerLookup.queryCount;

  const linkedJobStartedAt = Date.now();
  const linkedJobSnapshots = await Promise.all(
    customerIds.slice(0, 10).map((customerId) => adminDb.collection('jobs').where('customerId', '==', customerId).limit(10).get()),
  );
  linkedJobSnapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => docs.set(doc.id, doc)));
  firestoreMs += elapsedMs(linkedJobStartedAt);
  queryCount += Math.min(customerIds.length, 10);

  const matchingDocs = () => Array.from(docs.values())
    .filter((doc) => jobMatchesPhone(doc.data() || {}, normalizedPhone) || customerIds.includes(String((doc.data() || {}).customerId || '')));

  let matches = matchingDocs();
  if (matches.length === 0) {
    const legacyJobQueryTargets = variants.map((value) => ({ field: 'customerPhone', value }));
    const uniqueLegacyJobTargets = Array.from(new Map(
      legacyJobQueryTargets
        .filter(({ value }) => Boolean(value))
        .map((target) => [`${target.field}:${target.value}`, target]),
    ).values());
    const legacyJobStartedAt = Date.now();
    const legacySnapshots = await Promise.all(
      uniqueLegacyJobTargets.map(({ field, value }) => adminDb.collection('jobs').where(field, '==', value).limit(10).get()),
    );
    legacySnapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => docs.set(doc.id, doc)));
    firestoreMs += elapsedMs(legacyJobStartedAt);
    queryCount += uniqueLegacyJobTargets.length;
    matches = matchingDocs();
  }

  return {
    jobs: matches
    .sort((left, right) => timestampMillis((right.data() || {}).updatedAt || (right.data() || {}).createdAt) - timestampMillis((left.data() || {}).updatedAt || (left.data() || {}).createdAt))
    .slice(0, 10),
    lookupMs: elapsedMs(startedAt),
    firestoreMs,
    queryCount,
    customerMatchCount: customerIds.length,
  };
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
  const requestStartedAt = Date.now();
  try {
    const body = await request.json() as { repairId?: string; trackingCode?: string; phone?: string };
    const repairId = normalizeRepairId(String(body.repairId || ''));
    const trackingCode = normalizeTrackingCode(String(body.trackingCode || ''));
    const phone = String(body.phone || '');

    trackDebug({
      checkpoint: 'request:start',
      version: TRACK_LOOKUP_VERSION,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      collection: 'jobs',
      method: 'POST',
      hasRepairId: Boolean(repairId),
      rawMaskedPhone: maskPhoneForLog(phone),
      normalizedMaskedPhone: maskPhoneForLog(normalizePhone(phone)),
    });

    if (!repairId && phone) {
      const lookup = await findJobsByPhone(phone);
      const jobs = lookup.jobs;
      trackDebug({
        checkpoint: 'lookup:end',
        lookupType: 'phone',
        lookupMs: lookup.lookupMs,
        firestoreMs: lookup.firestoreMs,
        firestoreQueryCount: lookup.queryCount,
        customerMatchCount: lookup.customerMatchCount,
        matchedJobCount: jobs.length,
        matchedJobIds: jobs.slice(0, 3).map((doc) => maskDocId(doc.id)),
      });
      if (jobs.length === 0) {
        trackDebug({ checkpoint: 'request:end', status: 404, durationMs: elapsedMs(requestStartedAt) });
        return genericError();
      }
      if (jobs.length === 1) {
        void recordPublicView(jobs[0]);
        trackDebug({ checkpoint: 'request:end', status: 200, durationMs: elapsedMs(requestStartedAt), resultCount: 1 });
        return NextResponse.json({ result: mapPublicJob(jobs[0]), results: [] });
      }
      trackDebug({ checkpoint: 'request:end', status: 200, durationMs: elapsedMs(requestStartedAt), resultCount: jobs.length });
      return NextResponse.json({ results: jobs.map(mapPublicJob) });
    }

    if (!repairId || !trackingCode) {
      trackDebug({ checkpoint: 'request:end', status: 404, durationMs: elapsedMs(requestStartedAt), lookupType: 'repairId' });
      return legacyError();
    }
    const lookupStartedAt = Date.now();
    const jobDoc = await findJob(repairId);
    trackDebug({
      checkpoint: 'lookup:end',
      lookupType: 'repairId',
      lookupMs: elapsedMs(lookupStartedAt),
      firestoreMs: elapsedMs(lookupStartedAt),
      firestoreQueryCount: 5,
      hasJob: Boolean(jobDoc?.exists),
      jobId: jobDoc?.id ? maskDocId(jobDoc.id) : '',
    });
    if (!jobDoc?.exists) {
      trackDebug({ checkpoint: 'request:end', status: 404, durationMs: elapsedMs(requestStartedAt), lookupType: 'repairId' });
      return legacyError();
    }
    const job = jobDoc.data() || {};
    const existingTrackingCode = normalizeTrackingCode(String(job.publicTrackingCode || ''));
    if (!existingTrackingCode || existingTrackingCode !== trackingCode) {
      trackDebug({ checkpoint: 'request:end', status: 404, durationMs: elapsedMs(requestStartedAt), lookupType: 'repairId', reason: 'trackingCodeMismatch' });
      return legacyError();
    }

    void recordPublicView(jobDoc);
    trackDebug({ checkpoint: 'request:end', status: 200, durationMs: elapsedMs(requestStartedAt), lookupType: 'repairId', resultCount: 1 });
    return NextResponse.json({ result: mapPublicJob(jobDoc), results: [] });
  } catch (error) {
    trackDebug({
      checkpoint: 'request:error',
      version: TRACK_LOOKUP_VERSION,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      collection: 'jobs',
      method: 'POST',
      durationMs: elapsedMs(requestStartedAt),
      ...normalizeUnknownError(error),
    });
    return genericError();
  }
}
