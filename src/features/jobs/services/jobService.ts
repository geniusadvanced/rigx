import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/init';
import { assertCan, can } from '@/lib/rbac/can';
import { normalizeMalaysiaPhoneNumber } from '@/lib/utils/phone';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import type { Job, QuotationStatus, Role, UserData } from '@/types';
import {
  getAllowedNextStatuses,
  normalizeJobStatus,
  type CustomerApprovalStatus,
  type JobCostProfile,
  type JobDocumentType,
  type JobStatus,
} from '../types';

export interface CreateJobInput {
  agnJobNumber?: string;
  customerId?: string | null;
  customerNumber?: string;
  deviceId?: string | null;
  customerPhone?: string;
  normalizedPhone?: string;
  customerName: string;
  device: string;
  deviceType?: string;
  deviceBrand?: string;
  deviceModel?: string;
  devicePassword?: string;
  serialNumber?: string;
  issueDescription?: string;
  branchId: string;
  technicianId: string;
  technicianName?: string;
  totalSale: number;
  paymentStatus: string;
  createdBy: string;
  createdByDisplayName?: string;
  creatorRole: Role;
  costProfile: JobCostProfile;
  requiredDocuments: JobDocumentType[];
  pricingMode?: 'diagnosis_first' | 'quote_now';
  quotedPriceItems?: JobQuotedPriceItem[];
}

export interface JobQuotedPriceItem {
  priceItemId: string;
  name: string;
  category?: string;
  serviceGroup?: string;
  pricingType?: 'fixed' | 'starting_from' | 'range' | 'quote_required' | 'free_or_waived';
  basePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  deviceType?: string;
  model?: string;
  packageName?: string;
  commissionEligible?: boolean;
  costPrice?: number;
  finalPrice: number;
}

export interface UpdateJobStatusParams {
  job: Job;
  user: UserData;
  nextStatus: JobStatus;
  note: string;
}

export interface UpdateJobDetailsInput {
  customerId?: string | null;
  deviceId?: string | null;
  customerName: string;
  customerPhone: string;
  deviceType: string;
  deviceBrand: string;
  deviceModel: string;
  devicePassword: string;
  serialNumber: string;
  issueDescription: string;
  quotationAmount: number;
  quotationNote: string;
  customerApprovalStatus: CustomerApprovalStatus;
}

export interface UpdateJobPublicTrackingInput {
  diagnosisSummaryPublic: string;
  repairSummaryPublic: string;
  estimatedCompletionAt: string;
}

export interface UpdateQuotationParams {
  job: Job;
  user: UserData;
  quotationAmount?: number;
  quotationNote?: string;
  nextStatus: QuotationStatus;
  rejectedReason?: string;
  proofFile?: File | null;
}

export interface UpdateJobAssignmentParams {
  job: Job;
  user: UserData;
  technicianId: string;
  technicianName: string;
}

