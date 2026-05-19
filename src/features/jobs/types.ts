import type { Timestamp } from 'firebase/firestore';
import type { Role, UserData } from '@/types';

export type JobStatus =
  | 'received'
  | 'diagnosis'
  | 'quotation_pending'
  | 'quotation_sent'
  | 'customer_approved'
  | 'in_repair'
  | 'waiting_parts'
  | 'qc_check'
  | 'completed'
  | 'ready_for_collection'
  | 'collected'
  | 'cancelled';

export type CustomerApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface StatusHistoryItem {
  status: JobStatus;
  changedBy: string;
  changedByDisplayName: string;
  changedAt: Timestamp;
  note: string;
}

export const jobLifecycleStatuses: JobStatus[] = [
  'received',
  'diagnosis',
  'quotation_pending',
  'quotation_sent',
  'customer_approved',
  'in_repair',
  'waiting_parts',
  'qc_check',
  'completed',
  'ready_for_collection',
  'collected',
  'cancelled',
];

const technicianTransitions: Partial<Record<JobStatus, JobStatus[]>> = {
  received: ['diagnosis'],
  diagnosis: ['quotation_pending'],
  customer_approved: ['in_repair'],
  in_repair: ['qc_check'],
  waiting_parts: ['in_repair'],
  qc_check: ['completed'],
};

const adminManagerTransitions: Partial<Record<JobStatus, JobStatus[]>> = {
  received: ['diagnosis', 'cancelled'],
  diagnosis: ['quotation_pending', 'cancelled'],
  quotation_pending: ['quotation_sent', 'cancelled'],
  quotation_sent: ['customer_approved', 'cancelled'],
  customer_approved: ['in_repair', 'waiting_parts', 'cancelled'],
  in_repair: ['waiting_parts', 'qc_check', 'cancelled'],
  waiting_parts: ['in_repair', 'cancelled'],
  qc_check: ['completed', 'in_repair', 'cancelled'],
  completed: ['ready_for_collection', 'cancelled'],
  ready_for_collection: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
};

export function normalizeJobStatus(status?: string): JobStatus {
  if (jobLifecycleStatuses.includes(status as JobStatus)) return status as JobStatus;
  if (status === 'pending_approval' || status === 'approved' || status === 'in_progress') return 'received';
  if (status === 'done') return 'completed';
  return 'received';
}

export function getAllowedNextStatuses(currentStatus: string | undefined, role?: Role): JobStatus[] {
  const normalizedStatus = normalizeJobStatus(currentStatus);
  if (role === 'technician') return technicianTransitions[normalizedStatus] || [];
  if (role === 'admin' || role === 'manager') return adminManagerTransitions[normalizedStatus] || [];
  return [];
}

export function canUpdateJobStatus(user: UserData | null, job: { technicianId?: string; status?: string } | null): boolean {
  if (!user || !job) return false;
  if (user.role === 'admin' || user.role === 'manager') return getAllowedNextStatuses(job.status, user.role).length > 0;
  return user.role === 'technician' && job.technicianId === user.uid && getAllowedNextStatuses(job.status, user.role).length > 0;
}

export type JobDocumentType =
  | 'checklist'
  | 'supplier_receipt'
  | 'logistic_receipt'
  | 'invoice'
  | 'payment_receipt'
  | 'photo';

export type JobDocumentStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export type JobCostProfile = 'parts_required' | 'service_only' | 'custom';

export interface JobDocument {
  documentId: string;
  jobId: string;
  type: JobDocumentType;
  fileUrl: string;
  fileName?: string;
  amount?: number;
  uploadedBy: string;
  uploadedAt: Timestamp;
  status: JobDocumentStatus;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  removedBy?: string;
  removedAt?: Timestamp;
  removeReason?: string;
}

export interface JobDocumentExtractedData {
  amount: number | null;
  date: string;
  supplierName: string;
  invoiceNumber: string;
  logisticCost: number | null;
  inferredType: JobDocumentType;
  confidenceScore: number;
}

export type JobDocumentExtractionStatus = 'draft' | 'verified';

export type DocumentExtractionProviderName = 'mock' | 'openai_vision' | 'google_document_ai';

export interface ExtractionResult {
  extractedData: JobDocumentExtractedData;
  provider: DocumentExtractionProviderName;
  warnings?: string[];
  rawResult?: Record<string, unknown>;
}

export interface JobDocumentExtraction {
  extractionId: string;
  documentId: string;
  jobId: string;
  documentType: JobDocumentType;
  extractedData: JobDocumentExtractedData;
  status: JobDocumentExtractionStatus;
  verified: boolean;
  provider?: DocumentExtractionProviderName;
  extractionWarnings?: string[];
  extractedBy: string;
  extractedAt: Timestamp;
  updatedBy?: string;
  updatedAt?: Timestamp;
  verifiedBy?: string;
  verifiedAt?: Timestamp;
}

export interface JobFinancialSnapshot {
  jobId: string;
  revenue: number;
  amountCollected?: number;
  partsCost: number;
  outsourceCost?: number;
  logisticCost: number;
  otherDirectCost?: number;
  totalCost: number;
  grossProfit: number;
  commission: number;
  commissionBasis?: 'net_profit' | 'legacy';
  commissionRate?: number;
  netProfit: number;
  commissionSnapshot?: {
    basis: 'net_profit';
    rate: number;
    amountCollected: number;
    partsCost: number;
    outsourceCost: number;
    otherDirectCost: number;
    totalDirectCost: number;
    netProfit: number;
    commissionAmount: number;
    calculatedAt?: Timestamp;
    approvedAt?: Timestamp | null;
    approvedBy?: string | null;
    status: 'draft' | 'pending' | 'approved' | 'paid';
  };
  partsCostSources?: string[];
  partsOrderCostSources?: string[];
  logisticCostSources?: string[];
  outsourceCostSources?: string[];
  revenueValidationSources?: string[];
  warnings?: string[];
  locked: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  finalizedBy?: string;
  finalizedAt?: Timestamp;
}

export interface JobFinancialPreview extends JobFinancialSnapshot {
  locked: false;
  requiresOverride: boolean;
}

export interface JobLike {
  docId: string;
  totalSale?: number;
  totalAmount?: number;
  amount?: number;
  technicianId?: string;
  branchId?: string;
  status?: string;
  approvalStatus?: string;
  jobSheetNo?: string;
  technicianName?: string;
  statusHistory?: StatusHistoryItem[];
  diagnosisNote?: string;
  quotationAmount?: number;
  quotationNote?: string;
  customerApprovalStatus?: CustomerApprovalStatus;
  repairNote?: string;
  qcNote?: string;
  collectionNote?: string;
  createdByDisplayName?: string;
  costProfile?: JobCostProfile;
  requiredDocuments?: string[];
  paymentStatus?: string;
  paidStatus?: string;
  customerPaymentStatus?: string;
  paymentConfirmed?: boolean;
  isPaid?: boolean;
  month?: string;
  jobNo?: string;
  jobNumber?: string;
  completedAt?: { toDate?: () => Date };
  paidAt?: { toDate?: () => Date };
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
}
