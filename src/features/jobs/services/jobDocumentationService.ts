import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/init';
import { calculateTechnicianCommission } from '@/features/commissions/commissionCalculator';
import { DEFAULT_COMMISSION_BASIS, DEFAULT_COMMISSION_RATE } from '@/features/commissions/constants';
import type { Job } from '@/types';
import type { UserData } from '@/types';
import { getJobDocumentExtractions } from './jobDocumentExtractionService';
import type {
  JobDocument,
  JobDocumentExtraction,
  JobDocumentStatus,
  JobDocumentType,
  JobFinancialPreview,
  JobFinancialSnapshot,
  JobLike,
} from '../types';

const defaultPartsRequiredDocumentTypes: JobDocumentType[] = ['supplier_receipt', 'logistic_receipt'];

interface UploadJobDocumentParams {
  job: JobLike;
  file: File;
  type: JobDocumentType;
  user: UserData;
  amount?: number;
}

interface ReviewJobDocumentParams {
  documentId: string;
  status: Extract<JobDocumentStatus, 'approved' | 'rejected'>;
  reviewedBy: string;
  rejectionReason?: string;
}

interface RemoveJobDocumentParams {
  documentId: string;
  jobId: string;
  removedBy: string;
  reason: string;
}

function mapDocument(documentId: string, data: Record<string, unknown>): JobDocument {
  return {
    ...(data as Omit<JobDocument, 'documentId'>),
    documentId,
  };
}

function getJobRevenue(job: JobLike): number {
  return Number(job.totalSale ?? job.totalAmount ?? job.amount ?? 0);
}

function getJobAmountCollected(job: JobLike): number {
  const values = job as JobLike & {
    totalPaid?: number;
    amountPaid?: number;
    paidAmount?: number;
    collectedAmount?: number;
  };
  return Number(values.totalPaid ?? values.amountPaid ?? values.paidAmount ?? values.collectedAmount ?? getJobRevenue(job) ?? 0);
}

function getTimestampMonth(timestamp?: { toDate?: () => Date }): string {
  const date = timestamp?.toDate?.();
  if (!date) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function getJobMonth(job: JobLike): string {
  return (
    job.month ||
    getTimestampMonth(job.completedAt) ||
    getTimestampMonth(job.paidAt) ||
    getTimestampMonth(job.updatedAt) ||
    getTimestampMonth(job.createdAt) ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date())
  );
}

function isJobApproved(job: JobLike): boolean {
  const status = String(job.status || '').toLowerCase();
  return (
    String(job.approvalStatus || '').toLowerCase() === 'approved' &&
    ['approved', 'completed', 'ready_for_collection', 'collected'].includes(status)
  );
}

