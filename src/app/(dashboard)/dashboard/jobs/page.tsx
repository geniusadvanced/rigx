'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  approveCommissionForJob,
  buildJobFinancialPreview,
  finalizeJobFinancials,
  getJobDocuments,
  getJobFinancial,
  getMissingRequiredDocumentTypes,
  getRequiredDocumentTypes,
  removeJobDocument,
  reviewJobDocument,
  uploadJobDocument,
} from '@/features/jobs/services/jobDocumentationService';
import {
  approveDocumentExtraction,
  extractDocumentData,
  getJobDocumentExtractions,
  updateDocumentExtraction,
} from '@/features/jobs/services/jobDocumentExtractionService';
import {
  createJob,
  deleteJob,
  getDisplayJobNumber,
  updateJobAssignment,
  updateJobDetails,
  updateJobPublicTrackingFields,
  ensureJobTrackingCode,
  logJobTrackingMessageSent,
  updateJobStatus,
  updateJobApprovalStatus,
  updateJobCostRequirements,
  updateQuotation,
  ensureJobSheetConsentToken,
  recordManualJobSheetConsent,
  type CreateJobInput,
  type JobQuotedPriceItem,
} from '@/features/jobs/services/jobService';
import {
  createCustomer,
  createOrUpdateCustomerFromJobInput,
  createDevice,
  getCustomers,
  getDevices,
  normalizeCustomerPhone,
} from '@/features/customers/services/customerService';
import type { Customer, CustomerBranch, Device } from '@/features/customers/types';
import {
  buildDeviceChecklistWhatsAppLink,
  completeAfterRepairChecklist,
  createDeviceChecklistFromJob,
  ensureDeviceChecklistSignatureToken,
  getAfterRepairChecklistByJob,
  getDeviceChecklistByJob,
  markDeviceChecklistSentWhatsApp,
  overrideDeviceChecklistSignature,
  updateDeviceChecklistStaffDetails,
} from '@/features/device-checklists/deviceChecklistService';
import {
  accessoryAfterStatusOptions,
  accessoryBeforeStatusOptions,
  createDefaultAfterRepairTestedItems,
  createDefaultAccessories,
  createDefaultChecklistItems,
  createDefaultInternalComponents,
  inspectionStatusOptions,
  internalComponentStatusOptions,
  normalizeAccessories,
  normalizeAfterRepairTestedItems,
  normalizeChecklistItems,
  normalizeInternalComponents,
  type AfterRepairTestedItem,
  type DeviceChecklist,
  type DeviceChecklistAccessory,
  type DeviceChecklistInternalComponents,
  type DeviceChecklistItem,
} from '@/features/device-checklists/types';
import { getPartsOrdersByJob, getPartsOrdersForUser } from '@/features/parts-orders/services/partsOrderService';
import type { PartsOrder } from '@/features/parts-orders/types';
import { calculateJobSla, getSlaFlagLabel, slaBadgeClass, type SlaStatus } from '@/features/sla/slaService';
import {
  canCreateWarrantyClaim,
  createWarrantyClaim,
  getActiveWarrantyRecord,
  getWarrantyClaimsByJob,
  getWarrantyClaimsForUser,
} from '@/features/warranty-claims/services/warrantyClaimService';
import type { WarrantyClaim, WarrantyClaimType } from '@/features/warranty-claims/types';
import {
  createJobDocumentRecord,
  calculateWarrantyEndDate,
  deleteJobDocumentRecord,
  ensureJobWarrantySignatureToken,
  geniusAdvancedWarrantyPolicyText,
  getJobDocumentRecords,
  getWarrantyStatus,
  jobHasActiveWarranty,
  updateJobDocumentRecord,
} from '@/features/job-documents/services/jobDocumentRecordService';
import type { JobDocumentRecord, JobDocumentRecordType, WarrantyPeriodType } from '@/features/job-documents/types';
import {
  calculatePaymentSummary,
  createJobPayment,
  getJobPayments,
  syncJobPaymentSummaryFromPosInvoice,
  updateJobPayment,
} from '@/features/payments/services/jobPaymentService';
import type { JobPayment, JobPaymentFormInput, JobPaymentMethod, JobPaymentType } from '@/features/payments/types';
import {
  approvePosQuotation,
  createInvoiceFromQuotation,
  ensureWarrantySignatureToken,
  createQuotationFromJob,
  ensureInvoicePaymentToken,
  getJobFinancialSummary,
  getJobQuotationActions,
  getInvoicesByJob,
  getPaymentsByInvoice,
  getPriceItems,
  getQuotationById,
  getWarrantiesByInvoice,
  logWarrantyTermsWhatsAppSent,
  prepareJobQuotationWhatsApp,
  priceItemMatchesSearch,
  recordInvoicePayment,
  rejectPosQuotation,
  buildInvoiceWhatsAppLink,
  type JobFinancialSummary,
  type JobQuotationActionSummary,
} from '@/features/pos/posService';
import type { PosInvoice, PosLineItem, PosPayment, PosPaymentMethod, PosWarranty, PriceItem } from '@/features/pos/types';
import {
  buildReadyForPickupWhatsAppMessage,
  buildReceiptWhatsAppLink,
  buildRepairStatusWhatsAppMessage,
  buildWarrantyWhatsAppLink,
  buildWarrantyWhatsAppMessage,
  buildWaMeLink,
} from '@/features/pos/whatsappService';
import {
  getAllowedRepairLifecycleTransitions,
  getCurrentRepairLifecycleStatus,
  repairLifecycleActionLabels,
  repairLifecycleLabels,
  updateJobLifecycleStatus,
  type RepairLifecycleStatus,
} from '@/features/jobs/services/jobLifecycleService';
import { getStaffList } from '@/features/hr/services/hrService';
import type { StaffProfile } from '@/features/hr/types';
import {
  normalizeJobStatus,
} from '@/features/jobs/types';
import type {
  JobDocument,
  JobDocumentExtractedData,
  JobDocumentExtraction,
  JobDocumentType,
  JobCostProfile,
  JobFinancialPreview,
  JobFinancialSnapshot,
  JobLike,
  JobStatus,
} from '@/features/jobs/types';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdmin, isTechnician } from '@/lib/rbac/can';
import type { Job } from '@/types';

const documentTypes: { value: JobDocumentType; label: string }[] = [
  { value: 'checklist', label: 'Customer checklist' },
  { value: 'supplier_receipt', label: 'Supplier receipt' },
  { value: 'logistic_receipt', label: 'Lalamove/logistic receipt' },
  { value: 'invoice', label: 'Final customer invoice' },
  { value: 'payment_receipt', label: 'Payment receipt' },
  { value: 'photo', label: 'Repair photo' },
];
const manualUploadDocumentTypes = documentTypes.filter(
  (type) => type.value !== 'checklist' && type.value !== 'invoice',
);

const allowedUploadTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxUploadSize = 10 * 1024 * 1024;
const supportDocumentTabs: Array<{ value: JobDocumentRecordType; label: string }> = [
  { value: 'service_report', label: 'Service Report' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'attachment', label: 'Attachments' },
];

type AddJobPricingMode = 'diagnosis_first' | 'quote_now';
type AddJobSelectedPriceItem = JobQuotedPriceItem & { finalPriceInput: string };
const warrantyClaimTypes: Array<{ value: WarrantyClaimType; label: string }> = [
  { value: 'repair_issue', label: 'Repair Issue' },
  { value: 'part_failure', label: 'Part Failure' },
  { value: 'other', label: 'Other' },
];
const warrantyPeriodOptions: Array<{ value: WarrantyPeriodType; label: string }> = [
  { value: '7_days', label: '7 Days' },
  { value: '1_month', label: '1 Month' },
  { value: '3_months', label: '3 Months' },
  { value: '6_months', label: '6 Months' },
  { value: '12_months', label: '12 Months' },
];
const paymentTypes: Array<{ value: JobPaymentType; label: string }> = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'partial', label: 'Partial Payment' },
  { value: 'full_payment', label: 'Full Payment' },
  { value: 'discount', label: 'Discount' },
  { value: 'refund', label: 'Refund' },
];
const paymentMethods: Array<{ value: JobPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'ewallet', label: 'E-Wallet' },
  { value: 'other', label: 'Other' },
];
const costProfileLabels: Record<JobCostProfile, string> = {
  parts_required: 'Parts Job',
  service_only: 'Service Only',
  custom: 'Custom',
};

function quotationLineTotal(item: Pick<PosLineItem, 'quantity' | 'unitPrice' | 'discount'>): number {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const discount = Number(item.discount || 0);
  return Math.max(0, quantity * unitPrice - discount);
}

function quotationLineSubtotal(item: Pick<PosLineItem, 'quantity' | 'unitPrice'>): number {
  return Math.max(0, Number(item.quantity || 0) * Number(item.unitPrice || 0));
}

function parseCurrencyInput(value: string): number {
  const normalized = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  return Math.max(0, Number(normalized || 0));
}

function parseQuantityInput(value: string): number {
  return Math.max(1, Math.floor(Number(value.replace(/\D/g, '') || 1)));
}

const lifecycleStatusLabels: Record<JobStatus, string> = {
  received: 'Received',
  diagnosis: 'Diagnosis',
  quotation_pending: 'Quotation Pending',
  quotation_sent: 'Quotation Sent',
  customer_approved: 'Customer Approved',
  in_repair: 'In Repair',
  waiting_parts: 'Waiting Parts',
  qc_check: 'QC Check',
  completed: 'Completed',
  ready_for_collection: 'Ready for Collection',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

function lifecycleLabelForJob(job: Job): string {
  return repairLifecycleLabels[getCurrentRepairLifecycleStatus(job)] || lifecycleStatusLabels[normalizeJobStatus(job.status)];
}

function jobDeviceInfo(job: Job): string {
  return [job.deviceBrand, job.deviceModel || job.device].filter(Boolean).join(' ') || 'your device';
}

function branchDisplayName(branchId?: string): string {
  if (branchId === 'bangi') return 'Genius Advanced Bangi';
  if (branchId === 'cyberjaya') return 'Genius Advanced Cyberjaya';
  return branchId ? `Genius Advanced ${branchId}` : 'Genius Advanced';
}

function normalizeBranchId(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  if (compact === 'bangi') return 'bangi';
  if (compact === 'cyberjaya') return 'cyberjaya';
  return normalized;
}

function normalizeCustomerBranchForJob(value?: string | null): Exclude<CustomerBranch, 'unknown'> | null {
  const normalized = normalizeBranchId(value);
  if (normalized === 'bangi' || normalized === 'cyberjaya') return normalized;
  return null;
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

function isPermissionLikeError(error: unknown): boolean {
  const details = getUnknownErrorDetails(error);
  const message = String(details.errorMessage || '').toLowerCase();
  const code = String(details.errorCode || '').toLowerCase();
  return code.includes('permission-denied')
    || message.includes('missing or insufficient permissions')
    || message.includes('permission');
}

function warnJobPagePermissionSourceDebug(payload: Record<string, unknown>) {
  console.warn('[JOB PAGE PERMISSION SOURCE DEBUG]', JSON.stringify(payload, null, 2));
}

function warnJobPagePermissionSourceIfNeeded(error: unknown, payload: Record<string, unknown>) {
  if (!isPermissionLikeError(error)) return;
  warnJobPagePermissionSourceDebug({
    ...payload,
    ...getUnknownErrorDetails(error),
  });
}

function normalizeMalaysiaPhoneForWhatsApp(phone?: string | null): string | null {
  if (!phone) return null;

  let cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+60')) {
    cleaned = `60${cleaned.slice(3)}`;
  } else if (cleaned.startsWith('0')) {
    cleaned = `60${cleaned.slice(1)}`;
  } else if (!cleaned.startsWith('60')) {
    cleaned = `60${cleaned}`;
  }

  cleaned = cleaned.replace(/\D/g, '');

  if (cleaned.length < 10 || cleaned.length > 13) return null;
  return cleaned;
}

function buildCustomerWhatsAppUrl(phone: string | null | undefined, message: string): { normalizedPhone: string; url: string } | null {
  const normalizedPhone = normalizeMalaysiaPhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;
  return {
    normalizedPhone,
    url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
  };
}

function getJobCustomerPhoneForWhatsApp(job: Job): string | null {
  const extra = job as Job & { phone?: string; customer?: { phone?: string } };
  return [job.customerPhone, extra.phone, extra.customer?.phone]
    .map((phone) => normalizeMalaysiaPhoneForWhatsApp(phone))
    .find((phone): phone is string => Boolean(phone)) || null;
}

function getJobCustomerPhoneDebug(job: Job) {
  const extra = job as Job & { phone?: string; customer?: { phone?: string } };
  const candidates = [
    { field: 'selectedJob.customerPhone', rawPhone: job.customerPhone, normalizedPhone: normalizeMalaysiaPhoneForWhatsApp(job.customerPhone) },
    { field: 'selectedJob.phone', rawPhone: extra.phone, normalizedPhone: normalizeMalaysiaPhoneForWhatsApp(extra.phone) },
    { field: 'selectedJob.customer.phone', rawPhone: extra.customer?.phone, normalizedPhone: normalizeMalaysiaPhoneForWhatsApp(extra.customer?.phone) },
  ];
  const selected = candidates.find((candidate) => Boolean(candidate.normalizedPhone));
  return {
    candidates,
    selectedPhoneField: selected?.field,
    selectedRawPhone: selected?.rawPhone,
    normalizedPhone: selected?.normalizedPhone || null,
    isValid: Boolean(selected?.normalizedPhone),
  };
}

function warnReadyPickupWhatsAppDebug(payload: Record<string, unknown>) {
  console.warn('[READY PICKUP WHATSAPP DEBUG]', JSON.stringify(payload, null, 2));
}

function warnManageJobPaymentDebug(payload: Record<string, unknown>) {
  console.warn('[MANAGE JOB PAYMENT DEBUG]', JSON.stringify(payload, null, 2));
}

function loggableError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : '',
    message: error instanceof Error ? error.message : String(error || ''),
    stack: error instanceof Error ? error.stack : '',
    code: typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '',
  };
}

function normalizeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode:
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined,
      errorString: String(error),
      rawType: typeof error,
    };
  }

  return {
    errorName: undefined,
    errorMessage: undefined,
    errorStack: undefined,
    errorCode:
      typeof error === 'object' &&
      error !== null &&
      'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined,
    errorString: String(error),
    rawType: typeof error,
  };
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

function formatCurrency(value: number | undefined): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(Number(value || 0));
}

function priceItemDisplayPrice(item: PriceItem | AddJobSelectedPriceItem): string {
  if (item.pricingType === 'quote_required') return 'Quote required';
  if (item.pricingType === 'free_or_waived') return 'Waived if proceed';
  if (item.pricingType === 'range') return `${formatCurrency(item.minPrice || 0)} - ${formatCurrency(item.maxPrice || 0)}`;
  if (item.pricingType === 'starting_from') return `Starting ${formatCurrency(item.basePrice || 0)}`;
  return formatCurrency(item.basePrice || 0);
}

function priceItemDefaultFinalPrice(item: PriceItem, branchId?: string): number {
  if (item.pricingType === 'range' || item.pricingType === 'quote_required') return 0;
  return Number(item.branchPrices?.[branchId as 'bangi' | 'cyberjaya'] ?? item.basePrice ?? 0);
}

function selectedPriceItemToJobQuote(item: AddJobSelectedPriceItem): JobQuotedPriceItem {
  return {
    priceItemId: item.priceItemId,
    name: item.name,
    category: item.category,
    serviceGroup: item.serviceGroup,
    pricingType: item.pricingType || 'fixed',
    basePrice: Number(item.basePrice || 0),
    minPrice: Number(item.minPrice || 0),
    maxPrice: Number(item.maxPrice || 0),
    deviceType: item.deviceType || '',
    model: item.model || '',
    packageName: item.packageName || '',
    commissionEligible: item.commissionEligible === true,
    costPrice: Number(item.costPrice || 0),
    finalPrice: Number(item.finalPriceInput || 0),
  };
}

function documentTypeLabel(type: JobDocumentType): string {
  return documentTypes.find((documentType) => documentType.value === type)?.label || type.replaceAll('_', ' ');
}

function documentRequirementStatus(document?: JobDocument): { label: string; className: string } {
  if (!document) return { label: 'Missing', className: 'border-red-500/35 bg-red-500/10 text-red-300' };
  if (document.status === 'approved') return { label: 'Verified', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' };
  if (document.status === 'rejected') return { label: 'Rejected', className: 'border-red-500/35 bg-red-500/10 text-red-300' };
  if (document.status === 'removed') return { label: 'Removed', className: 'border-amber-500/35 bg-amber-500/10 text-amber-300' };
  return { label: 'Pending Review', className: 'border-amber-500/35 bg-amber-500/10 text-amber-300' };
}

function mapJobPaymentMethodToPos(method: JobPaymentMethod): PosPaymentMethod {
  if (method === 'ewallet') return 'ewallet';
  if (method === 'bank_transfer') return 'bank_transfer';
  if (method === 'card') return 'card';
  if (method === 'cash') return 'cash';
  return 'other';
}

function systemDocumentStatus(completed: boolean): { label: string; className: string } {
  return completed
    ? { label: 'Completed', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' }
    : { label: 'Pending', className: 'border-amber-500/35 bg-amber-500/10 text-amber-300' };
}

function statusClass(status: string): string {
  if (status === 'approved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'removed') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'paid') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-white/10 bg-[#1A1A1A] text-slate-300';
}

function lifecycleStatusClass(status: JobStatus | RepairLifecycleStatus): string {
  if (['delivered', 'warranty_active', 'repair_completed', 'collected', 'completed'].includes(status)) return 'border-emerald-500/40 text-emerald-300';
  if (['cancelled', 'customer_rejected', 'warranty_expired'].includes(status)) return 'border-red-500/40 text-red-300';
  if (['quotation_pending', 'quotation_sent', 'ready_for_pickup'].includes(status)) return 'border-amber-500/40 text-amber-300';
  if (['repair_in_progress', 'in_repair', 'qc_check'].includes(status)) return 'border-amber-500/35 text-amber-300';
  return 'border-white/15 text-slate-300';
}

function formatTimestamp(value?: { toDate?: () => Date } | unknown): string {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return '-';
  return value.toDate().toLocaleString('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function deviceChecklistStatusLabel(status?: DeviceChecklist['checklistStatus']): string {
  if (!status) return 'Not Created';
  if (status === 'staff_completed' || status === 'completed_by_staff') return 'Staff Completed';
  if (status === 'sent_to_customer') return 'Sent to Customer';
  if (status === 'customer_signed') return 'Customer Signed';
  if (status === 'signature_overridden') return 'Override Approved';
  if (status === 'final_checked') return 'Final Checked';
  if (status === 'completed') return 'Completed';
  return 'Draft';
}

function deviceChecklistStatusClass(status?: DeviceChecklist['checklistStatus']): string {
  if (status === 'customer_signed') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'signature_overridden') return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
  if (status === 'sent_to_customer') return 'border-orange-500/40 bg-orange-500/10 text-orange-200';
  if (status === 'staff_completed' || status === 'completed_by_staff') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-white/15 bg-[#151515] text-slate-300';
}

interface DeviceChecklistFormState {
  customerId: string;
  deviceId: string;
  items: DeviceChecklistItem[];
  accessories: DeviceChecklistAccessory[];
  internalComponents: DeviceChecklistInternalComponents;
  externalConditionSummary: string;
  functionalChecklist: string;
  accessoriesReceived: string;
  internalComponentInventory: string;
}

interface AfterRepairChecklistFormState {
  testedItems: AfterRepairTestedItem[];
  remarks: string;
}

function createDeviceChecklistFormDefaults(overrides: Partial<DeviceChecklistFormState> = {}): DeviceChecklistFormState {
  return {
    customerId: '',
    deviceId: '',
    items: createDefaultChecklistItems(),
    accessories: createDefaultAccessories(),
    internalComponents: createDefaultInternalComponents(),
    externalConditionSummary: '',
    functionalChecklist: '',
    accessoriesReceived: '',
    internalComponentInventory: '',
    ...overrides,
  };
}

function createAfterRepairChecklistFormDefaults(overrides: Partial<AfterRepairChecklistFormState> = {}): AfterRepairChecklistFormState {
  return {
    testedItems: createDefaultAfterRepairTestedItems(),
    remarks: '',
    ...overrides,
  };
}

function afterRepairChecklistCompleted(checklist?: DeviceChecklist | null): boolean {
  return checklist?.checklistType === 'after_repair'
    && checklist.checklistStatus === 'completed'
    && Boolean(checklist.completedAt);
}

interface ScrollAnchorSnapshot {
  element: Element | null;
  top: number;
  scrollX: number;
  scrollY: number;
}

function captureScrollAnchor(): ScrollAnchorSnapshot {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { element: null, top: 0, scrollX: 0, scrollY: 0 };
  }

  const element = document.activeElement instanceof Element ? document.activeElement : null;
  return {
    element,
    top: element?.getBoundingClientRect().top ?? 0,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function restoreScrollAnchor(snapshot: ScrollAnchorSnapshot) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (snapshot.element && document.contains(snapshot.element)) {
        const nextTop = snapshot.element.getBoundingClientRect().top;
        window.scrollBy({ top: nextTop - snapshot.top, left: 0, behavior: 'auto' });
        return;
      }

      window.scrollTo({ top: snapshot.scrollY, left: snapshot.scrollX, behavior: 'auto' });
    });
  });
}