export interface ManualJobSheetConsentInput {
  consentMethod: string;
  signerName: string;
  icOrPassportNo?: string;
  phone: string;
  notes?: string;
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeJobQuotedPriceItems(items: JobQuotedPriceItem[] | undefined): JobQuotedPriceItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    priceItemId: normalizeText(item.priceItemId || ''),
    name: normalizeText(item.name || ''),
    category: normalizeText(item.category || ''),
    serviceGroup: normalizeText(item.serviceGroup || ''),
    pricingType: item.pricingType || 'fixed',
    basePrice: Number(item.basePrice || 0),
    minPrice: Number(item.minPrice || 0),
    maxPrice: Number(item.maxPrice || 0),
    deviceType: normalizeText(item.deviceType || ''),
    model: normalizeText(item.model || ''),
    packageName: normalizeText(item.packageName || ''),
    commissionEligible: item.commissionEligible === true,
    costPrice: Number(item.costPrice || 0),
    finalPrice: Math.max(0, Number(item.finalPrice || 0)),
  })).filter((item) => item.priceItemId && item.name);
}

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function getUnknownErrorDetails(error: unknown) {
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

function warnTechnicianAddJobDebug(payload: Record<string, unknown>) {
  console.warn('[TECHNICIAN ADD JOB DEBUG]', JSON.stringify(payload, null, 2));
}

function addChange(
  changes: Array<{ field: string; before: unknown; after: unknown }>,
  field: string,
  before: unknown,
  after: unknown,
) {
  if (before !== after) {
    changes.push({ field, before, after });
  }
}

function normalizeCostProfile(value: JobCostProfile | undefined, role: Role): JobCostProfile {
  if (role === 'technician') return 'parts_required';
  if (value === 'service_only' || value === 'custom') return value;
  return 'parts_required';
}

function normalizeRequiredDocuments(profile: JobCostProfile, requiredDocuments: JobDocumentType[]): JobDocumentType[] {
  if (profile === 'parts_required') {
    return requiredDocuments.filter((type): type is JobDocumentType =>
      type === 'supplier_receipt' || type === 'logistic_receipt',
    );
  }

  const base: JobDocumentType[] = ['checklist', 'invoice'];
  const normalized = new Set<JobDocumentType>(base);

  if (profile === 'service_only') return base;

  requiredDocuments.forEach((type) => {
    if (['supplier_receipt', 'logistic_receipt', 'checklist', 'invoice', 'payment_receipt'].includes(type)) {
      normalized.add(type);
    }
  });

  return Array.from(normalized);
}

function generateTrackingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jobNumberYearParts(date = new Date()) {
  const year = date.getFullYear();
  const shortYear = String(year).slice(-2);
  return { year, shortYear };
}

function formatRigxJobNumber(year: number, runningNumber: number): string {
  const shortYear = String(year).slice(-2);
  return `RIGX-${shortYear}${String(runningNumber).padStart(4, '0')}`;
}

export function getDisplayJobNumber(job: Partial<Job> & { id?: string }): string {
  return job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || job.docId || job.id || '';
}

function jobDeviceInfo(job: Job): string {
  return [job.deviceBrand, job.deviceModel || job.device].filter(Boolean).join(' ') || 'Not specified';
}

function jobSheetConsentSnapshot(job: Job) {
  return {
    jobId: getDisplayJobNumber(job),
    sourceJobId: job.docId,
    customerName: job.customerName || '',
    customerPhone: job.customerPhone || '',
    deviceModel: jobDeviceInfo(job),
    reportedProblem: job.issueDescription || '',
    branch: job.branchId || '',
    termsVersion: '2026-05-08',
  };
}

async function createJobDocumentWithRigxNumber(
  jobRef: DocumentReference,
  buildJobData: (jobNumber: string) => Record<string, unknown>,
): Promise<{ jobNumber: string; year: number; runningNumber: number }> {
  const { year } = jobNumberYearParts();
  const counterRef = doc(db, 'systemCounters', `jobNumbers_${year}`);

  try {
    const result = await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      const lastNumber = counterSnap.exists() && typeof counterSnap.data().lastNumber === 'number'
        ? counterSnap.data().lastNumber
        : 0;
      const nextNumber = lastNumber + 1;
      const jobNumber = formatRigxJobNumber(year, nextNumber);
      const registryRef = doc(db, 'jobNumberRegistry', jobNumber);
      const registrySnap = await transaction.get(registryRef);

      if (registrySnap.exists()) {
        throw new Error('Unable to generate a unique RIGX job number. Please try again.');
      }

      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:jobNumber:start',
        firestorePath: counterRef.path,
        jobDocId: jobRef.id,
        jobNumber,
      });
      transaction.set(counterRef, {
        year,
        prefix: 'RIGX',
        lastNumber: nextNumber,
        lastJobNo: jobNumber,
        lastJobId: jobRef.id,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      transaction.set(registryRef, {
        jobId: jobRef.id,
        jobNo: jobNumber,
        year,
        runningNumber: nextNumber,
        createdAt: serverTimestamp(),
      });

      const jobPayload = buildJobData(jobNumber);
      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:jobCreate:start',
        firestorePath: jobRef.path,
        jobDocId: jobRef.id,
        jobPayloadBranchId: jobPayload.branchId,
        jobPayloadCreatedBy: jobPayload.createdBy,
        jobPayloadTechnicianId: jobPayload.technicianId,
        jobPayloadStatus: jobPayload.status,
        jobPayloadLifecycleStatus: jobPayload.lifecycleStatus,
        jobPayloadApprovalStatus: jobPayload.approvalStatus,
        jobPayloadCostProfile: jobPayload.costProfile,
        payloadKeys: Object.keys(jobPayload),
      });
      transaction.set(jobRef, jobPayload);

      return { jobNumber, year, runningNumber: nextNumber };
    });
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:jobNumber:success',
      firestorePath: counterRef.path,
      jobDocId: jobRef.id,
      jobNumber: result.jobNumber,
    });
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:jobCreate:success',
      firestorePath: jobRef.path,
      jobDocId: jobRef.id,
      jobNumber: result.jobNumber,
    });
    return result;
  } catch (error) {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:jobNumber:failed',
      firestorePath: `${counterRef.path}, jobNumberRegistry/{jobNo}, ${jobRef.path}`,
      jobDocId: jobRef.id,
      ...getUnknownErrorDetails(error),
    });
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:jobCreate:failed',
      firestorePath: jobRef.path,
      jobDocId: jobRef.id,
      ...getUnknownErrorDetails(error),
    });
    throw error;
  }
}