function isPaymentConfirmed(job: JobLike): boolean {
  const paymentStatus = String(job.paymentStatus || job.paidStatus || job.customerPaymentStatus || '').toLowerCase();
  return (
    job.paymentConfirmed === true ||
    job.isPaid === true ||
    paymentStatus === 'paid' ||
    paymentStatus === 'confirmed' ||
    paymentStatus === 'payment_confirmed'
  );
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function extractedAmount(extraction: JobDocumentExtraction): number {
  return Number(extraction.extractedData.amount || 0);
}

function extractedLogisticCost(extraction: JobDocumentExtraction): number {
  return Number(extraction.extractedData.logisticCost ?? extraction.extractedData.amount ?? 0);
}

async function getPartsOrderCost(jobId: string): Promise<{ total: number; sources: string[] }> {
  const snapshot = await getDocs(query(collection(db, 'partsOrders'), where('jobId', '==', jobId)));
  let total = 0;
  const sources: string[] = [];

  snapshot.docs.forEach((orderDoc) => {
    const data = orderDoc.data();
    const status = String(data.status || '');
    if (status === 'cancelled') return;
    total += Number(data.costPrice || 0);
    sources.push(orderDoc.id);
  });

  return { total: roundMoney(total), sources };
}

async function getOutsourceCost(jobId: string): Promise<{ total: number; sources: string[] }> {
  const snapshot = await getDocs(query(collection(db, 'partnerJobs'), where('sourceJobId', '==', jobId)));
  let total = 0;
  const sources: string[] = [];

  snapshot.docs.forEach((partnerDoc) => {
    const data = partnerDoc.data() as { status?: string; outsourceCost?: number; costPrice?: number; cost?: number };
    if (data.status === 'cancelled') return;
    const cost = Number(data.outsourceCost ?? data.costPrice ?? data.cost ?? 0);
    if (cost <= 0) return;
    total += cost;
    sources.push(partnerDoc.id);
  });

  return { total: roundMoney(total), sources };
}

function amountsMatch(left: number, right: number): boolean {
  return Math.abs(roundMoney(left) - roundMoney(right)) < 0.01;
}

function getApprovedDocuments(documents: JobDocument[]): JobDocument[] {
  return documents.filter((document) => document.status === 'approved');
}

async function getJob(jobId: string): Promise<JobLike> {
  const snapshot = await getDoc(doc(db, 'jobs', jobId));
  if (!snapshot.exists()) throw new Error('Job not found');
  return {
    docId: snapshot.id,
    ...(snapshot.data() as Omit<Job, 'docId'>),
  };
}

export async function getJobDocuments(jobId: string, includeRemoved = false): Promise<JobDocument[]> {
  const operationName = 'getJobDocuments';
  console.log('[DEBUG READ]', operationName, 'documents', {
    filters: [['jobId', '==', jobId]],
    jobId,
    includeRemoved,
  });

  try {
    const snapshot = await getDocs(query(collection(db, 'documents'), where('jobId', '==', jobId)));
    return snapshot.docs
      .map((documentSnapshot) => mapDocument(documentSnapshot.id, documentSnapshot.data()))
      .filter((document) => includeRemoved || document.status !== 'removed')
      .sort((left, right) => (right.uploadedAt?.toMillis?.() || 0) - (left.uploadedAt?.toMillis?.() || 0));
  } catch (error) {
    console.error('[PERMISSION ERROR]', operationName, error);
    throw error;
  }
}

export async function getJobFinancial(jobId: string): Promise<JobFinancialSnapshot | null> {
  const operationName = 'getJobFinancial';
  console.log('[DEBUG READ]', operationName, `job_financials/${jobId}`, { jobId });

  try {
    const snapshot = await getDoc(doc(db, 'job_financials', jobId));
    if (!snapshot.exists()) return null;
    return snapshot.data() as JobFinancialSnapshot;
  } catch (error) {
    console.error('[PERMISSION ERROR]', operationName, error);
    throw error;
  }
}

function hasApprovedType(documents: JobDocument[], type: JobDocumentType): boolean {
  return documents.some((document) => document.type === type && document.status === 'approved');
}

function isBeforeRepairChecklistCompleted(data: Record<string, unknown>): boolean {
  const status = String(data.checklistStatus || '');
  return (!data.checklistType || data.checklistType === 'pre_repair')
    && [
      'staff_completed',
      'completed_by_staff',
      'sent_to_customer',
      'customer_signed',
      'signature_overridden',
      'final_checked',
      'completed',
    ].includes(status);
}

function isAfterRepairChecklistCompleted(data: Record<string, unknown>): boolean {
  return data.checklistType === 'after_repair'
    && data.checklistStatus === 'completed'
    && Boolean(data.completedAt);
}

async function getSystemSatisfiedRequiredDocumentTypes(job: JobLike): Promise<Set<JobDocumentType>> {
  const satisfied = new Set<JobDocumentType>();
  if (!job.docId) return satisfied;
  const required = getRequiredDocumentTypes(job);

  await Promise.all([
    required.includes('checklist')
      ? getDocs(query(collection(db, 'deviceChecklists'), where('jobId', '==', job.docId)))
          .then((snapshot) => {
            const rows = snapshot.docs.map((row) => row.data());
            if (rows.some(isBeforeRepairChecklistCompleted) && rows.some(isAfterRepairChecklistCompleted)) {
              satisfied.add('checklist');
            }
          })
      : Promise.resolve(),
    required.includes('invoice')
      ? getDocs(query(collection(db, 'invoices'), where('jobId', '==', job.docId)))
          .then((snapshot) => {
            const paidInvoice = snapshot.docs.some((row) => {
              const data = row.data();
              return data.paymentStatus === 'paid'
                || (Number(data.balance || 0) <= 0 && Number(data.amountPaid || 0) > 0);
            });
            if (paidInvoice) satisfied.add('invoice');
          })
      : Promise.resolve(),
  ]);

  return satisfied;
}

export function getRequiredDocumentTypes(job?: JobLike | null): JobDocumentType[] {
  const costProfile = job?.costProfile || 'parts_required';
  const customRequiredDocuments = Array.isArray(job?.requiredDocuments)
    ? job.requiredDocuments.filter((type): type is JobDocumentType =>
        ['checklist', 'supplier_receipt', 'logistic_receipt', 'invoice', 'payment_receipt', 'photo'].includes(type),
      )
    : [];

  if (costProfile === 'parts_required') {
    return customRequiredDocuments.filter((type) =>
      defaultPartsRequiredDocumentTypes.includes(type),
    );
  }

  if (costProfile === 'service_only') {
    return ['checklist', 'invoice'];
  }

  if (costProfile === 'custom') {
    return customRequiredDocuments.length > 0 ? customRequiredDocuments : ['checklist', 'invoice'];
  }

  return defaultPartsRequiredDocumentTypes;
}

export function getMissingRequiredDocumentTypes(documents: JobDocument[], job?: JobLike | null): JobDocumentType[] {
  const requiredDocumentTypes = getRequiredDocumentTypes(job);

  return requiredDocumentTypes.filter((type) => {
    return !hasApprovedType(documents, type);
  });
}

async function getMissingRequiredDocumentTypesWithSystem(documents: JobDocument[], job: JobLike): Promise<JobDocumentType[]> {
  const systemSatisfied = await getSystemSatisfiedRequiredDocumentTypes(job);
  return getMissingRequiredDocumentTypes(documents, job).filter((type) => !systemSatisfied.has(type));
}

async function approvedRequiredDocumentsExist(documents: JobDocument[], job: JobLike): Promise<boolean> {
  return (await getMissingRequiredDocumentTypesWithSystem(documents, job)).length === 0;
}

export async function buildJobFinancialPreview(jobId: string): Promise<JobFinancialPreview> {
  const [job, documents, extractions, partsOrderCost, outsourceCostResult] = await Promise.all([
    getJob(jobId),
    getJobDocuments(jobId),
    getJobDocumentExtractions(jobId),
    getPartsOrderCost(jobId),
    getOutsourceCost(jobId),
  ]);
  const missingRequiredDocuments = await getMissingRequiredDocumentTypesWithSystem(documents, job);

  if (!isJobApproved(job)) {
    throw new Error('Job must be approved before financial preview or finalization');
  }

  if (missingRequiredDocuments.length > 0) {
    throw new Error(`Required documents are not approved: ${missingRequiredDocuments.join(', ')}`);
  }

  const approvedDocuments = getApprovedDocuments(documents);
  const approvedDocumentIds = new Set(approvedDocuments.map((document) => document.documentId));
  const verifiedExtractions = extractions.filter(
    (extraction) => extraction.verified && extraction.status === 'verified' && approvedDocumentIds.has(extraction.documentId),
  );
  const amountCollected = roundMoney(getJobAmountCollected(job));
  const revenue = amountCollected;
  const warnings: string[] = [];

  const isServiceOnly = job.costProfile === 'service_only';
  const supplierExtractions = isServiceOnly
    ? []
    : verifiedExtractions.filter((extraction) => extraction.documentType === 'supplier_receipt');
  const logisticExtractions = isServiceOnly
    ? []
    : verifiedExtractions.filter((extraction) => extraction.documentType === 'logistic_receipt');
  const revenueValidationExtractions = job.costProfile === 'parts_required'
    ? []
    : verifiedExtractions.filter((extraction) =>
        extraction.documentType === 'invoice' || extraction.documentType === 'payment_receipt',
      );

  const extractedPartsCost = roundMoney(
    supplierExtractions.reduce((total, extraction) => total + extractedAmount(extraction), 0),
  );
  const partsCost = roundMoney(Math.max(extractedPartsCost, partsOrderCost.total));
  const logisticCost = roundMoney(
    logisticExtractions.reduce((total, extraction) => total + extractedLogisticCost(extraction), 0),
  );
  const outsourceCost = outsourceCostResult.total;
  const otherDirectCost = logisticCost;
  const commissionSnapshot = calculateTechnicianCommission({
    amountCollected,
    partsCost,
    outsourceCost,
    otherDirectCost,
    commissionRate: DEFAULT_COMMISSION_RATE,
  });
  const totalCost = commissionSnapshot.totalDirectCost;
  const grossProfit = commissionSnapshot.netProfit;
  const commission = commissionSnapshot.commissionAmount;
  const netProfit = commissionSnapshot.netProfit;

  revenueValidationExtractions.forEach((extraction) => {
    const validationAmount = extractedAmount(extraction);
    if (validationAmount > 0 && !amountsMatch(validationAmount, revenue)) {
      warnings.push(
        `${extraction.documentType} ${extraction.documentId} amount ${validationAmount.toFixed(2)} does not match job total ${revenue.toFixed(2)}`,
      );
    }
  });

  if (isServiceOnly) {
    warnings.push('Service-only job: parts/logistic receipt not required');
  } else if (getRequiredDocumentTypes(job).includes('supplier_receipt') && supplierExtractions.length === 0 && partsOrderCost.sources.length === 0) {
    warnings.push('No verified supplier receipt extraction or linked parts order cost found; parts cost is 0.00');
  }

  if (supplierExtractions.length > 0 && partsOrderCost.sources.length > 0 && extractedPartsCost !== partsOrderCost.total) {
    warnings.push('Parts cost has both supplier receipt and parts order sources; using the higher amount to avoid under-counting.');
  }

  if (outsourceCostResult.sources.length === 0) {
    warnings.push('No linked outsource cost found; outsource cost is 0.00');
  }

  if (job.costProfile !== 'parts_required' && revenueValidationExtractions.length === 0) {
    warnings.push('No verified invoice or payment receipt extraction found for revenue validation');
  }

  return {
    jobId,
    revenue,
    amountCollected,
    partsCost,
    outsourceCost,
    logisticCost,
    otherDirectCost,
    totalCost,
    grossProfit,
    commission,
    commissionBasis: DEFAULT_COMMISSION_BASIS,
    commissionRate: DEFAULT_COMMISSION_RATE,
    netProfit,
    commissionSnapshot: {
      ...commissionSnapshot,
      status: 'draft',
    },
    partsCostSources: supplierExtractions.map((extraction) => extraction.documentId),
    partsOrderCostSources: partsOrderCost.sources,
    logisticCostSources: logisticExtractions.map((extraction) => extraction.documentId),
    outsourceCostSources: outsourceCostResult.sources,
    revenueValidationSources: revenueValidationExtractions.map((extraction) => extraction.documentId),
    warnings,
    locked: false,
    requiresOverride: warnings.length > 0,
  };
}

export async function uploadJobDocument(params: UploadJobDocumentParams): Promise<{ documentId: string }> {
  try {
    if (!params.job.docId) throw new Error('Job is required');
    if (!params.file) throw new Error('File is required');
    const isAssignedTechnician = params.user.role === 'technician' && params.job.technicianId === params.user.uid;
    const isAdmin = params.user.role === 'admin';
    const isBranchManager = params.user.role === 'manager' && (!params.user.branchId || params.job.branchId === params.user.branchId);
    if (!isAdmin && !isBranchManager && !isAssignedTechnician) {
      throw new Error('You do not have permission to upload documents for this job');
    }

    console.log('Uploading job document to Firebase Storage', {
      jobId: params.job.docId,
      type: params.type,
      fileName: params.file.name,
      fileType: params.file.type,
      fileSize: params.file.size,
    });

    const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const branchId = String(params.job.branchId || params.user.branchId || 'unknown');
    const jobWithCustomer = params.job as JobLike & { customerId?: string | null };
    const jobNumber = String(params.job.jobNo || params.job.jobNumber || params.job.jobSheetNo || '');
    const filePath = `job-documents/${branchId}/${params.job.docId}/${params.type}/${Date.now()}_${safeName}`;
    const uploadSnapshot = await uploadBytes(ref(storage, filePath), params.file, {
      contentType: params.file.type,
    });
    const fileUrl = await getDownloadURL(uploadSnapshot.ref);
    const documentRef = await addDoc(collection(db, 'documents'), {
      jobId: params.job.docId,
      jobNumber,
      branchId,
      customerId: jobWithCustomer.customerId || '',
      type: params.type,
      fileUrl,
      storagePath: filePath,
      fileName: params.file.name,
      amount: Number(params.amount || 0),
      uploadedBy: params.user.uid,
      uploadedAt: serverTimestamp(),
      status: 'pending',
    });

    console.log('Job document metadata created', {
      documentId: documentRef.id,
      jobId: params.job.docId,
    });

    return { documentId: documentRef.id };
  } catch (error) {
    console.error('Job document upload failed', error);
    throw error;
  }
}

export async function reviewJobDocument(params: ReviewJobDocumentParams): Promise<void> {
  await updateDoc(doc(db, 'documents', params.documentId), {
    status: params.status,
    reviewedBy: params.reviewedBy,
    reviewedAt: serverTimestamp(),
    rejectionReason: params.status === 'rejected' ? params.rejectionReason?.trim() || '' : '',
  });
}

export async function removeJobDocument(params: RemoveJobDocumentParams): Promise<void> {
  const reason = params.reason.trim();

  if (!reason) throw new Error('Removal reason is required');

  await runTransaction(db, async (transaction) => {
    const documentRef = doc(db, 'documents', params.documentId);
    const auditRef = doc(collection(db, 'audit_logs'));
    const documentSnapshot = await transaction.get(documentRef);

    if (!documentSnapshot.exists()) {
      throw new Error('Document not found');
    }

    transaction.update(documentRef, {
      status: 'removed',
      removedBy: params.removedBy,
      removedAt: serverTimestamp(),
      removeReason: reason,
      updatedAt: serverTimestamp(),
    });

    transaction.set(auditRef, {
      actorId: params.removedBy,
      action: 'job_document.removed',
      targetCollection: 'documents',
      targetId: params.documentId,
      userId: params.removedBy,
      documentId: params.documentId,
      jobId: params.jobId,
      removedBy: params.removedBy,
      removedAt: serverTimestamp(),
      reason,
      generatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  });
}

export async function finalizeJobFinancials(
  jobId: string,
  finalizedBy: string,
  allowRevenueMismatchOverride = false,
): Promise<JobFinancialSnapshot> {
  const preview = await buildJobFinancialPreview(jobId);

  if (preview.requiresOverride && !allowRevenueMismatchOverride) {
    throw new Error('Financial snapshot has warnings. Confirm override before finalizing.');
  }

  const snapshot: JobFinancialSnapshot = {
    jobId: preview.jobId,
    revenue: preview.revenue,
    amountCollected: preview.amountCollected,
    partsCost: preview.partsCost,
    outsourceCost: preview.outsourceCost,
    logisticCost: preview.logisticCost,
    otherDirectCost: preview.otherDirectCost,
    totalCost: preview.totalCost,
    grossProfit: preview.grossProfit,
    commission: preview.commission,
    commissionBasis: DEFAULT_COMMISSION_BASIS,
    commissionRate: DEFAULT_COMMISSION_RATE,
    netProfit: preview.netProfit,
    commissionSnapshot: {
      ...(preview.commissionSnapshot || calculateTechnicianCommission({
        amountCollected: preview.amountCollected || preview.revenue,
        partsCost: preview.partsCost,
        outsourceCost: preview.outsourceCost || 0,
        otherDirectCost: preview.otherDirectCost ?? preview.logisticCost,
        commissionRate: DEFAULT_COMMISSION_RATE,
      })),
      status: 'pending',
      calculatedAt: serverTimestamp() as never,
      approvedAt: null,
      approvedBy: null,
    },
    partsCostSources: preview.partsCostSources,
    partsOrderCostSources: preview.partsOrderCostSources,
    logisticCostSources: preview.logisticCostSources,
    outsourceCostSources: preview.outsourceCostSources,
    revenueValidationSources: preview.revenueValidationSources,
    warnings: preview.warnings,
    locked: true,
    finalizedBy,
  };

  await setDoc(
    doc(db, 'job_financials', jobId),
    {
      ...snapshot,
      finalizedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return snapshot;
}

export async function approveCommissionForJob(jobId: string, approvedBy: string): Promise<void> {
  const [job, documents, financial] = await Promise.all([getJob(jobId), getJobDocuments(jobId), getJobFinancial(jobId)]);

  if (!isJobApproved(job)) throw new Error('Job must be approved before commission approval');
  if (!isPaymentConfirmed(job)) throw new Error('Customer payment must be confirmed before commission approval');
  if (!(await approvedRequiredDocumentsExist(documents, job))) throw new Error('Required job documents must be approved');
  if (!financial?.locked) throw new Error('Job financial snapshot must be locked before commission approval');
  if (!job.technicianId) throw new Error('Job technician is missing');

  const month = getJobMonth(job);
  const commissionRate = Number(financial.commissionRate || DEFAULT_COMMISSION_RATE);
  const amountCollected = Number(financial.amountCollected ?? financial.revenue ?? getJobAmountCollected(job));
  const commissionSnapshot = calculateTechnicianCommission({
    amountCollected,
    partsCost: Number(financial.partsCost || 0),
    outsourceCost: Number(financial.outsourceCost || 0),
    otherDirectCost: Number(financial.otherDirectCost ?? financial.logisticCost ?? 0),
    commissionRate,
  });
  const commissionAmount = roundMoney(financial.commission || commissionSnapshot.commissionAmount);

  await runTransaction(db, async (transaction) => {
    transaction.set(
      doc(db, 'commissions', jobId),
      {
        commissionId: jobId,
        technicianId: job.technicianId,
        jobId,
        month,
        jobTotal: financial.revenue,
        commissionBasis: DEFAULT_COMMISSION_BASIS,
        rate: commissionRate,
        amount: commissionAmount,
        amountCollected,
        partsCost: Number(financial.partsCost || 0),
        outsourceCost: Number(financial.outsourceCost || 0),
        otherDirectCost: Number(financial.otherDirectCost ?? financial.logisticCost ?? 0),
        totalDirectCost: Number(financial.totalCost || commissionSnapshot.totalDirectCost),
        netProfit: Number(financial.netProfit || commissionSnapshot.netProfit),
        calculatedAt: serverTimestamp(),
        commissionSnapshot: {
          ...commissionSnapshot,
          commissionAmount,
          status: 'approved',
          calculatedAt: serverTimestamp(),
          approvedAt: serverTimestamp(),
          approvedBy,
        },
        eligibilityStatus: 'eligible',
        status: 'approved',
        approvedBy,
        approvedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.update(doc(db, 'jobs', jobId), {
      commissionAmount,
      commissionStatus: 'approved',
      updatedAt: serverTimestamp(),
    });
  });
}