export default function JobsPage() {
  const { profile } = useUser();
  const { jobs, loading, error, refetch } = useJobs(profile?.role ? profile : null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [documents, setDocuments] = useState<JobDocument[]>([]);
  const [extractions, setExtractions] = useState<Record<string, JobDocumentExtraction>>({});
  const [extractionEdits, setExtractionEdits] = useState<Record<string, JobDocumentExtractedData>>({});
  const [financial, setFinancial] = useState<JobFinancialSnapshot | null>(null);
  const [financialPreview, setFinancialPreview] = useState<JobFinancialPreview | null>(null);
  const [partsOrders, setPartsOrders] = useState<PartsOrder[]>([]);
  const [allPartsOrders, setAllPartsOrders] = useState<PartsOrder[]>([]);
  const [warrantyClaims, setWarrantyClaims] = useState<WarrantyClaim[]>([]);
  const [allWarrantyClaims, setAllWarrantyClaims] = useState<WarrantyClaim[]>([]);
  const [jobPayments, setJobPayments] = useState<JobPayment[]>([]);
  const [posFinancialSummary, setPosFinancialSummary] = useState<JobFinancialSummary | null>(null);
  const [linkedPosInvoices, setLinkedPosInvoices] = useState<PosInvoice[]>([]);
  const [linkedPosWarranties, setLinkedPosWarranties] = useState<PosWarranty[]>([]);
  const [latestPosReceipt, setLatestPosReceipt] = useState<{ invoice: PosInvoice; payment: PosPayment } | null>(null);
  const [jobQuotationActions, setJobQuotationActions] = useState<JobQuotationActionSummary[]>([]);
  const [jobDocumentRecords, setJobDocumentRecords] = useState<JobDocumentRecord[]>([]);
  const [supportDocumentTab, setSupportDocumentTab] = useState<JobDocumentRecordType>('service_report');
  const [supportDocumentFile, setSupportDocumentFile] = useState<File | null>(null);
  const [quotationProofFile, setQuotationProofFile] = useState<File | null>(null);
  const [quotationProofInputKey, setQuotationProofInputKey] = useState(0);
  const [quotationRejectReason, setQuotationRejectReason] = useState('');
  const [showJobQuotationModal, setShowJobQuotationModal] = useState(false);
  const [jobQuotationForm, setJobQuotationForm] = useState<{
    items: PosLineItem[];
    depositAmount: string;
    discountReason: string;
    validUntil: string;
  }>({
    items: [{ name: '', category: 'Repair', type: 'service', quantity: 1, unitPrice: 0, discount: 0, warrantyDurationDays: 0, total: 0 }],
    depositAmount: '0',
    discountReason: '',
    validUntil: '',
  });
  const [focusedJobQuotationMoneyField, setFocusedJobQuotationMoneyField] = useState<string | null>(null);
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [paymentFileInputKey, setPaymentFileInputKey] = useState(0);
  const [editingPayment, setEditingPayment] = useState<JobPayment | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentModalError, setPaymentModalError] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState<JobPaymentFormInput>({
    amount: '',
    type: 'partial',
    method: 'cash',
    referenceNo: '',
    note: '',
    paidAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()),
  });
  const [quotationForm, setQuotationForm] = useState({
    quotationAmount: '0',
    quotationNote: '',
  });
  const [manualApprovalTarget, setManualApprovalTarget] = useState('');
  const [manualApprovalForm, setManualApprovalForm] = useState({
    approvalMethod: 'WhatsApp',
    approvedByName: '',
    notes: '',
    confirmed: false,
  });
  const [showManualJobSheetConsent, setShowManualJobSheetConsent] = useState(false);
  const [manualJobSheetConsentForm, setManualJobSheetConsentForm] = useState({
    consentMethod: 'WhatsApp',
    signerName: '',
    icOrPassportNo: '',
    phone: '',
    notes: '',
    confirmed: false,
  });
  const [supportFileInputKey, setSupportFileInputKey] = useState(0);
  const [editingSupportDocument, setEditingSupportDocument] = useState<JobDocumentRecord | null>(null);
  const [supportDocumentForm, setSupportDocumentForm] = useState({
    title: '',
    description: '',
    warrantyPeriodType: '3_months' as WarrantyPeriodType,
    warrantyStartDate: '',
  });
  const [warrantyClaimForm, setWarrantyClaimForm] = useState({
    claimType: 'repair_issue' as WarrantyClaimType,
    claimReason: '',
  });
  const [confirmFinancialOverride, setConfirmFinancialOverride] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadType, setUploadType] = useState<JobDocumentType>('supplier_receipt');
  const [uploadAmount, setUploadAmount] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [removeDocumentId, setRemoveDocumentId] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [showAddJob, setShowAddJob] = useState(false);
  const [showNewDevicePassword, setShowNewDevicePassword] = useState(false);
  const [showDetailDevicePassword, setShowDetailDevicePassword] = useState(false);
  const [showSelectedDevicePassword, setShowSelectedDevicePassword] = useState(false);
  const [technicians, setTechnicians] = useState<StaffProfile[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobPriceItems, setJobPriceItems] = useState<PriceItem[]>([]);
  const [jobPriceItemSearch, setJobPriceItemSearch] = useState('');
  const [selectedJobPriceItems, setSelectedJobPriceItems] = useState<AddJobSelectedPriceItem[]>([]);
  const [customerDataLoading, setCustomerDataLoading] = useState(false);
  const [customerLookup, setCustomerLookup] = useState('');
  const [deviceChecklist, setDeviceChecklist] = useState<DeviceChecklist | null>(null);
  const [afterRepairChecklist, setAfterRepairChecklist] = useState<DeviceChecklist | null>(null);
  const [showDeviceChecklistEditor, setShowDeviceChecklistEditor] = useState(false);
  const [showAfterRepairChecklistEditor, setShowAfterRepairChecklistEditor] = useState(false);
  const [deviceChecklistCustomerSearch, setDeviceChecklistCustomerSearch] = useState('');
  const [deviceChecklistOverrideReason, setDeviceChecklistOverrideReason] = useState('');
  const [deviceChecklistForm, setDeviceChecklistForm] = useState<DeviceChecklistFormState>(() => createDeviceChecklistFormDefaults());
  const [afterRepairChecklistForm, setAfterRepairChecklistForm] = useState<AfterRepairChecklistFormState>(() => createAfterRepairChecklistFormDefaults());
  const [newJob, setNewJob] = useState<Omit<CreateJobInput, 'createdBy' | 'creatorRole' | 'totalSale'> & { totalSale: string; customerEmail: string; customerAddress: string }>({
    customerId: null,
    customerNumber: '',
    deviceId: null,
    customerName: '',
    customerPhone: '',
    normalizedPhone: '',
    customerEmail: '',
    customerAddress: '',
    device: '',
    branchId: profile?.branchId || '',
    technicianId: '',
    totalSale: '',
    paymentStatus: 'pending',
    devicePassword: '',
    costProfile: 'parts_required',
    requiredDocuments: ['supplier_receipt', 'logistic_receipt'],
    pricingMode: 'diagnosis_first',
    quotedPriceItems: [],
  });
  const [requirementProfile, setRequirementProfile] = useState<JobCostProfile>('parts_required');
  const [requireSupplierReceipt, setRequireSupplierReceipt] = useState(true);
  const [requireLogisticReceipt, setRequireLogisticReceipt] = useState(true);
  const [statusNote, setStatusNote] = useState('');
  const [detailForm, setDetailForm] = useState({
    customerId: null as string | null,
    deviceId: null as string | null,
    customerName: '',
    customerPhone: '',
    deviceType: '',
    deviceBrand: '',
    deviceModel: '',
    devicePassword: '',
    serialNumber: '',
    issueDescription: '',
    quotationAmount: '0',
    quotationNote: '',
    customerApprovalStatus: 'pending' as 'pending' | 'approved' | 'rejected',
    diagnosisSummaryPublic: '',
    repairSummaryPublic: '',
    estimatedCompletionAt: '',
    technicianId: '',
  });
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [slaFilter, setSlaFilter] = useState<SlaStatus | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [jobSearch, setJobSearch] = useState('');
  const [jobPendingDelete, setJobPendingDelete] = useState<Job | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [supportWarning, setSupportWarning] = useState('');

  const canManageReviews = can(profile?.role, 'jobs.update');
  const canDeleteJobs = can(profile?.role, 'jobs.delete');
  const canRemoveDocuments = isAdmin(profile?.role);
  const canCreateJobs = can(profile?.role, 'jobs.create');
  useEffect(() => {
    if (!error) return;
    warnJobPagePermissionSourceIfNeeded(error, {
      sourceFunction: 'useJobs',
      operationName: 'loadJobs',
      firestorePath: profile?.role === 'technician'
        ? `jobs query where technicianId == ${profile.uid}`
        : 'jobs collection read',
      profileUid: profile?.uid,
      profileRole: profile?.role,
      profileBranchId: profile?.branchId,
    });
  }, [error, profile?.branchId, profile?.role, profile?.uid]);
  const selectedPaymentSummary = useMemo(
    () => (selectedJob ? calculatePaymentSummary(selectedJob, jobPayments) : null),
    [jobPayments, selectedJob],
  );
  const selectedPaymentStatus = useMemo(() => {
    if (!selectedPaymentSummary) return 'unpaid';
    if (selectedPaymentSummary.paymentStatus === 'paid') return 'paid';
    if (selectedPaymentSummary.paymentStatus === 'refunded') return 'refunded';
    if (selectedPaymentSummary.totalPaid > 0) return 'partial';
    return 'unpaid';
  }, [selectedPaymentSummary]);
  const canUploadForSelectedJob = Boolean(
    selectedJob && profile && (
      canManageReviews ||
      (isTechnician(profile.role) && selectedJob.technicianId === profile.uid)
    ),
  );
  const missingRequiredDocuments = useMemo(
    () => getMissingRequiredDocumentTypes(documents, selectedJob),
    [documents, selectedJob],
  );
  const requiredDocumentTypes = useMemo(() => getRequiredDocumentTypes(selectedJob), [selectedJob]);
  const documentRequirementRows = useMemo(() => {
    const requiredRows = requiredDocumentTypes.map((type) => ({
      type,
      required: true,
      document: documents.find((document) => document.type === type && document.status !== 'removed'),
    }));
    const extraRows = documents
      .filter((document) => document.status !== 'removed' && !requiredDocumentTypes.includes(document.type))
      .map((document) => ({ type: document.type, required: false, document }));
    return [...requiredRows, ...extraRows];
  }, [documents, requiredDocumentTypes]);
  const requiredDocumentSummary = useMemo(() => (
    requiredDocumentTypes.length > 0
      ? requiredDocumentTypes.map(documentTypeLabel).join(', ')
      : 'No manual upload required'
  ), [requiredDocumentTypes]);
  const systemDocumentRows = useMemo(() => {
    const completedChecklistStatuses: Array<DeviceChecklist['checklistStatus']> = [
      'staff_completed',
      'completed_by_staff',
      'sent_to_customer',
      'customer_signed',
      'signature_overridden',
      'final_checked',
      'completed',
    ];
    const checklistCompleted = Boolean(
      deviceChecklist?.checklistStatus && completedChecklistStatuses.includes(deviceChecklist.checklistStatus),
    );
    const hasInvoice = Boolean(posFinancialSummary?.invoiceIds.length);
    const invoicePaid = hasInvoice
      && Number(posFinancialSummary?.outstandingBalance || 0) <= 0
      && Number(posFinancialSummary?.paidAmount || 0) > 0;
    return [
      {
        key: 'device-checklist-sop',
        label: 'Device Checklist SOP',
        status: systemDocumentStatus(checklistCompleted),
        detail: checklistCompleted ? 'Completed in Device Checklist SOP' : 'Pending Device Checklist SOP completion',
      },
      {
        key: 'final-customer-invoice',
        label: 'Final Customer Invoice',
        status: invoicePaid
          ? { label: 'Auto-linked / Paid', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' }
          : { label: hasInvoice ? 'Pending payment' : 'Pending invoice/payment', className: 'border-amber-500/35 bg-amber-500/10 text-amber-300' },
        detail: hasInvoice ? 'Linked from POS invoice/payment flow' : 'Waiting for POS invoice/payment flow',
      },
    ];
  }, [deviceChecklist?.checklistStatus, posFinancialSummary]);
  const allowedNextStatuses = useMemo(() => {
    if (!profile || !selectedJob) return [];
    return getAllowedRepairLifecycleTransitions(selectedJob, profile);
  }, [profile, selectedJob]);
  const canChangeSelectedJobStatus = allowedNextStatuses.length > 0;
  const selectedJobSla = useMemo(
    () => (selectedJob ? calculateJobSla(selectedJob, partsOrders) : null),
    [partsOrders, selectedJob],
  );
  const activeJobQuotation = useMemo(() => {
    return jobQuotationActions.find((quotation) => (
      ['draft', 'pending', 'sent', 'approved'].includes(String(quotation.quotationApprovalStatus || quotation.status || ''))
    )) || null;
  }, [jobQuotationActions]);
  const approvedJobQuotationForInvoice = useMemo(() => (
    jobQuotationActions.find((quotation) => (
      (quotation.status === 'approved' || quotation.quotationApprovalStatus === 'approved')
      && Number(quotation.total || 0) > 0
    )) || null
  ), [jobQuotationActions]);
  const canMakeQuotationForSelectedJob = Boolean(
    profile
      && selectedJob
      && can(profile.role, 'pos.operate')
      && selectedJob.customerId
      && selectedJob.customerName
      && selectedJob.customerPhone
      && !['completed', 'collected', 'cancelled', 'delivered', 'warranty_active', 'warranty_expired'].includes(String(selectedJob.lifecycleStatus || selectedJob.status || ''))
      && !activeJobQuotation,
  );
  const jobQuotationTotals = useMemo(() => {
    const subtotal = jobQuotationForm.items.reduce((sum, item) => sum + quotationLineSubtotal(item), 0);
    const discount = jobQuotationForm.items.reduce((sum, item) => sum + Math.max(0, Number(item.discount || 0)), 0);
    const total = Math.max(0, subtotal - discount);
    const deposit = parseCurrencyInput(jobQuotationForm.depositAmount);
    return { subtotal, discount, deposit, total };
  }, [jobQuotationForm.depositAmount, jobQuotationForm.items]);
  const selectedActiveWarranty = useMemo(() => getActiveWarrantyRecord(jobDocumentRecords), [jobDocumentRecords]);
  const supportWarrantyEndPreview = useMemo(() => {
    if (supportDocumentTab !== 'warranty') return '-';
    const startDate =
      supportDocumentForm.warrantyStartDate ||
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    return formatTimestamp(calculateWarrantyEndDate(startDate, supportDocumentForm.warrantyPeriodType));
  }, [supportDocumentForm.warrantyPeriodType, supportDocumentForm.warrantyStartDate, supportDocumentTab]);
  const branchOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.branchId).filter(Boolean))).sort(), [jobs]);
  const technicianOptions = useMemo(() => {
    return Array.from(
      new Map(
        jobs
          .filter((job) => job.technicianId)
          .map((job) => [job.technicianId, job.technicianName || 'Unknown User'] as const),
      ).entries(),
    ).sort((left, right) => left[1].localeCompare(right[1]));
  }, [jobs]);
  const newJobDevices = useMemo(
    () => devices.filter((device) => device.customerId === newJob.customerId),
    [devices, newJob.customerId],
  );
  const canQuoteNowOnAddJob = Boolean(profile && canManageReviews && can(profile.role, 'pos.operate'));
  const filteredJobPriceItems = useMemo(
    () => jobPriceItems
      .filter((item) => item.active)
      .filter((item) => priceItemMatchesSearch(item, jobPriceItemSearch))
      .slice(0, 12),
    [jobPriceItemSearch, jobPriceItems],
  );
  const selectedJobPriceItemsTotal = useMemo(
    () => selectedJobPriceItems.reduce((sum, item) => sum + Math.max(0, Number(item.finalPriceInput || 0)), 0),
    [selectedJobPriceItems],
  );
  const selectedJobPriceItemsNeedManualPrice = useMemo(
    () => selectedJobPriceItems.some((item) => (
      (item.pricingType === 'range' || item.pricingType === 'quote_required')
      && Number(item.finalPriceInput || 0) <= 0
    )),
    [selectedJobPriceItems],
  );
  const filteredNewJobCustomers = useMemo(() => {
    const search = customerLookup.trim().toLowerCase();
    if (!search) return customers;
    return customers.filter((customer) => (
      [
        customer.customerNumber,
        customer.fullName,
        customer.phone,
        customer.normalizedPhone,
        customer.email,
      ].some((value) => String(value || '').toLowerCase().includes(search))
    ));
  }, [customerLookup, customers]);
  const detailDevices = useMemo(
    () => devices.filter((device) => device.customerId === detailForm.customerId),
    [detailForm.customerId, devices],
  );
  const deviceChecklistCustomer = useMemo(
    () => customers.find((customer) => customer.customerId === deviceChecklistForm.customerId) || null,
    [customers, deviceChecklistForm.customerId],
  );
  const deviceChecklistDevices = useMemo(
    () => devices.filter((device) => device.customerId === deviceChecklistForm.customerId),
    [deviceChecklistForm.customerId, devices],
  );
  const deviceChecklistDevice = useMemo(
    () => devices.find((device) => device.deviceId === deviceChecklistForm.deviceId) || null,
    [devices, deviceChecklistForm.deviceId],
  );
  const filteredDeviceChecklistCustomers = useMemo(() => {
    const search = deviceChecklistCustomerSearch.trim().toLowerCase();
    if (!search) return customers.slice(0, 20);
    return customers.filter((customer) => (
      [
        customer.customerNumber,
        customer.fullName,
        customer.phone,
        customer.normalizedPhone,
        customer.email,
      ].some((value) => String(value || '').toLowerCase().includes(search))
    )).slice(0, 20);
  }, [customers, deviceChecklistCustomerSearch]);
  const duplicateChecklistCustomer = useMemo(() => {
    const phone = normalizeCustomerPhone(deviceChecklistCustomer?.phone || selectedJob?.customerPhone || '');
    if (!phone) return null;
    return customers.find((customer) => customer.customerId !== deviceChecklistForm.customerId && customer.normalizedPhone === phone) || null;
  }, [customers, deviceChecklistCustomer?.phone, deviceChecklistForm.customerId, selectedJob?.customerPhone]);
  const filteredJobs = useMemo(() => {
    const search = jobSearch.trim().toLowerCase();
    return jobs.filter((job) => {
      const jobSla = calculateJobSla(job, allPartsOrders.filter((order) => order.jobId === job.docId));
      const status = normalizeJobStatus(job.status);
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const matchesSla = slaFilter === 'all' || jobSla.status === slaFilter;
      const matchesOverdue = !overdueOnly || jobSla.status === 'overdue';
      const matchesTechnician = technicianFilter === 'all' || job.technicianId === technicianFilter;
      const matchesBranch = branchFilter === 'all' || job.branchId === branchFilter;
      const matchesSearch =
        !search ||
        [
          job.jobNo,
          job.jobNumber,
          job.jobSheetNo,
          job.agnJobNumber,
          job.customerName,
          job.customerPhone,
          job.deviceModel,
          job.device,
        ].some((value) => String(value || '').toLowerCase().includes(search));
      return matchesStatus && matchesSla && matchesOverdue && matchesTechnician && matchesBranch && matchesSearch;
    });
  }, [allPartsOrders, branchFilter, jobSearch, jobs, overdueOnly, slaFilter, statusFilter, technicianFilter]);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.role) return;

    if (process.env.NODE_ENV === 'development') console.time('loadJobsSupportData');
    getPartsOrdersForUser(profile)
      .then((orders) => {
        if (!cancelled) {
          setAllPartsOrders(orders);
          setSupportWarning('');
        }
      })
      .catch((partsError) => {
        if (!cancelled) {
          console.error('Unable to load parts orders for SLA', partsError);
          setAllPartsOrders([]);
          setSupportWarning('Some parts-order SLA data could not be loaded. Job actions and WhatsApp buttons are still available.');
        }
      });

    getWarrantyClaimsForUser(profile)
      .then((claims) => {
        if (!cancelled) setAllWarrantyClaims(claims);
      })
      .catch((claimsError) => {
        if (!cancelled) console.error('Unable to load warranty claims for job badges', claimsError);
      })
      .finally(() => {
        if (!cancelled && process.env.NODE_ENV === 'development') console.timeEnd('loadJobsSupportData');
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.role, profile?.uid]);

  async function refreshJobDetails(job: Job) {
    setDetailsLoading(true);
    setMessage('');
    setConfirmFinancialOverride(false);

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadJobDetails');
      const [documentsResult, extractionsResult, financialResult] = await Promise.allSettled([
        getJobDocuments(job.docId, canRemoveDocuments),
        getJobDocumentExtractions(job.docId),
        getJobFinancial(job.docId),
      ]);
      const supportDocumentsResult = await getJobDocumentRecords(job.docId).catch((supportError) => {
        console.error('Unable to load job documents and warranty', supportError);
        return [];
      });
      const paymentsResult = await getJobPayments(job.docId).catch((paymentError) => {
        console.error('Unable to load job payments', paymentError);
        return [];
      });
      const partsOrdersResult = await getPartsOrdersByJob(job.docId).catch((partsError) => {
        console.error('Unable to load parts orders', partsError);
        setSupportWarning('Parts orders could not be loaded for this job. WhatsApp tracking and Job Sheet actions are still available.');
        return [];
      });
      const warrantyClaimsResult = await getWarrantyClaimsByJob(job.docId).catch((claimsError) => {
        console.error('Unable to load warranty claims', claimsError);
        return [];
      });
      const posFinancialSummaryResult = profile && can(profile.role, 'pos.operate')
        ? await getJobFinancialSummary(job.docId, profile).catch((summaryError) => {
          console.error('Unable to load POS financial summary', summaryError);
          return null;
        })
        : null;
      const linkedPosInvoicesResult = profile && can(profile.role, 'pos.operate')
        ? await getInvoicesByJob(job.docId, profile).catch((invoiceError) => {
          console.error('Unable to load linked POS invoices', invoiceError);
          return [];
        })
        : [];
      const linkedPosWarrantiesResult = profile && can(profile.role, 'pos.operate')
        ? (await Promise.all(linkedPosInvoicesResult.map((invoice) => getWarrantiesByInvoice(invoice.invoiceId, profile).catch(() => [])))).flat()
        : [];
      const jobQuotationActionsResult = profile
        ? await getJobQuotationActions(job, profile).catch((quotationError) => {
          console.error('Unable to load linked job quotations', quotationError);
          return [];
        })
        : [];
      const deviceChecklistResult = profile
        ? await getDeviceChecklistByJob({
          jobId: job.docId,
          user: profile,
          jobBranchId: job.branchId,
          jobTechnicianId: job.technicianId,
        }).catch((checklistError) => {
          console.error('Unable to load device checklist', checklistError);
          return null;
        })
        : null;
      const afterRepairChecklistResult = profile
        ? await getAfterRepairChecklistByJob({
          jobId: job.docId,
          user: profile,
          jobBranchId: job.branchId,
          jobTechnicianId: job.technicianId,
        }).catch((checklistError) => {
          console.error('Unable to load after repair checklist', checklistError);
          return null;
        })
        : null;
      const nextDocuments = documentsResult.status === 'fulfilled' ? documentsResult.value : [];
      const nextExtractions = extractionsResult.status === 'fulfilled' ? extractionsResult.value : [];
      const nextFinancial = financialResult.status === 'fulfilled' ? financialResult.value : null;

      if (documentsResult.status === 'rejected') {
        throw documentsResult.reason;
      }

      if (extractionsResult.status === 'rejected') {
        console.error('Unable to load document extractions', extractionsResult.reason);
      }

      if (financialResult.status === 'rejected') {
        console.error('Unable to load job financial snapshot', financialResult.reason);
      }

      const extractionMap = nextExtractions.reduce<Record<string, JobDocumentExtraction>>((current, extraction) => {
        current[extraction.documentId] = extraction;
        return current;
      }, {});

      setDocuments(nextDocuments);
      setExtractions(extractionMap);
      setExtractionEdits(
        nextExtractions.reduce<Record<string, JobDocumentExtractedData>>((current, extraction) => {
          current[extraction.documentId] = extraction.extractedData;
          return current;
        }, {}),
      );
      setFinancial(nextFinancial);
      setPartsOrders(partsOrdersResult);
      setWarrantyClaims(warrantyClaimsResult);
      setJobPayments(paymentsResult);
      setJobDocumentRecords(supportDocumentsResult);
      setPosFinancialSummary(posFinancialSummaryResult);
      setLinkedPosInvoices(linkedPosInvoicesResult);
      setLinkedPosWarranties(linkedPosWarrantiesResult);
      setJobQuotationActions(jobQuotationActionsResult);
      setDeviceChecklist(deviceChecklistResult);
      setAfterRepairChecklist(afterRepairChecklistResult);

      try {
        const nextPreview = await buildJobFinancialPreview(job.docId);
        setFinancialPreview(nextPreview);
      } catch {
        setFinancialPreview(null);
      }
    } catch (loadError) {
      warnJobPagePermissionSourceIfNeeded(loadError, {
        sourceFunction: 'refreshJobDetails',
        operationName: 'loadSelectedJobDetails',
        firestorePath: job
          ? `job detail reads for jobs/${job.docId}`
          : 'job detail reads',
        selectedJobDocId: job?.docId,
        selectedJobNumber: job ? getDisplayJobNumber(job) : undefined,
        profileUid: profile?.uid,
        profileRole: profile?.role,
        profileBranchId: profile?.branchId,
      });
      console.error('Unable to load job documentation section', loadError);
      setMessage(
        loadError instanceof Error && loadError.message.includes('permission')
          ? 'You do not have permission to view these job documents'
          : loadError instanceof Error
            ? loadError.message
            : 'Unable to load job documents',
      );
    } finally {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadJobDetails');
      setDetailsLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedJob) return;
    setDetailForm({
      customerId: selectedJob.customerId || null,
      deviceId: selectedJob.deviceId || null,
      customerName: selectedJob.customerName || '',
      customerPhone: selectedJob.customerPhone || '',
      deviceType: selectedJob.deviceType || '',
      deviceBrand: selectedJob.deviceBrand || '',
      deviceModel: selectedJob.deviceModel || selectedJob.device || '',
      serialNumber: selectedJob.serialNumber || '',
      devicePassword: selectedJob.devicePassword || '',
      issueDescription: selectedJob.issueDescription || '',
      quotationAmount: String(selectedJob.quotationAmount || 0),
      quotationNote: selectedJob.quotationNote || '',
      customerApprovalStatus: selectedJob.customerApprovalStatus || 'pending',
      diagnosisSummaryPublic: selectedJob.diagnosisSummaryPublic || '',
      repairSummaryPublic: selectedJob.repairSummaryPublic || '',
      estimatedCompletionAt: selectedJob.estimatedCompletionAt?.toDate?.().toISOString().slice(0, 10) || '',
      technicianId: selectedJob.technicianId || '',
    });
    setQuotationForm({
      quotationAmount: String(selectedJob.quotationAmount || 0),
      quotationNote: selectedJob.quotationNote || '',
    });
    setQuotationRejectReason('');
    setShowSelectedDevicePassword(false);
    setShowDetailDevicePassword(false);
    setShowDeviceChecklistEditor(false);
    setDeviceChecklistOverrideReason('');
    setDeviceChecklistCustomerSearch('');
    setDeviceChecklistForm(createDeviceChecklistFormDefaults({
      customerId: selectedJob.customerId || '',
      deviceId: selectedJob.deviceId || '',
      accessoriesReceived: (selectedJob as Job & { accessoriesReceived?: string }).accessoriesReceived || '',
    }));
    setQuotationProofFile(null);
    setQuotationProofInputKey((current) => current + 1);
    setLatestPosReceipt(null);
    const nextProfile = selectedJob.costProfile || 'parts_required';
    const nextRequired = getRequiredDocumentTypes(selectedJob);
    setRequirementProfile(nextProfile);
    setRequireSupplierReceipt(nextRequired.includes('supplier_receipt'));
    setRequireLogisticReceipt(nextRequired.includes('logistic_receipt'));
    void refreshJobDetails(selectedJob);
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob || !deviceChecklist) return;
    setDeviceChecklistForm(createDeviceChecklistFormDefaults({
      customerId: deviceChecklist.customerId || selectedJob.customerId || '',
      deviceId: deviceChecklist.deviceId || selectedJob.deviceId || '',
      items: normalizeChecklistItems(deviceChecklist.items),
      accessories: normalizeAccessories(deviceChecklist.accessories, deviceChecklist.accessoriesReceived || ''),
      internalComponents: normalizeInternalComponents(deviceChecklist.internalComponents, deviceChecklist.internalComponentInventory || ''),
      externalConditionSummary: deviceChecklist.externalConditionSummary || '',
      functionalChecklist: deviceChecklist.functionalChecklist || '',
      accessoriesReceived: deviceChecklist.accessoriesReceived || '',
      internalComponentInventory: deviceChecklist.internalComponentInventory || '',
    }));
  }, [deviceChecklist, selectedJob]);

  useEffect(() => {
    setAfterRepairChecklistForm(createAfterRepairChecklistFormDefaults({
      testedItems: normalizeAfterRepairTestedItems(afterRepairChecklist?.testedItems),
      remarks: afterRepairChecklist?.remarks || '',
    }));
  }, [afterRepairChecklist]);

  useEffect(() => {
    if (!profile?.branchId) return;
    setNewJob((current) => ({
      ...current,
      branchId: current.branchId || profile.branchId,
      technicianId: isTechnician(profile.role) ? profile.uid : current.technicianId,
    }));
  }, [profile?.branchId, profile?.role, profile?.uid]);

  useEffect(() => {
    let cancelled = false;

    if (!canManageReviews || (!showAddJob && !selectedJob)) return;

    setTechniciansLoading(true);
    getStaffList()
      .then((staff) => {
        if (cancelled) return;
        setTechnicians(staff.filter((member) => member.role === 'technician' && member.isActive));
      })
      .catch((staffError) => {
        if (cancelled) return;
        warnJobPagePermissionSourceIfNeeded(staffError, {
          sourceFunction: 'loadTechniciansEffect',
          operationName: 'getStaffList',
          firestorePath: 'users collection read',
          profileUid: profile?.uid,
          profileRole: profile?.role,
          profileBranchId: profile?.branchId,
        });
        setMessage(staffError instanceof Error ? staffError.message : 'Unable to load technicians');
      })
      .finally(() => {
        if (!cancelled) setTechniciansLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageReviews, selectedJob, showAddJob]);

  useEffect(() => {
    let cancelled = false;

    if (!profile || (!canManageReviews && !canCreateJobs) || (!showAddJob && !selectedJob)) return;

    const normalizedProfileBranchId = normalizeCustomerBranchForJob(profile.branchId);
    if (isTechnician(profile.role) && !normalizedProfileBranchId) {
      setCustomers([]);
      setDevices([]);
      setCustomerDataLoading(false);
      setMessage('Customer database access is limited. Enter customer details manually or search by phone.');
      return;
    }

    setCustomerDataLoading(true);
    Promise.all([
      getCustomers(profile),
      canManageReviews ? getDevices(profile.role) : Promise.resolve([]),
    ])
      .then(([nextCustomers, nextDevices]) => {
        if (cancelled) return;
        setCustomers(nextCustomers);
        setDevices(nextDevices);
      })
      .catch((customerError) => {
        if (cancelled) return;
        warnJobPagePermissionSourceIfNeeded(customerError, {
          sourceFunction: 'loadCustomersDevicesEffect',
          operationName: canManageReviews ? 'getCustomers + getDevices' : 'getCustomers',
          firestorePath: canManageReviews
            ? 'customers collection query, devices collection read'
            : `customers query${normalizedProfileBranchId ? ` where branch == ${normalizedProfileBranchId}` : ' without branch filter'}`,
          profileUid: profile.uid,
          profileRole: profile.role,
          profileBranchId: profile.branchId,
          normalizedBranchId: normalizedProfileBranchId,
          showAddJob,
          selectedJobDocId: selectedJob?.docId,
        });
        setMessage(
          isTechnician(profile.role) && isPermissionLikeError(customerError)
            ? 'Customer database access is limited. Enter customer details manually or search by phone.'
            : customerError instanceof Error
              ? customerError.message
              : 'Unable to load customer database',
        );
      })
      .finally(() => {
        if (!cancelled) setCustomerDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canCreateJobs, canManageReviews, profile, selectedJob, showAddJob]);

  useEffect(() => {
    let cancelled = false;
    if (!profile || !showAddJob || !canQuoteNowOnAddJob) return;

    getPriceItems(profile)
      .then((items) => {
        if (!cancelled) setJobPriceItems(items);
      })
      .catch((priceItemError) => {
        if (cancelled) return;
        warnJobPagePermissionSourceIfNeeded(priceItemError, {
          sourceFunction: 'loadAddJobPriceItemsEffect',
          operationName: 'getPriceItems',
          firestorePath: 'priceItems collection read',
          profileUid: profile.uid,
          profileRole: profile.role,
          profileBranchId: profile.branchId,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canQuoteNowOnAddJob, profile, showAddJob]);

  function applyCustomerToNewJob(customerId: string) {
    const customer = customers.find((item) => item.customerId === customerId);
    setNewJob((current) => ({
      ...current,
      customerId: customer?.customerId || null,
      customerNumber: customer?.customerNumber || current.customerNumber,
      deviceId: null,
      customerName: customer?.fullName || current.customerName,
      customerPhone: customer?.phone || current.customerPhone,
      normalizedPhone: customer?.normalizedPhone || normalizeCustomerPhone(customer?.phone || current.customerPhone),
      customerEmail: customer?.email || current.customerEmail,
      customerAddress: customer?.address || current.customerAddress,
      branchId: customer?.branch && customer.branch !== 'unknown' ? customer.branch : current.branchId,
    }));
  }

  function applyDeviceToNewJob(deviceId: string) {
    const device = devices.find((item) => item.deviceId === deviceId);
    setNewJob((current) => ({
      ...current,
      deviceId: device?.deviceId || null,
      device: device?.model || current.device,
      deviceType: device?.deviceType || current.deviceType,
      deviceBrand: device?.brand || current.deviceBrand,
      deviceModel: device?.model || current.deviceModel,
      serialNumber: device?.serialNumber || current.serialNumber,
    }));
  }

  function handleAddJobPricingModeChange(pricingMode: AddJobPricingMode) {
    if (pricingMode === 'quote_now' && !canQuoteNowOnAddJob) return;
    setNewJob((current) => ({
      ...current,
      pricingMode,
      totalSale: pricingMode === 'quote_now' ? String(selectedJobPriceItemsTotal || '') : current.totalSale,
      quotedPriceItems: pricingMode === 'quote_now' ? selectedJobPriceItems.map(selectedPriceItemToJobQuote) : [],
    }));
    if (pricingMode === 'diagnosis_first') {
      setSelectedJobPriceItems([]);
      setJobPriceItemSearch('');
    }
  }

  function addPriceItemToNewJob(item: PriceItem) {
    if (selectedJobPriceItems.some((selectedItem) => selectedItem.priceItemId === item.priceItemId)) return;
    const finalPrice = priceItemDefaultFinalPrice(item, newJob.branchId);
    const nextItem: AddJobSelectedPriceItem = {
      priceItemId: item.priceItemId,
      name: item.name,
      category: item.category,
      serviceGroup: item.serviceGroup,
      pricingType: item.pricingType || 'fixed',
      basePrice: Number(item.basePrice || 0),
      minPrice: Number(item.minPrice || 0),
      maxPrice: Number(item.maxPrice || 0),
      deviceType: item.deviceType || '',
      model: item.model || '',
      packageName: item.packageName || '',
      commissionEligible: item.commissionEligible === true,
      costPrice: Number(item.costPrice || 0),
      finalPrice,
      finalPriceInput: finalPrice > 0 ? String(finalPrice) : '',
    };
    const nextItems = [...selectedJobPriceItems, nextItem];
    const nextTotal = nextItems.reduce((sum, selectedItem) => sum + Math.max(0, Number(selectedItem.finalPriceInput || 0)), 0);
    setSelectedJobPriceItems(nextItems);
    setNewJob((current) => ({
      ...current,
      pricingMode: 'quote_now',
      totalSale: nextTotal > 0 ? String(nextTotal) : current.totalSale,
      quotedPriceItems: nextItems.map(selectedPriceItemToJobQuote),
    }));
  }

  function removePriceItemFromNewJob(priceItemId: string) {
    const nextItems = selectedJobPriceItems.filter((item) => item.priceItemId !== priceItemId);
    const nextTotal = nextItems.reduce((sum, item) => sum + Math.max(0, Number(item.finalPriceInput || 0)), 0);
    setSelectedJobPriceItems(nextItems);
    setNewJob((current) => ({
      ...current,
      totalSale: current.pricingMode === 'quote_now' ? String(nextTotal || '') : current.totalSale,
      quotedPriceItems: nextItems.map(selectedPriceItemToJobQuote),
    }));
  }

  function updateNewJobPriceItemFinalPrice(priceItemId: string, finalPriceInput: string) {
    const nextItems = selectedJobPriceItems.map((item) => (
      item.priceItemId === priceItemId
        ? { ...item, finalPriceInput, finalPrice: Number(finalPriceInput || 0) }
        : item
    ));
    const nextTotal = nextItems.reduce((sum, item) => sum + Math.max(0, Number(item.finalPriceInput || 0)), 0);
    setSelectedJobPriceItems(nextItems);
    setNewJob((current) => ({
      ...current,
      totalSale: current.pricingMode === 'quote_now' ? String(nextTotal || '') : current.totalSale,
      quotedPriceItems: nextItems.map(selectedPriceItemToJobQuote),
    }));
  }

  function applyCustomerToDetail(customerId: string) {
    const customer = customers.find((item) => item.customerId === customerId);
    setDetailForm((current) => ({
      ...current,
      customerId: customer?.customerId || null,
      deviceId: null,
      customerName: customer?.fullName || current.customerName,
      customerPhone: customer?.phone || current.customerPhone,
    }));
  }

  function applyDeviceToDetail(deviceId: string) {
    const device = devices.find((item) => item.deviceId === deviceId);
    setDetailForm((current) => ({
      ...current,
      deviceId: device?.deviceId || null,
      deviceType: device?.deviceType || current.deviceType,
      deviceBrand: device?.brand || current.deviceBrand,
      deviceModel: device?.model || current.deviceModel,
      serialNumber: device?.serialNumber || current.serialNumber,
    }));
  }

  async function handleQuickCreateCustomer() {
    if (!profile || !canManageReviews) return;

    setActionLoading(true);
    setMessage('');

    try {
      const customerId = await createCustomer(
        {
          fullName: newJob.customerName,
          phone: newJob.customerPhone || '',
          email: newJob.customerEmail || '',
          address: newJob.customerAddress || '',
          branch: normalizeCustomerBranchForJob(newJob.branchId) || 'unknown',
        },
        profile,
      );
      const nextCustomers = await getCustomers(profile);
      setCustomers(nextCustomers);
      setNewJob((current) => ({ ...current, customerId }));
      setMessage('Customer quick-created');
    } catch (error) {
      warnJobPagePermissionSourceIfNeeded(error, {
        sourceFunction: 'handleQuickCreateCustomer',
        operationName: 'createOrUpdateCustomerFromJobInput or getCustomers',
        firestorePath: 'counters/customerNumber_{year}, customers/{customerId}, auditLogs/{auditLogId}, customers query',
        profileUid: profile?.uid,
        profileRole: profile?.role,
        profileBranchId: profile?.branchId,
        normalizedBranchId: normalizeBranchId(profile?.branchId),
        customerPayloadBranch: normalizeCustomerBranchForJob(newJob.branchId) || 'unknown',
      });
      setMessage(error instanceof Error ? error.message : 'Unable to create customer');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleQuickCreateDevice() {
    if (!profile || !canManageReviews || !newJob.customerId) return;
    const customer = customers.find((item) => item.customerId === newJob.customerId);
    if (!customer) return;

    setActionLoading(true);
    setMessage('');

    try {
      const deviceId = await createDevice(
        {
          customerId: customer.customerId,
          customerName: customer.fullName,
          deviceType: newJob.deviceType || '',
          brand: newJob.deviceBrand || '',
          model: newJob.deviceModel || newJob.device,
          serialNumber: newJob.serialNumber || '',
          imei: '',
          notes: newJob.issueDescription || '',
        },
        profile,
      );
      const nextDevices = await getDevices(profile.role);
      setDevices(nextDevices);
      setNewJob((current) => ({ ...current, deviceId }));
      setMessage('Device quick-created');
    } catch (error) {
      warnJobPagePermissionSourceIfNeeded(error, {
        sourceFunction: 'handleQuickCreateDevice',
        operationName: 'createDevice or getDevices',
        firestorePath: 'devices/{deviceId}, auditLogs/{auditLogId}, devices collection read',
        profileUid: profile?.uid,
        profileRole: profile?.role,
        profileBranchId: profile?.branchId,
        selectedCustomerId: newJob.customerId,
      });
      setMessage(error instanceof Error ? error.message : 'Unable to create device');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handlerRawBranchId = profile && isTechnician(profile.role) ? profile.branchId : newJob.branchId;
    const handlerNormalizedBranchId = normalizeBranchId(handlerRawBranchId);
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:handlerEntered',
      profileUid: profile?.uid,
      profileRole: profile?.role,
      rawProfileBranchId: profile?.branchId,
      normalizedBranchId: handlerNormalizedBranchId,
      formCustomerName: newJob.customerName,
      formPhone: newJob.customerPhone,
      selectedBranchField: newJob.branchId,
      timestamp: new Date().toISOString(),
    });
    if (!profile || !canCreateJobs) {
      setMessage('You are not allowed to create jobs');
      return;
    }
    const rawBranchId = isTechnician(profile.role) ? profile.branchId : newJob.branchId;
    const normalizedBranchId = normalizeBranchId(rawBranchId);
    const customerPayloadBranch = normalizeCustomerBranchForJob(rawBranchId);
    const addJobDebugBase = {
      profileUid: profile.uid,
      profileRole: profile.role,
      rawProfileBranchId: profile.branchId,
      normalizedBranchId,
      customerPayloadBranch,
      jobPayloadBranchId: normalizedBranchId,
      jobPayloadCreatedBy: profile.uid,
      jobPayloadTechnicianId: isTechnician(profile.role) ? profile.uid : newJob.technicianId,
      jobPayloadStatus: 'received',
      jobPayloadLifecycleStatus: 'received',
      jobPayloadApprovalStatus: isTechnician(profile.role) ? 'submitted' : 'approved',
      jobPayloadCostProfile: isTechnician(profile.role) ? 'parts_required' : newJob.costProfile,
    };
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:start',
      ...addJobDebugBase,
    });
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:branchNormalized',
      ...addJobDebugBase,
    });
    if (isTechnician(profile.role) && (!normalizedBranchId || !customerPayloadBranch)) {
      setMessage('Your branch is missing or invalid. Please contact admin before creating a job.');
      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:catch',
        ...addJobDebugBase,
        errorName: 'InvalidBranch',
        errorMessage: 'Technician profile branch is missing or invalid',
        errorString: 'InvalidBranch: Technician profile branch is missing or invalid',
      });
      return;
    }

    if (newJob.pricingMode === 'quote_now') {
      if (!canQuoteNowOnAddJob) {
        setMessage('Only admin or manager can use Quote Now pricing during Add Job.');
        return;
      }
      if (selectedJobPriceItems.length === 0) {
        setMessage('Select at least one pricelist item for Quote Now.');
        return;
      }
      if (selectedJobPriceItemsNeedManualPrice) {
        setMessage('Enter final agreed price for range or quote-required pricelist items.');
        return;
      }
      if (!Number.isFinite(Number(newJob.totalSale)) || Number(newJob.totalSale) <= 0) {
        setMessage('Total sale is required for Quote Now.');
        return;
      }
    }

    setActionLoading(true);
    setMessage('');

    try {
      const selectedTechnician = technicians.find((technician) => technician.uid === newJob.technicianId);
      const branchId = isTechnician(profile.role) ? normalizedBranchId : normalizedBranchId || newJob.branchId.trim();
      const customerInput: {
        customerId?: string | null;
        fullName: string;
        phone: string;
        email: string;
        address: string;
        branch: CustomerBranch;
      } = {
        customerId: newJob.customerId,
        fullName: newJob.customerName,
        phone: newJob.customerPhone || '',
        email: newJob.customerEmail,
        address: newJob.customerAddress,
        branch: customerPayloadBranch || 'unknown',
      };
      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:customerCreate:start',
        ...addJobDebugBase,
        customerPayloadBranch: customerInput.branch,
        firestorePath: newJob.customerId ? `customers/${newJob.customerId}` : 'customers/{autoId}',
        payloadKeys: Object.keys(customerInput),
      });
      let linkedCustomer: Customer;
      try {
        linkedCustomer = await createOrUpdateCustomerFromJobInput(customerInput, profile);
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:customerCreate:success',
          ...addJobDebugBase,
          customerPayloadBranch: customerInput.branch,
          firestorePath: `customers/${linkedCustomer.customerId}`,
          payloadKeys: Object.keys(customerInput),
        });
      } catch (customerError) {
        warnJobPagePermissionSourceIfNeeded(customerError, {
          sourceFunction: 'handleCreateJob',
          operationName: 'customerCreateOrUpdate',
          firestorePath: newJob.customerId
            ? `customers/${newJob.customerId}`
            : 'counters/customerNumber_{year}, customers/{autoId}, auditLogs/{autoId}',
          profileUid: profile.uid,
          profileRole: profile.role,
          profileBranchId: profile.branchId,
          normalizedBranchId,
          customerPayloadBranch: customerInput.branch,
          jobPayloadBranchId: branchId,
        });
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:customerCreate:failed',
          ...addJobDebugBase,
          customerPayloadBranch: customerInput.branch,
          firestorePath: newJob.customerId ? `customers/${newJob.customerId}` : 'customers/{autoId}',
          payloadKeys: Object.keys(customerInput),
          ...getUnknownErrorDetails(customerError),
        });
        throw customerError;
      }
      const jobPayload = {
        ...newJob,
        customerId: linkedCustomer.customerId,
        customerNumber: linkedCustomer.customerNumber || '',
        customerName: linkedCustomer.fullName || newJob.customerName,
        customerPhone: linkedCustomer.phone || newJob.customerPhone,
        normalizedPhone: linkedCustomer.normalizedPhone || normalizeCustomerPhone(linkedCustomer.phone || newJob.customerPhone),
        branchId,
        technicianId: isTechnician(profile.role) ? profile.uid : newJob.technicianId,
        technicianName:
          isTechnician(profile.role)
            ? profile.displayName || profile.name || 'Unknown User'
            : selectedTechnician?.displayName || selectedTechnician?.name || 'Unknown User',
        totalSale: Number(newJob.totalSale),
        pricingMode: newJob.pricingMode || 'diagnosis_first',
        quotedPriceItems:
          newJob.pricingMode === 'quote_now'
            ? selectedJobPriceItems.map(selectedPriceItemToJobQuote)
            : [],
        createdBy: profile.uid,
        createdByDisplayName: profile.displayName || profile.name || 'Unknown User',
        creatorRole: profile.role,
      };
      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:jobNumber:start',
        ...addJobDebugBase,
        customerPayloadBranch: customerInput.branch,
        jobPayloadBranchId: jobPayload.branchId,
        jobPayloadCreatedBy: jobPayload.createdBy,
        jobPayloadTechnicianId: jobPayload.technicianId,
        firestorePath: 'systemCounters/jobNumbers_{year}, jobNumberRegistry/{jobNo}, jobs/{autoId}',
        payloadKeys: Object.keys(jobPayload),
      });
      let createdJob: Job;
      try {
        createdJob = await createJob(jobPayload);
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:jobCreate:success',
          ...addJobDebugBase,
          customerPayloadBranch: customerInput.branch,
          jobPayloadBranchId: jobPayload.branchId,
          jobPayloadCreatedBy: jobPayload.createdBy,
          jobPayloadTechnicianId: jobPayload.technicianId,
          firestorePath: `jobs/${createdJob.docId}`,
          payloadKeys: Object.keys(jobPayload),
        });
      } catch (jobError) {
        warnJobPagePermissionSourceIfNeeded(jobError, {
          sourceFunction: 'handleCreateJob',
          operationName: 'jobNumberAndJobCreate',
          firestorePath: 'systemCounters/jobNumbers_{year}, jobNumberRegistry/{jobNo}, jobs/{autoId}, auditLogs/{autoId}',
          profileUid: profile.uid,
          profileRole: profile.role,
          profileBranchId: profile.branchId,
          normalizedBranchId,
          customerPayloadBranch: customerInput.branch,
          jobPayloadBranchId: jobPayload.branchId,
          jobPayloadCreatedBy: jobPayload.createdBy,
          jobPayloadTechnicianId: jobPayload.technicianId,
          jobPayloadStatus: isTechnician(profile.role) ? 'received' : 'received',
          jobPayloadLifecycleStatus: 'received',
          jobPayloadApprovalStatus: isTechnician(profile.role) ? 'submitted' : 'approved',
          jobPayloadCostProfile: jobPayload.costProfile,
          payloadKeys: Object.keys(jobPayload),
        });
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:jobCreate:failed',
          ...addJobDebugBase,
          customerPayloadBranch: customerInput.branch,
          jobPayloadBranchId: jobPayload.branchId,
          jobPayloadCreatedBy: jobPayload.createdBy,
          jobPayloadTechnicianId: jobPayload.technicianId,
          firestorePath: 'systemCounters/jobNumbers_{year}, jobNumberRegistry/{jobNo}, jobs/{autoId}, auditLogs/{autoId}',
          payloadKeys: Object.keys(jobPayload),
          ...getUnknownErrorDetails(jobError),
        });
        throw jobError;
      }
      setNewJob({
        customerId: null,
        customerNumber: '',
        deviceId: null,
        customerName: '',
        customerPhone: '',
        normalizedPhone: '',
        customerEmail: '',
        customerAddress: '',
        device: '',
        branchId: profile.branchId || '',
        technicianId: isTechnician(profile.role) ? profile.uid : '',
        totalSale: '',
        paymentStatus: 'pending',
        devicePassword: '',
        costProfile: 'parts_required',
        requiredDocuments: ['supplier_receipt', 'logistic_receipt'],
        pricingMode: 'diagnosis_first',
        quotedPriceItems: [],
      });
      setSelectedJobPriceItems([]);
      setJobPriceItemSearch('');
      setShowAddJob(false);
      setMessage(`Job created: ${getDisplayJobNumber(createdJob)}`);
      await refetch();
    } catch (createError) {
      warnJobPagePermissionSourceIfNeeded(createError, {
        sourceFunction: 'handleCreateJob',
        operationName: 'addJobCatch',
        firestorePath: 'Add Job flow',
        profileUid: profile.uid,
        profileRole: profile.role,
        profileBranchId: profile.branchId,
        normalizedBranchId,
      });
      warnTechnicianAddJobDebug({
        checkpoint: 'addJob:catch',
        ...addJobDebugBase,
        firestorePath: 'Add Job flow',
        ...getUnknownErrorDetails(createError),
      });
      const errorMessage = createError instanceof Error ? createError.message : '';
      const errorCode = typeof createError === 'object' && createError && 'code' in createError
        ? String((createError as { code?: unknown }).code)
        : '';
      const isPermissionError =
        errorCode.includes('permission-denied') || errorMessage.toLowerCase().includes('permission');
      setMessage(
        isPermissionError
          ? 'Failed to add job. Please check your permission or required fields.'
          : errorMessage || 'Unable to create job',
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatusChange(nextStatus: RepairLifecycleStatus) {
    if (!profile || !selectedJob) return;
    if (
      nextStatus === 'repair_in_progress'
      && deviceChecklist?.checklistStatus !== 'customer_signed'
      && deviceChecklist?.checklistStatus !== 'signature_overridden'
    ) {
      setMessage('Customer Device Checklist signature is required before repair can proceed. Admin/manager can override with a reason if the customer is unavailable.');
      return;
    }
    if (nextStatus === 'ready_for_pickup' && !afterRepairChecklistCompleted(afterRepairChecklist)) {
      setShowAfterRepairChecklistEditor(true);
      setMessage('Please complete After Repair Checklist before marking this device as Ready for Pickup.');
      return;
    }

    setActionLoading(true);
    setMessage('');

    const shouldNotifyPickup = nextStatus === 'ready_for_pickup';
    const pickupPhoneDebug = shouldNotifyPickup ? getJobCustomerPhoneDebug(selectedJob) : null;
    const pickupPhone = pickupPhoneDebug?.normalizedPhone || null;
    const pickupBalance = Number(selectedPaymentSummary?.balanceDue || 0);
    const pickupMessageText = shouldNotifyPickup && pickupPhone
      ? buildReadyForPickupWhatsAppMessage({
        customerName: selectedJob.customerName,
        jobNumber: getDisplayJobNumber(selectedJob),
        deviceInfo: jobDeviceInfo(selectedJob),
        branchName: branchDisplayName(selectedJob.branchId),
        amount: pickupBalance > 0 ? pickupBalance : null,
      })
      : '';
    const pickupWhatsappUrl = shouldNotifyPickup && pickupPhone
      ? `https://wa.me/${pickupPhone}?text=${encodeURIComponent(pickupMessageText)}`
      : '';
    let whatsappWindow: Window | null = null;
    if (shouldNotifyPickup) {
      warnReadyPickupWhatsAppDebug({
        checkpoint: 'readyPickup:phoneValidation:before',
        rawSelectedJobCustomerPhone: selectedJob.customerPhone,
        rawSelectedJobPhone: (selectedJob as Job & { phone?: string }).phone,
        rawSelectedJobCustomerPhoneNested: (selectedJob as Job & { customer?: { phone?: string } }).customer?.phone,
        selectedPhoneFieldUsed: pickupPhoneDebug?.selectedPhoneField,
        selectedRawPhoneUsed: pickupPhoneDebug?.selectedRawPhone,
        normalizedPhoneResult: pickupPhone,
        phoneIsValid: Boolean(pickupPhone),
      });
      if (!pickupPhone) {
        setActionLoading(false);
        setMessage('Customer phone number is missing or invalid. Ready for Pickup WhatsApp was not sent.');
        return;
      }
      warnReadyPickupWhatsAppDebug({
        checkpoint: 'readyPickup:popupOpen:before',
        pickupWhatsappUrl,
        messageTextExists: Boolean(pickupMessageText),
        urlLength: pickupWhatsappUrl.length,
      });
      whatsappWindow = window.open('about:blank', '_blank');
      if (whatsappWindow) whatsappWindow.opener = null;
      warnReadyPickupWhatsAppDebug({
        checkpoint: 'readyPickup:popupOpen:after',
        whatsappWindowIsNull: whatsappWindow === null,
        popupOpenedSuccessfully: whatsappWindow !== null,
        whatsappWindowClosedImmediately: whatsappWindow ? whatsappWindow.closed : undefined,
      });
    }

    try {
      const overrideReason = !allowedNextStatuses.includes(nextStatus) ? window.prompt('Override reason') || '' : '';
      if (shouldNotifyPickup) {
        warnReadyPickupWhatsAppDebug({
          checkpoint: 'readyPickup:update:start',
          pickupWhatsappUrl,
          whatsappWindowExists: whatsappWindow !== null,
          whatsappWindowClosed: whatsappWindow ? whatsappWindow.closed : undefined,
        });
      }
      await updateJobLifecycleStatus({
        job: selectedJob,
        user: profile,
        nextStatus,
        note: statusNote,
        overrideReason,
        pickupNotification: shouldNotifyPickup,
      });
      if (shouldNotifyPickup) {
        warnReadyPickupWhatsAppDebug({
          checkpoint: 'readyPickup:update:success',
          pickupWhatsappUrl,
          whatsappWindowExists: whatsappWindow !== null,
          whatsappWindowClosed: whatsappWindow ? whatsappWindow.closed : undefined,
        });
      }
      const nextHistory = [
        ...(selectedJob.statusHistory || []),
        {
          status: nextStatus === 'repair_in_progress'
            ? 'in_repair'
            : nextStatus === 'repair_completed'
              ? 'completed'
              : nextStatus === 'ready_for_pickup'
                ? 'ready_for_collection'
                : nextStatus === 'delivered' || nextStatus === 'warranty_active' || nextStatus === 'warranty_expired'
                  ? 'collected'
                  : nextStatus === 'customer_rejected'
                    ? 'quotation_sent'
                    : nextStatus,
          changedBy: profile.uid,
          changedByDisplayName: profile.displayName || profile.name || 'Unknown User',
          changedAt: Timestamp.now(),
          note: statusNote,
        },
      ];
      const nextJob: Job = {
        ...selectedJob,
        lifecycleStatus: nextStatus,
        status: nextHistory[nextHistory.length - 1].status as Job['status'],
        statusHistory: nextHistory as Job['statusHistory'],
        ...(shouldNotifyPickup
          ? {
            readyForPickupAt: Timestamp.now(),
            readyForPickupBy: profile.uid,
            readyForPickupByDisplayName: profile.displayName || profile.name || 'Unknown User',
            pickupNotifiedAt: Timestamp.now(),
            pickupNotifiedBy: profile.uid,
            pickupNotifiedByDisplayName: profile.displayName || profile.name || 'Unknown User',
            repairSummaryPublic: 'Your device is ready for pickup at Genius Advanced.',
          }
          : {}),
      };
      setSelectedJob(nextJob);
      setStatusNote('');
      if (shouldNotifyPickup) {
        if (whatsappWindow) {
          warnReadyPickupWhatsAppDebug({
            checkpoint: 'readyPickup:assignUrl:start',
            pickupWhatsappUrl,
            whatsappWindowExists: true,
            whatsappWindowClosed: whatsappWindow.closed,
          });
          whatsappWindow.location.href = pickupWhatsappUrl;
          warnReadyPickupWhatsAppDebug({
            checkpoint: 'readyPickup:assignUrl:success',
            whatsappWindowClosed: whatsappWindow.closed,
          });
          setMessage('Job marked Ready for Pickup and WhatsApp message opened.');
        } else {
          warnReadyPickupWhatsAppDebug({
            checkpoint: 'readyPickup:assignUrl:start',
            pickupWhatsappUrl,
            whatsappWindowExists: false,
            whatsappWindowClosed: undefined,
          });
          const openedWindow = window.open(pickupWhatsappUrl, '_blank', 'noopener,noreferrer');
          warnReadyPickupWhatsAppDebug({
            checkpoint: 'readyPickup:assignUrl:success',
            whatsappWindowClosed: openedWindow ? openedWindow.closed : undefined,
          });
          setMessage(
            openedWindow
              ? 'Job marked Ready for Pickup and WhatsApp message opened.'
              : `Job marked Ready for Pickup. WhatsApp popup was blocked. Open manually: ${pickupWhatsappUrl}`,
          );
        }
      } else {
        setMessage('Job status updated');
      }
      await refetch();
    } catch (statusError) {
      const existedBeforeClose = whatsappWindow !== null;
      const closedBeforeClose = whatsappWindow ? whatsappWindow.closed : undefined;
      whatsappWindow?.close();
      if (shouldNotifyPickup) {
        warnReadyPickupWhatsAppDebug({
          checkpoint: 'readyPickup:catch',
          ...normalizeUnknownError(statusError),
          whatsappWindowExisted: existedBeforeClose,
          whatsappWindowClosedBeforeCatchClose: closedBeforeClose,
          whatsappWindowClosedByCatch: whatsappWindow ? whatsappWindow.closed : undefined,
        });
      }
      console.warn('[JOB LIFECYCLE STATUS WARNING JSON]', JSON.stringify({
        ...normalizeUnknownError(statusError),
        action: nextStatus === 'ready_for_pickup' ? 'ready_for_pickup_whatsapp' : 'update_job_lifecycle_status',
        selectedJobDocId: selectedJob.docId,
        selectedJobId: (selectedJob as Job & { id?: string }).id,
        selectedJobJobNumber: selectedJob.jobNumber,
        nextStatus,
        profileUid: profile.uid,
        profileRole: profile.role,
      }, null, 2));
      setMessage(statusError instanceof Error ? statusError.message : 'Unable to update job status');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveJobDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !profile || !canManageReviews) return;

    setActionLoading(true);
    setMessage('');

    try {
      const selectedTechnician = technicians.find((technician) => technician.uid === detailForm.technicianId);

      if (detailForm.technicianId && detailForm.technicianId !== selectedJob.technicianId) {
        await updateJobAssignment({
          job: selectedJob,
          user: profile,
          technicianId: detailForm.technicianId,
          technicianName: selectedTechnician?.displayName || selectedTechnician?.name || 'Unknown User',
        });
      }

      await updateJobDetails(selectedJob, {
        ...detailForm,
        quotationAmount: Number(detailForm.quotationAmount),
      }, profile);
      const nextJob = {
        ...selectedJob,
        customerId: detailForm.customerId,
        deviceId: detailForm.deviceId,
        customerName: detailForm.customerName,
        customerPhone: detailForm.customerPhone,
        deviceType: detailForm.deviceType,
        deviceBrand: detailForm.deviceBrand,
        deviceModel: detailForm.deviceModel,
        devicePassword: detailForm.devicePassword,
        serialNumber: detailForm.serialNumber,
        issueDescription: detailForm.issueDescription,
        customerApprovalStatus: detailForm.customerApprovalStatus,
        technicianId: detailForm.technicianId,
        device: detailForm.deviceModel,
        quotationAmount: Number(detailForm.quotationAmount),
        technicianName:
          selectedTechnician?.displayName ||
          selectedTechnician?.name ||
          selectedJob.technicianName ||
          'Unknown User',
      };
      setSelectedJob(nextJob);
      setMessage('Job details updated');
      await refetch();
    } catch (detailError) {
      setMessage(detailError instanceof Error ? detailError.message : 'Unable to update job details');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSavePublicTrackingFields() {
    if (!selectedJob || !profile || !canManageReviews) return;
    setActionLoading(true);
    setMessage('');
    try {
      await updateJobPublicTrackingFields(selectedJob, {
        diagnosisSummaryPublic: detailForm.diagnosisSummaryPublic,
        repairSummaryPublic: detailForm.repairSummaryPublic,
        estimatedCompletionAt: detailForm.estimatedCompletionAt,
      }, profile);
      setSelectedJob({
        ...selectedJob,
        diagnosisSummaryPublic: detailForm.diagnosisSummaryPublic,
        repairSummaryPublic: detailForm.repairSummaryPublic,
        estimatedCompletionAt: detailForm.estimatedCompletionAt
          ? Timestamp.fromDate(new Date(`${detailForm.estimatedCompletionAt}T00:00:00+08:00`))
          : null,
      });
      setMessage('Public tracking update saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save public tracking update');
    } finally {
      setActionLoading(false);
    }
  }

  async function prepareTrackingMessage(openWhatsApp: boolean) {
    if (!selectedJob) {
      setMessage('Please select a job first.');
      return;
    }
    if (!profile) {
      setMessage('Current user profile is not loaded.');
      return;
    }

    let whatsappWindow: Window | null = null;
    const normalizedPhone = normalizeMalaysiaPhoneForWhatsApp(selectedJob.customerPhone);
    if (openWhatsApp) {
      if (!normalizedPhone) {
        setMessage('Customer phone number is missing.');
        return;
      }
      whatsappWindow = window.open('', '_blank');
      if (whatsappWindow) whatsappWindow.opener = null;
    }

    setActionLoading(true);
    setMessage('');
    try {
      const code = await ensureJobTrackingCode(selectedJob, profile);
      const jobNo = getDisplayJobNumber(selectedJob);
      const currentStatus = getCurrentRepairLifecycleStatus(selectedJob);
      const trackingLink = `${appOrigin()}/track`;
      const baseMessageInput = {
        customerName: selectedJob.customerName,
        jobNumber: jobNo,
        deviceInfo: jobDeviceInfo(selectedJob),
      };
      const text = currentStatus === 'ready_for_pickup'
        ? buildReadyForPickupWhatsAppMessage({
            ...baseMessageInput,
            amount: selectedPaymentSummary?.balanceDue ?? selectedJob.balanceDue ?? selectedJob.totalAmountDue ?? selectedJob.totalSale,
          })
        : buildRepairStatusWhatsAppMessage({
            ...baseMessageInput,
            status: lifecycleLabelForJob(selectedJob),
            documentLink: `${trackingLink}\nTracking Code: ${code}`,
          });
      await navigator.clipboard.writeText(text).catch(() => undefined);
      await logJobTrackingMessageSent(selectedJob, profile).catch((error) => {
        console.error('[WHATSAPP TRACKING AUDIT ERROR]', {
          action: 'log_whatsapp_tracking_message_sent',
          jobId: selectedJob.docId,
          userId: profile.uid,
          userRole: profile.role,
          branchId: profile.branchId,
          requiredPermission: 'jobs.sendTrackingLink',
          error: loggableError(error),
        });
      });
      setSelectedJob({ ...selectedJob, publicTrackingCode: code });
      if (openWhatsApp) {
        const whatsapp = buildCustomerWhatsAppUrl(selectedJob.customerPhone, text);
        if (!whatsapp) {
          whatsappWindow?.close();
          setMessage('Customer phone number is missing.');
          return;
        }
        console.debug('[WHATSAPP TRACKING LINK]', {
          jobId: selectedJob.docId,
          customerName: selectedJob.customerName,
          rawPhone: selectedJob.customerPhone,
          normalizedPhone: whatsapp.normalizedPhone,
          trackingUrl: trackingLink,
          whatsappUrl: whatsapp.url,
        });
        if (whatsappWindow) {
          whatsappWindow.location.href = whatsapp.url;
          setMessage('WhatsApp tracking message opened.');
        } else {
          const openedWindow = window.open(whatsapp.url, '_blank', 'noopener,noreferrer');
          setMessage(
            openedWindow
              ? 'WhatsApp tracking message opened.'
              : 'WhatsApp popup was blocked. Please allow pop-ups and try again.',
          );
        }
      } else {
        setMessage('Tracking message copied.');
      }
    } catch (error) {
      whatsappWindow?.close();
      console.error('[WHATSAPP TRACKING ERROR]', {
        action: 'send_whatsapp_tracking_message',
        jobId: selectedJob.docId,
        userId: profile.uid,
        userRole: profile.role,
        branchId: profile.branchId,
        requiredPermission: 'jobs.sendTrackingLink',
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to prepare tracking message');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWhatsAppSupportDocument(record: JobDocumentRecord) {
    if (!selectedJob || !profile) return;
    if (!selectedJob.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }

    const jobNumber = getDisplayJobNumber(selectedJob);
    setActionLoading(true);
    try {
      const warrantyToken = record.type === 'warranty'
        ? await ensureJobWarrantySignatureToken(record, profile)
        : '';
      const message = record.type === 'warranty'
        ? buildWarrantyWhatsAppMessage({
          customerName: selectedJob.customerName,
          itemName: record.title || jobDeviceInfo(selectedJob),
          deviceId: jobDeviceInfo(selectedJob),
          jobId: jobNumber,
          warrantyDurationDays: record.warrantyPeriodDays || null,
          publicWarrantyToken: warrantyToken,
        })
        : buildRepairStatusWhatsAppMessage({
          customerName: selectedJob.customerName,
          jobNumber,
          deviceInfo: jobDeviceInfo(selectedJob),
          status: record.title,
          documentLink: record.fileUrl,
        });

      window.open(
        buildWaMeLink({ branch: selectedJob.branchId, recipientPhone: selectedJob.customerPhone, message }),
        '_blank',
        'noopener,noreferrer',
      );
      if (record.type === 'warranty') {
        setJobDocumentRecords((current) => current.map((row) => (
          row.documentId === record.documentId ? { ...row, publicWarrantyToken: warrantyToken, publicWarrantyTokenStatus: 'active' } : row
        )));
        setMessage('Job Warranty signature WhatsApp link opened.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare warranty signature link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendPosWarrantyTerms(warranty: PosWarranty) {
    if (!profile) return;
    if (!warranty.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }
    setActionLoading(true);
    try {
      const token = await ensureWarrantySignatureToken(warranty, profile);
      const nextWarranty = { ...warranty, publicWarrantyToken: token };
      window.open(buildWarrantyWhatsAppLink(nextWarranty), '_blank', 'noopener,noreferrer');
      await logWarrantyTermsWhatsAppSent(nextWarranty, profile).catch(() => undefined);
      setLinkedPosWarranties((current) => current.map((row) => (
        row.warrantyId === warranty.warrantyId ? nextWarranty : row
      )));
      setMessage('Warranty terms WhatsApp link opened.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare warranty terms link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendJobSheetWhatsApp() {
    if (!selectedJob) {
      setMessage('Please select a job first.');
      return;
    }
    if (!profile) {
      setMessage('Current user profile is not loaded.');
      return;
    }
    const normalizedPhone = normalizeMalaysiaPhoneForWhatsApp(selectedJob.customerPhone);
    if (!normalizedPhone) {
      setMessage('Customer phone number is missing.');
      return;
    }
    const whatsappWindow = window.open('', '_blank');
    if (whatsappWindow) whatsappWindow.opener = null;

    setActionLoading(true);
    setMessage('');
    try {
      console.debug('[WHATSAPP JOB SHEET ACTION]', {
        action: 'generate_job_sheet_whatsapp_link',
        jobId: selectedJob.docId,
        userId: profile.uid,
        userRole: profile.role,
        userBranchId: profile.branchId,
        jobBranchId: selectedJob.branchId,
        jobTechnicianId: selectedJob.technicianId,
      });
      const token = await ensureJobSheetConsentToken(selectedJob, profile);
      const publicLink = `${appOrigin()}/job-sheet/${token}`;
      const messageText = [
        `Hi ${selectedJob.customerName || 'Customer'}, Genius Advanced here.`,
        '',
        'Please review and sign your repair job sheet before we proceed with inspection and diagnosis.',
        '',
        `Job ID: ${getDisplayJobNumber(selectedJob)}`,
        `Device: ${jobDeviceInfo(selectedJob)}`,
        `Reported Issue: ${selectedJob.issueDescription || '-'}`,
        '',
        'Open your job sheet here:',
        publicLink,
        '',
        'Please tick the consent checklist and sign digitally.',
        '',
        'Thank you,',
        'Genius Advanced',
      ].join('\n');
      const whatsapp = buildCustomerWhatsAppUrl(normalizedPhone, messageText);
      if (!whatsapp) {
        whatsappWindow?.close();
        setMessage('Customer phone number is missing.');
        return;
      }
      console.debug('[WHATSAPP JOB SHEET LINK]', {
        action: 'generate_job_sheet_whatsapp_link',
        jobId: selectedJob.docId,
        userId: profile.uid,
        userRole: profile.role,
        userBranchId: profile.branchId,
        customerName: selectedJob.customerName,
        rawPhone: selectedJob.customerPhone,
        normalizedPhone: whatsapp.normalizedPhone,
        jobSheetUrl: publicLink,
        whatsappUrl: whatsapp.url,
      });
      if (whatsappWindow) {
        whatsappWindow.location.href = whatsapp.url;
        setMessage('Job Sheet WhatsApp link opened');
      } else {
        const openedWindow = window.open(whatsapp.url, '_blank', 'noopener,noreferrer');
        setMessage(
          openedWindow
            ? 'Job Sheet WhatsApp link opened'
            : 'WhatsApp popup was blocked. Please allow pop-ups and try again.',
        );
      }
      await refreshJobDetails({ ...selectedJob, jobSheetConsentToken: token });
    } catch (error) {
      whatsappWindow?.close();
      console.error('[WHATSAPP JOB SHEET ERROR]', {
        action: 'generate_job_sheet_whatsapp_link',
        jobId: selectedJob.docId,
        userId: profile.uid,
        userRole: profile.role,
        branchId: profile.branchId,
        jobBranchId: selectedJob.branchId,
        jobTechnicianId: selectedJob.technicianId,
        requiredPermission: 'jobs.sendTrackingLink for tracking code generation; assigned job or jobs.update for Job Sheet token',
        error: loggableError(error),
      });
      const errorMessage = error instanceof Error ? error.message : '';
      const errorCode = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      const isPermissionError =
        errorCode.includes('permission-denied') || errorMessage.toLowerCase().includes('permission');
      setMessage(
        isPermissionError
          ? 'Unable to create Job Sheet WhatsApp link. Please check your job assignment or branch access.'
          : errorMessage || 'Unable to send Job Sheet via WhatsApp',
      );
    } finally {
      setActionLoading(false);
    }
  }

  function importSelectedJobIntoDeviceChecklist() {
    if (!selectedJob) return;
    setDeviceChecklistForm((current) => ({
      ...current,
      customerId: selectedJob.customerId || current.customerId,
      deviceId: selectedJob.deviceId || current.deviceId,
      accessoriesReceived: (selectedJob as Job & { accessoriesReceived?: string }).accessoriesReceived || current.accessoriesReceived,
    }));
    setMessage('Job customer and device details imported into Device Checklist.');
  }

  async function handleSaveDeviceChecklist(completeByStaff: boolean) {
    if (!selectedJob || !profile) {
      setMessage('Please select a job first.');
      return;
    }
    if (!canUploadForSelectedJob) {
      setMessage('You are not allowed to manage this Device Checklist.');
      return;
    }

    const scrollAnchor = captureScrollAnchor();
    setActionLoading(true);
    setMessage('');
    try {
      const selectedCustomer = deviceChecklistCustomer || undefined;
      const selectedDevice = deviceChecklistDevice || undefined;
      let checklist = deviceChecklist;
      const createdAt = Timestamp.now();
      if (!checklist) {
        const checklistId = await createDeviceChecklistFromJob(selectedJob, profile, {
          customer: selectedCustomer,
          device: selectedDevice,
          items: deviceChecklistForm.items,
          accessories: deviceChecklistForm.accessories,
          internalComponents: deviceChecklistForm.internalComponents,
          externalConditionSummary: deviceChecklistForm.externalConditionSummary,
          functionalChecklist: deviceChecklistForm.functionalChecklist,
          accessoriesReceived: deviceChecklistForm.accessoriesReceived,
          internalComponentInventory: deviceChecklistForm.internalComponentInventory,
        });
        checklist = {
          checklistId,
          jobId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          customerId: selectedCustomer?.customerId || selectedJob.customerId || '',
          customerNameSnapshot: selectedCustomer?.fullName || selectedJob.customerName || '',
          customerPhoneSnapshot: selectedCustomer?.phone || selectedJob.customerPhone || '',
          customerEmailSnapshot: selectedCustomer?.email || (selectedJob as Job & { customerEmail?: string }).customerEmail || '',
          deviceId: selectedDevice?.deviceId || selectedJob.deviceId || '',
          deviceCategorySnapshot: selectedDevice?.deviceType || selectedJob.deviceType || '',
          deviceBrandModelSnapshot: selectedDevice ? [selectedDevice.brand, selectedDevice.model].filter(Boolean).join(' ') : jobDeviceInfo(selectedJob),
          deviceSerialOrImeiSnapshot: selectedDevice?.serialNumber || selectedDevice?.imei || selectedJob.serialNumber || '',
          reportedIssueSnapshot: selectedJob.issueDescription || '',
          branchId: selectedJob.branchId || '',
          assignedTechnicianId: selectedJob.technicianId || '',
          assignedTechnicianName: selectedJob.technicianName || '',
          importedFromJob: true,
          importedFromCustomer: Boolean(selectedCustomer?.customerId || selectedJob.customerId),
          importedFromDevice: Boolean(selectedDevice?.deviceId || selectedJob.deviceId),
          items: deviceChecklistForm.items,
          accessories: deviceChecklistForm.accessories,
          internalComponents: deviceChecklistForm.internalComponents,
          externalConditionSummary: deviceChecklistForm.externalConditionSummary,
          functionalChecklist: deviceChecklistForm.functionalChecklist,
          accessoriesReceived: deviceChecklistForm.accessoriesReceived,
          internalComponentInventory: deviceChecklistForm.internalComponentInventory,
          disclaimer: '',
          checklistStatus: 'draft',
          createdBy: profile.uid,
          createdByDisplayName: profile.displayName || profile.name || profile.email || '',
          createdAt,
          updatedAt: createdAt,
        };
      }

      if (completeByStaff || deviceChecklist) {
        await updateDeviceChecklistStaffDetails(checklist, selectedJob, profile, {
          customer: selectedCustomer,
          device: selectedDevice,
          items: deviceChecklistForm.items,
          accessories: deviceChecklistForm.accessories,
          internalComponents: deviceChecklistForm.internalComponents,
          externalConditionSummary: deviceChecklistForm.externalConditionSummary,
          functionalChecklist: deviceChecklistForm.functionalChecklist,
          accessoriesReceived: deviceChecklistForm.accessoriesReceived,
          internalComponentInventory: deviceChecklistForm.internalComponentInventory,
          completeByStaff,
        });
      }

      const updatedAt = Timestamp.now();
      setDeviceChecklist({
        ...checklist,
        customerId: selectedCustomer?.customerId || selectedJob.customerId || '',
        customerNameSnapshot: selectedCustomer?.fullName || selectedJob.customerName || '',
        customerPhoneSnapshot: selectedCustomer?.phone || selectedJob.customerPhone || '',
        customerEmailSnapshot: selectedCustomer?.email || (selectedJob as Job & { customerEmail?: string }).customerEmail || '',
        deviceId: selectedDevice?.deviceId || selectedJob.deviceId || '',
        deviceCategorySnapshot: selectedDevice?.deviceType || selectedJob.deviceType || selectedJob.device || '',
        deviceBrandModelSnapshot: selectedDevice ? [selectedDevice.brand, selectedDevice.model].filter(Boolean).join(' ') : jobDeviceInfo(selectedJob),
        deviceSerialOrImeiSnapshot: selectedDevice?.serialNumber || selectedDevice?.imei || selectedJob.serialNumber || '',
        reportedIssueSnapshot: selectedJob.issueDescription || '',
        branchId: selectedJob.branchId || '',
        assignedTechnicianId: selectedJob.technicianId || '',
        assignedTechnicianName: selectedJob.technicianName || '',
        importedFromJob: true,
        importedFromCustomer: Boolean(selectedCustomer?.customerId || selectedJob.customerId),
        importedFromDevice: Boolean(selectedDevice?.deviceId || selectedJob.deviceId),
        items: normalizeChecklistItems(deviceChecklistForm.items),
        accessories: normalizeAccessories(deviceChecklistForm.accessories, deviceChecklistForm.accessoriesReceived),
        internalComponents: normalizeInternalComponents(deviceChecklistForm.internalComponents, deviceChecklistForm.internalComponentInventory),
        externalConditionSummary: deviceChecklistForm.externalConditionSummary.trim(),
        functionalChecklist: deviceChecklistForm.functionalChecklist.trim(),
        accessoriesReceived: deviceChecklistForm.accessoriesReceived.trim(),
        internalComponentInventory: deviceChecklistForm.internalComponentInventory.trim(),
        checklistStatus: completeByStaff ? 'staff_completed' : 'draft',
        technicianVerification: completeByStaff
          ? {
              technicianId: selectedJob.technicianId || profile.uid,
              technicianName: profile.displayName || profile.name || profile.email || 'Unknown User',
              technicianRole: profile.role,
              branchId: profile.branchId || selectedJob.branchId || '',
              checkedAt: updatedAt,
              authUid: profile.uid,
              verificationText: 'Auto verified by RIGX System',
            }
          : checklist.technicianVerification,
        updatedAt,
      });
      setMessage(completeByStaff ? 'Device Checklist completed by staff.' : 'Device Checklist saved.');
      restoreScrollAnchor(scrollAnchor);
    } catch (error) {
      console.error('[DEVICE CHECKLIST SAVE ERROR]', {
        action: completeByStaff ? 'complete_device_checklist_staff' : 'create_device_checklist',
        jobId: selectedJob.docId,
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to save Device Checklist.');
      restoreScrollAnchor(scrollAnchor);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCompleteAfterRepairChecklist() {
    if (!selectedJob || !profile) {
      setMessage('Please select a job first.');
      return;
    }
    if (!canUploadForSelectedJob) {
      setMessage('You are not allowed to complete this After Repair Checklist.');
      return;
    }

    const scrollAnchor = captureScrollAnchor();
    setActionLoading(true);
    setMessage('');
    try {
      const checklistId = await completeAfterRepairChecklist(selectedJob, profile, {
        checklist: afterRepairChecklist,
        testedItems: afterRepairChecklistForm.testedItems,
        remarks: afterRepairChecklistForm.remarks,
      });
      setMessage('After Repair Checklist completed.');
      const completedAt = Timestamp.now();
      setAfterRepairChecklist((current) => ({
        ...(current || {
          checklistId,
          jobId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          customerId: selectedJob.customerId || '',
          customerNameSnapshot: selectedJob.customerName || '',
          customerPhoneSnapshot: selectedJob.customerPhone || '',
          deviceCategorySnapshot: selectedJob.deviceType || selectedJob.device || '',
          deviceBrandModelSnapshot: jobDeviceInfo(selectedJob),
          deviceSerialOrImeiSnapshot: selectedJob.serialNumber || '',
          reportedIssueSnapshot: selectedJob.issueDescription || '',
          branchId: selectedJob.branchId || '',
          importedFromJob: true,
          importedFromCustomer: Boolean(selectedJob.customerId),
          importedFromDevice: Boolean(selectedJob.deviceId),
          externalConditionSummary: '',
          functionalChecklist: '',
          accessoriesReceived: '',
          internalComponentInventory: '',
          disclaimer: '',
          createdBy: profile.uid,
          createdByDisplayName: profile.displayName || profile.name || profile.email || '',
          createdAt: completedAt,
        }),
        checklistId,
        checklistType: 'after_repair',
        checklistStatus: 'completed',
        technicianId: profile.uid,
        completedAt,
        testedItems: afterRepairChecklistForm.testedItems,
        remarks: afterRepairChecklistForm.remarks.trim(),
        technicianVerification: {
          technicianId: selectedJob.technicianId || profile.uid,
          technicianName: profile.displayName || profile.name || profile.email || 'Unknown User',
          technicianRole: profile.role,
          branchId: profile.branchId || selectedJob.branchId || '',
          checkedAt: completedAt,
          authUid: profile.uid,
          verificationText: 'Auto verified by RIGX System',
        },
        updatedAt: completedAt,
      }));
      restoreScrollAnchor(scrollAnchor);
    } catch (error) {
      console.error('[AFTER REPAIR CHECKLIST SAVE ERROR]', {
        action: 'complete_after_repair_checklist',
        jobId: selectedJob.docId,
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to complete After Repair Checklist.');
      restoreScrollAnchor(scrollAnchor);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendDeviceChecklistWhatsApp() {
    if (!selectedJob || !profile) {
      setMessage('Please select a job first.');
      return;
    }
    if (!canUploadForSelectedJob) {
      setMessage('You are not allowed to send this Device Checklist.');
      return;
    }
    const phone = deviceChecklist?.customerPhoneSnapshot || selectedJob.customerPhone;
    if (!normalizeMalaysiaPhoneForWhatsApp(phone)) {
      setMessage('Customer phone number is missing.');
      return;
    }

    const whatsappWindow = window.open('', '_blank');
    if (whatsappWindow) whatsappWindow.opener = null;
    setActionLoading(true);
    setMessage('');
    try {
      let checklist = deviceChecklist;
      if (!checklist) {
        const checklistId = await createDeviceChecklistFromJob(selectedJob, profile, {
          customer: deviceChecklistCustomer || undefined,
          device: deviceChecklistDevice || undefined,
          items: deviceChecklistForm.items,
          accessories: deviceChecklistForm.accessories,
          internalComponents: deviceChecklistForm.internalComponents,
          externalConditionSummary: deviceChecklistForm.externalConditionSummary,
          functionalChecklist: deviceChecklistForm.functionalChecklist,
          accessoriesReceived: deviceChecklistForm.accessoriesReceived,
          internalComponentInventory: deviceChecklistForm.internalComponentInventory,
        });
        checklist = await getDeviceChecklistByJob({
          jobId: selectedJob.docId,
          user: profile,
          jobBranchId: selectedJob.branchId,
          jobTechnicianId: selectedJob.technicianId,
        });
        if (!checklist || checklist.checklistId !== checklistId) {
          checklist = await getDeviceChecklistByJob({
            jobId: selectedJob.docId,
            user: profile,
            jobBranchId: selectedJob.branchId,
            jobTechnicianId: selectedJob.technicianId,
          });
        }
      }
      if (!checklist) throw new Error('Unable to create Device Checklist.');
      const token = await ensureDeviceChecklistSignatureToken(checklist, selectedJob, profile);
      const signatureLink = `${appOrigin()}/device-checklist/sign/${token}`;
      const whatsappUrl = buildDeviceChecklistWhatsAppLink({ ...checklist, publicSignatureToken: token }, signatureLink);
      if (whatsappWindow) {
        whatsappWindow.location.href = whatsappUrl;
      } else {
        const openedWindow = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        if (!openedWindow) {
          await navigator.clipboard.writeText(whatsappUrl).catch(() => undefined);
          setMessage('WhatsApp popup was blocked. Signature link copied.');
          return;
        }
      }
      await markDeviceChecklistSentWhatsApp({ ...checklist, publicSignatureToken: token }, selectedJob, profile);
      await refreshJobDetails(selectedJob);
      setMessage('Device Checklist signature link opened in WhatsApp.');
    } catch (error) {
      whatsappWindow?.close();
      console.error('[DEVICE CHECKLIST WHATSAPP ERROR]', {
        action: 'send_device_checklist_signature_whatsapp',
        jobId: selectedJob.docId,
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to send Device Checklist via WhatsApp.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCopyDeviceChecklistLink() {
    if (!selectedJob || !profile || !deviceChecklist) return;
    setActionLoading(true);
    setMessage('');
    try {
      const token = await ensureDeviceChecklistSignatureToken(deviceChecklist, selectedJob, profile);
      await navigator.clipboard.writeText(`${appOrigin()}/device-checklist/sign/${token}`);
      await refreshJobDetails(selectedJob);
      setMessage('Device Checklist signature link copied.');
    } catch (error) {
      console.error('[DEVICE CHECKLIST COPY LINK ERROR]', {
        action: 'copy_device_checklist_signature_link',
        jobId: selectedJob.docId,
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to copy Device Checklist link.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleOverrideDeviceChecklistSignature() {
    if (!selectedJob || !profile || !deviceChecklist) return;
    setActionLoading(true);
    setMessage('');
    try {
      await overrideDeviceChecklistSignature(deviceChecklist, selectedJob, profile, deviceChecklistOverrideReason);
      await refreshJobDetails(selectedJob);
      setDeviceChecklistOverrideReason('');
      setMessage('Device Checklist signature override recorded.');
    } catch (error) {
      console.error('[DEVICE CHECKLIST OVERRIDE ERROR]', {
        action: 'override_device_checklist_signature',
        jobId: selectedJob.docId,
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        error: loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to override Device Checklist signature.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManualJobSheetConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedJob || !canManageReviews) return;
    if (!manualJobSheetConsentForm.confirmed) {
      setMessage('Please confirm the customer or authorised representative has agreed to the Repair Job Sheet Terms & Conditions.');
      return;
    }

    setActionLoading(true);
    setMessage('');
    try {
      await recordManualJobSheetConsent(selectedJob, profile, {
        consentMethod: manualJobSheetConsentForm.consentMethod,
        signerName: manualJobSheetConsentForm.signerName,
        icOrPassportNo: manualJobSheetConsentForm.icOrPassportNo,
        phone: manualJobSheetConsentForm.phone,
        notes: manualJobSheetConsentForm.notes,
      });
      setShowManualJobSheetConsent(false);
      setManualJobSheetConsentForm({
        consentMethod: 'WhatsApp',
        signerName: '',
        icOrPassportNo: '',
        phone: '',
        notes: '',
        confirmed: false,
      });
      setMessage('Job Sheet consent recorded');
      await refreshJobDetails(selectedJob);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record Job Sheet consent');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleQuotationAction(nextStatus: 'draft' | 'sent' | 'approved' | 'rejected') {
    if (!profile || !selectedJob || !canManageReviews) return;

    setActionLoading(true);
    setMessage('');

    try {
      await updateQuotation({
        job: selectedJob,
        user: profile,
        quotationAmount: Number(quotationForm.quotationAmount),
        quotationNote: quotationForm.quotationNote,
        nextStatus,
        rejectedReason: quotationRejectReason,
        proofFile: quotationProofFile,
      });
      setMessage(
        nextStatus === 'sent'
          ? 'Quotation sent'
          : nextStatus === 'approved'
            ? 'Quotation approved'
            : nextStatus === 'rejected'
              ? 'Quotation rejected'
              : 'Quotation revised',
      );
      setQuotationProofFile(null);
      setQuotationProofInputKey((current) => current + 1);
      setQuotationRejectReason('');
      await refetch();
      setSelectedJob({
        ...selectedJob,
        quotationAmount: Number(quotationForm.quotationAmount),
        quotationNote: quotationForm.quotationNote,
        quotationStatus: nextStatus,
        customerApprovalStatus:
          nextStatus === 'approved'
            ? 'approved'
            : nextStatus === 'rejected'
              ? 'rejected'
              : selectedJob.customerApprovalStatus,
        status: nextStatus === 'approved' ? 'customer_approved' : selectedJob.status,
        quotationApprovedByDisplayName:
          nextStatus === 'approved' ? profile.displayName || profile.name || 'Unknown User' : selectedJob.quotationApprovedByDisplayName,
        quotationRejectedReason: nextStatus === 'rejected' ? quotationRejectReason : selectedJob.quotationRejectedReason,
      });
    } catch (quotationError) {
      setMessage(quotationError instanceof Error ? quotationError.message : 'Unable to update quotation');
    } finally {
      setActionLoading(false);
    }
  }

  async function refreshSelectedJobContext() {
    await refetch();
    if (selectedJob) {
      await refreshJobDetails(selectedJob);
    }
  }

  function openJobQuotationModal() {
    if (!selectedJob) return;
    setJobQuotationForm({
      items: [{
        name: selectedJob.issueDescription || jobDeviceInfo(selectedJob),
        category: 'Repair',
        type: 'service',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        warrantyDurationDays: 0,
        total: 0,
      }],
      depositAmount: '0',
      discountReason: selectedJob.diagnosisNote || '',
      validUntil: '',
    });
    setShowJobQuotationModal(true);
  }

  function updateJobQuotationItem(index: number, patch: Partial<PosLineItem>) {
    setJobQuotationForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextItem = { ...item, ...patch };
        return { ...nextItem, total: quotationLineTotal(nextItem) };
      }),
    }));
  }

  function addJobQuotationItem() {
    setJobQuotationForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { name: '', category: 'Repair', type: 'service', quantity: 1, unitPrice: 0, discount: 0, warrantyDurationDays: 0, total: 0 },
      ],
    }));
  }

  function removeJobQuotationItem(index: number) {
    setJobQuotationForm((current) => ({
      ...current,
      items: current.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleCreateQuotationFromJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedJob) return;
    setActionLoading(true);
    setMessage('');
    try {
      const items = jobQuotationForm.items
        .map((item) => ({
          ...item,
          name: String(item.name || '').trim(),
          category: String(item.category || 'Repair').trim(),
          type: item.type || 'service',
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          discount: Number(item.discount || 0),
          warrantyDurationDays: Number(item.warrantyDurationDays || 0),
          total: quotationLineTotal(item),
        }))
        .filter((item) => item.name && item.quantity > 0);
      if (items.length === 0) throw new Error('Add at least one quotation line item');
      const depositAmount = parseCurrencyInput(jobQuotationForm.depositAmount);
      const notes = [
        jobQuotationForm.discountReason.trim(),
        depositAmount > 0 ? `Deposit / Advance Payment: ${formatCurrency(depositAmount)}` : '',
      ].filter(Boolean).join('\n\n');
      const quotation = await createQuotationFromJob(selectedJob, {
        items,
        discountAmount: 0,
        discountReason: notes,
        validUntil: jobQuotationForm.validUntil,
      }, profile);
      setShowJobQuotationModal(false);
      setMessage(`Quotation created: ${quotation.quotationNumber || quotation.quotationNo}`);
      await refreshSelectedJobContext();
    } catch (error) {
      console.error('[CREATE QUOTATION FROM JOB ERROR]', {
        action: 'create_quotation_from_job',
        jobId: selectedJob.docId,
        jobNumber: getDisplayJobNumber(selectedJob),
        userId: profile.uid,
        role: profile.role,
        branchId: profile.branchId,
        ...loggableError(error),
      });
      setMessage(error instanceof Error ? error.message : 'Unable to create quotation from job');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendPosQuotationWhatsApp(quotationId: string) {
    if (!profile || !selectedJob) return;
    const linkedQuotation = jobQuotationActions.find((quotation) => quotation.quotationId === quotationId);
    const recipientPhone = normalizeMalaysiaPhoneForWhatsApp(selectedJob.customerPhone || linkedQuotation?.customerPhone || '');
    if (!recipientPhone) {
      setMessage('Customer phone number is missing.');
      return;
    }
    const whatsappWindow = window.open('', '_blank');
    if (whatsappWindow) whatsappWindow.opener = null;

    setActionLoading(true);
    setMessage('');
    try {
      const quotation = await prepareJobQuotationWhatsApp(quotationId, selectedJob, profile);
      const publicToken = quotation.quotationApprovalToken || quotation.publicToken || '';
      const publicLink = `${appOrigin()}/quotation/${publicToken}`;
      const jobId = getDisplayJobNumber(selectedJob);
      const deviceModel = jobDeviceInfo(selectedJob);
      const totalAmount = Number(quotation.total || 0).toFixed(2);
      const messageText = [
        'Hi, this is Genius Advanced.',
        '',
        'Your repair quotation is now ready for review.',
        '',
        `Repair ID: ${jobId}`,
        `Device: ${deviceModel}`,
        `Issue Reported: ${selectedJob.issueDescription || '-'}`,
        `Total Quotation: RM ${totalAmount}`,
        '',
        'Kindly review the quotation and confirm whether you would like us to proceed using the secure link below:',
        publicLink,
        '',
        'Repair work will only begin after your approval has been submitted.',
        '',
        'Thank you for choosing Genius Advanced.',
      ].join('\n');

      const whatsappUrl = buildWaMeLink({ recipientPhone: recipientPhone, message: messageText });
      if (whatsappWindow) {
        whatsappWindow.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      }
      setMessage('Quotation WhatsApp link opened');
      await refreshSelectedJobContext();
    } catch (error) {
      whatsappWindow?.close();
      setMessage(error instanceof Error ? error.message : 'Unable to send quotation via WhatsApp');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManualApprovePosQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedJob || !manualApprovalTarget || !canManageReviews) return;
    if (!manualApprovalForm.confirmed) {
      setMessage('Please confirm the customer or authorised representative has approved this quotation.');
      return;
    }

    setActionLoading(true);
    setMessage('');
    try {
      const quotation = await getQuotationById(manualApprovalTarget, profile);
      await approvePosQuotation(quotation, profile, {
        approvalMethod: manualApprovalForm.approvalMethod,
        approvedByName: manualApprovalForm.approvedByName,
        notes: manualApprovalForm.notes,
      });
      setManualApprovalTarget('');
      setManualApprovalForm({ approvalMethod: 'WhatsApp', approvedByName: '', notes: '', confirmed: false });
      setMessage('Quotation manually approved');
      await refreshSelectedJobContext();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve quotation');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectPosQuotation(quotationId: string) {
    if (!profile || !selectedJob || !canManageReviews) return;
    const reason = window.prompt('Reason for rejection (required)');
    if (!reason?.trim()) return;

    setActionLoading(true);
    setMessage('');
    try {
      const quotation = await getQuotationById(quotationId, profile);
      await rejectPosQuotation(quotation, reason, profile);
      setMessage('Quotation marked rejected');
      await refreshSelectedJobContext();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject quotation');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleJobApproval(job: Job, status: 'approved' | 'rejected') {
    if (!profile || !canManageReviews) return;

    setActionLoading(true);
    setMessage('');

    try {
      await updateJobApprovalStatus(job, status, profile);
      setMessage(status === 'approved' ? 'Job approved' : 'Job rejected');
      await refetch();
      if (selectedJob?.docId === job.docId) {
        setSelectedJob({ ...job, status, approvalStatus: status });
      }
    } catch (approvalError) {
      setMessage(approvalError instanceof Error ? approvalError.message : 'Unable to update job approval');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteJob() {
    if (!profile || !jobPendingDelete || !canDeleteJobs) return;

    setDeleteLoading(true);
    setMessage('');

    try {
      await deleteJob(jobPendingDelete, profile);
      if (selectedJob?.docId === jobPendingDelete.docId) {
        setSelectedJob(null);
      }
      setJobPendingDelete(null);
      setMessage('Job deleted successfully');
      await refetch();
    } catch (deleteError) {
      setMessage(deleteError instanceof Error ? deleteError.message : 'Unable to delete job');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile || !selectedJob || !uploadFile) {
      setMessage('Select a job and file before uploading');
      return;
    }

    if (!allowedUploadTypes.includes(uploadFile.type)) {
      setMessage('Only JPG, PNG, or PDF files are allowed');
      return;
    }

    if (uploadFile.size > maxUploadSize) {
      setMessage('File must be 10MB or smaller');
      return;
    }

    setUploadLoading(true);
    setMessage('');

    try {
      await uploadJobDocument({
        job: selectedJob as JobLike,
        file: uploadFile,
        type: uploadType,
        user: profile,
        amount: uploadAmount ? Number(uploadAmount) : undefined,
      });
      setUploadFile(null);
      setUploadAmount('');
      setUploadType('supplier_receipt');
      setFileInputKey((current) => current + 1);
      await refreshJobDetails(selectedJob);
      setMessage('Document uploaded for review');
    } catch (uploadError) {
      console.error('UPLOAD FAILED', uploadError);
      setMessage(uploadError instanceof Error ? uploadError.message : 'Unable to upload document');
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleRequirementFileUpload(type: JobDocumentType, file?: File | null) {
    if (!profile || !selectedJob || !file) return;

    if (!allowedUploadTypes.includes(file.type)) {
      setMessage('Only JPG, PNG, or PDF files are allowed');
      return;
    }

    if (file.size > maxUploadSize) {
      setMessage('File must be 10MB or smaller');
      return;
    }

    setUploadLoading(true);
    setMessage('');

    try {
      await uploadJobDocument({
        job: selectedJob as JobLike,
        file,
        type,
        user: profile,
      });
      await refreshJobDetails(selectedJob);
      setMessage(`${documentTypeLabel(type)} uploaded for review`);
    } catch (uploadError) {
      console.error('[DOCUMENT REQUIREMENT UPLOAD ERROR]', uploadError);
      setMessage(uploadError instanceof Error ? uploadError.message : 'Unable to upload document');
    } finally {
      setUploadLoading(false);
    }
  }

  function resetSupportDocumentForm() {
    setSupportDocumentForm({
      title: '',
      description: '',
      warrantyPeriodType: '3_months',
      warrantyStartDate: '',
    });
    setSupportDocumentFile(null);
    setSupportFileInputKey((current) => current + 1);
    setEditingSupportDocument(null);
  }

  function startEditSupportDocument(documentRecord: JobDocumentRecord) {
    setEditingSupportDocument(documentRecord);
    setSupportDocumentTab(documentRecord.type);
    setSupportDocumentForm({
      title: documentRecord.title || '',
      description: documentRecord.description || '',
      warrantyPeriodType: documentRecord.warrantyPeriodType || '3_months',
      warrantyStartDate: documentRecord.warrantyStartDate
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(documentRecord.warrantyStartDate.toDate())
        : '',
    });
    setMessage('');
  }

  async function handleSaveSupportDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      if (editingSupportDocument) {
        await updateJobDocumentRecord(editingSupportDocument, {
          title: supportDocumentForm.title,
          description: supportDocumentForm.description,
          warrantyPeriodType: supportDocumentForm.warrantyPeriodType,
          warrantyStartDate: supportDocumentForm.warrantyStartDate,
        }, profile);
        setMessage('Document updated');
      } else {
        await createJobDocumentRecord({
          jobId: selectedJob.docId,
          jobSheetNo: getDisplayJobNumber(selectedJob),
          type: supportDocumentTab,
          title: supportDocumentForm.title,
          description: supportDocumentForm.description,
          warrantyPeriodType: supportDocumentForm.warrantyPeriodType,
          warrantyStartDate: supportDocumentForm.warrantyStartDate,
          file: supportDocumentFile,
        }, profile);
        setMessage(
          supportDocumentTab === 'warranty'
            ? 'Warranty created'
            : supportDocumentTab === 'service_report'
              ? 'Service report saved'
              : 'Attachment uploaded',
        );
      }
      resetSupportDocumentForm();
      await refreshJobDetails(selectedJob);
    } catch (supportError) {
      setMessage(supportError instanceof Error ? supportError.message : 'Unable to save document');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteSupportDocument(documentRecord: JobDocumentRecord) {
    if (!canManageReviews) return;
    const confirmed = window.confirm(`Delete ${documentRecord.title}?`);
    if (!confirmed) return;

    setActionLoading(true);
    setMessage('');

    try {
      await deleteJobDocumentRecord(documentRecord);
      setMessage('Document deleted');
      await refreshJobDetails(selectedJob as Job);
    } catch (supportError) {
      setMessage(supportError instanceof Error ? supportError.message : 'Unable to delete document');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateWarrantyClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      await createWarrantyClaim(selectedJob, jobDocumentRecords, warrantyClaimForm, profile);
      setWarrantyClaimForm({ claimType: 'repair_issue', claimReason: '' });
      setMessage('Warranty claim created');
      await refreshJobDetails(selectedJob);
      const nextClaims = await getWarrantyClaimsForUser(profile);
      setAllWarrantyClaims(nextClaims);
    } catch (claimError) {
      setMessage(claimError instanceof Error ? claimError.message : 'Unable to create warranty claim');
    } finally {
      setActionLoading(false);
    }
  }

  function resetPaymentForm() {
    setPaymentForm({
      amount: '',
      type: 'partial',
      method: 'cash',
      referenceNo: '',
      note: '',
      paidAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()),
    });
    setPaymentReceiptFile(null);
    setPaymentFileInputKey((current) => current + 1);
    setEditingPayment(null);
    setPaymentModalError(null);
    setShowPaymentModal(false);
  }

  function startEditPayment(payment: JobPayment) {
    setEditingPayment(payment);
    setPaymentModalError(null);
    setPaymentForm({
      amount: String(payment.amount || 0),
      type: payment.type,
      method: payment.method,
      referenceNo: payment.referenceNo || '',
      note: payment.note || '',
      paidAt: payment.paidAt
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(payment.paidAt.toDate())
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()),
    });
    setPaymentReceiptFile(null);
    setPaymentFileInputKey((current) => current + 1);
    setShowPaymentModal(true);
  }

  async function handleSavePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    warnManageJobPaymentDebug({
      checkpoint: 'payment:modalSubmit:clicked',
      selectedJobDocId: selectedJob?.docId,
      jobNumber: selectedJob ? getDisplayJobNumber(selectedJob) : undefined,
      amountRaw: paymentForm.amount,
      amountParsed: Number(paymentForm.amount || 0),
      paymentMethod: paymentForm.method,
      paymentDate: paymentForm.paidAt,
      profileUid: profile?.uid,
      profileRole: profile?.role,
      canManageReviews,
      showPaymentModal,
      editingPaymentId: editingPayment?.paymentId,
    });
    if (!profile || !selectedJob || !canManageReviews) {
      warnManageJobPaymentDebug({
        checkpoint: 'payment:validation:failed',
        reason: 'missing profile, selected job, or manage permission',
        selectedJobDocId: selectedJob?.docId,
        jobNumber: selectedJob ? getDisplayJobNumber(selectedJob) : undefined,
        amountRaw: paymentForm.amount,
        amountParsed: Number(paymentForm.amount || 0),
        paymentMethod: paymentForm.method,
        paymentDate: paymentForm.paidAt,
        profileUid: profile?.uid,
        profileRole: profile?.role,
      });
      return;
    }

    setActionLoading(true);
    setMessage('');
    setPaymentModalError(null);

    try {
      const input = { ...paymentForm, receiptFile: paymentReceiptFile };
      warnManageJobPaymentDebug({
        checkpoint: 'payment:handleSave:start',
        selectedJobDocId: selectedJob.docId,
        jobNumber: getDisplayJobNumber(selectedJob),
        amountRaw: paymentForm.amount,
        amountParsed: Number(paymentForm.amount || 0),
        paymentMethod: paymentForm.method,
        paymentDate: paymentForm.paidAt,
        profileUid: profile.uid,
        profileRole: profile.role,
        linkedInvoiceCount: linkedPosInvoices.length,
      });
      if (editingPayment) {
        await updateJobPayment(selectedJob, editingPayment, input, profile);
        setMessage('Payment updated');
      } else {
        if (!paymentForm.method) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:validation:failed',
            reason: 'missing payment method',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: Number(paymentForm.amount || 0),
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
          });
          setPaymentModalError('Payment method is required.');
          setMessage('Payment method is required.');
          return;
        }
        if (!paymentForm.paidAt) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:validation:failed',
            reason: 'missing payment date',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: Number(paymentForm.amount || 0),
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
          });
          setPaymentModalError('Payment date is required.');
          setMessage('Payment date is required.');
          return;
        }
        warnManageJobPaymentDebug({
          checkpoint: 'payment:invoiceLookup:start',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: Number(paymentForm.amount || 0),
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceCount: linkedPosInvoices.length,
          linkedInvoiceIds: linkedPosInvoices.map((invoice) => invoice.invoiceId),
        });
        const linkedInvoice = linkedPosInvoices.find((invoice) => invoice.paymentStatus !== 'void' && Number(invoice.balance || 0) > 0)
          || linkedPosInvoices.find((invoice) => invoice.paymentStatus !== 'void');
        warnManageJobPaymentDebug({
          checkpoint: 'payment:invoiceLookup:result',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: Number(paymentForm.amount || 0),
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceId: linkedInvoice?.invoiceId,
          linkedInvoiceBalance: linkedInvoice?.balance,
          linkedInvoicePaymentStatus: linkedInvoice?.paymentStatus,
        });
        if (!linkedInvoice) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:validation:failed',
            reason: 'no linked POS invoice',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: Number(paymentForm.amount || 0),
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
          });
          const errorMessage = approvedJobQuotationForInvoice
            ? 'No linked invoice found. Generate invoice from quotation/POS before recording payment.'
            : 'No approved quotation found. Create and approve quotation first.';
          setPaymentModalError(errorMessage);
          setMessage(errorMessage);
          return;
        }
        const nextAmount = Number(paymentForm.amount || 0);
        if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:validation:failed',
            reason: 'invalid amount',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: nextAmount,
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
            linkedInvoiceId: linkedInvoice.invoiceId,
          });
          const errorMessage = 'Payment amount must be greater than 0';
          setPaymentModalError(errorMessage);
          setMessage(errorMessage);
          return;
        }
        if (nextAmount > Number(linkedInvoice.balance || 0)) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:validation:failed',
            reason: 'amount exceeds linked invoice balance',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: nextAmount,
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
            linkedInvoiceId: linkedInvoice.invoiceId,
            linkedInvoiceBalance: linkedInvoice.balance,
          });
          const errorMessage = 'Payment exceeds linked invoice balance';
          setPaymentModalError(errorMessage);
          setMessage(errorMessage);
          return;
        }
        warnManageJobPaymentDebug({
          checkpoint: 'payment:recordInvoicePayment:start',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: nextAmount,
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceId: linkedInvoice.invoiceId,
        });
        let posPaymentId: string;
        try {
          posPaymentId = await recordInvoicePayment(linkedInvoice, {
            amount: nextAmount,
            method: mapJobPaymentMethodToPos(paymentForm.method),
            referenceNo: [
              paymentForm.referenceNo.trim(),
              paymentForm.note.trim() ? `Manage Job note: ${paymentForm.note.trim()}` : '',
            ].filter(Boolean).join(' | '),
            proofFile: paymentReceiptFile,
          }, profile);
        } catch (recordPaymentError) {
          warnManageJobPaymentDebug({
            checkpoint: 'payment:recordInvoicePayment:failed',
            selectedJobDocId: selectedJob.docId,
            jobNumber: getDisplayJobNumber(selectedJob),
            amountRaw: paymentForm.amount,
            amountParsed: nextAmount,
            paymentMethod: paymentForm.method,
            paymentDate: paymentForm.paidAt,
            profileUid: profile.uid,
            profileRole: profile.role,
            linkedInvoiceId: linkedInvoice.invoiceId,
            ...normalizeUnknownError(recordPaymentError),
          });
          throw recordPaymentError;
        }
        warnManageJobPaymentDebug({
          checkpoint: 'payment:recordInvoicePayment:success',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: nextAmount,
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceId: linkedInvoice.invoiceId,
          posPaymentId,
        });
        const invoicePayments = await getPaymentsByInvoice(linkedInvoice.invoiceId, profile);
        const createdPayment = invoicePayments.find((payment) => payment.paymentId === posPaymentId) || invoicePayments[invoicePayments.length - 1];
        const updatedInvoice: PosInvoice = {
          ...linkedInvoice,
          customerPhone: getJobCustomerPhoneForWhatsApp(selectedJob) || linkedInvoice.customerPhone,
          amountPaid: linkedInvoice.amountPaid + nextAmount,
          balance: Math.max(0, linkedInvoice.total - (linkedInvoice.amountPaid + nextAmount)),
          paymentStatus: Math.max(0, linkedInvoice.total - (linkedInvoice.amountPaid + nextAmount)) <= 0 ? 'paid' : 'partial',
        };
        if (createdPayment) setLatestPosReceipt({ invoice: updatedInvoice, payment: createdPayment });
        warnManageJobPaymentDebug({
          checkpoint: 'payment:legacyMirror:start',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: nextAmount,
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceId: linkedInvoice.invoiceId,
          posPaymentId,
        });
        await createJobPayment(selectedJob, { ...input, receiptFile: null }, profile, {
          source: 'manage_job',
          invoiceId: linkedInvoice.invoiceId,
          posPaymentId,
        });
        warnManageJobPaymentDebug({
          checkpoint: 'payment:legacyMirror:success',
          selectedJobDocId: selectedJob.docId,
          jobNumber: getDisplayJobNumber(selectedJob),
          amountRaw: paymentForm.amount,
          amountParsed: nextAmount,
          paymentMethod: paymentForm.method,
          paymentDate: paymentForm.paidAt,
          profileUid: profile.uid,
          profileRole: profile.role,
          linkedInvoiceId: linkedInvoice.invoiceId,
          posPaymentId,
        });
        await syncJobPaymentSummaryFromPosInvoice(selectedJob, {
          total: updatedInvoice.total,
          amountPaid: updatedInvoice.amountPaid,
          balance: updatedInvoice.balance,
          paymentStatus: updatedInvoice.paymentStatus,
          lastPaymentAt: createdPayment?.receivedAt || null,
        });
        setMessage('Payment recorded in POS invoice and mirrored to job.');
      }
      setPaymentModalError(null);
      resetPaymentForm();
      await refreshJobDetails(selectedJob);
      await refetch();
    } catch (paymentError) {
      warnManageJobPaymentDebug({
        checkpoint: 'payment:catch',
        selectedJobDocId: selectedJob.docId,
        jobNumber: getDisplayJobNumber(selectedJob),
        amountRaw: paymentForm.amount,
        amountParsed: Number(paymentForm.amount || 0),
        paymentMethod: paymentForm.method,
        paymentDate: paymentForm.paidAt,
        profileUid: profile.uid,
        profileRole: profile.role,
        ...normalizeUnknownError(paymentError),
      });
      const errorMessage = paymentError instanceof Error ? paymentError.message : 'Unable to save payment';
      setPaymentModalError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleGenerateInvoiceFromJob() {
    if (!profile || !selectedJob || !canManageReviews) return;
    const existingInvoice = linkedPosInvoices.find((invoice) => invoice.paymentStatus !== 'void');
    if (existingInvoice) {
      setPaymentModalError(null);
      setMessage('Linked invoice already exists.');
      return;
    }
    const approvedQuotation = approvedJobQuotationForInvoice;
    if (!approvedQuotation) {
      const errorMessage = 'No approved quotation found. Create and approve quotation first.';
      if (showPaymentModal) setPaymentModalError(errorMessage);
      setMessage(errorMessage);
      return;
    }
    setActionLoading(true);
    setMessage('');
    setPaymentModalError(null);
    try {
      const quotation = await getQuotationById(approvedQuotation.quotationId, profile);
      if (Number(quotation.total || 0) <= 0) {
        const errorMessage = 'Approved quotation amount must be greater than 0 before generating invoice.';
        if (showPaymentModal) setPaymentModalError(errorMessage);
        setMessage(errorMessage);
        return;
      }
      const invoice = await createInvoiceFromQuotation(quotation, profile);
      setLinkedPosInvoices((current) => [invoice, ...current.filter((row) => row.invoiceId !== invoice.invoiceId)]);
      setMessage(`Invoice generated: ${invoice.invoiceNo}`);
      if (showPaymentModal) setPaymentModalError(null);
      await refreshJobDetails(selectedJob);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to generate invoice';
      if (showPaymentModal) setPaymentModalError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendLinkedInvoiceWhatsApp() {
    if (!profile || !selectedJob) return;
    const linkedInvoice = linkedPosInvoices.find((invoice) => invoice.paymentStatus !== 'void');
    if (!linkedInvoice) {
      setMessage('No linked invoice found. Generate invoice before sending.');
      return;
    }
    if (!getJobCustomerPhoneForWhatsApp(selectedJob)) {
      setMessage('Customer phone number is missing. Invoice WhatsApp was not sent.');
      return;
    }
    setActionLoading(true);
    try {
      const token = await ensureInvoicePaymentToken(linkedInvoice.invoiceId, profile);
      window.open(buildInvoiceWhatsAppLink({
        ...linkedInvoice,
        customerPhone: getJobCustomerPhoneForWhatsApp(selectedJob) || linkedInvoice.customerPhone,
        publicPaymentToken: token,
      }), '_blank', 'noopener,noreferrer');
      setMessage('Invoice WhatsApp link opened.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send invoice via WhatsApp');
    } finally {
      setActionLoading(false);
    }
  }

  function handleSendLatestReceiptWhatsApp() {
    if (!latestPosReceipt) {
      setMessage('No recent POS receipt found from this page. Record a payment first.');
      return;
    }
    window.open(buildReceiptWhatsAppLink(latestPosReceipt.invoice, latestPosReceipt.payment), '_blank', 'noopener,noreferrer');
    setMessage('Receipt WhatsApp link opened.');
  }

  async function handleReview(documentId: string, status: 'approved' | 'rejected') {
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      await reviewJobDocument({
        documentId,
        status,
        reviewedBy: profile.uid,
        rejectionReason: status === 'rejected' ? 'Rejected during document review' : undefined,
      });
      setMessage(status === 'approved' ? 'Document approved' : 'Document rejected');
      await refreshJobDetails(selectedJob);
    } catch (reviewError) {
      setMessage(reviewError instanceof Error ? reviewError.message : 'Unable to review document');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemoveDocument() {
    if (!profile || !selectedJob || !removeDocumentId) return;
    if (!removeReason.trim()) {
      setMessage('Removal reason is required');
      return;
    }

    setActionLoading(true);
    setMessage('');

    try {
      await removeJobDocument({
        documentId: removeDocumentId,
        jobId: selectedJob.docId,
        removedBy: profile.uid,
        reason: removeReason,
      });
      setRemoveDocumentId('');
      setRemoveReason('');
      await refreshJobDetails(selectedJob);
      setMessage('Document removed from active review');
    } catch (removeError) {
      setMessage(removeError instanceof Error ? removeError.message : 'Unable to remove document');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFinalizeFinancials() {
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      const snapshot = await finalizeJobFinancials(selectedJob.docId, profile.uid, confirmFinancialOverride);
      setFinancial(snapshot);
      setConfirmFinancialOverride(false);
      setMessage('Job financial snapshot locked');
      await refreshJobDetails(selectedJob);
    } catch (finalizeError) {
      setMessage(finalizeError instanceof Error ? finalizeError.message : 'Unable to finalize job financials');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApproveCommission() {
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      await approveCommissionForJob(selectedJob.docId, profile.uid);
      setMessage('Commission approved from locked job financials');
    } catch (commissionError) {
      setMessage(commissionError instanceof Error ? commissionError.message : 'Unable to approve commission');
    } finally {
      setActionLoading(false);
    }
  }

  function updateExtractionEdit(
    documentId: string,
    field: keyof JobDocumentExtractedData,
    value: string,
  ) {
    setExtractionEdits((current) => {
      const existing = current[documentId] || extractions[documentId]?.extractedData;
      if (!existing) return current;

      return {
        ...current,
        [documentId]: {
          ...existing,
          [field]:
            field === 'amount' || field === 'logisticCost'
              ? value === ''
                ? null
                : Number(value)
              : value,
        },
      };
    });
  }

  async function handleExtractDocument(documentId: string) {
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      await extractDocumentData({ documentId, extractedBy: profile.uid });
      setMessage('Mock extraction created for review');
      await refreshJobDetails(selectedJob);
    } catch (extractionError) {
      setMessage(extractionError instanceof Error ? extractionError.message : 'Unable to extract document data');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveExtraction(documentId: string) {
    if (!profile || !selectedJob) return;
    const extractedData = extractionEdits[documentId];
    if (!extractedData) {
      setMessage('No extraction data to save');
      return;
    }

    setActionLoading(true);
    setMessage('');

    try {
      await updateDocumentExtraction({
        documentId,
        extractedData,
        updatedBy: profile.uid,
      });
      setMessage('Extraction fields saved');
      await refreshJobDetails(selectedJob);
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : 'Unable to save extraction');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApproveExtraction(documentId: string) {
    if (!profile || !selectedJob) return;

    setActionLoading(true);
    setMessage('');

    try {
      await approveDocumentExtraction({ documentId, verifiedBy: profile.uid });
      setMessage('Extraction verified');
      await refreshJobDetails(selectedJob);
    } catch (approveError) {
      setMessage(approveError instanceof Error ? approveError.message : 'Unable to verify extraction');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveRequirements() {
    if (!profile || !selectedJob || !canManageReviews) return;

    const requiredDocuments = new Set<JobDocumentType>(
      requirementProfile === 'parts_required' ? [] : ['checklist', 'invoice'],
    );

    if (requirementProfile === 'parts_required' || requirementProfile === 'custom') {
      if (requireSupplierReceipt) requiredDocuments.add('supplier_receipt');
      if (requireLogisticReceipt) requiredDocuments.add('logistic_receipt');
    }

    setActionLoading(true);
    setMessage('');

    try {
      const nextRequiredDocuments = Array.from(requiredDocuments);
      await updateJobCostRequirements({
        jobId: selectedJob.docId,
        costProfile: requirementProfile,
        requiredDocuments: nextRequiredDocuments,
        role: profile.role,
      });
      const nextJob = {
        ...selectedJob,
        costProfile: requirementProfile,
        requiredDocuments: nextRequiredDocuments,
      };
      setSelectedJob(nextJob);
      setMessage('Job document requirements updated');
      await refetch();
      await refreshJobDetails(nextJob);
    } catch (requirementError) {
      setMessage(requirementError instanceof Error ? requirementError.message : 'Unable to update requirements');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-white">Jobs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Admins see all jobs, managers see branch jobs, technicians see assigned jobs.
            </p>
          </div>
          {canCreateJobs ? (
            <button
              type="button"
              onClick={() => setShowAddJob((current) => !current)}
              className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white"
            >
              {showAddJob ? 'Close' : 'Add Job'}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mb-4 rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-slate-200">
          {message}
        </div>
      ) : null}

      {supportWarning ? (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          {supportWarning}
        </div>
      ) : null}

      {canCreateJobs && showAddJob ? (
        <form
          onSubmit={handleCreateJob}
          className="mb-6 grid gap-3 rounded-lg border border-white/10 bg-[#151515] p-4 md:grid-cols-3"
        >
          {canManageReviews ? (
            <>
              <input
                type="search"
                value={customerLookup}
                onChange={(event) => setCustomerLookup(event.target.value)}
                placeholder="Search existing customer by ID, name, or phone"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <select
                value={newJob.customerId || ''}
                onChange={(event) => applyCustomerToNewJob(event.target.value)}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                <option value="">{customerDataLoading ? 'Loading customers' : 'Select existing customer'}</option>
                {filteredNewJobCustomers.map((customer) => (
                  <option key={customer.customerId} value={customer.customerId}>
                    {customer.customerNumber || 'Pending ID'} · {customer.fullName} ({customer.phone || 'No phone'})
                  </option>
                ))}
              </select>
              <select
                value={newJob.deviceId || ''}
                onChange={(event) => applyDeviceToNewJob(event.target.value)}
                disabled={!newJob.customerId}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                <option value="">Select existing device</option>
                {newJobDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.brand} {device.model} {device.serialNumber ? `(${device.serialNumber})` : ''}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <input
            type="text"
            required
            value={newJob.customerName}
            onChange={(event) => setNewJob((current) => ({ ...current, customerName: event.target.value }))}
            placeholder="Customer name"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            required
            value={newJob.customerPhone || ''}
            onChange={(event) => setNewJob((current) => ({
              ...current,
              customerPhone: event.target.value,
              normalizedPhone: normalizeCustomerPhone(event.target.value),
            }))}
            placeholder="Customer phone"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="email"
            value={newJob.customerEmail || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, customerEmail: event.target.value }))}
            placeholder="Customer email (optional)"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            value={newJob.customerAddress || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, customerAddress: event.target.value }))}
            placeholder="Customer address (optional)"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            required
            value={newJob.device}
            onChange={(event) => setNewJob((current) => ({ ...current, device: event.target.value }))}
            placeholder="Device"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            value={newJob.deviceBrand || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, deviceBrand: event.target.value }))}
            placeholder="Device brand"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            value={newJob.deviceModel || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, deviceModel: event.target.value }))}
            placeholder="Device model"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            value={newJob.serialNumber || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, serialNumber: event.target.value }))}
            placeholder="Serial number"
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-400">Device Password / Passcode</label>
            <div className="flex gap-2">
              <input
                type={showNewDevicePassword ? 'text' : 'password'}
                value={newJob.devicePassword || ''}
                onChange={(event) => setNewJob((current) => ({ ...current, devicePassword: event.target.value }))}
                placeholder='Example: 123456, pattern lock note, or "No password provided"'
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => setShowNewDevicePassword((current) => !current)}
                className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
              >
                {showNewDevicePassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Only request this if needed for diagnosis, testing, or repair verification.</p>
          </div>
          {canManageReviews ? (
            <div className="flex gap-2 md:col-span-3">
              <button
                type="button"
                onClick={handleQuickCreateCustomer}
                disabled={actionLoading || !newJob.customerName || !newJob.customerPhone}
                className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
              >
                Quick-create customer
              </button>
              <button
                type="button"
                onClick={handleQuickCreateDevice}
                disabled={actionLoading || !newJob.customerId || !(newJob.deviceModel || newJob.device)}
                className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
              >
                Quick-create device
              </button>
            </div>
          ) : null}
          {isTechnician(profile?.role) ? (
            <>
              <input
                type="text"
                readOnly
                value={profile?.branchId || ''}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400"
              />
              <input
                type="text"
                readOnly
                value={profile?.displayName || profile?.name || 'Unknown User'}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400"
              />
            </>
          ) : (
            <>
              <input
                type="text"
                required
                value={newJob.branchId}
                onChange={(event) => setNewJob((current) => ({ ...current, branchId: event.target.value }))}
                placeholder="Branch ID"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <select
                required
                value={newJob.technicianId}
                onChange={(event) => setNewJob((current) => ({ ...current, technicianId: event.target.value }))}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                <option value="">{techniciansLoading ? 'Loading technicians' : 'Select Technician'}</option>
                {technicians.map((technician) => (
                  <option key={technician.uid} value={technician.uid}>
                    {technician.displayName || technician.name || 'Unknown User'} ({technician.branchId})
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="md:col-span-3 rounded-md border border-white/10 bg-[#101010] p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase text-slate-500">Job Pricing Mode</span>
                <select
                  value={newJob.pricingMode || 'diagnosis_first'}
                  onChange={(event) => handleAddJobPricingModeChange(event.target.value as AddJobPricingMode)}
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                >
                  <option value="diagnosis_first">Need diagnosis first</option>
                  {canQuoteNowOnAddJob ? <option value="quote_now">Known issue / quote now</option> : null}
                </select>
              </label>
              <div className="rounded-md border border-white/10 bg-[#050505] p-3 text-xs text-slate-400 md:col-span-2">
                <p>Use Quote Now when issue and price are already confirmed.</p>
                <p className="mt-1">Use Diagnosis First when problem needs checking before quotation.</p>
              </div>
            </div>

            {newJob.pricingMode === 'quote_now' && canQuoteNowOnAddJob ? (
              <div className="mt-3 space-y-3">
                <input
                  type="search"
                  value={jobPriceItemSearch}
                  onChange={(event) => setJobPriceItemSearch(event.target.value)}
                  placeholder="Search name, model, category, e.g. 15.6 LCD, A1278, data recovery"
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                />
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {filteredJobPriceItems.map((item) => (
                    <button
                      key={item.priceItemId}
                      type="button"
                      onClick={() => addPriceItemToNewJob(item)}
                      className="rounded-md border border-white/10 bg-[#151515] p-3 text-left text-sm hover:border-orange-500/30"
                    >
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.category}{item.serviceGroup ? ` · ${item.serviceGroup}` : ''}</div>
                      <div className="mt-2 text-orange-200">{priceItemDisplayPrice(item)}</div>
                    </button>
                  ))}
                  {jobPriceItems.length > 0 && filteredJobPriceItems.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                      No pricelist items found. Try another keyword or clear filters.
                    </div>
                  ) : null}
                </div>

                {selectedJobPriceItems.length > 0 ? (
                  <div className="space-y-2">
                    {selectedJobPriceItems.map((item) => (
                      <div key={item.priceItemId} className="grid gap-2 rounded-md border border-white/10 bg-[#050505] p-3 text-sm md:grid-cols-[1fr_160px_auto]">
                        <div>
                          <div className="font-medium text-white">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.category}{item.model ? ` · ${item.model}` : ''} · {priceItemDisplayPrice(item)}
                          </div>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.finalPriceInput}
                          onChange={(event) => updateNewJobPriceItemFinalPrice(item.priceItemId, event.target.value)}
                          placeholder={item.pricingType === 'range' || item.pricingType === 'quote_required' ? 'Final price required' : 'Final price'}
                          className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                        />
                        <button
                          type="button"
                          onClick={() => removePriceItemFromNewJob(item.priceItemId)}
                          className="rounded-md border border-red-500/30 px-3 py-2 text-xs font-medium text-red-200"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-3 text-sm text-orange-100">
                      Selected pricelist total: {formatCurrency(selectedJobPriceItemsTotal)}. You can manually adjust Total sale below if needed.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={newJob.totalSale}
            onChange={(event) => setNewJob((current) => ({ ...current, totalSale: event.target.value }))}
            placeholder={newJob.pricingMode === 'quote_now' ? 'Total sale' : 'Total sale (optional before diagnosis)'}
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          />
          <select
            value={newJob.paymentStatus}
            onChange={(event) => setNewJob((current) => ({ ...current, paymentStatus: event.target.value }))}
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
          >
            <option value="pending">Payment pending</option>
            <option value="paid">Paid</option>
            <option value="confirmed">Payment confirmed</option>
          </select>
          <textarea
            value={newJob.issueDescription || ''}
            onChange={(event) => setNewJob((current) => ({ ...current, issueDescription: event.target.value }))}
            placeholder="Issue description"
            rows={2}
            className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2"
          />
          {canManageReviews ? (
            <>
              <select
                value={newJob.costProfile}
                onChange={(event) => {
                  const costProfile = event.target.value as JobCostProfile;
                  setNewJob((current) => ({
                    ...current,
                    costProfile,
	                    requiredDocuments:
	                      costProfile === 'service_only'
	                        ? ['checklist', 'invoice']
	                        : ['supplier_receipt', 'logistic_receipt'],
                  }));
                }}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                <option value="parts_required">Parts Job</option>
                <option value="service_only">Service Only</option>
                <option value="custom">Custom</option>
              </select>
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-300">
                <input
                  type="checkbox"
	                  checked={newJob.requiredDocuments.includes('supplier_receipt')}
	                  disabled={newJob.costProfile === 'service_only'}
                  onChange={(event) => setNewJob((current) => ({
                    ...current,
                    requiredDocuments: event.target.checked
                      ? Array.from(new Set([...current.requiredDocuments, 'supplier_receipt']))
                      : current.requiredDocuments.filter((type) => type !== 'supplier_receipt'),
                  }))}
                />
                Supplier receipt required
              </label>
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
	                    checked={newJob.requiredDocuments.includes('logistic_receipt')}
	                    disabled={newJob.costProfile === 'service_only'}
                  onChange={(event) => setNewJob((current) => ({
                    ...current,
                    requiredDocuments: event.target.checked
                      ? Array.from(new Set([...current.requiredDocuments, 'logistic_receipt']))
                      : current.requiredDocuments.filter((type) => type !== 'logistic_receipt'),
                  }))}
                />
                Logistic receipt required
              </label>
            </>
          ) : null}
          <button
            type="submit"
            disabled={actionLoading}
            className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
          >
            Create Job
          </button>
        </form>
      ) : null}

      {showJobQuotationModal && selectedJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={handleCreateQuotationFromJob} className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg border border-white/10 bg-[#151515] p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Create Quotation for Job</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {getDisplayJobNumber(selectedJob)} · {selectedJob.customerName} · {jobDeviceInfo(selectedJob)}
                </p>
              </div>
              <button type="button" onClick={() => setShowJobQuotationModal(false)} className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200">
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 rounded-md border border-white/10 bg-[#101010] p-3 text-sm md:grid-cols-3">
              <div>
                <div className="text-xs uppercase text-slate-500">Customer</div>
                <div className="mt-1 text-white">{selectedJob.customerName}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Phone</div>
                <div className="mt-1 text-white">{selectedJob.customerPhone || '-'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Branch</div>
                <div className="mt-1 text-white">{selectedJob.branchId || '-'}</div>
              </div>
              <div className="md:col-span-3">
                <div className="text-xs uppercase text-slate-500">Issue / Diagnosis</div>
                <div className="mt-1 text-slate-300">{selectedJob.issueDescription || selectedJob.diagnosisNote || '-'}</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="hidden grid-cols-[minmax(0,1fr)_90px_140px_140px_140px_86px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
                <div>Item Description</div>
                <div>Qty</div>
                <div>Unit Price (RM)</div>
                <div>Discount (RM)</div>
                <div>Line Total (RM)</div>
                <div />
              </div>
              {jobQuotationForm.items.map((item, index) => (
                <div key={index} className="grid gap-3 rounded-md border border-white/10 bg-[#101010] p-3 md:grid-cols-[minmax(0,1fr)_90px_140px_140px_140px_86px] md:gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 md:hidden">Item Description</span>
                    <input
                      required
                      value={item.name}
                      onChange={(event) => updateJobQuotationItem(index, { name: event.target.value })}
                      placeholder="Repair service or part"
                      className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 md:hidden">Qty</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(event) => updateJobQuotationItem(index, { quantity: parseQuantityInput(event.target.value) })}
                      className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 md:hidden">Unit Price (RM)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={focusedJobQuotationMoneyField === `unitPrice-${index}` ? String(Number(item.unitPrice || 0)) : formatCurrency(item.unitPrice)}
                      onFocus={(event) => {
                        setFocusedJobQuotationMoneyField(`unitPrice-${index}`);
                        const input = event.currentTarget;
                        window.setTimeout(() => {
                          input?.select();
                        }, 0);
                      }}
                      onBlur={() => setFocusedJobQuotationMoneyField(null)}
                      onChange={(event) => updateJobQuotationItem(index, { unitPrice: parseCurrencyInput(event.target.value) })}
                      className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-right text-sm text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 md:hidden">Discount (RM)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={focusedJobQuotationMoneyField === `discount-${index}` ? String(Number(item.discount || 0)) : formatCurrency(item.discount || 0)}
                      onFocus={(event) => {
                        setFocusedJobQuotationMoneyField(`discount-${index}`);
                        const input = event.currentTarget;
                        window.setTimeout(() => {
                          input?.select();
                        }, 0);
                      }}
                      onBlur={() => setFocusedJobQuotationMoneyField(null)}
                      onChange={(event) => updateJobQuotationItem(index, { discount: parseCurrencyInput(event.target.value) })}
                      className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-right text-sm text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 md:hidden">Line Total (RM)</span>
                    <div className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-right text-sm font-medium text-slate-200">
                      {formatCurrency(quotationLineTotal(item))}
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeJobQuotationItem(index)}
                    disabled={jobQuotationForm.items.length === 1}
                    className="self-end rounded-md border border-red-500/30 px-3 py-2 text-xs text-red-200 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addJobQuotationItem} className="rounded-md border border-orange-500/30 px-3 py-2 text-sm text-orange-200">
                Add Line Item
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_280px]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Deposit / Advance Payment (RM)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={focusedJobQuotationMoneyField === 'deposit' ? String(parseCurrencyInput(jobQuotationForm.depositAmount)) : formatCurrency(parseCurrencyInput(jobQuotationForm.depositAmount))}
                  onFocus={(event) => {
                    setFocusedJobQuotationMoneyField('deposit');
                    const input = event.currentTarget;
                    window.setTimeout(() => {
                      input?.select();
                    }, 0);
                  }}
                  onBlur={() => setFocusedJobQuotationMoneyField(null)}
                  onChange={(event) => setJobQuotationForm((current) => ({ ...current, depositAmount: String(parseCurrencyInput(event.target.value)) }))}
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-right text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Quotation Valid Until</span>
                <input
                  type="date"
                  value={jobQuotationForm.validUntil}
                  onChange={(event) => setJobQuotationForm((current) => ({ ...current, validUntil: event.target.value }))}
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="rounded-md border border-white/10 bg-[#101010] p-3 text-sm">
                <div className="flex items-center justify-between gap-4 text-slate-400">
                  <span>Subtotal (RM)</span>
                  <span className="text-slate-200">{formatCurrency(jobQuotationTotals.subtotal)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-4 text-slate-400">
                  <span>Discount (RM)</span>
                  <span className="text-slate-200">{formatCurrency(jobQuotationTotals.discount)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-4 text-slate-400">
                  <span>Deposit (RM)</span>
                  <span className="text-slate-200">{formatCurrency(jobQuotationTotals.deposit)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3 font-semibold text-white">
                  <span>Total (RM)</span>
                  <span>{formatCurrency(jobQuotationTotals.total)}</span>
                </div>
              </div>
              <label className="block md:col-span-3">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Notes / Terms & Conditions</span>
                <textarea
                  value={jobQuotationForm.discountReason}
                  onChange={(event) => setJobQuotationForm((current) => ({ ...current, discountReason: event.target.value }))}
                  placeholder="Warranty terms, payment terms, or customer notes"
                  rows={3}
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowJobQuotationModal(false)} disabled={actionLoading} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={actionLoading} className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {actionLoading ? 'Creating...' : 'Create Quotation'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="grid gap-4 md:grid-cols-6">
          <label className="block text-sm text-slate-300">
            Search
            <input
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Job sheet, customer, phone, model"
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as JobStatus | 'all')}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All statuses</option>
              {Object.entries(lifecycleStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Technician
            <select
              value={technicianFilter}
              onChange={(event) => setTechnicianFilter(event.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All technicians</option>
              {technicianOptions.map(([technicianId, technicianName]) => (
                <option key={technicianId} value={technicianId}>
                  {technicianName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            SLA
            <select
              value={slaFilter}
              onChange={(event) => setSlaFilter(event.target.value as SlaStatus | 'all')}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All SLA</option>
              <option value="normal">Normal</option>
              <option value="warning">Warning</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Branch
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All branches</option>
              {branchOptions.map((branchId) => (
                <option key={branchId} value={branchId}>
                  {branchId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
              className="mb-3"
            />
            <span className="mb-2">Overdue only</span>
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#151515]">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Job Sheet</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Technician</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Approval</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading jobs</td>
              </tr>
            ) : null}

            {error ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-red-300">{error.message}</td>
              </tr>
            ) : null}

            {!loading && !error && filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No jobs found</td>
              </tr>
            ) : null}

            {filteredJobs.map((job) => {
                const jobSla = calculateJobSla(job, allPartsOrders.filter((order) => order.jobId === job.docId));
                const jobWarrantyClaimCount = allWarrantyClaims.filter((claim) => claim.originalJobId === job.docId).length;
                return (
                  <tr
                    key={job.docId}
                    className={`border-b border-white/10 last:border-b-0 ${
                      selectedJob?.docId === job.docId ? 'bg-[#1A1A1A]/70' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-white">{getDisplayJobNumber(job)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {job.customerName}
                      {job.customerPhone ? <div className="mt-1 text-xs text-slate-500">{job.customerPhone}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{job.deviceModel || job.device}</td>
                    <td className="px-4 py-3 text-slate-300">{job.technicianName || 'Unknown User'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-1 text-xs ${lifecycleStatusClass(getCurrentRepairLifecycleStatus(job))}`}>
                        {lifecycleLabelForJob(job)}
                      </span>
                      <div className="mt-2">
                        <span className={`rounded-full border px-2 py-1 text-xs ${slaBadgeClass(jobSla.status)}`} title={jobSla.reason}>
                          SLA {jobSla.status}
                        </span>
                      </div>
                      {jobSla.primaryFlag ? <div className="mt-1 text-xs text-slate-500">{getSlaFlagLabel(jobSla.primaryFlag)}</div> : null}
                      {selectedJob?.docId === job.docId && jobHasActiveWarranty(jobDocumentRecords) ? (
                        <div className="mt-2">
                          <span className="rounded-full border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300">
                            Warranty Active
                          </span>
                        </div>
                      ) : null}
                      {jobWarrantyClaimCount > 0 ? (
                        <div className="mt-2">
                          <span className="rounded-full border border-amber-500/40 px-2 py-1 text-xs text-amber-300">
                            {jobWarrantyClaimCount} Warranty Claim{jobWarrantyClaimCount > 1 ? 's' : ''}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{job.approvalStatus}</td>
                    <td className="px-4 py-3 text-slate-300">{job.commissionStatus}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedJob(job)}
                          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1A1A1A]"
                        >
                          Manage
                        </button>
                        <Link
                          href={`/dashboard/documents/job-sheet/${job.docId}/print`}
                          className="rounded-md border border-orange-500/30 px-3 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
                        >
                          Job Sheet
                        </Link>
                        <Link
                          href={`/dashboard/documents/repair-reports/${job.docId}/print`}
                          className="rounded-md border border-orange-500/30 px-3 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
                        >
                          Repair Report
                        </Link>
                        {canManageReviews && job.status === 'pending_approval' ? (
                          <>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleJobApproval(job, 'approved')}
                              className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleJobApproval(job, 'rejected')}
                              className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        {canDeleteJobs ? (
                          <button
                            type="button"
                            disabled={actionLoading || deleteLoading}
                            onClick={() => setJobPendingDelete(job)}
                            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
            })}
          </tbody>
        </table>
      </div>

      {selectedJob ? (
        <div className="mt-6 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="flex flex-col justify-between gap-3 border-b border-white/10 pb-4 md:flex-row md:items-start">
            <div>
              <h2 className="text-lg font-semibold text-white">Job Documentation</h2>
              <p className="mt-1 text-sm text-slate-400">
                {getDisplayJobNumber(selectedJob)} · {selectedJob.customerName} ·{' '}
                {selectedJob.deviceModel || selectedJob.device}
              </p>
            </div>
            <div className="text-sm text-slate-300">
              Required:{' '}
              {missingRequiredDocuments.length === 0 ? (
                <span className="text-emerald-300">complete</span>
              ) : (
                <span className="text-amber-300">{missingRequiredDocuments.join(', ')}</span>
              )}
            </div>
          </div>

          {(canManageReviews || canUploadForSelectedJob) ? (
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-white">Device Password / Passcode</div>
                  <p className="mt-1 text-xs text-slate-500">Only request this if needed for diagnosis, testing, or repair verification.</p>
                </div>
                <button
                  type="button"
                  disabled={!selectedJob.devicePassword}
                  onClick={() => setShowSelectedDevicePassword((current) => !current)}
                  className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
                >
                  {showSelectedDevicePassword ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <div className="mt-3 rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-slate-200">
                {selectedJob.devicePassword
                  ? showSelectedDevicePassword
                    ? selectedJob.devicePassword
                    : '••••••••'
                  : 'No password provided'}
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-3 grid gap-1 text-xs text-slate-500">
                  <div>Official Job Number: <span className="text-slate-200">{getDisplayJobNumber(selectedJob)}</span></div>
                </div>
                <div className="font-medium text-white">Public Repair Tracking</div>
                <div className="mt-1 text-xs text-slate-500">
                  Repair ID: {getDisplayJobNumber(selectedJob)} · Code: {selectedJob.publicTrackingCode || 'Not generated'}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Current public status: {lifecycleLabelForJob(selectedJob)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={actionLoading} onClick={() => prepareTrackingMessage(false)} className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60">Copy tracking message</button>
                <button type="button" disabled={actionLoading} onClick={() => prepareTrackingMessage(true)} className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60">WhatsApp tracking message</button>
              </div>
            </div>
            {canManageReviews ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <textarea value={detailForm.diagnosisSummaryPublic} onChange={(event) => setDetailForm((current) => ({ ...current, diagnosisSummaryPublic: event.target.value }))} placeholder="Public diagnosis summary" rows={3} className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                <textarea value={detailForm.repairSummaryPublic} onChange={(event) => setDetailForm((current) => ({ ...current, repairSummaryPublic: event.target.value }))} placeholder="Public repair summary" rows={3} className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                <input type="date" value={detailForm.estimatedCompletionAt} onChange={(event) => setDetailForm((current) => ({ ...current, estimatedCompletionAt: event.target.value }))} className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                <button type="button" disabled={actionLoading} onClick={handleSavePublicTrackingFields} className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60">Save public update</button>
              </div>
            ) : null}
          </div>

          {['repair_completed', 'ready_for_pickup', 'delivered', 'warranty_active', 'warranty_expired'].includes(getCurrentRepairLifecycleStatus(selectedJob)) ? (
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-white">After Repair Checklist</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status:{' '}
                    <span className={`rounded-full border px-2 py-1 ${afterRepairChecklistCompleted(afterRepairChecklist) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
                      {afterRepairChecklistCompleted(afterRepairChecklist) ? 'Completed' : 'Required before Ready for Pickup'}
                    </span>
                  </div>
                  {afterRepairChecklist?.completedAt ? (
                    <div className="mt-1 text-xs text-emerald-300">Completed: {formatTimestamp(afterRepairChecklist.completedAt)}</div>
                  ) : (
                    <div className="mt-2 text-xs text-amber-300">Please complete After Repair Checklist before marking this device as Ready for Pickup.</div>
                  )}
                </div>
                {canUploadForSelectedJob ? (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setShowAfterRepairChecklistEditor((current) => !current)}
                    className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60"
                  >
                    {afterRepairChecklistCompleted(afterRepairChecklist) ? 'Review Checklist' : 'Open After Repair Checklist'}
                  </button>
                ) : null}
              </div>

              {showAfterRepairChecklistEditor ? (
                <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    {afterRepairChecklistForm.testedItems.map((item, itemIndex) => (
                      <label key={item.key} className="grid gap-1 text-xs text-slate-400">
                        {item.label}
                        <select
                          value={item.status}
                          onChange={(event) => setAfterRepairChecklistForm((current) => ({
                            ...current,
                            testedItems: current.testedItems.map((row, index) => index === itemIndex ? { ...row, status: event.target.value as AfterRepairTestedItem['status'] } : row),
                          }))}
                          className="rounded-md border border-white/10 bg-[#151515] px-2 py-2 text-xs text-white"
                        >
                          <option value="passed">Passed</option>
                          <option value="issue">Issue</option>
                          <option value="na">N/A</option>
                        </select>
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 grid gap-1 text-xs text-slate-400">
                    Remarks
                    <textarea
                      value={afterRepairChecklistForm.remarks}
                      onChange={(event) => setAfterRepairChecklistForm((current) => ({ ...current, remarks: event.target.value }))}
                      rows={3}
                      placeholder="Optional remarks"
                      className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={handleCompleteAfterRepairChecklist}
                      className="rounded-md bg-orange-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
                    >
                      Complete After Repair Checklist
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-white">Device Checklist SOP</div>
                <div className="mt-1 text-xs text-slate-500">
                  Status:{' '}
                  <span className={`rounded-full border px-2 py-1 ${deviceChecklistStatusClass(deviceChecklist?.checklistStatus)}`}>
                    {deviceChecklistStatusLabel(deviceChecklist?.checklistStatus)}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {deviceChecklist
                    ? `${deviceChecklist.customerNameSnapshot || selectedJob.customerName || '-'} · ${deviceChecklist.deviceBrandModelSnapshot || jobDeviceInfo(selectedJob)}`
                    : 'Create a pre-service checklist from existing job, customer, or device details.'}
                </div>
                {deviceChecklist?.customerSignedAt ? (
                  <div className="mt-1 text-xs text-emerald-300">Signed: {formatTimestamp(deviceChecklist.customerSignedAt)}</div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {canUploadForSelectedJob ? (
                  <>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => {
                        setShowDeviceChecklistEditor((current) => !current);
                        importSelectedJobIntoDeviceChecklist();
                      }}
                      className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60"
                    >
                      {deviceChecklist ? 'Edit Checklist' : 'Create Checklist'}
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || deviceChecklist?.checklistStatus === 'customer_signed'}
                      onClick={handleSendDeviceChecklistWhatsApp}
                      className="rounded-md border border-emerald-500/30 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-50"
                    >
                      Send via WhatsApp
                    </button>
                    {deviceChecklist ? (
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={handleCopyDeviceChecklistLink}
                        className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
                      >
                        Copy Signature Link
                      </button>
                    ) : null}
                  </>
                ) : null}
                {deviceChecklist?.publicSignatureToken ? (
                  <>
                    <a
                      href={`/device-checklist/sign/${deviceChecklist.publicSignatureToken}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                    >
                      View Checklist Link
                    </a>
                    <a
                      href={`/device-checklist/sign/${deviceChecklist.publicSignatureToken}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                    >
                      Download PDF
                    </a>
                  </>
                ) : null}
              </div>
            </div>

            {showDeviceChecklistEditor ? (
              <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={importSelectedJobIntoDeviceChecklist}
                    className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200"
                  >
                    Import from Job
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceChecklistForm((current) => ({
                        ...current,
                        customerId: '',
                        deviceId: '',
                      }));
                      setDeviceChecklistCustomerSearch('');
                    }}
                    className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                  >
                    Manual Entry
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-slate-500">Change Customer / Import Customer</label>
                    <input
                      value={deviceChecklistCustomerSearch}
                      onChange={(event) => setDeviceChecklistCustomerSearch(event.target.value)}
                      placeholder="Search name, phone, email, customer ID"
                      className="mt-1 w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                    />
                    <select
                      value={deviceChecklistForm.customerId}
                      onChange={(event) => setDeviceChecklistForm((current) => ({
                        ...current,
                        customerId: event.target.value,
                        deviceId: '',
                      }))}
                      className="mt-2 w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                    >
                      <option value="">Use job snapshot / manual fallback</option>
                      {filteredDeviceChecklistCustomers.map((customer) => (
                        <option key={customer.customerId} value={customer.customerId}>
                          {customer.customerNumber || 'Pending ID'} · {customer.fullName} · {customer.phone}
                        </option>
                      ))}
                    </select>
                    {duplicateChecklistCustomer ? (
                      <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
                        Existing customer found. Import customer details instead?
                        <button
                          type="button"
                          onClick={() => setDeviceChecklistForm((current) => ({
                            ...current,
                            customerId: duplicateChecklistCustomer.customerId,
                            deviceId: '',
                          }))}
                          className="ml-2 text-orange-200 underline"
                        >
                          Use Existing Customer
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs text-slate-500">
                      Selected: {deviceChecklistCustomer?.fullName || selectedJob.customerName || 'Job snapshot'} · {deviceChecklistCustomer?.phone || selectedJob.customerPhone || '-'}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Previous Devices</label>
                    <select
                      value={deviceChecklistForm.deviceId}
                      onChange={(event) => setDeviceChecklistForm((current) => ({ ...current, deviceId: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                    >
                      <option value="">Use job device snapshot / manual fallback</option>
                      {deviceChecklistDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {[device.deviceType, device.brand, device.model, device.serialNumber || device.imei].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-xs text-slate-500">
                      Device: {deviceChecklistDevice ? [deviceChecklistDevice.brand, deviceChecklistDevice.model].filter(Boolean).join(' ') : jobDeviceInfo(selectedJob)}
                    </div>
                  </div>

                </div>

                <div className="mt-4 overflow-x-auto rounded-md border border-white/10">
                  <table className="min-w-full text-xs">
                    <thead className="bg-[#151515] text-slate-300">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Item</th>
                        <th className="px-3 py-2 text-left font-medium">Before Repair</th>
                        <th className="px-3 py-2 text-left font-medium">After Repair</th>
                        <th className="px-3 py-2 text-left font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {deviceChecklistForm.items.map((item, itemIndex) => (
                        <tr key={item.key}>
                          <td className="px-3 py-2 font-medium text-slate-200">{item.label}</td>
                          <td className="px-3 py-2">
                            <select
                              value={item.beforeStatus}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                items: current.items.map((row, index) => index === itemIndex ? { ...row, beforeStatus: event.target.value as DeviceChecklistItem['beforeStatus'] } : row),
                              }))}
                              className="w-32 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                            >
                              {inspectionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={item.afterStatus}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                items: current.items.map((row, index) => index === itemIndex ? { ...row, afterStatus: event.target.value as DeviceChecklistItem['afterStatus'] } : row),
                              }))}
                              className="w-32 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                            >
                              {inspectionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={item.note}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                items: current.items.map((row, index) => index === itemIndex ? { ...row, note: event.target.value } : row),
                              }))}
                              placeholder={item.notePlaceholder}
                              className="w-64 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white outline-none focus:border-orange-500/35"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 overflow-x-auto rounded-md border border-white/10">
                  <div className="border-b border-white/10 bg-[#151515] px-3 py-2 text-xs font-medium text-slate-200">Accessories</div>
                  <table className="min-w-full text-xs">
                    <tbody className="divide-y divide-white/10">
                      {deviceChecklistForm.accessories.map((item, itemIndex) => (
                        <tr key={item.key}>
                          <td className="px-3 py-2 font-medium text-slate-200">{item.label}</td>
                          <td className="px-3 py-2">
                            <select
                              value={item.beforeStatus}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                accessories: current.accessories.map((row, index) => index === itemIndex ? { ...row, beforeStatus: event.target.value as DeviceChecklistAccessory['beforeStatus'] } : row),
                              }))}
                              className="w-36 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                            >
                              {accessoryBeforeStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={item.afterStatus}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                accessories: current.accessories.map((row, index) => index === itemIndex ? { ...row, afterStatus: event.target.value as DeviceChecklistAccessory['afterStatus'] } : row),
                              }))}
                              className="w-36 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                            >
                              {accessoryAfterStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={item.note}
                              onChange={(event) => setDeviceChecklistForm((current) => ({
                                ...current,
                                accessories: current.accessories.map((row, index) => index === itemIndex ? { ...row, note: event.target.value } : row),
                              }))}
                              placeholder={item.key === 'charger' ? 'original charger, adapter, cable' : 'bag, sleeve, dongle, cable'}
                              className="w-64 rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white outline-none focus:border-orange-500/35"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid gap-3 rounded-md border border-white/10 bg-[#101010] p-3 md:grid-cols-3">
                  {([
                    ['ram', 'RAM'],
                    ['storage', 'SSD / HDD'],
                    ['wifiCard', 'WiFi Card'],
                  ] as const).map(([componentKey, label]) => {
                    const component = deviceChecklistForm.internalComponents[componentKey];
                    return (
                      <div key={componentKey} className="grid gap-2">
                        <div className="text-xs font-medium text-slate-200">{label}</div>
                        <select
                          value={component.status}
                          onChange={(event) => setDeviceChecklistForm((current) => ({
                            ...current,
                            internalComponents: {
                              ...current.internalComponents,
                              [componentKey]: { ...current.internalComponents[componentKey], status: event.target.value as DeviceChecklistInternalComponents[typeof componentKey]['status'] },
                            },
                          }))}
                          className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                        >
                          {internalComponentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {componentKey === 'ram' ? (
                          <>
                            <input value={component.quantity || ''} onChange={(event) => setDeviceChecklistForm((current) => ({ ...current, internalComponents: { ...current.internalComponents, ram: { ...current.internalComponents.ram, quantity: event.target.value } } }))} placeholder="Quantity" className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white" />
                            <input value={component.capacity || ''} onChange={(event) => setDeviceChecklistForm((current) => ({ ...current, internalComponents: { ...current.internalComponents, ram: { ...current.internalComponents.ram, capacity: event.target.value } } }))} placeholder="Capacity, e.g. 8GB" className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white" />
                          </>
                        ) : null}
                        {componentKey === 'storage' ? (
                          <>
                            <input value={component.type || ''} onChange={(event) => setDeviceChecklistForm((current) => ({ ...current, internalComponents: { ...current.internalComponents, storage: { ...current.internalComponents.storage, type: event.target.value } } }))} placeholder="Type, e.g. SSD / HDD" className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white" />
                            <input value={component.capacity || ''} onChange={(event) => setDeviceChecklistForm((current) => ({ ...current, internalComponents: { ...current.internalComponents, storage: { ...current.internalComponents.storage, capacity: event.target.value } } }))} placeholder="Capacity, e.g. 512GB" className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white" />
                          </>
                        ) : null}
                        <input
                          value={component.note}
                          onChange={(event) => setDeviceChecklistForm((current) => ({
                            ...current,
                            internalComponents: {
                              ...current.internalComponents,
                              [componentKey]: { ...current.internalComponents[componentKey], note: event.target.value },
                            },
                          }))}
                          placeholder="Short note"
                          className="rounded-md border border-white/10 bg-[#151515] px-2 py-1 text-xs text-white"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleSaveDeviceChecklist(false)}
                    className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-60"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleSaveDeviceChecklist(true)}
                    className="rounded-md bg-orange-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    Complete Staff Checklist
                  </button>
                </div>
              </div>
            ) : null}

            {deviceChecklist ? (
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <div>Customer Snapshot: <span className="text-slate-200">{deviceChecklist.customerNameSnapshot || '-'}</span></div>
                <div>Phone Snapshot: <span className="text-slate-200">{deviceChecklist.customerPhoneSnapshot || '-'}</span></div>
                <div>Device Snapshot: <span className="text-slate-200">{deviceChecklist.deviceBrandModelSnapshot || '-'}</span></div>
                <div>Serial / IMEI: <span className="text-slate-200">{deviceChecklist.deviceSerialOrImeiSnapshot || '-'}</span></div>
              </div>
            ) : null}

            {deviceChecklist && (isAdmin(profile?.role) || profile?.role === 'manager') && deviceChecklist.checklistStatus !== 'customer_signed' ? (
              <div className="mt-3 rounded-md border border-white/10 bg-[#101010] p-3">
                <div className="text-xs font-medium text-slate-200">Override Customer Signature</div>
                <div className="mt-1 text-xs text-slate-500">Admin/manager only. Reason is required and will be audited.</div>
                <div className="mt-2 flex flex-col gap-2 md:flex-row">
                  <input
                    value={deviceChecklistOverrideReason}
                    onChange={(event) => setDeviceChecklistOverrideReason(event.target.value)}
                    placeholder="Override reason"
                    className="flex-1 rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                  />
                  <button
                    type="button"
                    disabled={actionLoading || !deviceChecklistOverrideReason.trim()}
                    onClick={handleOverrideDeviceChecklistSignature}
                    className="rounded-md border border-red-500/30 px-3 py-2 text-xs font-medium text-red-200 disabled:opacity-50"
                  >
                    Override Signature
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-white">Repair Job Sheet Consent</div>
                <div className="mt-1 text-xs text-slate-500">
                  Status:{' '}
                  <span className={selectedJob.jobSheetConsentStatus === 'signed' ? 'text-emerald-300' : 'text-amber-300'}>
                    {selectedJob.jobSheetConsentStatus === 'signed' ? 'Signed' : 'Pending signature'}
                  </span>
                </div>
                {selectedJob.jobSheetSignedAt ? (
                  <div className="mt-1 text-xs text-slate-500">Signed: {formatTimestamp(selectedJob.jobSheetSignedAt)}</div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/dashboard/documents/job-sheet/${selectedJob.docId}/print`}
                  className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200"
                >
                  View Job Sheet
                </a>
                {(canManageReviews || canUploadForSelectedJob) ? (
                  <button
                    type="button"
                    disabled={actionLoading || selectedJob.jobSheetConsentStatus === 'signed'}
                    onClick={handleSendJobSheetWhatsApp}
                    className="rounded-md border border-emerald-500/30 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-50"
                    title={!selectedJob.customerPhone ? 'Customer phone number is missing.' : undefined}
                  >
                    Send Job Sheet via WhatsApp
                  </button>
                ) : null}
                {canManageReviews ? (
                  <button
                    type="button"
                    disabled={actionLoading || selectedJob.jobSheetConsentStatus === 'signed'}
                    onClick={() => {
                      setManualJobSheetConsentForm((current) => ({
                        ...current,
                        signerName: selectedJob.customerName || '',
                        phone: selectedJob.customerPhone || '',
                      }));
                      setShowManualJobSheetConsent(true);
                    }}
                    className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
                  >
                    Manual Job Sheet Consent
                  </button>
                ) : null}
              </div>
            </div>
            {!selectedJob.customerPhone ? <div className="mt-2 text-xs text-amber-300">Customer phone number is missing.</div> : null}
          </div>

          <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <div className="font-medium text-white">Lifecycle Status</div>
                <div className="mt-2">
                  <span className={`rounded-full border px-2 py-1 text-xs ${lifecycleStatusClass(getCurrentRepairLifecycleStatus(selectedJob))}`}>
                    {lifecycleLabelForJob(selectedJob)}
                  </span>
                </div>
              </div>
              {canChangeSelectedJobStatus ? (
                <div className="w-full max-w-xl">
                  <textarea
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    placeholder="Status note"
                    rows={2}
                    className="w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {allowedNextStatuses.map((nextStatus) => (
                      <button
                        key={nextStatus}
                        type="button"
                        onClick={() => handleStatusChange(nextStatus)}
                        disabled={actionLoading || (nextStatus === 'ready_for_pickup' && !afterRepairChecklistCompleted(afterRepairChecklist))}
                        title={nextStatus === 'ready_for_pickup' && !afterRepairChecklistCompleted(afterRepairChecklist) ? 'Please complete After Repair Checklist before marking this device as Ready for Pickup.' : undefined}
                        className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
                      >
                        {nextStatus === 'ready_for_pickup' ? 'Ready for Pickup + WhatsApp' : repairLifecycleActionLabels[nextStatus]}
                      </button>
                    ))}
                  </div>
                  {allowedNextStatuses.includes('ready_for_pickup') && !afterRepairChecklistCompleted(afterRepairChecklist) ? (
                    <div className="mt-2 text-xs text-amber-300">Please complete After Repair Checklist before marking this device as Ready for Pickup.</div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No available status actions</div>
              )}
            </div>

            {selectedJobSla ? (
              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="mb-2 text-sm font-medium text-white">SLA</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                    <div className="text-xs uppercase text-slate-500">Status</div>
                    <div className="mt-2">
                      <span className={`rounded-full border px-2 py-1 text-xs ${slaBadgeClass(selectedJobSla.status)}`}>
                        {selectedJobSla.status}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                    <div className="text-xs uppercase text-slate-500">Current Stage</div>
                    <div className="mt-1 text-sm text-slate-200">{selectedJobSla.currentStage}</div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                    <div className="text-xs uppercase text-slate-500">Elapsed</div>
                    <div className="mt-1 text-sm text-slate-200">{Math.floor(selectedJobSla.elapsedHours)}h</div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                    <div className="text-xs uppercase text-slate-500">Threshold</div>
                    <div className="mt-1 text-sm text-slate-200">
                      {selectedJobSla.thresholdHours ? `${Math.floor(selectedJobSla.thresholdHours)}h` : '-'}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-400">{selectedJobSla.reason}</div>
                {selectedJobSla.flags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedJobSla.flags.map((flag) => (
                      <span key={flag} className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                        {getSlaFlagLabel(flag)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">Quotation</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status: <span className="capitalize text-orange-200">{selectedJob.quotationStatus || 'draft'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {can(profile?.role, 'pos.operate') ? (
                    <button
                      type="button"
                      onClick={openJobQuotationModal}
                      disabled={actionLoading || !canMakeQuotationForSelectedJob}
                      title={
                        activeJobQuotation
                          ? 'An active quotation already exists for this job.'
                          : !selectedJob.customerId
                            ? 'Customer record is required before making a quotation.'
                            : undefined
                      }
                      className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-50"
                    >
                      Make Quotation
                    </button>
                  ) : null}
                  {selectedJob.quotationStatus === 'approved' ? (
                    <span className="rounded-full border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300">
                      Approved
                    </span>
                  ) : selectedJob.quotationStatus === 'rejected' ? (
                    <span className="rounded-full border border-red-500/40 px-2 py-1 text-xs text-red-300">Rejected</span>
                  ) : selectedJob.quotationStatus === 'sent' ? (
                    <span className="rounded-full border border-amber-500/40 px-2 py-1 text-xs text-amber-300">Sent</span>
                  ) : (
                    <span className="rounded-full border border-white/15 px-2 py-1 text-xs text-slate-300">Draft</span>
                  )}
                </div>
              </div>
              {activeJobQuotation ? (
                <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-950/10 p-2 text-xs text-amber-100">
                  Active POS quotation attached: {activeJobQuotation.quotationNo}. Use the attached quotation actions below.
                </div>
              ) : null}

              {canManageReviews && (!selectedJob.quotationStatus || ['draft', 'rejected'].includes(selectedJob.quotationStatus)) ? (
                <div className="grid gap-3 rounded-md border border-white/10 bg-[#151515] p-3 md:grid-cols-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotationForm.quotationAmount}
                    onChange={(event) => setQuotationForm((current) => ({ ...current, quotationAmount: event.target.value }))}
                    placeholder="Quotation amount"
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                  />
                  <input
                    key={quotationProofInputKey}
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => setQuotationProofFile(event.target.files?.[0] || null)}
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-300 md:col-span-2"
                  />
                  <textarea
                    value={quotationForm.quotationNote}
                    onChange={(event) => setQuotationForm((current) => ({ ...current, quotationNote: event.target.value }))}
                    placeholder="Quotation note"
                    rows={2}
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-3"
                  />
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleQuotationAction('sent')}
                    className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Send Quotation
                  </button>
                </div>
              ) : (
                <div className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase text-slate-500">Amount</div>
                      <div className="mt-1 text-white">{formatCurrency(selectedJob.quotationAmount || 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-500">Sent</div>
                      <div className="mt-1 text-slate-300">{formatTimestamp(selectedJob.quotationSentAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-500">Proof</div>
                      <div className="mt-1">
                        {selectedJob.quotationProofUrl ? (
                          <a href={selectedJob.quotationProofUrl} target="_blank" rel="noreferrer" className="text-orange-200">
                            View proof
                          </a>
                        ) : (
                          <span className="text-slate-500">No proof</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {selectedJob.quotationNote ? <div className="mt-3 text-slate-300">{selectedJob.quotationNote}</div> : null}
                  {selectedJob.quotationStatus === 'approved' ? (
                    <div className="mt-3 text-xs text-slate-500">
                      Approved by {selectedJob.quotationApprovedByDisplayName || 'Unknown User'} · {formatTimestamp(selectedJob.quotationApprovedAt)}
                    </div>
                  ) : null}
                  {selectedJob.quotationStatus === 'rejected' ? (
                    <div className="mt-3 text-xs text-red-300">
                      Rejected: {selectedJob.quotationRejectedReason || '-'} · {formatTimestamp(selectedJob.quotationRejectedAt)}
                    </div>
                  ) : null}
                </div>
              )}

              {canManageReviews && selectedJob.quotationStatus === 'sent' ? (
                <div className="mt-3 flex flex-col gap-2 rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleQuotationAction('approved')}
                      className="rounded-md border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                    >
                      Mark Approved
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || !quotationRejectReason.trim()}
                      onClick={() => handleQuotationAction('rejected')}
                      className="rounded-md border border-red-500/40 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                    >
                      Mark Rejected
                    </button>
                  </div>
                  <input
                    value={quotationRejectReason}
                    onChange={(event) => setQuotationRejectReason(event.target.value)}
                    placeholder="Rejection reason"
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                  />
                </div>
              ) : null}

              <div className="mt-3 rounded-md border border-white/10 bg-[#151515] p-3">
                <div className="mb-2 text-xs uppercase text-slate-500">Attached Quotation</div>
                {jobQuotationActions.length ? (
                  <div className="space-y-2 text-xs">
                    {jobQuotationActions.map((quotation) => {
                      const isFinalized = quotation.status === 'approved' || quotation.status === 'rejected';
                      const customerPhoneMissing = !selectedJob.customerPhone && !quotation.customerPhone;
                      return (
                        <div key={quotation.quotationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-[#101010] p-2">
                          <div>
                            <div className="font-medium text-white">{quotation.quotationNo || quotation.quotationId}</div>
                            <div className="mt-1 text-slate-400">
                              Status: <span className="capitalize text-orange-200">{quotation.quotationApprovalStatus || quotation.status}</span> · Total {formatCurrency(quotation.total)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {can(profile?.role, 'pos.operate') ? (
                              <a href={`/dashboard/pos/quotations/${quotation.quotationId}`} className="rounded-md border border-orange-500/25 px-2 py-1 text-orange-200">
                                View Quotation
                              </a>
                            ) : null}
                            <button
                              type="button"
                              disabled={actionLoading || customerPhoneMissing || isFinalized}
                              onClick={() => handleSendPosQuotationWhatsApp(quotation.quotationId)}
                              className="rounded-md border border-emerald-500/30 px-2 py-1 text-emerald-200 disabled:opacity-50"
                              title={customerPhoneMissing ? 'Customer phone number is missing.' : isFinalized ? 'Quotation has already been finalized.' : undefined}
                            >
                              Send Quotation via WhatsApp
                            </button>
                            {canManageReviews ? (
                              <>
                                <button
                                  type="button"
                                  disabled={actionLoading || isFinalized}
                                  onClick={() => setManualApprovalTarget(quotation.quotationId)}
                                  className="rounded-md border border-emerald-500/30 px-2 py-1 text-emerald-300 disabled:opacity-50"
                                >
                                  Manual Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading || isFinalized}
                                  onClick={() => handleRejectPosQuotation(quotation.quotationId)}
                                  className="rounded-md border border-red-500/30 px-2 py-1 text-red-300 disabled:opacity-50"
                                >
                                  Mark Rejected
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-white/10 bg-[#101010] p-3 text-sm text-slate-400">
                    <div>No quotation attached to this job yet.</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {can(profile?.role, 'pos.operate') ? 'Create quotation from POS first.' : 'Ask admin/manager to create a quotation first.'}
                    </div>
                  </div>
                )}
              </div>

              {canManageReviews && selectedJob.quotationStatus === 'rejected' ? (
                <button
                  type="button"
                  onClick={() => setSelectedJob({ ...selectedJob, quotationStatus: 'draft' })}
                  className="mt-3 rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10"
                >
                  Revise Quotation
                </button>
              ) : null}
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">Payment</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-1 text-xs ${
                      selectedPaymentStatus === 'paid'
                        ? 'border-emerald-500/40 text-emerald-300'
                        : selectedPaymentStatus === 'refunded'
                        ? 'border-amber-500/35 text-amber-300'
                        : selectedPaymentStatus === 'unpaid'
                          ? 'border-red-500/40 text-red-300'
                          : 'border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {selectedPaymentStatus}
                  </span>
                  {canManageReviews ? (
                    <button
                      type="button"
                      onClick={() => {
                        resetPaymentForm();
                        const hasLinkedInvoice = linkedPosInvoices.some((invoice) => invoice.paymentStatus !== 'void');
                        if (!hasLinkedInvoice) {
                          setPaymentModalError(
                            approvedJobQuotationForInvoice
                              ? 'No linked invoice found. Generate invoice from quotation/POS before recording payment.'
                              : 'No approved quotation found. Create and approve quotation first.',
                          );
                        }
                        setShowPaymentModal(true);
                      }}
                      className="rounded-md border border-orange-500/30 px-3 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10"
                    >
                      Add Payment
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-xs uppercase text-slate-500">Total Amount</div>
                  <div className="mt-1 font-medium text-white">{formatCurrency(selectedPaymentSummary?.totalAmountDue || selectedJob.quotationAmount || selectedJob.totalSale || 0)}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-xs uppercase text-slate-500">Paid Amount</div>
                  <div className="mt-1 font-medium text-white">{formatCurrency(selectedPaymentSummary?.totalPaid || 0)}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-xs uppercase text-slate-500">Remaining Balance</div>
                  <div className="mt-1 font-medium text-white">{formatCurrency(selectedPaymentSummary?.balanceDue ?? selectedJob.quotationAmount ?? selectedJob.totalSale ?? 0)}</div>
                  {Number(selectedPaymentSummary?.refundAmount || 0) > 0 ? (
                    <div className="mt-1 text-xs text-amber-300">Refunded {formatCurrency(selectedPaymentSummary?.refundAmount || 0)}</div>
                  ) : null}
                </div>
                <div className="rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-xs uppercase text-slate-500">Payment Status</div>
                  <div className="mt-1 font-medium capitalize text-white">{selectedPaymentStatus}</div>
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-[#151515]">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Notes</th>
                      {canManageReviews ? <th className="px-3 py-2">Action</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {jobPayments.length === 0 ? (
                      <tr>
                        <td colSpan={canManageReviews ? 5 : 4} className="px-3 py-6 text-center text-slate-500">No payments recorded</td>
                      </tr>
                    ) : null}
                    {jobPayments.map((payment) => (
                      <tr key={payment.paymentId} className="border-b border-white/10 last:border-b-0">
                        <td className="px-3 py-2 text-slate-300">{formatTimestamp(payment.paidAt)}</td>
                        <td className="px-3 py-2 text-white">{formatCurrency(payment.amount)}</td>
                        <td className="px-3 py-2 text-slate-300">{payment.method.replaceAll('_', ' ')}</td>
                        <td className="px-3 py-2 text-slate-300">{payment.note || '-'}</td>
	                        {canManageReviews ? (
	                          <td className="px-3 py-2">
	                            <div className="flex gap-2">
	                              {payment.posPaymentId ? (
	                                <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">POS linked</span>
	                              ) : (
	                                <button type="button" onClick={() => startEditPayment(payment)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">Edit</button>
	                              )}
	                            </div>
	                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {posFinancialSummary ? (
              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">POS Financial Summary</div>
                  </div>
	                  <div className="flex flex-wrap gap-2 text-xs">
	                    {posFinancialSummary.quotationIds.map((quotationId) => (
	                      <a key={quotationId} href={`/dashboard/pos/quotations/${quotationId}`} className="rounded-md border border-orange-500/25 px-2 py-1 text-orange-200">Quotation</a>
	                    ))}
	                    {posFinancialSummary.invoiceIds.map((invoiceId) => (
	                      <a key={invoiceId} href={`/dashboard/pos/invoices/${invoiceId}`} className="rounded-md border border-orange-500/25 px-2 py-1 text-orange-200">Invoice</a>
	                    ))}
	                    {canManageReviews && linkedPosInvoices.length === 0 ? (
	                      <button type="button" disabled={actionLoading} onClick={handleGenerateInvoiceFromJob} className="rounded-md border border-orange-500/25 px-2 py-1 text-orange-200 disabled:opacity-50">Generate Invoice</button>
	                    ) : null}
	                    {linkedPosInvoices.length > 0 ? (
	                      <button type="button" disabled={actionLoading} onClick={handleSendLinkedInvoiceWhatsApp} className="rounded-md border border-orange-500/25 px-2 py-1 text-orange-200 disabled:opacity-50">Send Invoice via WhatsApp</button>
	                    ) : null}
	                    {latestPosReceipt ? (
	                      <button type="button" onClick={handleSendLatestReceiptWhatsApp} className="rounded-md border border-emerald-500/25 px-2 py-1 text-emerald-200">Send Receipt via WhatsApp</button>
	                    ) : null}
	                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Quotation Total</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.quotationTotal)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Invoice Total</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.invoiceTotal)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Paid Amount</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.paidAmount)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Outstanding Balance</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.outstandingBalance)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Refund Total</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.refundTotal)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Approved Commission</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.approvedCommissionTotal)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Inventory Cost Estimate</div><div className="mt-1 font-medium text-white">{formatCurrency(posFinancialSummary.inventoryCostTotal)}</div></div>
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3"><div className="text-xs uppercase text-slate-500">Gross Profit Estimate</div><div className="mt-1 font-medium text-orange-200">{formatCurrency(posFinancialSummary.grossProfitEstimate)}</div></div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-2 text-sm font-medium text-white">Related Parts Orders</div>
              <div className="space-y-2">
                {partsOrders.filter((order) => ['ordered', 'arrived', 'installed'].includes(order.status)).length === 0 ? (
                  <div className="text-sm text-slate-500">No ordered or arrived parts for this job.</div>
                ) : null}
                {partsOrders
                  .filter((order) => ['ordered', 'arrived', 'installed'].includes(order.status))
                  .map((order) => (
                    <div key={order.partsOrderId} className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="font-medium text-slate-200">{order.partName}</div>
                        <div className="text-xs capitalize text-orange-200">{order.status}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {order.partCategory.replaceAll('_', ' ')} · {order.supplierName || 'No supplier'}
                      </div>
                      {order.remarks ? <div className="mt-2 text-slate-300">{order.remarks}</div> : null}
                    </div>
                  ))}
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-white">Documents & Warranty</div>
                  {normalizeJobStatus(selectedJob.status) === 'completed' &&
                  !jobDocumentRecords.some((record) => record.type === 'service_report') ? (
                    <div className="mt-1 text-xs text-amber-300">Service report recommended before collection.</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {supportDocumentTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => {
                        setSupportDocumentTab(tab.value);
                        setEditingSupportDocument(null);
                      }}
                      className={`rounded-md border px-3 py-1.5 text-xs ${
                        supportDocumentTab === tab.value
                          ? 'border-orange-500/30 bg-[#F97316]/10 text-orange-200'
                          : 'border-white/10 text-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {selectedActiveWarranty ? (
                <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-emerald-200">Active warranty available</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {selectedActiveWarranty.title} · Ends {formatTimestamp(selectedActiveWarranty.warrantyEndDate)}
                      </div>
                    </div>
                    {canCreateWarrantyClaim(profile) ? (
                      <span className="rounded-full border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300">
                        Claim eligible
                      </span>
                    ) : null}
                  </div>

                  {canCreateWarrantyClaim(profile) ? (
                    <form onSubmit={handleCreateWarrantyClaim} className="mt-3 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                      <select
                        value={warrantyClaimForm.claimType}
                        onChange={(event) =>
                          setWarrantyClaimForm((current) => ({
                            ...current,
                            claimType: event.target.value as WarrantyClaimType,
                          }))
                        }
                        className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                      >
                        {warrantyClaimTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      <input
                        required
                        value={warrantyClaimForm.claimReason}
                        onChange={(event) => setWarrantyClaimForm((current) => ({ ...current, claimReason: event.target.value }))}
                        placeholder="Claim reason"
                        className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                      />
                      <button
                        type="submit"
                        disabled={actionLoading}
                        className="rounded-md border border-orange-500/30 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
                      >
                        Create Warranty Claim
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {supportDocumentTab === 'warranty' && !jobDocumentRecords.some((record) => record.type === 'warranty') ? (
                <div className="mb-3 rounded-md border border-orange-500/25 bg-orange-500/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-orange-100">POS Warranty Agreement</div>
                      <div className="mt-1 text-xs text-slate-400">
                        Official warranty terms generated from paid POS invoice. Customer signature is handled through the public warranty link.
                      </div>
                    </div>
                  </div>
                  {linkedPosWarranties.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {linkedPosWarranties.map((warranty) => {
                        const signed = Boolean(warranty.warrantyTermsAccepted || warranty.warrantySignedAt);
                        return (
                          <div key={warranty.warrantyId} className="rounded-md border border-white/10 bg-[#050505] p-3 text-xs">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-white">{warranty.itemName}</div>
                                <div className="mt-1 text-slate-500">
                                  Period: {warranty.warrantyDurationDays} days · Start {formatTimestamp(warranty.startDate)} · End {formatTimestamp(warranty.endDate)}
                                </div>
                                <div className="mt-1 text-slate-500">
                                  Status: {warranty.status} · {signed
                                    ? `Signed by ${warranty.warrantySignedName || 'customer'} on ${formatTimestamp(warranty.warrantySignedAt)}`
                                    : 'Signature pending'}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {signed ? (
                                  <Link
                                    href={`/dashboard/documents/warranties/${warranty.warrantyId}/print`}
                                    className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                                  >
                                    View Signed Warranty
                                  </Link>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleSendPosWarrantyTerms(warranty)}
                                  className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 disabled:opacity-60"
                                >
                                  {signed ? 'Resend Warranty Link' : 'Send Warranty Terms via WhatsApp'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md border border-white/10 bg-[#050505] p-3 text-xs text-slate-400">
                      POS Warranty Agreement is only needed for standalone POS product/accessory sales.
                    </div>
                  )}
                </div>
              ) : null}

              {warrantyClaims.length > 0 ? (
                <div className="mb-3 rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-sm font-medium text-white">Warranty Claim History</div>
                  <div className="mt-3 grid gap-2">
                    {warrantyClaims.map((claim) => (
                      <div key={claim.claimId} className="rounded-md border border-white/10 bg-[#050505] p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <div className="font-medium text-slate-200">{claim.claimReason}</div>
                          <span className="rounded-full border border-amber-500/40 px-2 py-1 text-xs capitalize text-amber-300">
                            {claim.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {claim.claimType.replaceAll('_', ' ')} · Handled by {claim.handledByDisplayName || 'Unknown User'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {(canManageReviews || (isTechnician(profile?.role) && selectedJob.technicianId === profile?.uid)) ? (
                <form onSubmit={handleSaveSupportDocument} className="mb-3 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-3 md:grid-cols-3">
                  <input
                    required
                    value={supportDocumentForm.title}
                    onChange={(event) => setSupportDocumentForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={
                      supportDocumentTab === 'warranty'
                        ? 'Warranty title'
                        : supportDocumentTab === 'service_report'
                          ? 'Service report title'
                          : 'Attachment title'
                    }
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
                  />
                  {supportDocumentTab === 'warranty' ? (
                    <>
                      <select
                        value={supportDocumentForm.warrantyPeriodType}
                        onChange={(event) =>
                          setSupportDocumentForm((current) => ({
                            ...current,
                            warrantyPeriodType: event.target.value as WarrantyPeriodType,
                          }))
                        }
                        disabled={!canManageReviews}
                        className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {warrantyPeriodOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={supportDocumentForm.warrantyStartDate}
                        onChange={(event) =>
                          setSupportDocumentForm((current) => ({ ...current, warrantyStartDate: event.target.value }))
                        }
                        disabled={!canManageReviews}
                        className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                      <div className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-xs text-slate-400">
                        End date: <span className="text-slate-200">{supportWarrantyEndPreview}</span>
                        <div className="mt-1">
                          Claim rule: unlimited claims within active warranty period, subject to inspection and verification.
                        </div>
                      </div>
                    </>
                  ) : (
                    <input
                      key={supportFileInputKey}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(event) => setSupportDocumentFile(event.target.files?.[0] || null)}
                      className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-300 md:col-span-2"
                    />
                  )}
                  <textarea
                    value={supportDocumentForm.description}
                    onChange={(event) => setSupportDocumentForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={supportDocumentTab === 'service_report' ? 'Service report notes' : 'Description'}
                    rows={2}
                    className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-3"
                  />
                  {supportDocumentTab === 'warranty' ? (
                    <details className="rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300 md:col-span-3">
                      <summary className="cursor-pointer text-sm font-medium text-white">Warranty Terms & Conditions</summary>
                      <div className="mt-3 whitespace-pre-line text-xs leading-5 text-slate-400">
                        {geniusAdvancedWarrantyPolicyText}
                      </div>
                    </details>
                  ) : null}
                  <div className="flex flex-wrap gap-2 md:col-span-3">
                    <button
                      type="submit"
                      disabled={actionLoading || (supportDocumentTab === 'warranty' && !canManageReviews)}
                      className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {editingSupportDocument ? 'Save Document' : supportDocumentTab === 'warranty' ? 'Create Warranty' : 'Save Document'}
                    </button>
                    {editingSupportDocument ? (
                      <button
                        type="button"
                        onClick={resetSupportDocumentForm}
                        className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200"
                      >
                        Cancel Edit
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : null}

              {supportDocumentTab === 'warranty' ? (
                <div className="mb-3 rounded-md border border-white/10 bg-[#151515] p-3">
                  <div className="text-sm font-medium text-white">Legacy Warranty Documents</div>
                  <div className="mt-1 text-xs text-slate-500">
                    These are uploaded/support warranty documents. They do not request customer signature.
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {jobDocumentRecords.filter((record) => record.type === supportDocumentTab).length === 0 ? (
                  <div className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-500">
                    No {supportDocumentTabs.find((tab) => tab.value === supportDocumentTab)?.label.toLowerCase()} yet
                  </div>
                ) : null}
                {jobDocumentRecords
                  .filter((record) => record.type === supportDocumentTab)
                  .map((record) => {
                    const warrantyStatus = getWarrantyStatus(record);
                    const warrantySigned = Boolean(record.acceptedTerms || record.warrantySignedAt);
                    return (
                      <div key={record.documentId} className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-100">{record.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              By {record.createdByDisplayName || 'Unknown User'} · {formatTimestamp(record.createdAt)}
                            </div>
                            {record.description ? <div className="mt-2 text-slate-300">{record.description}</div> : null}
                            {warrantyStatus ? (
                              <div className="mt-2">
                                <span
                                  className={`rounded-full border px-2 py-1 text-xs ${
                                    warrantyStatus === 'active'
                                      ? 'border-emerald-500/40 text-emerald-300'
                                      : 'border-red-500/40 text-red-300'
                                  }`}
                                >
                                  Warranty {warrantyStatus}
                                </span>
                                <span className="ml-2 text-xs text-slate-500">
                                  Ends {formatTimestamp(record.warrantyEndDate)}
                                </span>
                                <div className="mt-2 text-xs text-slate-500">
                                  Duration:{' '}
                                  {warrantyPeriodOptions.find((option) => option.value === record.warrantyPeriodType)?.label ||
                                    `${record.warrantyPeriodDays || 0} days`}
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  Unlimited claims within active warranty period, subject to inspection and verification.
                                </div>
                                <div className={`mt-2 text-xs ${warrantySigned ? 'text-emerald-300' : 'text-amber-300'}`}>
                                  {warrantySigned
                                    ? `Signed / Approved${record.warrantySignedName ? ` by ${record.warrantySignedName}` : ''}`
                                    : 'Pending Customer Signature'}
                                </div>
                                {warrantyStatus === 'active' && !warrantySigned ? (
                                  <div className="mt-1 text-xs text-amber-300">Warranty is active but pending customer acknowledgement.</div>
                                ) : null}
                                <details className="mt-2 rounded-md border border-white/10 bg-[#050505] p-3 text-xs text-slate-400">
                                  <summary className="cursor-pointer font-medium text-slate-200">Warranty Terms & Conditions</summary>
                                  <div className="mt-2 whitespace-pre-line leading-5">
                                    {record.warrantyPolicyText || geniusAdvancedWarrantyPolicyText}
                                  </div>
                                </details>
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {['service_report', 'warranty'].includes(record.type) ? (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => void handleWhatsAppSupportDocument(record)}
                                className="rounded-md border border-orange-500/30 px-3 py-1.5 text-xs text-orange-200"
                              >
                                {record.type === 'warranty' ? 'Send Job Warranty for Signature via WhatsApp' : 'Send Service Report via WhatsApp'}
                              </button>
                            ) : null}
                            {record.fileUrl ? (
                              <>
                                <a
                                  href={record.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200"
                                >
                                  Preview
                                </a>
                                <a
                                  href={record.fileUrl}
                                  download={record.fileName}
                                  className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200"
                                >
                                  Download
                                </a>
                              </>
                            ) : null}
                            {(canManageReviews || record.createdBy === profile?.uid) && record.type !== 'warranty' ? (
                              <button
                                type="button"
                                onClick={() => startEditSupportDocument(record)}
                                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200"
                              >
                                Edit
                              </button>
                            ) : null}
                            {canManageReviews ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteSupportDocument(record)}
                                className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-2 text-sm font-medium text-white">Status Timeline</div>
              <div className="space-y-2">
                {(selectedJob.statusHistory || []).length === 0 ? (
                  <div className="text-sm text-slate-500">No status history recorded for this legacy job.</div>
                ) : null}
                {(selectedJob.statusHistory || []).map((item, index) => (
                  <div key={`${item.status}-${index}`} className="rounded-md border border-white/10 bg-[#151515] p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="font-medium text-slate-200">{lifecycleStatusLabels[normalizeJobStatus(item.status)]}</div>
                      <div className="text-xs text-slate-500">{formatTimestamp(item.changedAt)}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">By {item.changedByDisplayName || 'Unknown User'}</div>
                    {item.note ? <div className="mt-2 text-slate-300">{item.note}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {canManageReviews ? (
            <form onSubmit={handleSaveJobDetails} className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="mb-3 font-medium text-white">Edit Job Details</div>
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={detailForm.customerId || ''}
                  onChange={(event) => applyCustomerToDetail(event.target.value)}
                  className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                >
                  <option value="">{customerDataLoading ? 'Loading customers' : 'Link customer'}</option>
                  {customers.map((customer) => (
                    <option key={customer.customerId} value={customer.customerId}>
                      {customer.fullName} ({customer.phone || 'No phone'})
                    </option>
                  ))}
                </select>
                <select
                  value={detailForm.deviceId || ''}
                  onChange={(event) => applyDeviceToDetail(event.target.value)}
                  disabled={!detailForm.customerId}
                  className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white disabled:opacity-60"
                >
                  <option value="">Link device</option>
                  {detailDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.brand} {device.model} {device.serialNumber ? `(${device.serialNumber})` : ''}
                    </option>
                  ))}
                </select>
                {[
                  ['customerName', 'Customer name'],
                  ['customerPhone', 'Customer phone'],
                  ['deviceType', 'Device type'],
                  ['deviceBrand', 'Device brand'],
                  ['deviceModel', 'Device model'],
                  ['serialNumber', 'Serial number'],
                ].map(([field, placeholder]) => (
                  <input
                    key={field}
                    value={String(detailForm[field as keyof typeof detailForm] || '')}
                    onChange={(event) => setDetailForm((current) => ({ ...current, [field]: event.target.value }))}
                    placeholder={placeholder}
                    className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                  />
                ))}
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-400">Device Password / Passcode</label>
                  <div className="flex gap-2">
                    <input
                      type={showDetailDevicePassword ? 'text' : 'password'}
                      value={detailForm.devicePassword}
                      onChange={(event) => setDetailForm((current) => ({ ...current, devicePassword: event.target.value }))}
                      placeholder='Example: 123456, pattern lock note, or "No password provided"'
                      className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDetailDevicePassword((current) => !current)}
                      className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                    >
                      {showDetailDevicePassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Only request this if needed for diagnosis, testing, or repair verification.</p>
                </div>
                <select
                  value={detailForm.technicianId}
                  onChange={(event) => setDetailForm((current) => ({ ...current, technicianId: event.target.value }))}
                  className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                >
                  <option value="">{techniciansLoading ? 'Loading technicians' : 'Assign technician'}</option>
                  {technicians.map((technician) => (
                    <option key={technician.uid} value={technician.uid}>
                      {technician.displayName || technician.name || 'Unknown User'} ({technician.branchId})
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={detailForm.issueDescription}
                onChange={(event) => setDetailForm((current) => ({ ...current, issueDescription: event.target.value }))}
                placeholder="Issue description"
                rows={3}
                className="mt-3 w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={actionLoading}
                className="mt-3 rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
              >
                Save Details
              </button>
            </form>
          ) : null}

          {message ? (
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-200">
              {message}
            </div>
          ) : null}

          <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3 text-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
	                <div className="font-medium text-white">Document Requirements</div>
	                <div className="mt-1 text-xs text-slate-400">
	                  Profile: {costProfileLabels[selectedJob.costProfile || 'parts_required']} · Manual required:{' '}
	                  {requiredDocumentSummary}
	                </div>
              </div>
              {canManageReviews ? (
                <div className="grid gap-2 md:grid-cols-[160px_auto_auto_auto] md:items-center">
                  <select
                    value={requirementProfile}
                    onChange={(event) => {
                      const nextProfile = event.target.value as JobCostProfile;
                      setRequirementProfile(nextProfile);
	                      if (nextProfile === 'service_only') {
	                        setRequireSupplierReceipt(false);
	                        setRequireLogisticReceipt(false);
	                      }
	                      if (nextProfile === 'parts_required') {
	                        setRequireSupplierReceipt(true);
	                        setRequireLogisticReceipt(true);
	                      }
                    }}
                    className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
                  >
                    <option value="parts_required">Parts Job</option>
                    <option value="service_only">Service Only</option>
                    <option value="custom">Custom</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
	                    <input
	                      type="checkbox"
	                      checked={requireSupplierReceipt}
	                      disabled={requirementProfile === 'service_only'}
	                      onChange={(event) => setRequireSupplierReceipt(event.target.checked)}
	                    />
                    Supplier required
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
	                    <input
	                      type="checkbox"
	                      checked={requireLogisticReceipt}
	                      disabled={requirementProfile === 'service_only'}
	                      onChange={(event) => setRequireLogisticReceipt(event.target.checked)}
	                    />
                    Logistic required
                  </label>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={handleSaveRequirements}
                    className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {canUploadForSelectedJob ? (
            <form onSubmit={handleUpload} className="mt-4 grid gap-3 rounded-md border border-white/10 bg-[#050505] p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <select
                value={uploadType}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => setUploadType(event.target.value as JobDocumentType)}
                className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
              >
	                {manualUploadDocumentTypes.map((type) => (
	                  <option key={type.value} value={type.value}>{type.label}</option>
	                ))}
              </select>
              <input
                key={fileInputKey}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUploadFile(event.target.files?.[0] || null)}
                className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-slate-300"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={uploadAmount}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUploadAmount(event.target.value)}
                placeholder="Amount, if receipt"
                className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={uploadLoading}
                className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadLoading ? 'Uploading...' : 'Upload'}
              </button>
            </form>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-md border border-white/10">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Extraction</th>
                  <th className="px-4 py-3">Review</th>
                </tr>
              </thead>
              <tbody>
                {detailsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading documents</td>
                  </tr>
                ) : null}
                {!detailsLoading && requiredDocumentTypes.length > 0 && documents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-amber-200">Required documents are missing. Upload the documents below.</td>
                  </tr>
                ) : null}
	                {!detailsLoading && documentRequirementRows.length === 0 && systemDocumentRows.length === 0 ? (
	                  <tr>
	                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">No document requirements configured</td>
	                  </tr>
	                ) : null}
	                {!detailsLoading && systemDocumentRows.map((row) => (
	                  <tr key={row.key} className="border-b border-white/10 align-top">
	                    <td className="px-4 py-3 text-slate-200">
	                      <div className="font-medium text-white">{row.label}</div>
	                      <span className="mt-1 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
	                        System
	                      </span>
	                    </td>
	                    <td className="px-4 py-3">
	                      <span className={`rounded-full border px-2 py-1 text-xs ${row.status.className}`}>
	                        {row.status.label}
	                      </span>
	                    </td>
	                    <td className="px-4 py-3 text-slate-300">-</td>
	                    <td className="px-4 py-3 text-xs text-slate-400">{row.detail}</td>
	                    <td className="px-4 py-3 text-xs text-slate-500">System managed</td>
	                    <td className="px-4 py-3 text-xs text-slate-500">No manual upload</td>
	                  </tr>
	                ))}
	                {documentRequirementRows.map((row) => {
                  const document = row.document;
                  const extraction = document ? extractions[document.documentId] : undefined;
                  const edit = document ? extractionEdits[document.documentId] : undefined;
                  const isRemoved = document?.status === 'removed';
                  const requirementStatus = documentRequirementStatus(document);
                  const inputId = `upload-${row.type}`;

                  return (
                    <tr
                      key={document?.documentId || row.type}
                      className={`border-b border-white/10 last:border-b-0 align-top ${
                        isRemoved ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-slate-200">
                        <div className="font-medium text-white">{documentTypeLabel(row.type)}</div>
                        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${row.required ? 'border-orange-500/30 text-orange-200' : 'border-white/10 text-slate-400'}`}>
                          {row.required ? 'Required' : 'Optional'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 text-xs ${requirementStatus.className}`}>
                          {requirementStatus.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{document ? formatCurrency(document.amount) : '-'}</td>
                      <td className="px-4 py-3">
                        {document ? (
                          <>
                            <a
                              href={document.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-orange-200 hover:text-orange-200"
                            >
                              View file
                            </a>
                            {document.fileName ? <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">{document.fileName}</div> : null}
                            {isRemoved && document.removeReason ? (
                              <div className="mt-1 text-xs text-amber-300">Removed: {document.removeReason}</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-slate-500">No file</span>
                        )}
	                        {canUploadForSelectedJob && row.type !== 'checklist' && row.type !== 'invoice' && (!document || document.status !== 'approved') ? (
                          <div className="mt-2">
                            <label htmlFor={inputId} className="inline-flex cursor-pointer rounded-md border border-orange-500/30 px-2 py-1 text-xs text-orange-200 hover:bg-[#F97316]/10">
                              {document ? `Replace ${documentTypeLabel(row.type)}` : `Upload ${documentTypeLabel(row.type)}`}
                            </label>
                            <input
                              id={inputId}
                              type="file"
                              accept="image/jpeg,image/png,application/pdf"
                              className="hidden"
                              disabled={uploadLoading}
                              onChange={(event) => {
                                const file = event.target.files?.[0] || null;
                                event.currentTarget.value = '';
                                void handleRequirementFileUpload(row.type, file);
                              }}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {isRemoved ? (
                          <span className="text-xs text-amber-300">Removed from active review</span>
                        ) : !document ? (
                          <span className="text-xs text-slate-500">Upload required before extraction</span>
                        ) : canManageReviews ? (
                          extraction && edit ? (
                            <div className="grid min-w-[320px] gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(extraction.status)}`}>
                                  {extraction.verified ? 'verified' : 'draft'}
                                </span>
                                <span className="text-xs text-slate-500">Type: {edit.inferredType}</span>
                                <span className="text-xs text-slate-500">
                                  Confidence: {Math.round(Number(edit.confidenceScore || 0) * 100)}%
                                </span>
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={edit.amount ?? ''}
                                  onChange={(event) => updateExtractionEdit(document.documentId, 'amount', event.target.value)}
                                  placeholder="Amount"
                                  className="rounded-md border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white"
                                />
                                <input
                                  type="date"
                                  value={edit.date}
                                  onChange={(event) => updateExtractionEdit(document.documentId, 'date', event.target.value)}
                                  className="rounded-md border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white"
                                />
                                <input
                                  type="text"
                                  value={edit.supplierName}
                                  onChange={(event) => updateExtractionEdit(document.documentId, 'supplierName', event.target.value)}
                                  placeholder="Supplier name"
                                  className="rounded-md border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white"
                                />
                                <input
                                  type="text"
                                  value={edit.invoiceNumber}
                                  onChange={(event) => updateExtractionEdit(document.documentId, 'invoiceNumber', event.target.value)}
                                  placeholder="Invoice number"
                                  className="rounded-md border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={edit.logisticCost ?? ''}
                                  onChange={(event) => updateExtractionEdit(document.documentId, 'logisticCost', event.target.value)}
                                  placeholder="Logistic cost"
                                  className="rounded-md border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleSaveExtraction(document.documentId)}
                                  className="rounded-md border border-orange-500/30 px-2 py-1 text-xs text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
                                >
                                  Save Extraction
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading || extraction.verified}
                                  onClick={() => handleApproveExtraction(document.documentId)}
                                  className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                                >
                                  Verify
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleExtractDocument(document.documentId)}
                              className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-[#1A1A1A] disabled:opacity-60"
                            >
                              Extract Data
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-slate-500">
                            {extraction?.verified ? 'Extraction verified' : 'Extraction pending'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!document ? (
                          <span className="text-xs text-slate-500">Waiting for upload</span>
                        ) : canManageReviews && document.status === 'pending' ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleReview(document.documentId, 'approved')}
                              className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleReview(document.documentId, 'rejected')}
                              className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            >
                              Reject
                            </button>
                            {canRemoveDocuments ? (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => {
                                  setRemoveDocumentId(document.documentId);
                                  setRemoveReason('');
                                }}
                                className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <span className="text-xs text-slate-500">
                              {isRemoved ? 'Removed' : document.reviewedBy ? 'Reviewed' : 'Pending review'}
                            </span>
                            {canRemoveDocuments && !isRemoved ? (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => {
                                  setRemoveDocumentId(document.documentId);
                                  setRemoveReason('');
                                }}
                                className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canRemoveDocuments && removeDocumentId ? (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-sm font-medium text-amber-200">Remove Document</div>
              <p className="mt-1 text-xs text-amber-100/80">
                This keeps the uploaded file and marks only the Firestore metadata as removed for audit.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <input
                  type="text"
                  value={removeReason}
                  onChange={(event) => setRemoveReason(event.target.value)}
                  placeholder="Reason for removal"
                  className="rounded-md border border-amber-500/30 bg-[#050505] px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  disabled={actionLoading || !removeReason.trim()}
                  onClick={handleRemoveDocument}
                  className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Confirm Remove
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => {
                    setRemoveDocumentId('');
                    setRemoveReason('');
                  }}
                  className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-[#1A1A1A] disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {canManageReviews ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div className="rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300">
                <div className="font-medium text-white">Financial Snapshot</div>
                {financial?.locked ? (
                  <div className="mt-2 grid gap-2">
                    <div className="grid gap-1 md:grid-cols-3">
                      <span>Amount Collected: {formatCurrency(financial.amountCollected ?? financial.revenue)}</span>
                      <span>Parts Cost: {formatCurrency(financial.partsCost)}</span>
                      <span>Outsource Cost: {formatCurrency(financial.outsourceCost || 0)}</span>
                      <span>Other Direct Cost: {formatCurrency(financial.otherDirectCost ?? financial.logisticCost)}</span>
                      <span>Total Direct Cost: {formatCurrency(financial.totalCost)}</span>
                      <span>Net Profit: {formatCurrency(financial.netProfit)}</span>
                      <span>Commission Basis: Net Profit</span>
                      <span>Commission Rate: {Number((financial.commissionRate || 0.02) * 100).toFixed(0)}%</span>
                      <span>Technician Commission: {formatCurrency(financial.commission)}</span>
                    </div>
                    {financial.warnings?.length ? (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                        {financial.warnings.map((warning) => (
                          <div key={warning}>{warning}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {financialPreview ? (
                      <>
                        <div className="grid gap-1 md:grid-cols-3">
                          <span>Amount Collected: {formatCurrency(financialPreview.amountCollected ?? financialPreview.revenue)}</span>
                          <span>Parts Cost: {formatCurrency(financialPreview.partsCost)}</span>
                          <span>Outsource Cost: {formatCurrency(financialPreview.outsourceCost || 0)}</span>
                          <span>Other Direct Cost: {formatCurrency(financialPreview.otherDirectCost ?? financialPreview.logisticCost)}</span>
                          <span>Total Direct Cost: {formatCurrency(financialPreview.totalCost)}</span>
                          <span>Net Profit: {formatCurrency(financialPreview.netProfit)}</span>
                          <span>Commission Basis: Net Profit</span>
                          <span>Commission Rate: {Number((financialPreview.commissionRate || 0.02) * 100).toFixed(0)}%</span>
                          <span>Technician Commission: {formatCurrency(financialPreview.commission)}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Sources: supplier docs {financialPreview.partsCostSources?.length || 0}, parts orders{' '}
                          {financialPreview.partsOrderCostSources?.length || 0}, outsource {financialPreview.outsourceCostSources?.length || 0}, other direct{' '}
                          {financialPreview.logisticCostSources?.length || 0}, revenue validation{' '}
                          {financialPreview.revenueValidationSources?.length || 0}
                        </div>
                        {financialPreview.warnings?.length ? (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                            {financialPreview.warnings.map((warning) => (
                              <div key={warning}>{warning}</div>
                            ))}
                          </div>
                        ) : null}
                        {financialPreview.requiresOverride ? (
                          <label className="flex items-start gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={confirmFinancialOverride}
                              onChange={(event) => setConfirmFinancialOverride(event.target.checked)}
                              className="mt-0.5"
                            />
                            Confirm admin override for the warnings above
                          </label>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-slate-400">
                        Preview unavailable until required documents and verified extractions are ready
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={
                  actionLoading ||
                  missingRequiredDocuments.length > 0 ||
                  !financialPreview ||
                  (financialPreview.requiresOverride && !confirmFinancialOverride)
                }
                onClick={handleFinalizeFinancials}
                className="rounded-md border border-orange-500/30 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Finalize Financials
              </button>
              <button
                type="button"
                disabled={actionLoading || !financial?.locked}
                onClick={handleApproveCommission}
                className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve Commission
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {jobPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <h2 className="text-lg font-semibold text-white">Confirm Delete Job</h2>
            <p className="mt-3 text-sm text-slate-300">Are you sure you want to permanently delete this job?</p>
            <p className="mt-2 text-sm font-medium text-red-300">This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setJobPendingDelete(null)}
                className="rounded-md border border-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[#1A1A1A] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleDeleteJob}
                className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showManualJobSheetConsent && canManageReviews ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            onSubmit={handleManualJobSheetConsent}
            className="w-full max-w-lg rounded-2xl border border-orange-500/20 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Manual Job Sheet Consent</h2>
                <p className="mt-1 text-sm text-slate-400">Record customer or authorised representative consent.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowManualJobSheetConsent(false)}
                className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
            <div className="grid gap-3">
              <select
                required
                value={manualJobSheetConsentForm.consentMethod}
                onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, consentMethod: event.target.value }))}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                {['Walk-in', 'WhatsApp', 'Phone Call', 'SMS', 'Email', 'Representative Approval', 'Other'].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
              <input
                required
                value={manualJobSheetConsentForm.signerName}
                onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, signerName: event.target.value }))}
                placeholder="Customer / Representative Name"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <input
                value={manualJobSheetConsentForm.icOrPassportNo}
                onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, icOrPassportNo: event.target.value }))}
                placeholder="IC / Passport No (optional)"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <input
                required
                value={manualJobSheetConsentForm.phone}
                onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Phone Number"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <textarea
                value={manualJobSheetConsentForm.notes}
                onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Notes"
                rows={3}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={manualJobSheetConsentForm.confirmed}
                  onChange={(event) => setManualJobSheetConsentForm((current) => ({ ...current, confirmed: event.target.checked }))}
                  className="mt-1"
                />
                <span>I confirm the customer or authorised representative has agreed to the Repair Job Sheet Terms & Conditions.</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowManualJobSheetConsent(false)}
                className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading || !manualJobSheetConsentForm.confirmed}
                className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Record Consent
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {manualApprovalTarget && canManageReviews ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            onSubmit={handleManualApprovePosQuotation}
            className="w-full max-w-lg rounded-2xl border border-emerald-500/20 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Manual Approve Quotation</h2>
                <p className="mt-1 text-sm text-slate-400">Record customer or authorised representative approval.</p>
              </div>
              <button
                type="button"
                onClick={() => setManualApprovalTarget('')}
                className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
            <div className="grid gap-3">
              <select
                required
                value={manualApprovalForm.approvalMethod}
                onChange={(event) => setManualApprovalForm((current) => ({ ...current, approvalMethod: event.target.value }))}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                {['Walk-in', 'WhatsApp', 'Phone Call', 'SMS', 'Email', 'Representative Approval', 'Other'].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
              <input
                required
                value={manualApprovalForm.approvedByName}
                onChange={(event) => setManualApprovalForm((current) => ({ ...current, approvedByName: event.target.value }))}
                placeholder="Approved By Name"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <textarea
                value={manualApprovalForm.notes}
                onChange={(event) => setManualApprovalForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Notes"
                rows={3}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={manualApprovalForm.confirmed}
                  onChange={(event) => setManualApprovalForm((current) => ({ ...current, confirmed: event.target.checked }))}
                  className="mt-1"
                />
                <span>I confirm the customer or authorised representative has approved this quotation.</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setManualApprovalTarget('')}
                className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading || !manualApprovalForm.confirmed}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Approve Quotation
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {showPaymentModal && selectedJob && canManageReviews ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            onSubmit={handleSavePayment}
            className="w-full max-w-lg rounded-2xl border border-orange-500/20 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{editingPayment ? 'Update Payment' : 'Add Payment'}</h2>
              </div>
              <button type="button" onClick={resetPaymentForm} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">
                Cancel
              </button>
            </div>
            <div className="grid gap-3">
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={paymentForm.amount}
                onChange={(event) => {
                  setPaymentModalError(null);
                  setPaymentForm((current) => ({ ...current, amount: event.target.value }));
                }}
                placeholder="Amount"
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <select
                value={paymentForm.method}
                onChange={(event) => {
                  setPaymentModalError(null);
                  setPaymentForm((current) => ({ ...current, method: event.target.value as JobPaymentMethod }));
                }}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
              </select>
              <input
                type="date"
                value={paymentForm.paidAt}
                onChange={(event) => {
                  setPaymentModalError(null);
                  setPaymentForm((current) => ({ ...current, paidAt: event.target.value }));
                }}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
              <textarea
                value={paymentForm.note}
                onChange={(event) => {
                  setPaymentModalError(null);
                  setPaymentForm((current) => ({ ...current, note: event.target.value }));
                }}
                placeholder="Notes"
                rows={3}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            </div>
            {paymentModalError ? (
              <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {paymentModalError}
                {approvedJobQuotationForInvoice && linkedPosInvoices.every((invoice) => invoice.paymentStatus === 'void') ? (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={handleGenerateInvoiceFromJob}
                    className="mt-3 rounded-md border border-orange-500/35 px-3 py-1.5 text-xs font-semibold text-orange-100 hover:bg-orange-500/10 disabled:opacity-60"
                  >
                    {actionLoading ? 'Generating...' : 'Generate Invoice First'}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={resetPaymentForm} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200">
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                onClick={() => warnManageJobPaymentDebug({
                  checkpoint: 'payment:modalSubmit:clicked',
                  selectedJobDocId: selectedJob.docId,
                  jobNumber: getDisplayJobNumber(selectedJob),
                  amountRaw: paymentForm.amount,
                  amountParsed: Number(paymentForm.amount || 0),
                  paymentMethod: paymentForm.method,
                  paymentDate: paymentForm.paidAt,
                  profileUid: profile?.uid,
                  profileRole: profile?.role,
                  linkedInvoiceCount: linkedPosInvoices.length,
                })}
                className="rounded-md bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionLoading ? 'Saving...' : editingPayment ? 'Update Payment' : 'Add Payment'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