export function validateCreateJobInput(input: CreateJobInput): Omit<CreateJobInput, 'totalSale'> & { totalSale: number } {
  const totalSale = Number(input.totalSale);
  const pricingMode = input.pricingMode === 'quote_now' ? 'quote_now' : 'diagnosis_first';
  const quotedPriceItems = pricingMode === 'quote_now' ? normalizeJobQuotedPriceItems(input.quotedPriceItems) : [];

  if (!normalizeText(input.customerName)) throw new Error('Customer name is required');
  if (!normalizeText(input.device)) throw new Error('Device is required');
  if (!normalizeText(input.technicianId)) throw new Error('Technician ID is required');
  if (!normalizeText(input.branchId)) throw new Error('Branch ID is required');
  if (!Number.isFinite(totalSale) || totalSale < 0) throw new Error('Total sale must be a valid amount');

  return {
    agnJobNumber: normalizeText(input.agnJobNumber || ''),
    customerId: input.customerId || null,
    customerNumber: normalizeText(input.customerNumber || ''),
    deviceId: input.deviceId || null,
    customerPhone: normalizeText(input.customerPhone || ''),
    normalizedPhone: normalizeText(input.normalizedPhone || normalizeMalaysiaPhoneNumber(input.customerPhone)),
    customerName: normalizeText(input.customerName),
    device: normalizeText(input.device),
    deviceType: normalizeText(input.deviceType || ''),
    deviceBrand: normalizeText(input.deviceBrand || ''),
    deviceModel: normalizeText(input.deviceModel || input.device),
    devicePassword: normalizeText(input.devicePassword || ''),
    serialNumber: normalizeText(input.serialNumber || ''),
    issueDescription: normalizeText(input.issueDescription || input.device),
    branchId: normalizeText(input.branchId),
    technicianId: normalizeText(input.technicianId),
    technicianName: normalizeText(input.technicianName || ''),
    totalSale,
    paymentStatus: normalizeText(input.paymentStatus) || 'pending',
    createdBy: input.createdBy,
    createdByDisplayName: normalizeText(input.createdByDisplayName || ''),
    creatorRole: input.creatorRole,
    costProfile: normalizeCostProfile(input.costProfile, input.creatorRole),
    requiredDocuments: normalizeRequiredDocuments(
      normalizeCostProfile(input.costProfile, input.creatorRole),
      input.requiredDocuments || [],
    ),
    pricingMode,
    quotedPriceItems,
  };
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  assertCan(input.creatorRole, 'jobs.create');
  const data = validateCreateJobInput(input);
  const publicTrackingCode = generateTrackingCode();
  const now = Timestamp.now();
  const isTechnicianCreated = data.creatorRole === 'technician';
  const lifecycleStatus: JobStatus = 'received';
  const status = lifecycleStatus;
  const approvalStatus = isTechnicianCreated ? 'submitted' : 'approved';
  const jobRef = doc(collection(db, 'jobs'));
  const { jobNumber, year, runningNumber } = await createJobDocumentWithRigxNumber(jobRef, (generatedJobNumber) => ({
    ...data,
    agnJobNumber: data.agnJobNumber || '',
    jobNo: generatedJobNumber,
    jobNumber: generatedJobNumber,
    jobSheetNo: generatedJobNumber,
    status,
    lifecycleStatus: 'received',
    receivedAt: serverTimestamp(),
    statusHistory: [
      {
        status: lifecycleStatus,
        changedBy: data.createdBy,
        changedByDisplayName: data.createdByDisplayName || 'Unknown User',
        changedAt: now,
        note: isTechnicianCreated ? 'Job created by technician and pending review' : 'Job received',
      },
    ],
    diagnosisNote: '',
    diagnosisSummaryPublic: '',
    repairSummaryPublic: '',
    estimatedCompletionAt: null,
    publicTrackingCode,
    publicTrackingCreatedAt: serverTimestamp(),
    quotationAmount: 0,
    quotationNote: '',
    quotationStatus: 'draft' satisfies QuotationStatus,
    quotationSentAt: null,
    quotationApprovedAt: null,
    quotationRejectedAt: null,
    quotationApprovedBy: null,
    quotationApprovedByDisplayName: null,
    quotationRejectedReason: null,
    quotationProofUrl: null,
    customerApprovalStatus: 'pending' satisfies CustomerApprovalStatus,
    repairNote: '',
    qcNote: '',
    collectionNote: '',
    approvalStatus,
    commissionAmount: 0,
    commissionStatus: 'pending_documents',
    costProfile: data.costProfile,
    requiredDocuments: data.requiredDocuments,
    paymentConfirmed: data.paymentStatus === 'paid' || data.paymentStatus === 'confirmed',
    paymentStatus: 'unpaid',
    totalAmountDue: 0,
    totalPaid: 0,
    balanceDue: 0,
    discountAmount: 0,
    refundAmount: 0,
    lastPaymentAt: null,
    ...(isTechnicianCreated ? {} : { approvedBy: data.createdBy, approvedAt: serverTimestamp() }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  warnTechnicianAddJobDebug({
    checkpoint: 'addJob:audit:start',
    firestorePath: 'auditLogs/{autoId}',
    jobDocId: jobRef.id,
    jobNumber,
    action: 'create',
  });
  try {
    await writeAuditLog({
      entityType: 'job',
      entityId: jobRef.id,
      action: 'create',
      changedBy: data.createdBy,
      changedByDisplayName: data.createdByDisplayName || 'Unknown User',
      changes: [
        { field: 'jobSheetNo', before: null, after: jobNumber },
        { field: 'customerName', before: null, after: data.customerName },
        { field: 'technicianName', before: null, after: data.technicianName || 'Unknown User' },
        { field: 'status', before: null, after: status },
      ],
      note: isTechnicianCreated ? 'Job created by technician and pending review' : 'Job created',
    });
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:audit:success',
      firestorePath: 'auditLogs/{autoId}',
      jobDocId: jobRef.id,
      jobNumber,
      action: 'create',
    });
  } catch (error) {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:audit:failed',
      firestorePath: 'auditLogs/{autoId}',
      jobDocId: jobRef.id,
      jobNumber,
      action: 'create',
      ...getUnknownErrorDetails(error),
    });
    throw error;
  }

  await writeAuditLog({
    entityType: 'job',
    entityId: jobRef.id,
    action: 'job_number_generated',
    changedBy: data.createdBy,
    changedByDisplayName: data.createdByDisplayName || 'Unknown User',
    changes: [
      { field: 'jobNo', before: null, after: jobNumber },
      { field: 'jobNumberYear', before: null, after: year },
      { field: 'jobNumberRunningNumber', before: null, after: runningNumber },
    ],
    note: `Official RIGX job number generated: ${jobNumber}`,
  }).catch(() => undefined);

  await writeAuditLog({
    entityType: 'job',
    entityId: jobRef.id,
    action: 'job_tracking_code_generated',
    changedBy: data.createdBy,
    changedByDisplayName: data.createdByDisplayName || 'Unknown User',
    changes: [{ field: 'publicTrackingCode', before: null, after: 'generated' }],
    note: 'Public tracking code generated',
  }).catch(() => undefined);

  return {
    docId: jobRef.id,
    agnJobNumber: data.agnJobNumber || '',
    jobNo: jobNumber,
    jobNumber,
    jobSheetNo: jobNumber,
    customerName: data.customerName,
    customerId: data.customerId,
    customerNumber: data.customerNumber,
    device: data.device,
    deviceId: data.deviceId,
    deviceModel: data.deviceModel,
    customerPhone: data.customerPhone,
    normalizedPhone: data.normalizedPhone,
    technicianName: data.technicianName,
    totalSale: data.totalSale,
    paymentStatus: 'unpaid',
    totalAmountDue: 0,
    totalPaid: 0,
    balanceDue: 0,
    discountAmount: 0,
    refundAmount: 0,
    lastPaymentAt: null,
    technicianId: data.technicianId,
    status,
    lifecycleStatus: 'received',
    receivedAt: now,
    publicTrackingCode,
    publicTrackingCreatedAt: now,
    diagnosisSummaryPublic: '',
    repairSummaryPublic: '',
    estimatedCompletionAt: null,
    quotationStatus: 'draft',
    costProfile: data.costProfile,
    requiredDocuments: data.requiredDocuments,
    approvalStatus,
    commissionAmount: 0,
    commissionStatus: 'pending_documents',
  };
}

export async function updateJobStatus(params: UpdateJobStatusParams): Promise<void> {
  if (!params.job?.docId) throw new Error('Job ID is required for status update');
  if (!params.user?.uid) throw new Error('User identity is required for status update');
  // TODO RBAC MISMATCH:
  // Technicians may update assigned job lifecycle statuses, but the first RBAC permission list has no
  // dedicated "jobs.update.assigned" permission. Firestore rules still enforce assigned-job limits.
  if (!can(params.user.role, 'jobs.update') && !can(params.user.role, 'jobs.view.assigned')) {
    assertCan(params.user.role, 'jobs.update');
  }

  const currentStatus = normalizeJobStatus(params.job.status);
  const allowedNextStatuses = getAllowedNextStatuses(currentStatus, params.user.role);
  const nextStatus = params.nextStatus;

  if (!allowedNextStatuses.includes(nextStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${nextStatus}`);
  }

  if (params.user.role === 'technician' && params.job.technicianId !== params.user.uid) {
    throw new Error('Technician can update assigned jobs only');
  }

  if (nextStatus === 'in_repair' && params.job.quotationStatus !== 'approved') {
    throw new Error('Quotation must be approved before moving job into repair');
  }

  if (nextStatus === 'collected' && params.job.paymentStatus !== 'paid' && params.user.role === 'technician') {
    throw new Error('Job cannot be collected until payment is fully paid');
  }

  const note = normalizeText(params.note);
  const now = Timestamp.now();
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    statusHistory: arrayUnion({
      status: nextStatus,
      changedBy: params.user.uid,
      changedByDisplayName: params.user.displayName || params.user.name || 'Unknown User',
      changedAt: now,
      note,
    }),
    updatedAt: serverTimestamp(),
  };

  if (nextStatus === 'diagnosis') updatePayload.diagnosisNote = note;
  if (nextStatus === 'in_repair' || nextStatus === 'waiting_parts') updatePayload.repairNote = note;
  if (nextStatus === 'qc_check' || nextStatus === 'completed') updatePayload.qcNote = note;
  if (nextStatus === 'collected') updatePayload.collectionNote = note;
  if (nextStatus === 'customer_approved') updatePayload.customerApprovalStatus = 'approved';
  if (nextStatus === 'quotation_sent') updatePayload.quotationNote = note;

  await updateDoc(doc(db, 'jobs', params.job.docId), updatePayload);

  await writeAuditLog({
    entityType: 'job',
    entityId: params.job.docId,
    action: 'status_change',
    changedBy: params.user.uid,
    changedByDisplayName: displayNameForUser(params.user),
    changes: [{ field: 'status', before: currentStatus, after: nextStatus }],
    note: nextStatus === 'collected' && params.job.paymentStatus !== 'paid'
      ? `${note || 'Collected with payment override'} (payment override)`
      : note,
  });
}

export async function updateJobDetails(job: Job, input: UpdateJobDetailsInput, user: UserData): Promise<void> {
  assertCan(user.role, 'jobs.update');
  const quotationAmount = Number(input.quotationAmount || 0);
  if (!normalizeText(input.customerName)) throw new Error('Customer name is required');
  if (!normalizeText(input.deviceModel)) throw new Error('Device model is required');
  if (!Number.isFinite(quotationAmount) || quotationAmount < 0) throw new Error('Quotation amount must be valid');

  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'customerName', job.customerName || '', normalizeText(input.customerName));
  addChange(changes, 'customerId', job.customerId || null, input.customerId || null);
  addChange(changes, 'deviceId', job.deviceId || null, input.deviceId || null);
  addChange(changes, 'customerPhone', job.customerPhone || '', normalizeText(input.customerPhone));
  addChange(changes, 'deviceType', job.deviceType || '', normalizeText(input.deviceType));
  addChange(changes, 'deviceBrand', job.deviceBrand || '', normalizeText(input.deviceBrand));
  addChange(changes, 'deviceModel', job.deviceModel || job.device || '', normalizeText(input.deviceModel));
  addChange(changes, 'serialNumber', job.serialNumber || '', normalizeText(input.serialNumber));
  addChange(changes, 'issueDescription', job.issueDescription || '', normalizeText(input.issueDescription));
  addChange(changes, 'customerApprovalStatus', job.customerApprovalStatus || 'pending', input.customerApprovalStatus);
  const devicePasswordChanged = normalizeText(job.devicePassword || '') !== normalizeText(input.devicePassword || '');

  await updateDoc(doc(db, 'jobs', job.docId), {
    customerName: normalizeText(input.customerName),
    customerId: input.customerId || null,
    deviceId: input.deviceId || null,
    customerPhone: normalizeText(input.customerPhone),
    deviceType: normalizeText(input.deviceType),
    deviceBrand: normalizeText(input.deviceBrand),
    deviceModel: normalizeText(input.deviceModel),
    device: normalizeText(input.deviceModel),
    devicePassword: normalizeText(input.devicePassword || ''),
    serialNumber: normalizeText(input.serialNumber),
    issueDescription: normalizeText(input.issueDescription),
    customerApprovalStatus: input.customerApprovalStatus,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'job',
      entityId: job.docId,
      action: 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: changes.some((change) => change.field === 'customerId' || change.field === 'deviceId')
        ? 'Job linked to customer/device'
        : 'Job details and quotation updated',
    });
  }

  if (devicePasswordChanged) {
    await writeAuditLog({
      entityType: 'job',
      entityId: job.docId,
      action: 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [],
      note: 'Device password updated',
    });
  }
}

export async function updateJobPublicTrackingFields(
  job: Job,
  input: UpdateJobPublicTrackingInput,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'jobs.update');
  const estimatedCompletionAt = input.estimatedCompletionAt
    ? Timestamp.fromDate(new Date(`${input.estimatedCompletionAt}T00:00:00+08:00`))
    : null;
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'diagnosisSummaryPublic', job.diagnosisSummaryPublic || '', normalizeText(input.diagnosisSummaryPublic));
  addChange(changes, 'repairSummaryPublic', job.repairSummaryPublic || '', normalizeText(input.repairSummaryPublic));
  addChange(changes, 'estimatedCompletionAt', job.estimatedCompletionAt || null, estimatedCompletionAt);

  await updateDoc(doc(db, 'jobs', job.docId), {
    diagnosisSummaryPublic: normalizeText(input.diagnosisSummaryPublic),
    repairSummaryPublic: normalizeText(input.repairSummaryPublic),
    estimatedCompletionAt,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'job',
      entityId: job.docId,
      action: 'job_public_update_changed',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: 'Customer-facing repair tracking fields updated',
    });
  }
}

export async function ensureJobTrackingCode(job: Job, user: UserData): Promise<string> {
  assertCan(user.role, 'jobs.sendTrackingLink');
  if (user.role === 'manager' && job.branchId !== user.branchId) {
    throw new Error('You can only send tracking links for jobs in your branch');
  }
  if (user.role === 'technician' && job.technicianId !== user.uid) {
    throw new Error('You can only send tracking links for jobs assigned to you');
  }
  if (job.publicTrackingCode) return job.publicTrackingCode;
  const publicTrackingCode = generateTrackingCode();
  await updateDoc(doc(db, 'jobs', job.docId), {
    publicTrackingCode,
    publicTrackingCreatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'job_tracking_code_generated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicTrackingCode', before: null, after: 'generated' }],
    note: 'Public tracking code generated',
  }).catch(() => undefined);
  return publicTrackingCode;
}

export async function logJobTrackingMessageSent(job: Job, user: UserData): Promise<void> {
  assertCan(user.role, 'jobs.sendTrackingLink');
  if (user.role === 'manager' && job.branchId !== user.branchId) {
    throw new Error('You can only log tracking messages for jobs in your branch');
  }
  if (user.role === 'technician' && job.technicianId !== user.uid) {
    throw new Error('You can only log tracking messages for jobs assigned to you');
  }
  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'job_tracking_message_sent',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [],
    note: 'Repair tracking message prepared',
  }).catch(() => undefined);
}

async function uploadQuotationProof(jobId: string, file?: File | null): Promise<string | null> {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
    throw new Error('Only JPG, PNG, or PDF proof files are allowed');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Proof file must be 10MB or smaller');
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadSnapshot = await uploadBytes(ref(storage, `job-documents/${jobId}/quotation/${Date.now()}_${safeName}`), file, {
    contentType: file.type,
  });
  return getDownloadURL(uploadSnapshot.ref);
}

export async function updateQuotation(params: UpdateQuotationParams): Promise<void> {
  assertCan(params.user.role, 'jobs.approve');

  const currentStatus = params.job.quotationStatus || 'draft';
  const nextStatus = params.nextStatus;
  const currentAmount = Number(params.job.quotationAmount || 0);
  const nextAmount = Number(params.quotationAmount ?? currentAmount);
  const nextNote = normalizeText(params.quotationNote ?? params.job.quotationNote ?? '');

  if (!Number.isFinite(nextAmount) || nextAmount < 0) throw new Error('Quotation amount must be valid');
  if ((nextStatus === 'sent' || nextStatus === 'approved') && nextAmount <= 0) {
    throw new Error('Quotation amount is required');
  }
  if (nextStatus === 'rejected' && !normalizeText(params.rejectedReason || '')) {
    throw new Error('Rejection reason is required');
  }
  if (currentStatus === 'approved' && nextStatus !== 'approved') {
    throw new Error('Approved quotation is locked');
  }
  if (currentStatus === 'sent' && nextStatus === 'sent' && (nextAmount !== currentAmount || nextNote !== (params.job.quotationNote || ''))) {
    throw new Error('Sent quotation amount and note are locked');
  }

  const proofUrl = await uploadQuotationProof(params.job.docId, params.proofFile);
  const updatePayload: Record<string, unknown> = {
    quotationStatus: nextStatus,
    updatedAt: serverTimestamp(),
  };

  if (currentStatus === 'draft' || currentStatus === 'rejected') {
    updatePayload.quotationAmount = nextAmount;
    updatePayload.quotationNote = nextNote;
  }

  if (proofUrl) updatePayload.quotationProofUrl = proofUrl;

  if (nextStatus === 'sent') {
    updatePayload.quotationSentAt = serverTimestamp();
    updatePayload.quotationRejectedAt = null;
    updatePayload.quotationRejectedReason = null;
  }

  if (nextStatus === 'approved') {
    const now = Timestamp.now();
    updatePayload.quotationApprovedAt = serverTimestamp();
    updatePayload.quotationApprovedBy = params.user.uid;
    updatePayload.quotationApprovedByDisplayName = displayNameForUser(params.user);
    updatePayload.customerApprovalStatus = 'approved';
    updatePayload.status = 'customer_approved';
    updatePayload.statusHistory = arrayUnion({
      status: 'customer_approved',
      changedBy: params.user.uid,
      changedByDisplayName: displayNameForUser(params.user),
      changedAt: now,
      note: 'Quotation approved by customer',
    });
  }

  if (nextStatus === 'rejected') {
    updatePayload.quotationRejectedAt = serverTimestamp();
    updatePayload.quotationRejectedReason = normalizeText(params.rejectedReason || '');
    updatePayload.customerApprovalStatus = 'rejected';
  }

  await updateDoc(doc(db, 'jobs', params.job.docId), updatePayload);

  const action =
    nextStatus === 'sent'
      ? 'quotation_sent'
      : nextStatus === 'approved'
        ? 'quotation_approved'
        : nextStatus === 'rejected'
          ? 'quotation_rejected'
          : 'quotation_updated';

  await writeAuditLog({
    entityType: 'job',
    entityId: params.job.docId,
    action,
    changedBy: params.user.uid,
    changedByDisplayName: displayNameForUser(params.user),
    changes: [
      { field: 'quotationStatus', before: currentStatus, after: nextStatus },
      { field: 'quotationAmount', before: currentAmount, after: nextAmount },
      { field: 'quotationNote', before: params.job.quotationNote || '', after: nextNote },
      ...(proofUrl ? [{ field: 'quotationProofUrl', before: params.job.quotationProofUrl || null, after: proofUrl }] : []),
    ],
    note:
      nextStatus === 'sent'
        ? 'Quotation sent'
        : nextStatus === 'approved'
          ? 'Quotation approved'
          : nextStatus === 'rejected'
            ? normalizeText(params.rejectedReason || '')
            : 'Quotation updated',
  });
}

export async function updateJobAssignment(params: UpdateJobAssignmentParams): Promise<void> {
  assertCan(params.user.role, 'jobs.assign');

  const technicianId = normalizeText(params.technicianId);
  const technicianName = normalizeText(params.technicianName) || 'Unknown User';
  if (!technicianId) throw new Error('Technician is required');

  await updateDoc(doc(db, 'jobs', params.job.docId), {
    technicianId,
    technicianName,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'job',
    entityId: params.job.docId,
    action: 'update',
    changedBy: params.user.uid,
    changedByDisplayName: displayNameForUser(params.user),
    changes: [
      {
        field: 'technicianName',
        before: params.job.technicianName || 'Unknown User',
        after: technicianName,
      },
    ],
    note: 'Technician reassigned',
  });
}

export async function updateJobCostRequirements(params: {
  jobId: string;
  costProfile: JobCostProfile;
  requiredDocuments: JobDocumentType[];
  role: Role;
}): Promise<void> {
  assertCan(params.role, 'jobs.manageWarranty');
  const costProfile = normalizeCostProfile(params.costProfile, 'admin');

  await updateDoc(doc(db, 'jobs', params.jobId), {
    costProfile,
    requiredDocuments: normalizeRequiredDocuments(costProfile, params.requiredDocuments),
    updatedAt: serverTimestamp(),
  });
}

export async function updateJobApprovalStatus(
  job: Job,
  status: 'approved' | 'rejected',
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'jobs.approve');
  const jobRef = doc(db, 'jobs', job.docId);
  const jobSnapshot = await getDoc(jobRef);
  const currentStatus = jobSnapshot.exists() ? String(jobSnapshot.data().status || job.status) : job.status;
  const currentApprovalStatus = jobSnapshot.exists()
    ? String(jobSnapshot.data().approvalStatus || job.approvalStatus)
    : job.approvalStatus;

  await updateDoc(jobRef, {
    status,
    approvalStatus: status,
    approvedBy: status === 'approved' ? user.uid : '',
    approvedAt: status === 'approved' ? serverTimestamp() : null,
    rejectedBy: status === 'rejected' ? user.uid : '',
    rejectedAt: status === 'rejected' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'status_change',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'status', before: currentStatus, after: status },
      { field: 'approvalStatus', before: currentApprovalStatus, after: status },
    ],
    note: status === 'approved' ? 'Job approved' : 'Job rejected',
  });
}

export async function ensureJobSheetConsentToken(job: Job, user: UserData): Promise<string> {
  const canSend = can(user.role, 'jobs.update') || job.technicianId === user.uid;
  if (!canSend) throw new Error('You do not have permission to send this Job Sheet');
  if (job.jobSheetConsentToken) return job.jobSheetConsentToken;
  const token = generateSecureToken();
  await updateDoc(doc(db, 'jobs', job.docId), {
    jobSheetConsentToken: token,
    jobSheetConsentTokenCreatedAt: serverTimestamp(),
    jobSheetConsentStatus: job.jobSheetConsentStatus || 'pending',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'job_sheet_consent_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'jobSheetConsentToken', before: null, after: 'created' }],
    note: 'Repair Job Sheet consent link created',
  });
  return token;
}

export async function recordManualJobSheetConsent(job: Job, user: UserData, input: ManualJobSheetConsentInput): Promise<void> {
  assertCan(user.role, 'jobs.update');
  const consentMethod = normalizeText(input.consentMethod);
  const signerName = normalizeText(input.signerName);
  const phone = normalizeText(input.phone);
  if (!consentMethod) throw new Error('Consent method is required');
  if (!signerName) throw new Error('Customer / Representative Name is required');
  if (!phone) throw new Error('Phone Number is required');

  await updateDoc(doc(db, 'jobs', job.docId), {
    jobSheetConsentStatus: 'signed',
    jobSheetSignedAt: serverTimestamp(),
    jobSheetSignedBy: user.uid,
    jobSheetConsentMethod: consentMethod,
    jobSheetManualConsent: true,
    jobSheetManualConsentName: signerName,
    jobSheetManualConsentPhone: phone,
    jobSheetManualConsentNotes: normalizeText(input.notes || ''),
    jobSheetTermsAccepted: true,
    consentCompleted: true,
    jobSheetSigner: {
      name: signerName,
      icOrPassportNo: normalizeText(input.icOrPassportNo || ''),
      phone,
      signedDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()),
    },
    jobSheetConsentChecklist: {
      inspectionDiagnosisAuthorised: true,
      dataLossAcknowledged: true,
      preExistingFaultAcknowledged: true,
      electronicApprovalAccepted: true,
      termsAccepted: true,
    },
    jobSheetConsentSnapshot: {
      ...jobSheetConsentSnapshot(job),
      signedAt: new Date().toISOString(),
    },
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'notifications'), {
    title: 'Job Sheet manually recorded',
    message: `${displayNameForUser(user)} manually recorded Job Sheet consent for job ${getDisplayJobNumber(job)}. Method: ${consentMethod}.`,
    type: 'job_sheet_manually_recorded',
    branchId: job.branchId || '',
    targetRoles: ['admin', 'manager'],
    targetUserIds: job.technicianId ? [job.technicianId] : [],
    metadata: {
      jobId: job.docId,
      customerId: job.customerId || '',
      technicianId: job.technicianId || '',
      branch: job.branchId || '',
      deviceModel: jobDeviceInfo(job),
      consentMethod,
    },
    relatedEntityType: 'job',
    relatedEntityId: job.docId,
    readBy: [],
    createdAt: serverTimestamp(),
  }).catch(() => undefined);

  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'job_sheet_manual_consent_recorded',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'jobSheetConsentStatus', before: job.jobSheetConsentStatus || 'pending', after: 'signed' }],
    note: `Manual Job Sheet consent recorded via ${consentMethod}`,
  });
}

export async function deleteJob(job: Job, user: UserData): Promise<void> {
  assertCan(user.role, 'jobs.delete');

  await deleteDoc(doc(db, 'jobs', job.docId));

  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'delete',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'jobSheetNo', before: getDisplayJobNumber(job) || null, after: null },
      { field: 'customerName', before: job.customerName || null, after: null },
      { field: 'status', before: job.status || null, after: null },
    ],
    note: 'Job deleted',
  });
}
