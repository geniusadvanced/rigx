import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { updateCustomerMasterActivity } from '@/features/customers/services/customerService';
import { calculateTechnicianCommission } from '@/features/commissions/commissionCalculator';
import { DEFAULT_COMMISSION_PERCENTAGE, DEFAULT_COMMISSION_RULE_NAME } from '@/features/commissions/constants';
import {
  getCurrentRepairLifecycleStatus,
  updateJobLifecycleStatus,
  type RepairLifecycleStatus,
} from '@/features/jobs/services/jobLifecycleService';
import { db, storage } from '@/lib/firebase/init';
import { generateQuotationNumber } from '@/lib/numbering/publicNumberService';
import { assertCan, can } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import {
  buildInvoiceWhatsAppMessage as buildInvoiceMessageTemplate,
  buildWaMeLink,
} from './whatsappService';
import { defaultWarrantyTermsSnapshot } from './warrantyTerms';
import type {
  AiDetectedPriceItem,
  AiPricelistImport,
  CommissionRule,
  InventoryItem,
  InventoryMovement,
  InventoryStockLedgerEntry,
  InvoicePaymentStatus,
  PaymentSubmission,
  PosCommissionEntry,
  PosBranch,
  PosRefund,
  PosInvoice,
  PosLineItem,
  PosPayment,
  PosPaymentMethod,
  PosQuotation,
  PosWarranty,
  PosWarrantyClaim,
  PosWarrantyClaimStatus,
  PriceItem,
  PriceItemPricingType,
  PriceItemType,
  QuotationStatus,
} from './types';

export interface PriceItemInput {
  name: string;
  category: string;
  serviceGroup?: string;
  packageName?: string;
  pricingType?: PriceItemPricingType;
  type?: PriceItemType;
  basePrice: number;
  minPrice?: number;
  maxPrice?: number;
  unit?: string;
  deviceType?: string;
  model?: string;
  variant?: string;
  capacityTier?: string;
  problemType?: string;
  costPrice?: number;
  warrantyDays?: number;
  warrantyDurationDays?: number;
  customerNotes?: string;
  internalNotes?: string;
  branch?: '' | PosBranch;
  slug?: string;
  seedKey?: string;
  branchPrices?: Partial<Record<PosBranch, number>>;
  commissionEligible: boolean;
  active: boolean;
}

function normalizePriceItemSearchText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function priceItemMatchesSearch(item: PriceItem | PriceItemInput, searchTerm: string): boolean {
  const keywords = normalizePriceItemSearchText(searchTerm).split(' ').filter(Boolean);
  if (keywords.length === 0) return true;
  const haystack = normalizePriceItemSearchText([
    item.name,
    item.category,
    item.serviceGroup,
    item.packageName,
    item.deviceType,
    item.model,
    item.variant,
    item.capacityTier,
    item.problemType,
    item.customerNotes,
    item.internalNotes,
  ].join(' '));
  return keywords.every((keyword) => haystack.includes(keyword));
}

const proofTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxProofSize = 10 * 1024 * 1024;
const aiPricelistSourceTypes = ['image/jpeg', 'image/png', 'application/pdf'];

export interface PosDocumentInput {
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId?: string;
  deviceLabel?: string;
  deviceName?: string;
  deviceBrand?: string;
  deviceModel?: string;
  serialNumber?: string;
  imei?: string;
  jobId?: string;
  branchId: string;
  items: PosLineItem[];
  discountAmount: number;
  discountReason?: string;
  validUntil?: string;
}

export interface ManualQuotationApprovalInput {
  approvalMethod: string;
  approvedByName: string;
  notes?: string;
}

export interface JobFinancialSummary {
  jobId: string;
  quotationTotal: number;
  invoiceTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  refundTotal: number;
  approvedCommissionTotal: number;
  payrollLinkedCommissionTotal: number;
  paidCommissionTotal: number;
  inventoryCostTotal: number;
  grossProfitEstimate: number;
  quotationIds: string[];
  invoiceIds: string[];
}

export interface JobQuotationActionSummary {
  quotationId: string;
  jobId?: string;
  customerName: string;
  customerPhone: string;
  quotationNo: string;
  status: QuotationStatus;
  quotationApprovalStatus?: QuotationStatus;
  total: number;
  hasLineItems?: boolean;
  publicToken?: string;
  quotationApprovalToken?: string;
  deviceInfo?: string;
  reportedIssue?: string;
}

async function createInternalNotification(input: {
  title: string;
  message: string;
  type:
    | 'pos_quotation'
    | 'pos_payment'
    | 'warranty'
    | 'inventory'
    | 'commission'
    | 'system'
    | 'quotation_approved'
    | 'quotation_rejected'
    | 'quotation_manually_approved';
  branchId?: string;
  relatedModule?: string;
  actionUrl?: string;
  relatedEntityType?: 'quotation' | 'invoice' | 'paymentSubmission' | 'warranty' | 'job';
  relatedEntityId?: string;
  targetUserIds?: string[];
  metadata?: Record<string, unknown>;
}) {
  await addDoc(collection(db, 'notifications'), {
    ...input,
    targetRoles: ['admin', 'manager'],
    targetUserIds: input.targetUserIds || [],
    metadata: input.metadata || {},
    relatedModule: input.relatedModule || input.relatedEntityType || '',
    actionUrl: input.actionUrl || '',
    readBy: [],
    createdAt: serverTimestamp(),
  }).catch(() => undefined);
}

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function cleanText(value?: string): string {
  return String(value || '').trim();
}

function dateToTimestamp(value?: string): Timestamp {
  if (!value) {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return Timestamp.fromDate(date);
  }
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

async function getLinkedJobForPos(jobId?: string): Promise<Job | null> {
  const cleanJobId = cleanText(jobId);
  if (!cleanJobId) return null;
  const snapshot = await getDoc(doc(db, 'jobs', cleanJobId));
  if (!snapshot.exists()) throw new Error('Linked job not found');
  return { docId: snapshot.id, ...snapshot.data() } as Job;
}

async function getCustomerNumberForPos(customerId?: string): Promise<string> {
  const cleanCustomerId = cleanText(customerId);
  if (!cleanCustomerId) return '';
  const snapshot = await getDoc(doc(db, 'customers', cleanCustomerId));
  if (!snapshot.exists()) return '';
  return cleanText(snapshot.data().customerNumber);
}

function displayJobNumberForPos(job: Job | null): string {
  return job?.jobNo || job?.jobNumber || job?.jobSheetNo || '';
}

async function requireLinkedJobLifecycle(
  jobId: string | undefined,
  allowedStatuses: RepairLifecycleStatus[],
  blockedMessage: string,
): Promise<Job | null> {
  const job = await getLinkedJobForPos(jobId);
  if (!job) return null;
  const lifecycleStatus = getCurrentRepairLifecycleStatus(job);
  if (!allowedStatuses.includes(lifecycleStatus)) throw new Error(blockedMessage);
  return job;
}

function isValidQuotationRecord(quotation: PosQuotation): boolean {
  if (['void', 'cancelled', 'expired', 'rejected'].includes(String(quotation.quotationApprovalStatus || quotation.status || '').toLowerCase())) return false;
  return Number(quotation.total || 0) > 0 || quotation.items.some((item) => String(item.name || '').trim() && Number(item.quantity || 0) > 0);
}

function legacyLineItems(data: Record<string, unknown>, fallbackName: string): PosLineItem[] {
  if (Array.isArray(data.items) && data.items.length > 0) return data.items as PosLineItem[];
  const amount = Number(
    data.total
      ?? data.finalPrice
      ?? data.amount
      ?? data.quotationAmount
      ?? data.invoiceAmount
      ?? 0,
  );
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const name = cleanText(String(
    data.description
      ?? data.itemName
      ?? data.serviceName
      ?? data.deviceLabel
      ?? data.deviceName
      ?? fallbackName,
  )) || fallbackName;
  return [{
    priceItemId: '',
    name,
    category: cleanText(String(data.category || '')) || 'Service',
    type: cleanText(String(data.type || '')) || 'service',
    quantity: 1,
    unitPrice: amount,
    discount: 0,
    commissionEligible: false,
    costPrice: 0,
    netProfit: amount,
    warrantyDurationDays: 0,
    total: amount,
  }];
}

async function moveLinkedJobLifecycle(
  jobId: string | undefined,
  nextStatus: RepairLifecycleStatus,
  note: string,
  user: UserData,
): Promise<void> {
  const job = await getLinkedJobForPos(jobId);
  if (!job) return;
  if (getCurrentRepairLifecycleStatus(job) === nextStatus) return;
  await updateJobLifecycleStatus({ job, user, nextStatus, note });
}

async function moveLinkedJobToQuotationSent(jobId: string | undefined, user: UserData): Promise<void> {
  const job = await getLinkedJobForPos(jobId);
  if (!job) return;
  const currentStatus = getCurrentRepairLifecycleStatus(job);
  if (currentStatus === 'diagnosis' || currentStatus === 'customer_rejected') {
    await updateJobLifecycleStatus({
      job,
      user,
      nextStatus: 'quotation_pending',
      note: currentStatus === 'customer_rejected' ? 'POS quotation revised' : 'POS quotation prepared',
    });
    const updatedJob = await getLinkedJobForPos(jobId);
    if (updatedJob) {
      await updateJobLifecycleStatus({ job: updatedJob, user, nextStatus: 'quotation_sent', note: 'POS quotation sent' });
    }
    return;
  }
  await updateJobLifecycleStatus({ job, user, nextStatus: 'quotation_sent', note: 'POS quotation sent' });
}

function canUseJobQuotationAction(job: Job, user: UserData): boolean {
  return can(user.role, 'pos.operate') || (user.role === 'technician' && job.technicianId === user.uid);
}

function assertCanUseJobQuotationAction(job: Job, user: UserData) {
  if (!canUseJobQuotationAction(job, user)) {
    throw new Error('Permission denied');
  }
}

async function ensureQuotationPublicTokenForJobAction(quotationId: string, user: UserData): Promise<string> {
  const quotationRef = doc(db, 'quotations', quotationId);
  const snapshot = await getDoc(quotationRef);
  if (!snapshot.exists()) throw new Error('Quotation not found');
  const existingToken = String(snapshot.data().publicToken || '');
  if (existingToken) return existingToken;
  const publicToken = generatePublicToken();
  await updateDoc(quotationRef, {
    publicToken,
    quotationApprovalToken: publicToken,
    publicTokenCreatedAt: serverTimestamp(),
    quotationApprovalTokenCreatedAt: serverTimestamp(),
    publicTokenStatus: 'active',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotationId,
    action: 'pos_quotation_public_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicToken', before: null, after: 'created' }],
    note: 'Quotation public token created',
  });
  return publicToken;
}

function mapPriceItem(id: string, data: Record<string, unknown>): PriceItem {
  return { ...(data as Omit<PriceItem, 'priceItemId'>), priceItemId: id };
}

function mapQuotation(id: string, data: Record<string, unknown>): PosQuotation {
  const items = legacyLineItems(data, 'Service quotation');
  const subtotal = Number(data.subtotal ?? items.reduce((sum, item) => sum + Number(item.total || 0), 0));
  const discountAmount = Number(data.discountAmount ?? 0);
  const total = Number(data.total ?? Math.max(0, subtotal - discountAmount));
  return {
    ...(data as Omit<PosQuotation, 'quotationId'>),
    quotationId: id,
    items,
    subtotal,
    discountAmount,
    total,
  };
}

function mapJobQuotationAction(quotation: PosQuotation): JobQuotationActionSummary {
  const firstItem = quotation.items?.[0];
  return {
    quotationId: quotation.quotationId,
    jobId: quotation.jobId,
    customerName: quotation.customerName,
    customerPhone: quotation.customerPhone,
    quotationNo: quotation.quotationNo,
    status: quotation.status,
    quotationApprovalStatus: quotation.quotationApprovalStatus,
    total: quotation.total,
    hasLineItems: quotation.items?.some((item) => String(item.name || '').trim() && Number(item.quantity || 0) > 0) || false,
    publicToken: quotation.publicToken,
    quotationApprovalToken: quotation.quotationApprovalToken,
    deviceInfo: [firstItem?.name, quotation.items?.length > 1 ? `and ${quotation.items.length - 1} more item(s)` : ''].filter(Boolean).join(' ') || 'Service',
    reportedIssue: firstItem?.name || '',
  };
}

function mapInvoice(id: string, data: Record<string, unknown>): PosInvoice {
  const items = legacyLineItems(data, 'Service invoice');
  const subtotal = Number(data.subtotal ?? items.reduce((sum, item) => sum + Number(item.total || 0), 0));
  const discountAmount = Number(data.discountAmount ?? 0);
  const total = Number(data.total ?? Math.max(0, subtotal - discountAmount));
  const amountPaid = Number(data.amountPaid ?? 0);
  return {
    ...(data as Omit<PosInvoice, 'invoiceId'>),
    invoiceId: id,
    items,
    subtotal,
    discountAmount,
    total,
    amountPaid,
    balance: Number(data.balance ?? Math.max(0, total - amountPaid)),
  };
}

function mapPayment(id: string, data: Record<string, unknown>): PosPayment {
  return { ...(data as Omit<PosPayment, 'paymentId'>), paymentId: id };
}

function mapPaymentSubmission(id: string, data: Record<string, unknown>): PaymentSubmission {
  return { ...(data as Omit<PaymentSubmission, 'submissionId'>), submissionId: id };
}

function mapWarranty(id: string, data: Record<string, unknown>): PosWarranty {
  return { ...(data as Omit<PosWarranty, 'warrantyId'>), warrantyId: id };
}

function mapRefund(id: string, data: Record<string, unknown>): PosRefund {
  return { ...(data as Omit<PosRefund, 'refundId'>), refundId: id };
}

function mapWarrantyClaim(id: string, data: Record<string, unknown>): PosWarrantyClaim {
  return { ...(data as Omit<PosWarrantyClaim, 'claimId'>), claimId: id };
}

function mapCommissionEntry(id: string, data: Record<string, unknown>): PosCommissionEntry {
  return { ...(data as Omit<PosCommissionEntry, 'entryId'>), entryId: id };
}

function quotationJobReference(quotation: PosQuotation, job: Job | null): string {
  return job ? (job.jobNo || job.jobNumber || job.jobSheetNo || 'Not linked') : 'Not linked';
}

function quotationApprovalSnapshot(quotation: PosQuotation, job: Job | null) {
  return {
    quotationNo: quotation.quotationNo,
    jobId: quotationJobReference(quotation, job),
    sourceJobId: quotation.jobId || '',
    customerName: quotation.customerName,
    customerPhone: quotation.customerPhone,
    deviceModel: job ? [job.deviceBrand, job.deviceModel || job.device].filter(Boolean).join(' ') : quotation.deviceLabel || quotation.deviceModel || quotation.deviceName || '',
    totalAmount: Number(quotation.total || 0),
    items: quotation.items || [],
    termsVersion: '2026-05-08',
  };
}

function mapInventoryMovement(id: string, data: Record<string, unknown>): InventoryMovement {
  return { ...(data as Omit<InventoryMovement, 'movementId'>), movementId: id };
}

function mapInventoryItem(id: string, data: Record<string, unknown>): InventoryItem {
  return { ...(data as Omit<InventoryItem, 'inventoryItemId'>), inventoryItemId: id };
}

function mapCommissionRule(id: string, data: Record<string, unknown>): CommissionRule {
  return { ...(data as Omit<CommissionRule, 'ruleId'>), ruleId: id };
}

function mapInventoryStockLedgerEntry(id: string, data: Record<string, unknown>): InventoryStockLedgerEntry {
  return { ...(data as Omit<InventoryStockLedgerEntry, 'ledgerId'>), ledgerId: id };
}

function mapAiPricelistImport(id: string, data: Record<string, unknown>): AiPricelistImport {
  return { ...(data as Omit<AiPricelistImport, 'importId'>), importId: id };
}

function normalizeItems(items: PosLineItem[]): PosLineItem[] {
  if (!items.length) throw new Error('At least one item is required');
  return items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const discount = Number(item.discount || 0);
    if (!cleanText(item.name)) throw new Error('Item name is required');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Item quantity must be valid');
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Item price must be valid');
    if (!Number.isFinite(discount) || discount < 0) throw new Error('Item discount must be valid');
    const total = Math.max(0, quantity * unitPrice - discount);
    const costPrice = Number(item.costPrice || 0);
    const lineDirectCost = Math.max(0, costPrice * quantity);
    return {
      priceItemId: item.priceItemId || '',
      name: cleanText(item.name),
      category: cleanText(item.category),
      serviceGroup: cleanText(item.serviceGroup),
      pricingType: item.pricingType || 'fixed',
      basePrice: Number(item.basePrice || 0),
      minPrice: Number(item.minPrice || 0),
      maxPrice: Number(item.maxPrice || 0),
      type: item.type || 'service',
      quantity,
      unitPrice,
      discount,
      commissionEligible: item.commissionEligible === true,
      costPrice,
      netProfit: Number((total - lineDirectCost).toFixed(2)),
      warrantyDurationDays: Number(item.warrantyDurationDays || 0),
      total,
    };
  });
}

function calculateTotals(items: PosLineItem[], discountAmount: number) {
  const subtotal = items.reduce((total, item) => total + Number(item.total || 0), 0);
  const parsedDiscount = Number(discountAmount || 0);
  if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) throw new Error('Discount amount must be valid');
  const discount = Math.max(0, parsedDiscount);
  return { subtotal, discountAmount: discount, total: Math.max(0, subtotal - discount) };
}

function nextNumber(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

function currentYearSuffix(): string {
  return String(new Date().getFullYear()).slice(-2);
}

function officialSequenceFromInvoice(invoice: PosInvoice): number {
  const year = currentYearSuffix();
  const candidate = String(invoice.officialInvoiceNo || invoice.invoiceNo || '');
  const match = candidate.match(new RegExp(`^INV-${year}(\\d{4})$`));
  return match ? Number(match[1]) : 0;
}

async function nextOfficialInvoiceNo(user: UserData): Promise<string> {
  const year = currentYearSuffix();
  const invoices = await getInvoices(user).catch(() => []);
  const nextSequence = invoices.reduce((max, invoice) => Math.max(max, officialSequenceFromInvoice(invoice)), 0) + 1;
  return `INV-${year}${String(nextSequence).padStart(4, '0')}`;
}

function generatePublicToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function uploadPaymentProof(invoiceId: string, paymentId: string, file?: File | null): Promise<string> {
  if (!file) return '';
  if (!proofTypes.includes(file.type)) throw new Error('Only JPG, PNG, or PDF proof files are allowed');
  if (file.size > maxProofSize) throw new Error('Payment proof must be 10MB or smaller');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadSnapshot = await uploadBytes(ref(storage, `pos-payments/${invoiceId}/${paymentId}/${Date.now()}_${safeName}`), file, {
    contentType: file.type,
  });
  return getDownloadURL(uploadSnapshot.ref);
}

function getFirebaseErrorDetails(error: unknown) {
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

async function uploadAiPricelistSourceFile(importId: string, file: File | null | undefined, user: UserData, branchId?: string): Promise<string> {
  if (!file) return '';
  if (!aiPricelistSourceTypes.includes(file.type)) throw new Error('Only JPG, PNG, or PDF pricelist files are allowed');
  if (file.size > maxProofSize) throw new Error('Pricelist file must be 10MB or smaller');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `ai-pricelist-imports/${importId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  let uploadSnapshot;
  try {
    uploadSnapshot = await uploadBytes(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedBy: user.uid,
        branchId: cleanText(branchId),
        contentType: file.type,
      },
    });
  } catch (error) {
    console.warn('[POS AI PRICELIST STORAGE WARNING]', JSON.stringify({
      action: 'uploadBytes',
      storagePath,
      userUid: user.uid,
      userRole: user.role,
      branchId: cleanText(branchId),
      ...getFirebaseErrorDetails(error),
    }, null, 2));
    throw error;
  }

  try {
    return await getDownloadURL(uploadSnapshot.ref);
  } catch (error) {
    console.warn('[POS AI PRICELIST STORAGE WARNING]', JSON.stringify({
      action: 'getDownloadURL',
      storagePath,
      userUid: user.uid,
      userRole: user.role,
      branchId: cleanText(branchId),
      ...getFirebaseErrorDetails(error),
    }, null, 2));
    throw error;
  }
}

function deriveAiPricelistImportStatus(detectedItems: AiDetectedPriceItem[]): AiPricelistImport['status'] {
  if (!detectedItems.length) return 'parsed';
  const approvedCount = detectedItems.filter((item) => item.status === 'approved').length;
  const rejectedCount = detectedItems.filter((item) => item.status === 'rejected').length;
  const reviewedCount = approvedCount + rejectedCount;
  if (reviewedCount === detectedItems.length && approvedCount > 0 && rejectedCount === 0) return 'approved';
  if (reviewedCount === detectedItems.length && approvedCount === 0 && rejectedCount > 0) return 'rejected';
  if (reviewedCount > 0) return 'partially_approved';
  return 'parsed';
}

export async function getPriceItems(user: UserData): Promise<PriceItem[]> {
  if (!can(user.role, 'pos.manage') && !can(user.role, 'pos.view')) assertCan(user.role, 'pos.view');
  const snapshot = await getDocs(collection(db, 'priceItems'));
  return snapshot.docs.map((itemDoc) => mapPriceItem(itemDoc.id, itemDoc.data())).sort((a, b) => a.name.localeCompare(b.name));
}

function priceItemSlug(input: Pick<PriceItemInput, 'category' | 'packageName' | 'name' | 'model'>): string {
  return [input.category, input.packageName, input.name, input.model]
    .map((value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
    .filter(Boolean)
    .join('__');
}

function normalizePriceItemInput(input: PriceItemInput) {
  const pricingType = input.pricingType || 'fixed';
  const type = input.type || 'service';
  const basePrice = Number(input.basePrice || 0);
  const minPrice = Number(input.minPrice || 0);
  const maxPrice = Number(input.maxPrice || 0);
  const warrantyDays = Number(input.warrantyDays ?? input.warrantyDurationDays ?? 0);
  if (!cleanText(input.name)) throw new Error('Name is required');
  if (!cleanText(input.category)) throw new Error('Category is required');
  if (!['fixed', 'starting_from', 'range', 'quote_required', 'free_or_waived'].includes(pricingType)) throw new Error('Pricing type is invalid');
  if (pricingType === 'fixed' && (!Number.isFinite(basePrice) || basePrice < 0)) throw new Error('Base price must be valid');
  if (pricingType === 'starting_from' && (!Number.isFinite(basePrice) || basePrice <= 0)) throw new Error('Starting price must be greater than 0');
  if (pricingType === 'range' && (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice < minPrice)) throw new Error('Price range must be valid');

  return {
    category: cleanText(input.category),
    serviceGroup: cleanText(input.serviceGroup),
    name: cleanText(input.name),
    packageName: cleanText(input.packageName),
    type,
    pricingType,
    basePrice: pricingType === 'range' ? minPrice : basePrice,
    minPrice,
    maxPrice,
    unit: cleanText(input.unit),
    deviceType: cleanText(input.deviceType),
    model: cleanText(input.model),
    variant: cleanText(input.variant),
    capacityTier: cleanText(input.capacityTier),
    problemType: cleanText(input.problemType),
    costPrice: Number(input.costPrice || 0),
    warrantyDays,
    warrantyDurationDays: warrantyDays,
    customerNotes: cleanText(input.customerNotes),
    internalNotes: cleanText(input.internalNotes),
    branch: input.branch || '',
    slug: input.slug || priceItemSlug(input),
    seedKey: cleanText(input.seedKey),
    branchPrices: input.branchPrices || {},
    commissionEligible: Boolean(input.commissionEligible),
    active: Boolean(input.active),
  };
}

export async function createPriceItem(input: PriceItemInput, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const payload = normalizePriceItemInput(input);
  const itemRef = await addDoc(collection(db, 'priceItems'), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: itemRef.id,
    action: 'pos_price_item_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'name', before: null, after: payload.name }],
    note: 'Price item created',
  });
}

export async function updatePriceItem(itemId: string, input: PriceItemInput, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const payload = normalizePriceItemInput(input);
  await updateDoc(doc(db, 'priceItems', itemId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: itemId,
    action: 'pos_price_item_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'name', before: null, after: payload.name }],
    note: 'Price item updated',
  });
}

export async function deletePriceItem(itemId: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await deleteDoc(doc(db, 'priceItems', itemId));
}

export async function duplicatePriceItem(item: PriceItem, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await createPriceItem({
    ...item,
    name: `${item.name} Copy`,
    slug: '',
    seedKey: '',
  }, user);
}

type GeniusAdvancedSeedItem = Partial<PriceItemInput> & {
  name: string;
  pricingType: PriceItemPricingType;
};

type GeniusAdvancedSeedGroup = {
  category: string;
  serviceGroup: string;
  items: GeniusAdvancedSeedItem[];
};

const macBookBatterySeedItems: GeniusAdvancedSeedItem[] = [
  { name: 'MacBook Battery A1278', pricingType: 'fixed', basePrice: 450, deviceType: 'MacBook', model: 'A1278' },
  { name: 'MacBook Battery A1286', pricingType: 'fixed', basePrice: 480, deviceType: 'MacBook', model: 'A1286' },
  { name: 'MacBook Battery A1309', pricingType: 'fixed', basePrice: 400, deviceType: 'MacBook', model: 'A1309' },
  { name: 'MacBook Battery A1465', pricingType: 'fixed', basePrice: 470, deviceType: 'MacBook', model: 'A1465' },
  { name: 'MacBook Battery A1466', pricingType: 'fixed', basePrice: 450, deviceType: 'MacBook', model: 'A1466' },
  { name: 'MacBook Battery A1398', pricingType: 'fixed', basePrice: 520, deviceType: 'MacBook', model: 'A1398' },
  { name: 'MacBook Battery A1425', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A1425' },
  { name: 'MacBook Battery A1502', pricingType: 'fixed', basePrice: 520, deviceType: 'MacBook', model: 'A1502' },
  { name: 'MacBook Battery A1534', pricingType: 'fixed', basePrice: 350, deviceType: 'MacBook', model: 'A1534' },
  { name: 'MacBook Battery A1706', pricingType: 'fixed', basePrice: 520, deviceType: 'MacBook', model: 'A1706' },
  { name: 'MacBook Battery A1707', pricingType: 'fixed', basePrice: 600, deviceType: 'MacBook', model: 'A1707' },
  { name: 'MacBook Battery A1708', pricingType: 'fixed', basePrice: 510, deviceType: 'MacBook', model: 'A1708' },
  { name: 'MacBook Battery A1989', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A1989' },
  { name: 'MacBook Battery A1990', pricingType: 'fixed', basePrice: 570, deviceType: 'MacBook', model: 'A1990' },
  { name: 'MacBook Battery A2159', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A2159' },
  { name: 'MacBook Battery A2141', pricingType: 'fixed', basePrice: 610, deviceType: 'MacBook', model: 'A2141' },
  { name: 'MacBook Battery A2251', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A2251' },
  { name: 'MacBook Battery A2289', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A2289' },
  { name: 'MacBook Battery A1932', pricingType: 'fixed', basePrice: 520, deviceType: 'MacBook', model: 'A1932' },
  { name: 'MacBook Battery A2179', pricingType: 'fixed', basePrice: 520, deviceType: 'MacBook', model: 'A2179' },
  { name: 'MacBook Battery A2337 M1 Air', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A2337', variant: 'M1 Air' },
  { name: 'MacBook Battery A2338 M1/M2 Pro', pricingType: 'fixed', basePrice: 530, deviceType: 'MacBook', model: 'A2338', variant: 'M1/M2 Pro' },
  { name: 'MacBook Battery A2442 M1 Pro 14 inch', pricingType: 'fixed', basePrice: 600, deviceType: 'MacBook', model: 'A2442', variant: 'M1 Pro 14 inch' },
  { name: 'MacBook Battery A2485 M1 Pro 16 inch', pricingType: 'fixed', basePrice: 610, deviceType: 'MacBook', model: 'A2485', variant: 'M1 Pro 16 inch' },
  { name: 'MacBook Battery A2681 M2 Pro 13 inch', pricingType: 'fixed', basePrice: 630, deviceType: 'MacBook', model: 'A2681', variant: 'M2 Pro 13 inch' },
  { name: 'MacBook Battery A2779 M2 Pro 14 inch', pricingType: 'fixed', basePrice: 630, deviceType: 'MacBook', model: 'A2779', variant: 'M2 Pro 14 inch' },
  { name: 'MacBook Battery A2780 M2 Pro 16 inch', pricingType: 'fixed', basePrice: 630, deviceType: 'MacBook', model: 'A2780', variant: 'M2 Pro 16 inch' },
  { name: 'MacBook Battery A2941 M2 Air 15 inch', pricingType: 'fixed', basePrice: 650, deviceType: 'MacBook', model: 'A2941', variant: 'M2 Air 15 inch' },
  { name: 'MacBook Battery A2992 M3 Pro 14 inch', pricingType: 'fixed', basePrice: 630, deviceType: 'MacBook', model: 'A2992', variant: 'M3 Pro 14 inch' },
  { name: 'MacBook Battery A2991 M3 Pro 16 inch', pricingType: 'fixed', basePrice: 630, deviceType: 'MacBook', model: 'A2991', variant: 'M3 Pro 16 inch' },
  { name: 'MacBook Battery A3113 M3 Air 13 inch', pricingType: 'quote_required', deviceType: 'MacBook', model: 'A3113', variant: 'M3 Air 13 inch', internalNotes: 'Need manual price verification.' },
  { name: 'MacBook Battery A3114 M3 Air 15 inch', pricingType: 'quote_required', deviceType: 'MacBook', model: 'A3114', variant: 'M3 Air 15 inch', internalNotes: 'Need manual price verification.' },
];

const macBookDisplaySeedItems: GeniusAdvancedSeedItem[] = [
  { name: 'MacBook Display A1278 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 899, deviceType: 'MacBook', model: 'A1278', warrantyDays: 90, customerNotes: 'LCD replacement only.' },
  { name: 'MacBook Display A1278 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1299, deviceType: 'MacBook', model: 'A1278', warrantyDays: 90, customerNotes: 'Full display assembly replacement.' },
  { name: 'MacBook Display A1286 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 949, deviceType: 'MacBook', model: 'A1286', warrantyDays: 90 },
  { name: 'MacBook Display A1369 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 899, deviceType: 'MacBook', model: 'A1369', warrantyDays: 90 },
  { name: 'MacBook Display A1369 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1299, deviceType: 'MacBook', model: 'A1369', warrantyDays: 90 },
  { name: 'MacBook Display A1465 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 899, deviceType: 'MacBook', model: 'A1465', warrantyDays: 90 },
  { name: 'MacBook Display A1466 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 899, deviceType: 'MacBook', model: 'A1466', warrantyDays: 90 },
  { name: 'MacBook Display A1466 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1199, deviceType: 'MacBook', model: 'A1466', warrantyDays: 90 },
  { name: 'MacBook Display A1398 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A1398', warrantyDays: 90 },
  { name: 'MacBook Display A1398 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A1398', warrantyDays: 90 },
  { name: 'MacBook Display A1502 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1349, deviceType: 'MacBook', model: 'A1502', warrantyDays: 90 },
  { name: 'MacBook Display A1502 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1649, deviceType: 'MacBook', model: 'A1502', warrantyDays: 90 },
  { name: 'MacBook Display A1706 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A1706', warrantyDays: 90 },
  { name: 'MacBook Display A1706 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A1706', warrantyDays: 90 },
  { name: 'MacBook Display A1707 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2199, deviceType: 'MacBook', model: 'A1707', warrantyDays: 90 },
  { name: 'MacBook Display A1707 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 2699, deviceType: 'MacBook', model: 'A1707', warrantyDays: 90 },
  { name: 'MacBook Display A1708 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A1708', warrantyDays: 90 },
  { name: 'MacBook Display A1708 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A1708', warrantyDays: 90 },
  { name: 'MacBook Display A1989 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A1989', warrantyDays: 90 },
  { name: 'MacBook Display A1989 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A1989', warrantyDays: 90 },
  { name: 'MacBook Display A1990 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2299, deviceType: 'MacBook', model: 'A1990', warrantyDays: 90 },
  { name: 'MacBook Display A1990 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 2799, deviceType: 'MacBook', model: 'A1990', warrantyDays: 90 },
  { name: 'MacBook Display A2159 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A2159', warrantyDays: 90 },
  { name: 'MacBook Display A2159 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2159', warrantyDays: 90 },
  { name: 'MacBook Display A2141 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2699, deviceType: 'MacBook', model: 'A2141', warrantyDays: 90 },
  { name: 'MacBook Display A2141 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 3099, deviceType: 'MacBook', model: 'A2141', warrantyDays: 90 },
  { name: 'MacBook Display A2251 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A2251', warrantyDays: 90 },
  { name: 'MacBook Display A2251 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2251', warrantyDays: 90 },
  { name: 'MacBook Display A2289 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A2289', warrantyDays: 90 },
  { name: 'MacBook Display A2289 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2289', warrantyDays: 90 },
  { name: 'MacBook Display A1932 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A1932', warrantyDays: 90 },
  { name: 'MacBook Display A1932 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A1932', warrantyDays: 90 },
  { name: 'MacBook Display A2179 LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A2179', warrantyDays: 90 },
  { name: 'MacBook Display A2179 Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2179', warrantyDays: 90 },
  { name: 'MacBook Display A2337 M1 Air LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1399, deviceType: 'MacBook', model: 'A2337', variant: 'M1 Air', warrantyDays: 90 },
  { name: 'MacBook Display A2337 M1 Air Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2337', variant: 'M1 Air', warrantyDays: 90 },
  { name: 'MacBook Display A2338 M1/M2 Pro LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1499, deviceType: 'MacBook', model: 'A2338', variant: 'M1/M2 Pro', warrantyDays: 90 },
  { name: 'MacBook Display A2338 M1/M2 Pro Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1799, deviceType: 'MacBook', model: 'A2338', variant: 'M1/M2 Pro', warrantyDays: 90 },
  { name: 'MacBook Display A2442 M1 Pro 14 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2199, deviceType: 'MacBook', model: 'A2442', variant: 'M1 Pro 14 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2442 M1 Pro 14 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 2999, deviceType: 'MacBook', model: 'A2442', variant: 'M1 Pro 14 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2485 M1 Pro 16 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2299, deviceType: 'MacBook', model: 'A2485', variant: 'M1 Pro 16 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2485 M1 Pro 16 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 3199, deviceType: 'MacBook', model: 'A2485', variant: 'M1 Pro 16 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2681 M2 Pro 13 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1499, deviceType: 'MacBook', model: 'A2681', variant: 'M2 Pro 13 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2681 M2 Pro 13 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1699, deviceType: 'MacBook', model: 'A2681', variant: 'M2 Pro 13 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2779 M2 Pro 14 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2299, deviceType: 'MacBook', model: 'A2779', variant: 'M2 Pro 14 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2779 M2 Pro 14 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 3199, deviceType: 'MacBook', model: 'A2779', variant: 'M2 Pro 14 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2780 M2 Pro 16 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2299, deviceType: 'MacBook', model: 'A2780', variant: 'M2 Pro 16 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2780 M2 Pro 16 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 3099, deviceType: 'MacBook', model: 'A2780', variant: 'M2 Pro 16 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2941 M2 Air 15 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1599, deviceType: 'MacBook', model: 'A2941', variant: 'M2 Air 15 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2941 M2 Air 15 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 2199, deviceType: 'MacBook', model: 'A2941', variant: 'M2 Air 15 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2992 M3 Pro 14 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2399, deviceType: 'MacBook', model: 'A2992', variant: 'M3 Pro 14 inch', warrantyDays: 90 },
  { name: 'MacBook Display A2991 M3 Pro 16 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 2499, deviceType: 'MacBook', model: 'A2991', variant: 'M3 Pro 16 inch', warrantyDays: 90 },
  { name: 'MacBook Display A3113 M3 Air 13 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1499, deviceType: 'MacBook', model: 'A3113', variant: 'M3 Air 13 inch', warrantyDays: 90 },
  { name: 'MacBook Display A3113 M3 Air 13 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 1799, deviceType: 'MacBook', model: 'A3113', variant: 'M3 Air 13 inch', warrantyDays: 90 },
  { name: 'MacBook Display A3114 M3 Air 15 inch LCD', packageName: 'LCD', pricingType: 'fixed', basePrice: 1599, deviceType: 'MacBook', model: 'A3114', variant: 'M3 Air 15 inch', warrantyDays: 90 },
  { name: 'MacBook Display A3114 M3 Air 15 inch Full Set', packageName: 'Full Set', pricingType: 'fixed', basePrice: 2199, deviceType: 'MacBook', model: 'A3114', variant: 'M3 Air 15 inch', warrantyDays: 90 },
];

const geniusAdvancedSeedGroups: GeniusAdvancedSeedGroup[] = [
  {
    category: 'Windows Format & Restoration Service',
    serviceGroup: 'Laptop System Restoration & Backup',
    items: [
      { name: 'Format Service', pricingType: 'fixed', basePrice: 79, customerNotes: 'Clean Windows installation.' },
      { name: 'Format + Data Restore + Driver Setup', pricingType: 'fixed', basePrice: 149, customerNotes: 'Includes data backup, restore and driver installation.' },
      { name: 'Complete System Setup', pricingType: 'fixed', basePrice: 179, customerNotes: 'Includes Windows activation, essential software installation and latest update.' },
      { name: 'Microsoft Office Activation', serviceGroup: 'Activation Only', pricingType: 'fixed', basePrice: 79 },
      { name: 'Windows Activation', serviceGroup: 'Activation Only', pricingType: 'fixed', basePrice: 79 },
    ],
  },
  {
    category: 'PlayStation 5',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 149 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 199 },
      { name: 'Pro Restore', pricingType: 'fixed', basePrice: 249 },
    ],
  },
  {
    category: 'PlayStation 5 Controller Repair',
    serviceGroup: 'Drift Stick Issue',
    items: [
      { name: 'Single Stick Drift', pricingType: 'fixed', basePrice: 99, warrantyDays: 90 },
      { name: 'Dual Stick Drift', pricingType: 'fixed', basePrice: 149, warrantyDays: 90 },
      { name: 'Full Controller Restore', pricingType: 'fixed', basePrice: 179, warrantyDays: 90 },
    ],
  },
  {
    category: 'Office Laptop',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 69 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 99 },
      { name: 'Pro Restore', pricingType: 'fixed', basePrice: 149 },
    ],
  },
  {
    category: 'PlayStation 4',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 99 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 159 },
      { name: 'Pro Restore', pricingType: 'fixed', basePrice: 199 },
    ],
  },
  {
    category: 'PlayStation 4 Controller Repair',
    serviceGroup: 'Drift Stick Issue',
    items: [
      { name: 'Single Stick Drift', pricingType: 'fixed', basePrice: 89, warrantyDays: 90 },
      { name: 'Dual Stick Drift', pricingType: 'fixed', basePrice: 129, warrantyDays: 90 },
      { name: 'Full Controller Restore', pricingType: 'fixed', basePrice: 149, warrantyDays: 90 },
    ],
  },
  {
    category: 'Laptop Motherboard Repair',
    serviceGroup: 'Microsoldering Service',
    items: [
      { name: 'Laptop Office Board Repair', pricingType: 'starting_from', basePrice: 399, deviceType: 'Office Laptop' },
      { name: 'Gaming Laptop Board Repair', pricingType: 'starting_from', basePrice: 539, deviceType: 'Gaming Laptop' },
      { name: 'MacBook Board Repair', pricingType: 'starting_from', basePrice: 579, deviceType: 'MacBook' },
      { name: 'Gaming PC Board Repair', pricingType: 'starting_from', basePrice: 539, deviceType: 'Gaming PC' },
      { name: 'Diagnosis Fee', pricingType: 'free_or_waived', basePrice: 30, customerNotes: 'RM30, waived if proceed repair.' },
    ],
  },
  {
    category: 'Gaming PC',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 99 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 149 },
      { name: 'Pro Restore', pricingType: 'range', minPrice: 199, maxPrice: 249 },
      { name: 'GPU Deep Clean + Thermal Paste', serviceGroup: 'GPU Only Service', pricingType: 'fixed', basePrice: 129 },
      { name: 'GPU Deep Clean + Thermal Paste + Thermal Pad', serviceGroup: 'GPU Only Service', pricingType: 'fixed', basePrice: 149 },
    ],
  },
  {
    category: 'Laptop Hinge Restoration Service',
    serviceGroup: 'Hinge Repair & Restoration',
    items: [
      { name: 'Office Laptop Single Side Hinge Repair', pricingType: 'fixed', basePrice: 149, deviceType: 'Office Laptop' },
      { name: 'Office Laptop Full Hinge Restoration', pricingType: 'fixed', basePrice: 199, deviceType: 'Office Laptop' },
      { name: 'Touch Screen Laptop Single Side Hinge Repair', pricingType: 'fixed', basePrice: 179, deviceType: 'Touch Screen Laptop' },
      { name: 'Touch Screen Laptop Full Hinge Restoration', pricingType: 'fixed', basePrice: 229, deviceType: 'Touch Screen Laptop' },
      { name: 'Gaming Laptop Single Side Hinge Repair', pricingType: 'fixed', basePrice: 179, deviceType: 'Gaming Laptop' },
      { name: 'Gaming Laptop Full Hinge Restoration', pricingType: 'fixed', basePrice: 249, deviceType: 'Gaming Laptop' },
    ],
  },
  {
    category: 'Data Recovery',
    serviceGroup: 'Logical Data Recovery',
    items: [
      { name: 'Memory Card / USB / SSD Logical Recovery', pricingType: 'starting_from', basePrice: 150, problemType: 'Deleted / Format / Virus' },
      { name: 'HDD Logical Recovery ≤500GB', pricingType: 'starting_from', basePrice: 400, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤500GB' },
      { name: 'HDD Logical Recovery ≤1TB', pricingType: 'starting_from', basePrice: 450, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤1TB' },
      { name: 'HDD Logical Recovery ≤2TB', pricingType: 'starting_from', basePrice: 500, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤2TB' },
      { name: 'HDD Logical Recovery ≤3TB', pricingType: 'starting_from', basePrice: 550, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤3TB' },
      { name: 'HDD Logical Recovery ≥4TB', pricingType: 'starting_from', basePrice: 600, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≥4TB' },
    ],
  },
  {
    category: 'Data Recovery',
    serviceGroup: 'Physical Data Recovery',
    items: [
      { name: 'Memory Card / USB / SSD Physical Recovery', pricingType: 'starting_from', basePrice: 600, problemType: 'Bad Sector / PCB / Firmware' },
      { name: 'HDD Physical Recovery ≤500GB', pricingType: 'starting_from', basePrice: 500, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤500GB' },
      { name: 'HDD Physical Recovery ≤1TB', pricingType: 'starting_from', basePrice: 600, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤1TB' },
      { name: 'HDD Physical Recovery ≤2TB', pricingType: 'starting_from', basePrice: 700, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤2TB' },
      { name: 'HDD Physical Recovery ≤3TB', pricingType: 'starting_from', basePrice: 800, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤3TB' },
      { name: 'HDD Physical Recovery ≥4TB', pricingType: 'starting_from', basePrice: 900, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≥4TB' },
    ],
  },
  {
    category: 'Data Recovery',
    serviceGroup: 'Advanced Clean Room',
    items: [
      { name: 'HDD Clean Room Recovery ≤500GB', pricingType: 'starting_from', basePrice: 1800, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤500GB', problemType: 'Head / Motor Damage' },
      { name: 'HDD Clean Room Recovery ≤1TB', pricingType: 'starting_from', basePrice: 2200, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤1TB', problemType: 'Head / Motor Damage' },
      { name: 'HDD Clean Room Recovery ≤2TB', pricingType: 'starting_from', basePrice: 2600, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤2TB', problemType: 'Head / Motor Damage' },
      { name: 'HDD Clean Room Recovery ≤3TB', pricingType: 'starting_from', basePrice: 3000, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≤3TB', problemType: 'Head / Motor Damage' },
      { name: 'HDD Clean Room Recovery ≥4TB', pricingType: 'starting_from', basePrice: 3400, deviceType: 'HDD 2.5 / 3.5', capacityTier: '≥4TB', problemType: 'Head / Motor Damage' },
      { name: 'RAID / Server Recovery', serviceGroup: 'RAID / Server Recovery', pricingType: 'range', minPrice: 2000, maxPrice: 5000, unit: 'per drive' },
      { name: 'Diagnosis', serviceGroup: 'Diagnosis', pricingType: 'free_or_waived', basePrice: 50, customerNotes: 'Starting RM50. Waived if proceed.' },
    ],
  },
  {
    category: 'Gaming Laptop',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 99 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 149 },
      { name: 'Pro Restore', pricingType: 'range', minPrice: 199, maxPrice: 249 },
      { name: 'Elite Performance', pricingType: 'range', minPrice: 229, maxPrice: 349 },
    ],
  },
  {
    category: 'MacBook',
    serviceGroup: 'Advanced Thermal & Performance Service',
    items: [
      { name: 'Basic Clean', pricingType: 'fixed', basePrice: 149 },
      { name: 'Performance Cleaning', pricingType: 'fixed', basePrice: 199 },
      { name: 'Pro Restore', pricingType: 'fixed', basePrice: 249 },
    ],
  },
  {
    category: 'MacBook Battery Health Restoration',
    serviceGroup: 'MacBook Battery Replacement',
    items: macBookBatterySeedItems,
  },
  {
    category: 'Laptop Display Restoration Service',
    serviceGroup: 'Laptop Display Restoration & Replacement',
    items: [
      { name: '15.6 HD 1366x768 30 Pin Display Replacement', pricingType: 'fixed', basePrice: 389, model: '15.6 HD 30 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '15.6 FHD 1920x1080 30 Pin Display Replacement', pricingType: 'fixed', basePrice: 369, model: '15.6 FHD 30 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '15.6 FHD 144Hz 40 Pin Display Replacement', pricingType: 'fixed', basePrice: 449, model: '15.6 FHD 144Hz 40 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '15.6 FHD 165Hz 40 Pin Display Replacement', pricingType: 'fixed', basePrice: 599, model: '15.6 FHD 165Hz 40 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '14.0 FHD 1920x1080 30 Pin Display Replacement', pricingType: 'fixed', basePrice: 359, model: '14.0 FHD 30 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '13.3 FHD 1920x1080 30 Pin Display Replacement', pricingType: 'fixed', basePrice: 459, model: '13.3 FHD 30 Pin', internalNotes: 'Verify price from original pricelist image.' },
      { name: '15.6 4K UHD 40 Pin Display Replacement', pricingType: 'starting_from', basePrice: 1099, model: '15.6 4K UHD 40 Pin', internalNotes: 'Verify price from original pricelist image.' },
    ],
  },
  {
    category: 'MacBook Display Restoration & Replacement',
    serviceGroup: 'MacBook Display Replacement',
    items: macBookDisplaySeedItems,
  },
];

const geniusAdvancedSeedItems: PriceItemInput[] = geniusAdvancedSeedGroups.flatMap((group) =>
  group.items.map((item) => {
    const warrantyDays = Number(item.warrantyDays ?? item.warrantyDurationDays ?? 0);
    const defaultCommissionEligible = group.category !== 'MacBook Display Restoration & Replacement';
    return {
      name: item.name,
      category: group.category,
      serviceGroup: item.serviceGroup || group.serviceGroup,
      packageName: item.packageName || '',
      pricingType: item.pricingType,
      type: item.type || 'service',
      basePrice: Number(item.basePrice ?? item.minPrice ?? 0),
      minPrice: Number(item.minPrice ?? 0),
      maxPrice: Number(item.maxPrice ?? 0),
      unit: item.unit || '',
      deviceType: item.deviceType || '',
      model: item.model || '',
      variant: item.variant || '',
      capacityTier: item.capacityTier || '',
      problemType: item.problemType || '',
      costPrice: Number(item.costPrice ?? 0),
      warrantyDays,
      warrantyDurationDays: warrantyDays,
      customerNotes: item.customerNotes || '',
      internalNotes: item.internalNotes || '',
      branch: item.branch || '',
      branchPrices: item.branchPrices || {},
      commissionEligible: item.commissionEligible ?? defaultCommissionEligible,
      active: item.active ?? true,
    };
  }),
);

export async function seedGeniusAdvancedPriceItems(user: UserData): Promise<{ created: number; skipped: number; updated: number }> {
  assertCan(user.role, 'pos.manage');
  const existingItems = await getPriceItems(user);
  const existingItemsByKey = new Map(existingItems.map((item) => [item.seedKey || item.slug || priceItemSlug(item), item]));
  const existingKeys = new Set(existingItemsByKey.keys());
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const seedItem of geniusAdvancedSeedItems) {
    const seedKey = priceItemSlug(seedItem);
    if (existingKeys.has(seedKey)) {
      const existingItem = existingItemsByKey.get(seedKey);
      if (existingItem && existingItem.commissionEligible !== seedItem.commissionEligible) {
        await updateDoc(doc(db, 'priceItems', existingItem.priceItemId), {
          commissionEligible: seedItem.commissionEligible,
          updatedAt: serverTimestamp(),
        });
        updated += 1;
      }
      skipped += 1;
      continue;
    }
    await createPriceItem({ ...seedItem, seedKey, slug: seedKey }, user);
    existingKeys.add(seedKey);
    created += 1;
  }

  return { created, skipped, updated };
}

export async function getQuotations(user: UserData): Promise<PosQuotation[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(collection(db, 'quotations'));
  return snapshot.docs.map((quoteDoc) => mapQuotation(quoteDoc.id, quoteDoc.data()));
}

export async function getQuotationById(quotationId: string, user: UserData): Promise<PosQuotation> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDoc(doc(db, 'quotations', quotationId));
  if (!snapshot.exists()) throw new Error('Quotation not found');
  return mapQuotation(snapshot.id, snapshot.data());
}

export async function getJobQuotationActions(job: Job, user: UserData): Promise<JobQuotationActionSummary[]> {
  assertCanUseJobQuotationAction(job, user);
  const snapshot = await getDocs(query(collection(db, 'quotations'), where('jobId', '==', job.docId)));
  return snapshot.docs
    .map((quoteDoc) => mapJobQuotationAction(mapQuotation(quoteDoc.id, quoteDoc.data())))
    .sort((left, right) => left.quotationNo.localeCompare(right.quotationNo));
}

export async function ensureQuotationPublicToken(quotationId: string, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  const quotationRef = doc(db, 'quotations', quotationId);
  const snapshot = await getDoc(quotationRef);
  if (!snapshot.exists()) throw new Error('Quotation not found');
  const existingToken = String(snapshot.data().publicToken || '');
  if (existingToken) return existingToken;
  const publicToken = generatePublicToken();
  await updateDoc(quotationRef, {
    publicToken,
    quotationApprovalToken: publicToken,
    publicTokenCreatedAt: serverTimestamp(),
    quotationApprovalTokenCreatedAt: serverTimestamp(),
    publicTokenStatus: 'active',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotationId,
    action: 'pos_quotation_public_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicToken', before: null, after: 'created' }],
    note: 'Quotation public token created',
  });
  return publicToken;
}

export async function prepareJobQuotationWhatsApp(quotationId: string, job: Job, user: UserData): Promise<PosQuotation> {
  assertCanUseJobQuotationAction(job, user);
  const quotationRef = doc(db, 'quotations', quotationId);
  const quotationSnapshot = await getDoc(quotationRef);
  if (!quotationSnapshot.exists()) throw new Error('Quotation not found');
  const quotation = mapQuotation(quotationSnapshot.id, quotationSnapshot.data());
  if (quotation.jobId !== job.docId) throw new Error('Quotation is not linked to this job');
  if (quotation.status === 'approved' || quotation.status === 'rejected') {
    throw new Error('Quotation has already been finalized');
  }
  if (quotation.status === 'draft') {
    await requireLinkedJobLifecycle(
      quotation.jobId,
      ['diagnosis', 'quotation_pending', 'customer_rejected', 'quotation_sent'],
      'Quotation can only be sent while diagnosis or quotation revision is in progress',
    );
    await updateDoc(quotationRef, {
      status: 'sent',
      quotationApprovalStatus: 'sent',
      sentAt: serverTimestamp(),
      quotationSentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await moveLinkedJobToQuotationSent(quotation.jobId, user);
    await writeAuditLog({
      entityType: 'pos',
      entityId: quotation.quotationId,
      action: 'quotation_sent_whatsapp',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [
        { field: 'status', before: quotation.status, after: 'sent' },
        { field: 'quotationId', before: quotation.quotationId, after: quotation.quotationId },
        { field: 'jobId', before: quotation.jobId || '', after: quotation.jobId || '' },
        { field: 'sentBy', before: '', after: user.uid },
        { field: 'sentByRole', before: '', after: user.role },
      ],
      note: 'Quotation sent via WhatsApp fallback link',
    });
  }
  const publicToken = await ensureQuotationPublicTokenForJobAction(quotationId, user);
  const updatedSnapshot = await getDoc(quotationRef);
  return mapQuotation(updatedSnapshot.id, {
    ...updatedSnapshot.data(),
    publicToken,
    quotationApprovalToken: String(updatedSnapshot.data()?.quotationApprovalToken || publicToken),
    status: quotation.status === 'draft' ? 'sent' : quotation.status,
    quotationApprovalStatus: quotation.status === 'draft' ? 'sent' : quotation.quotationApprovalStatus,
  });
}

export async function regenerateQuotationPublicToken(quotation: PosQuotation, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  const publicToken = generatePublicToken();
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    publicToken,
    publicTokenCreatedAt: serverTimestamp(),
    publicTokenStatus: 'active',
    publicTokenRevokedAt: null,
    publicTokenRevokedBy: '',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_public_token_regenerated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicToken', before: quotation.publicToken ? 'existing' : null, after: 'regenerated' }],
    note: 'Quotation public token regenerated',
  });
  return publicToken;
}

export async function revokeQuotationPublicToken(quotation: PosQuotation, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    publicTokenStatus: 'revoked',
    publicTokenRevokedAt: serverTimestamp(),
    publicTokenRevokedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_public_token_revoked',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicTokenStatus', before: quotation.publicTokenStatus || 'active', after: 'revoked' }],
    note: 'Quotation public token revoked',
  });
}

export async function expirePastQuotations(user: UserData): Promise<number> {
  assertCan(user.role, 'pos.operate');
  const quotations = await getQuotations(user);
  const now = Date.now();
  let expiredCount = 0;
  for (const quotation of quotations) {
    if ((quotation.status === 'draft' || quotation.status === 'sent') && quotation.validUntil?.toMillis?.() < now) {
      await expirePosQuotation(quotation, user);
      expiredCount += 1;
    }
  }
  return expiredCount;
}

export async function createQuotation(input: PosDocumentInput, user: UserData): Promise<PosQuotation> {
  assertCan(user.role, 'pos.operate');
  const linkedJob = await requireLinkedJobLifecycle(
    input.jobId,
    ['diagnosis', 'quotation_pending', 'customer_rejected', 'quotation_sent'],
    'Quotation can only be created while diagnosis or quotation revision is in progress',
  );
  if (input.jobId) {
    const existingSnapshot = await getDocs(query(collection(db, 'quotations'), where('jobId', '==', input.jobId)));
    const activeQuotation = existingSnapshot.docs
      .map((quoteDoc) => mapQuotation(quoteDoc.id, quoteDoc.data()))
      .find((quotation) => ['draft', 'pending', 'sent', 'approved'].includes(String(quotation.quotationApprovalStatus || quotation.status || '')) && isValidQuotationRecord(quotation));
    if (activeQuotation) {
      throw new Error(`Active quotation already exists for this job: ${activeQuotation.quotationNo || activeQuotation.quotationId}`);
    }
  }
  const items = normalizeItems(input.items);
  const totals = calculateTotals(items, input.discountAmount);
  const quotationNumber = await generateQuotationNumber();
  const customerNumber = await getCustomerNumberForPos(input.customerId);
  const linkedJobNumber = displayJobNumberForPos(linkedJob);
  const quotationRef = await addDoc(collection(db, 'quotations'), {
    quotationNo: quotationNumber,
    quotationNumber,
    customerNumber,
    jobNumber: linkedJobNumber,
    customerId: cleanText(input.customerId),
	    customerName: cleanText(input.customerName),
	    customerPhone: cleanText(input.customerPhone),
	    deviceId: cleanText(input.deviceId),
	    deviceLabel: cleanText(input.deviceLabel),
	    deviceName: cleanText(input.deviceName),
	    deviceBrand: cleanText(input.deviceBrand),
	    deviceModel: cleanText(input.deviceModel),
	    serialNumber: cleanText(input.serialNumber),
	    imei: cleanText(input.imei),
	    jobId: cleanText(input.jobId),
    branchId: cleanText(input.branchId),
    items,
    ...totals,
    discountReason: cleanText(input.discountReason),
    status: 'draft',
    validUntil: dateToTimestamp(input.validUntil),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotationRef.id,
    action: 'pos_quotation_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'quotationNumber', before: null, after: quotationNumber },
      { field: 'total', before: null, after: totals.total },
    ],
    note: 'Quotation created',
  });
  await updateCustomerMasterActivity({
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    branch: input.branchId,
    source: 'quotation',
    jobId: input.jobId,
  }, user).catch(() => undefined);
  const quotationSnapshot = await getDoc(quotationRef);
  return mapQuotation(quotationRef.id, quotationSnapshot.data() || {});
}

export async function createQuotationFromJob(
  job: Job,
  input: Pick<PosDocumentInput, 'items' | 'discountAmount' | 'discountReason' | 'validUntil'>,
  user: UserData,
): Promise<PosQuotation> {
  assertCan(user.role, 'pos.operate');
  if (!job.docId) throw new Error('Job ID is required');
  if (!job.customerId) throw new Error('Customer record is required before making a quotation');
  if (user.role === 'manager' && user.branchId && job.branchId !== user.branchId) {
    throw new Error('Permission denied for this branch');
  }

  const existingSnapshot = await getDocs(query(collection(db, 'quotations'), where('jobId', '==', job.docId)));
  const existingQuotations = existingSnapshot.docs.map((quoteDoc) => mapQuotation(quoteDoc.id, quoteDoc.data()));
  const activeQuotation = existingQuotations.find((quotation) => (
    ['draft', 'pending', 'sent', 'approved'].includes(String(quotation.quotationApprovalStatus || quotation.status || '')) && isValidQuotationRecord(quotation)
  ));
  if (activeQuotation) {
    throw new Error(`Active quotation already exists for this job: ${activeQuotation.quotationNo || activeQuotation.quotationId}`);
  }

  const quotation = await createQuotation({
    customerId: job.customerId,
    customerName: job.customerName,
    customerPhone: job.customerPhone || '',
    deviceId: job.deviceId || '',
    jobId: job.docId,
    branchId: job.branchId || user.branchId,
    items: input.items,
    discountAmount: input.discountAmount,
    discountReason: input.discountReason,
    validUntil: input.validUntil,
  }, user);

  const latestJob = await getLinkedJobForPos(job.docId);
  if (latestJob && ['diagnosis', 'customer_rejected'].includes(getCurrentRepairLifecycleStatus(latestJob))) {
    await updateJobLifecycleStatus({
      job: latestJob,
      user,
      nextStatus: 'quotation_pending',
      note: 'POS quotation created from job',
    });
  }

  await updateDoc(doc(db, 'jobs', job.docId), {
    quotationId: quotation.quotationId,
    quotationNumber: quotation.quotationNumber || quotation.quotationNo,
    quotationAmount: Number(quotation.total || 0),
    quotationStatus: 'draft',
    quotationCreatedAt: serverTimestamp(),
    quotationCreatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'job',
    entityId: job.docId,
    action: 'update',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'quotationId', before: '', after: quotation.quotationId },
      { field: 'quotationNumber', before: '', after: quotation.quotationNumber || quotation.quotationNo },
    ],
    note: 'Quotation created from job page',
  }).catch(() => undefined);

  return quotation;
}

export async function updateQuotationLineItems(
  quotation: PosQuotation,
  input: Pick<PosDocumentInput, 'items' | 'discountAmount' | 'discountReason' | 'validUntil'>,
  user: UserData,
): Promise<PosQuotation> {
  assertCan(user.role, 'pos.operate');
  if (user.role === 'manager' && user.branchId && quotation.branchId !== user.branchId) {
    throw new Error('Permission denied for this branch');
  }
  const convertedSnapshot = await getDocs(query(collection(db, 'invoices'), where('quotationId', '==', quotation.quotationId)));
  if (!convertedSnapshot.empty) throw new Error('Quotation has already been converted to invoice and cannot be edited');
  if (['rejected', 'expired'].includes(quotation.status) && !can(user.role, 'pos.manage')) {
    throw new Error('This quotation can no longer be edited');
  }

  const items = normalizeItems(input.items);
  const totals = calculateTotals(items, input.discountAmount);
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    items,
    ...totals,
    discountReason: cleanText(input.discountReason),
    validUntil: dateToTimestamp(input.validUntil),
    updatedAt: serverTimestamp(),
  });

  if (quotation.jobId) {
    await updateDoc(doc(db, 'jobs', quotation.jobId), {
      quotationAmount: Number(totals.total || 0),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'total', before: quotation.total, after: totals.total }],
    note: 'Quotation line items updated',
  }).catch(() => undefined);

  const snapshot = await getDoc(doc(db, 'quotations', quotation.quotationId));
  return mapQuotation(snapshot.id, snapshot.data() || {});
}

export async function approveQuotation(quotationId: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  const quotationSnapshot = await getDoc(doc(db, 'quotations', quotationId));
  const quotation = quotationSnapshot.exists() ? mapQuotation(quotationSnapshot.id, quotationSnapshot.data()) : null;
  await updateDoc(doc(db, 'quotations', quotationId), {
    status: 'approved',
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await moveLinkedJobLifecycle(quotation?.jobId, 'customer_approved', 'POS quotation approved', user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotationId,
    action: 'pos_quotation_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: null, after: 'approved' }],
    note: 'Quotation approved',
  });
}

export async function markQuotationSent(quotation: PosQuotation, user: UserData, source: 'manual' | 'whatsapp' = 'manual'): Promise<void> {
  assertCan(user.role, 'pos.operate');
  if (!['draft', 'sent'].includes(quotation.status)) throw new Error('Only draft quotations can be marked as sent');
  await requireLinkedJobLifecycle(
    quotation.jobId,
    ['diagnosis', 'quotation_pending', 'customer_rejected', 'quotation_sent'],
    'Quotation can only be sent while diagnosis or quotation revision is in progress',
  );
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    status: 'sent',
    quotationApprovalStatus: 'sent',
    sentAt: serverTimestamp(),
    quotationSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await moveLinkedJobToQuotationSent(quotation.jobId, user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: source === 'whatsapp' ? 'quotation_sent_whatsapp' : 'pos_quotation_sent',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: quotation.status, after: 'sent' }],
    note: source === 'whatsapp' ? 'Quotation sent via WhatsApp fallback link' : 'Quotation marked as sent',
  });
}

export async function approvePosQuotation(
  quotation: PosQuotation,
  user: UserData,
  manualApproval?: ManualQuotationApprovalInput,
): Promise<void> {
  assertCan(user.role, 'pos.operate');
  if (!['draft', 'sent'].includes(quotation.status)) throw new Error('Only draft or sent quotations can be approved');
  await requireLinkedJobLifecycle(
    quotation.jobId,
    ['diagnosis', 'quotation_pending', 'quotation_sent', 'customer_rejected', 'customer_approved'],
    'Quotation approval requires the linked job to be waiting for customer approval',
  );
  const linkedJob = await getLinkedJobForPos(quotation.jobId);
  const approvalMethod = cleanText(manualApproval?.approvalMethod) || 'staff';
  const approvedByName = cleanText(manualApproval?.approvedByName);
  if (manualApproval && !approvedByName) throw new Error('Approved By Name is required');
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    status: 'approved',
    quotationApprovalStatus: 'approved',
    approvedBy: user.uid,
    approvedByName: displayNameForUser(user),
    quotationApprovedByName: approvedByName || displayNameForUser(user),
    quotationApprovedByPhone: '',
    approvalMethod,
    manualApproval: Boolean(manualApproval),
    manualApprovalName: approvedByName,
    manualApprovalNotes: cleanText(manualApproval?.notes),
    termsAccepted: Boolean(manualApproval),
    approvalSnapshot: quotationApprovalSnapshot(quotation, linkedJob),
    approvedAt: serverTimestamp(),
    quotationApprovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await moveLinkedJobLifecycle(quotation.jobId, 'customer_approved', 'POS quotation approved', user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: quotation.status, after: 'approved' }],
    note: manualApproval ? `Manual approval via ${approvalMethod}` : 'Quotation approved',
  });
  await createInternalNotification({
    title: manualApproval ? 'Quotation manually approved' : 'Customer approved quotation',
    message: manualApproval
      ? `${displayNameForUser(user)} manually approved quotation ${quotation.quotationNo} for job ${quotationJobReference(quotation, linkedJob)}. Method: ${approvalMethod}.`
      : `${quotation.customerName || 'Customer'} approved quotation ${quotation.quotationNo} for job ${quotationJobReference(quotation, linkedJob)}. Total: RM ${Number(quotation.total || 0).toFixed(2)}.`,
    type: manualApproval ? 'quotation_manually_approved' : 'quotation_approved',
    branchId: quotation.branchId,
    relatedModule: 'quotation',
    actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
    relatedEntityType: 'quotation',
    relatedEntityId: quotation.quotationId,
    targetUserIds: linkedJob?.technicianId ? [linkedJob.technicianId] : [],
    metadata: {
      jobId: quotation.jobId || '',
      quotationId: quotation.quotationId,
      quotationNo: quotation.quotationNo,
      customerId: quotation.customerId,
      actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
      technicianId: linkedJob?.technicianId || '',
      totalAmount: Number(quotation.total || 0),
      approvalMethod,
    },
  });
}

export async function syncApprovedJobQuotation(job: Job, user: UserData): Promise<PosQuotation | null> {
  assertCan(user.role, 'pos.operate');
  if (!job.docId || job.quotationStatus !== 'approved') return null;
  if (user.role === 'manager' && user.branchId && job.branchId !== user.branchId) {
    throw new Error('Permission denied for this branch');
  }

  let quotation: PosQuotation | null = null;
  if (job.quotationId) {
    quotation = await getQuotationById(job.quotationId, user).catch(() => null);
  }
  if (!quotation) {
    const snapshot = await getDocs(query(collection(db, 'quotations'), where('jobId', '==', job.docId)));
    const rows = snapshot.docs.map((quoteDoc) => mapQuotation(quoteDoc.id, quoteDoc.data()));
    quotation = rows.find((row) => row.status === 'approved' || row.quotationApprovalStatus === 'approved')
      || rows.find((row) => ['draft', 'sent'].includes(row.status) && Number(row.total || 0) > 0)
      || rows[0]
      || null;
  }
  if (!quotation) return null;

  if (quotation.status === 'approved' && quotation.quotationApprovalStatus === 'approved') return quotation;
  if (!['draft', 'sent', 'approved'].includes(quotation.status)) return quotation;

  const approvedByName = job.quotationApprovedByDisplayName || displayNameForUser(user);
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    status: 'approved',
    quotationApprovalStatus: 'approved',
    approvedBy: user.uid,
    approvedByName: displayNameForUser(user),
    quotationApprovedByName: approvedByName,
    approvalMethod: 'job_quotation_status_sync',
    manualApproval: false,
    manualApprovalName: approvedByName,
    manualApprovalNotes: 'Synced from approved job quotation status',
    termsAccepted: true,
    approvedAt: quotation.approvedAt || serverTimestamp(),
    quotationApprovedAt: quotation.quotationApprovedAt || job.quotationApprovedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (!job.quotationId) {
    await updateDoc(doc(db, 'jobs', job.docId), {
      quotationId: quotation.quotationId,
      quotationNumber: quotation.quotationNumber || quotation.quotationNo,
      quotationAmount: Number(quotation.total || job.quotationAmount || 0),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: quotation.status, after: 'approved' }],
    note: 'POS quotation approval synced from approved job quotation',
  }).catch(() => undefined);

  return getQuotationById(quotation.quotationId, user);
}

export async function rejectPosQuotation(quotation: PosQuotation, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  const rejectionReason = cleanText(reason);
  if (!rejectionReason) throw new Error('Rejection reason is required');
  if (!['draft', 'sent'].includes(quotation.status)) throw new Error('Only draft or sent quotations can be rejected');
  await requireLinkedJobLifecycle(
    quotation.jobId,
    ['quotation_sent', 'customer_rejected'],
    'Quotation rejection requires the linked job to be waiting for customer approval',
  );
  const linkedJob = await getLinkedJobForPos(quotation.jobId);
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    status: 'rejected',
    quotationApprovalStatus: 'rejected',
    rejectedAt: serverTimestamp(),
    quotationRejectedAt: serverTimestamp(),
    rejectedBy: user.uid,
    rejectedByName: displayNameForUser(user),
    rejectionReason,
    quotationRejectionReason: rejectionReason,
    updatedAt: serverTimestamp(),
  });
  await moveLinkedJobLifecycle(quotation.jobId, 'customer_rejected', 'POS quotation rejected', user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_rejected',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: quotation.status, after: 'rejected' }],
    note: rejectionReason,
  });
  await createInternalNotification({
    title: 'Customer rejected quotation',
    message: `${quotation.customerName || 'Customer'} rejected quotation ${quotation.quotationNo} for job ${quotationJobReference(quotation, linkedJob)}.`,
    type: 'quotation_rejected',
    branchId: quotation.branchId,
    relatedModule: 'quotation',
    actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
    relatedEntityType: 'quotation',
    relatedEntityId: quotation.quotationId,
    targetUserIds: linkedJob?.technicianId ? [linkedJob.technicianId] : [],
    metadata: {
      jobId: quotation.jobId || '',
      quotationId: quotation.quotationId,
      quotationNo: quotation.quotationNo,
      customerId: quotation.customerId,
      actionUrl: `/dashboard/pos/quotations/${quotation.quotationId}`,
      technicianId: linkedJob?.technicianId || '',
      totalAmount: Number(quotation.total || 0),
      rejectionMethod: 'staff',
    },
  });
}

export async function expirePosQuotation(quotation: PosQuotation, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  if (quotation.status === 'approved') throw new Error('Approved quotation cannot be expired');
  if (quotation.status === 'rejected') throw new Error('Rejected quotation cannot be expired');
  await updateDoc(doc(db, 'quotations', quotation.quotationId), {
    status: 'expired',
    expiredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_expired',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: quotation.status, after: 'expired' }],
    note: 'Quotation expired',
  });
}

export async function getInvoices(user: UserData): Promise<PosInvoice[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(collection(db, 'invoices'));
  return snapshot.docs.map((invoiceDoc) => mapInvoice(invoiceDoc.id, invoiceDoc.data()));
}

export async function getInvoicesByJob(jobId: string, user: UserData): Promise<PosInvoice[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(query(collection(db, 'invoices'), where('jobId', '==', jobId)));
  return snapshot.docs
    .map((invoiceDoc) => mapInvoice(invoiceDoc.id, invoiceDoc.data()))
    .filter((invoice) => invoice.paymentStatus !== 'void')
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0));
}

export async function getInvoiceById(invoiceId: string, user: UserData): Promise<PosInvoice> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDoc(doc(db, 'invoices', invoiceId));
  if (!snapshot.exists()) throw new Error('Invoice not found');
  return mapInvoice(snapshot.id, snapshot.data());
}

export async function ensureInvoicePaymentToken(invoiceId: string, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  const invoiceRef = doc(db, 'invoices', invoiceId);
  const snapshot = await getDoc(invoiceRef);
  if (!snapshot.exists()) throw new Error('Invoice not found');
  const existingToken = String(snapshot.data().publicPaymentToken || '');
  if (existingToken) return existingToken;
  const publicPaymentToken = generatePublicToken();
  await updateDoc(invoiceRef, {
    publicPaymentToken,
    publicPaymentTokenCreatedAt: serverTimestamp(),
    publicPaymentTokenStatus: 'active',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoiceId,
    action: 'pos_invoice_payment_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicPaymentToken', before: null, after: 'created' }],
    note: 'Invoice payment token created',
  });
  return publicPaymentToken;
}

export async function regenerateInvoicePaymentToken(invoice: PosInvoice, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  const publicPaymentToken = generatePublicToken();
  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    publicPaymentToken,
    publicPaymentTokenCreatedAt: serverTimestamp(),
    publicPaymentTokenStatus: 'active',
    publicPaymentTokenRevokedAt: null,
    publicPaymentTokenRevokedBy: '',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_invoice_payment_token_regenerated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicPaymentToken', before: invoice.publicPaymentToken ? 'existing' : null, after: 'regenerated' }],
    note: 'Invoice payment token regenerated',
  });
  return publicPaymentToken;
}

export async function revokeInvoicePaymentToken(invoice: PosInvoice, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    publicPaymentTokenStatus: 'revoked',
    publicPaymentTokenRevokedAt: serverTimestamp(),
    publicPaymentTokenRevokedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_invoice_payment_token_revoked',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicPaymentTokenStatus', before: invoice.publicPaymentTokenStatus || 'active', after: 'revoked' }],
    note: 'Invoice payment token revoked',
  });
}

export async function createInvoice(input: PosDocumentInput & { quotationId?: string }, user: UserData): Promise<PosInvoice> {
  assertCan(user.role, 'pos.operate');
  await requireLinkedJobLifecycle(
    input.jobId,
    ['repair_completed', 'ready_for_pickup', 'delivered', 'warranty_active'],
    'Cannot generate invoice before repair is completed',
  );
  const items = normalizeItems(input.items);
  const totals = calculateTotals(items, input.discountAmount);
  const invoiceNo = await nextOfficialInvoiceNo(user);
  const invoiceRef = await addDoc(collection(db, 'invoices'), {
    invoiceNo,
    officialInvoiceNo: invoiceNo,
    quotationId: cleanText(input.quotationId),
    jobId: cleanText(input.jobId),
    customerId: cleanText(input.customerId),
	    customerName: cleanText(input.customerName),
	    customerPhone: cleanText(input.customerPhone),
	    deviceId: cleanText(input.deviceId),
	    deviceLabel: cleanText(input.deviceLabel),
	    deviceName: cleanText(input.deviceName),
	    deviceBrand: cleanText(input.deviceBrand),
	    deviceModel: cleanText(input.deviceModel),
	    serialNumber: cleanText(input.serialNumber),
	    imei: cleanText(input.imei),
	    branchId: cleanText(input.branchId),
    items,
    ...totals,
    discountReason: cleanText(input.discountReason),
    amountPaid: 0,
    balance: totals.total,
    paymentStatus: 'unpaid',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoiceRef.id,
    action: 'pos_invoice_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'total', before: null, after: totals.total }],
    note: 'Invoice created',
  });
  await updateCustomerMasterActivity({
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    branch: input.branchId,
    source: 'invoice',
    jobId: input.jobId,
    invoiceId: invoiceRef.id,
  }, user).catch(() => undefined);
  const invoiceSnapshot = await getDoc(invoiceRef);
  return mapInvoice(invoiceRef.id, invoiceSnapshot.data() || {});
}

export async function createInvoiceFromQuotation(quotation: PosQuotation, user: UserData): Promise<PosInvoice> {
  assertCan(user.role, 'pos.operate');
  if (quotation.status !== 'approved') throw new Error('Only approved quotations can be converted to invoice');
  const existingInvoices = await getDocs(query(collection(db, 'invoices'), where('quotationId', '==', quotation.quotationId)));
  if (!existingInvoices.empty) throw new Error('Quotation has already been converted to invoice');
  const invoice = await createInvoice({
    quotationId: quotation.quotationId,
    jobId: quotation.jobId,
	    customerId: quotation.customerId,
	    customerName: quotation.customerName,
	    customerPhone: quotation.customerPhone,
	    deviceId: quotation.deviceId,
	    deviceLabel: quotation.deviceLabel,
	    deviceName: quotation.deviceName,
	    deviceBrand: quotation.deviceBrand,
	    deviceModel: quotation.deviceModel,
	    serialNumber: quotation.serialNumber,
	    imei: quotation.imei,
	    branchId: quotation.branchId,
    items: quotation.items,
    discountAmount: quotation.discountAmount,
    discountReason: quotation.discountReason,
  }, user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: quotation.quotationId,
    action: 'pos_quotation_converted_to_invoice',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'invoiceId', before: null, after: invoice.invoiceId }],
    note: 'Quotation converted to invoice',
  });
  return invoice;
}

export async function updateInvoiceLineItems(
  invoice: PosInvoice,
  input: Pick<PosDocumentInput, 'items' | 'discountAmount' | 'discountReason'>,
  user: UserData,
): Promise<PosInvoice> {
  assertCan(user.role, 'pos.operate');
  if (user.role === 'manager' && user.branchId && invoice.branchId !== user.branchId) {
    throw new Error('Permission denied for this branch');
  }
  if (invoice.paymentStatus === 'void') throw new Error('Void invoices cannot be edited');
  if (Number(invoice.amountPaid || 0) > 0 && user.role !== 'admin') {
    throw new Error('Invoice already has payment. Only admin can edit finalized financial details.');
  }

  const items = normalizeItems(input.items);
  const totals = calculateTotals(items, input.discountAmount);
  const amountPaid = Number(invoice.amountPaid || 0);
  if (amountPaid > totals.total) throw new Error('Invoice total cannot be lower than amount paid');
  const balance = Math.max(0, totals.total - amountPaid);
  let paymentStatus: InvoicePaymentStatus = amountPaid <= 0 ? 'unpaid' : balance <= 0 ? 'paid' : 'partial';
  if (invoice.paymentStatus === 'refunded') paymentStatus = 'refunded';

  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    items,
    ...totals,
    discountReason: cleanText(input.discountReason),
    amountPaid,
    balance,
    paymentStatus,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_invoice_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'total', before: invoice.total, after: totals.total }],
    note: 'Invoice line items updated',
  }).catch(() => undefined);

  const snapshot = await getDoc(doc(db, 'invoices', invoice.invoiceId));
  return mapInvoice(snapshot.id, snapshot.data() || {});
}

export async function recordInvoicePayment(invoice: PosInvoice, input: {
  amount: number;
  method: PosPaymentMethod;
  referenceNo?: string;
  proofFile?: File | null;
}, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  if (invoice.paymentStatus === 'void') throw new Error('Payment cannot be added to a void invoice');
  const amount = Number(input.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be valid');
  if (invoice.amountPaid + amount > invoice.total) throw new Error('Payment exceeds invoice total');
  const nextPaid = invoice.amountPaid + amount;
  const balance = Math.max(0, invoice.total - nextPaid);
  const paymentStatus: InvoicePaymentStatus = balance <= 0 ? 'paid' : 'partial';
  const paymentRef = doc(collection(db, 'payments'));
  const proofImageUrl = await uploadPaymentProof(invoice.invoiceId, paymentRef.id, input.proofFile);
  await setDoc(paymentRef, {
    invoiceId: invoice.invoiceId,
    branchId: invoice.branchId,
    amount,
    method: input.method,
    referenceNo: cleanText(input.referenceNo),
    receivedBy: user.uid,
    receivedAt: serverTimestamp(),
    proofImageUrl,
    status: 'completed',
    balanceAfterPayment: balance,
  });
  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    amountPaid: nextPaid,
    balance,
    paymentStatus,
    paidAt: paymentStatus === 'paid' ? serverTimestamp() : invoice.paidAt || null,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_payment_recorded',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'amountPaid', before: invoice.amountPaid, after: nextPaid }],
    note: `Payment ${paymentRef.id} recorded`,
  });
  await updateCustomerMasterActivity({
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    branch: invoice.branchId,
    source: 'payment',
    jobId: invoice.jobId,
    invoiceId: invoice.invoiceId,
    amountSpent: amount,
  }, user).catch(() => undefined);
  if (paymentStatus === 'paid') {
    await activateWarrantiesFromInvoice({ ...invoice, amountPaid: nextPaid, balance, paymentStatus }, user);
  }
  return paymentRef.id;
}

export async function voidInvoice(invoice: PosInvoice, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const voidReason = cleanText(reason);
  if (!voidReason) throw new Error('Void reason is required');
  if (invoice.paymentStatus === 'void') throw new Error('Invoice is already void');
  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    paymentStatus: 'void',
    voidedAt: serverTimestamp(),
    voidedBy: user.uid,
    voidReason,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_invoice_voided',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'paymentStatus', before: invoice.paymentStatus, after: 'void' }],
    note: voidReason,
  });
}

export async function activateWarrantiesFromInvoice(invoice: PosInvoice, user: UserData): Promise<number> {
  assertCan(user.role, 'pos.operate');
  if (invoice.jobId) return 0;
  if (invoice.paymentStatus !== 'paid') return 0;
  const linkedJob = await getLinkedJobForPos(invoice.jobId);
  if (linkedJob && !['delivered', 'warranty_active'].includes(getCurrentRepairLifecycleStatus(linkedJob))) return 0;

  const existingSnapshot = await getDocs(query(collection(db, 'warranties'), where('invoiceId', '==', invoice.invoiceId)));
  const existingKeys = new Set(existingSnapshot.docs.map((warrantyDoc) => String(warrantyDoc.data().invoiceItemKey || '')));
  let createdCount = 0;
  const startDate = new Date();

  for (const [index, item] of invoice.items.entries()) {
    const warrantyDurationDays = Number(item.warrantyDurationDays || 0);
    if (!Number.isFinite(warrantyDurationDays) || warrantyDurationDays <= 0) continue;
    const invoiceItemKey = `${index}_${item.priceItemId || item.name.replace(/\s+/g, '_')}`;
    if (existingKeys.has(invoiceItemKey)) continue;

    const warrantyRef = doc(collection(db, 'warranties'));
    await setDoc(warrantyRef, {
      invoiceId: invoice.invoiceId,
      invoiceItemKey,
      jobId: cleanText(invoice.jobId),
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerPhone: invoice.customerPhone,
      deviceId: cleanText(invoice.deviceId),
      deviceLabel: cleanText(invoice.deviceLabel),
      deviceName: cleanText(invoice.deviceName),
      deviceBrand: cleanText(invoice.deviceBrand),
      deviceModel: cleanText(invoice.deviceModel),
      serialNumber: cleanText(invoice.serialNumber),
      imei: cleanText(invoice.imei),
      branchId: invoice.branchId,
      itemName: item.name,
      warrantyDurationDays,
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(addDays(startDate, warrantyDurationDays)),
      claimLimit: 'unlimited',
      status: 'active',
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    createdCount += 1;
  }

  if (createdCount > 0) {
    if (linkedJob && getCurrentRepairLifecycleStatus(linkedJob) !== 'warranty_active') {
      await updateJobLifecycleStatus({ job: linkedJob, user, nextStatus: 'warranty_active', note: 'POS warranty activated from paid invoice' });
    }
    await writeAuditLog({
      entityType: 'pos',
      entityId: invoice.invoiceId,
      action: 'pos_warranty_activated_from_invoice',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [{ field: 'warranties', before: 0, after: createdCount }],
      note: 'Warranty activated from paid invoice',
    });
  }

  return createdCount;
}

export async function getPayments(user: UserData): Promise<PosPayment[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(collection(db, 'payments'));
  return snapshot.docs.map((paymentDoc) => mapPayment(paymentDoc.id, paymentDoc.data()));
}

export async function getPaymentSubmissions(user: UserData): Promise<PaymentSubmission[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'paymentSubmissions'));
  return snapshot.docs
    .map((submissionDoc) => mapPaymentSubmission(submissionDoc.id, submissionDoc.data()))
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0));
}

export async function approvePaymentSubmission(submission: PaymentSubmission, invoice: PosInvoice, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (submission.status !== 'pending_review') throw new Error('Only pending submissions can be approved');
  if (invoice.paymentStatus === 'void') throw new Error('Cannot approve payment submission for void invoice');
  if (Number(invoice.balance || 0) <= 0) throw new Error('Invoice is already fully paid');
  if (Number(submission.amountClaimed || 0) > Number(invoice.balance || 0)) throw new Error('Payment submission exceeds invoice balance');
  const paymentId = await recordInvoicePayment(invoice, {
    amount: submission.amountClaimed,
    method: submission.method,
    referenceNo: submission.referenceNo,
  }, user);
  await updateDoc(doc(db, 'paymentSubmissions', submission.submissionId), {
    status: 'approved',
    reviewedBy: user.uid,
    reviewedAt: serverTimestamp(),
    paymentId,
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_payment_submission_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'paymentSubmission', before: submission.status, after: 'approved' }],
    note: `Payment submission ${submission.submissionId} approved`,
  });
  await createInternalNotification({
    title: 'Payment submission approved',
    message: `${submission.customerName} payment submission was approved`,
    type: 'pos_payment',
    branchId: submission.branchId,
    relatedModule: 'payment',
    actionUrl: '/dashboard/pos/payment-submissions',
    relatedEntityType: 'paymentSubmission',
    relatedEntityId: submission.submissionId,
  });
}

export async function rejectPaymentSubmission(submission: PaymentSubmission, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const rejectionReason = cleanText(reason);
  if (submission.status !== 'pending_review') throw new Error('Only pending submissions can be rejected');
  if (!rejectionReason) throw new Error('Rejection reason is required');
  await updateDoc(doc(db, 'paymentSubmissions', submission.submissionId), {
    status: 'rejected',
    reviewedBy: user.uid,
    reviewedAt: serverTimestamp(),
    rejectionReason,
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: submission.invoiceId,
    action: 'pos_payment_submission_rejected',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'paymentSubmission', before: submission.status, after: 'rejected' }],
    note: rejectionReason,
  });
  await createInternalNotification({
    title: 'Payment submission rejected',
    message: `${submission.customerName} payment submission was rejected`,
    type: 'pos_payment',
    branchId: submission.branchId,
    relatedModule: 'payment',
    actionUrl: '/dashboard/pos/payment-submissions',
    relatedEntityType: 'paymentSubmission',
    relatedEntityId: submission.submissionId,
  });
}

export async function getPaymentsByInvoice(invoiceId: string, user: UserData): Promise<PosPayment[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(query(collection(db, 'payments'), where('invoiceId', '==', invoiceId)));
  return snapshot.docs
    .map((paymentDoc) => mapPayment(paymentDoc.id, paymentDoc.data()))
    .sort((left, right) => (left.receivedAt?.toMillis?.() || 0) - (right.receivedAt?.toMillis?.() || 0));
}

export async function getRefundsByInvoice(invoiceId: string, user: UserData): Promise<PosRefund[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(query(collection(db, 'refunds'), where('invoiceId', '==', invoiceId)));
  return snapshot.docs.map((refundDoc) => mapRefund(refundDoc.id, refundDoc.data()));
}

export async function getRefunds(user: UserData): Promise<PosRefund[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(collection(db, 'refunds'));
  return snapshot.docs.map((refundDoc) => mapRefund(refundDoc.id, refundDoc.data()));
}

export async function getWarrantiesByInvoice(invoiceId: string, user: UserData): Promise<PosWarranty[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(query(collection(db, 'warranties'), where('invoiceId', '==', invoiceId)));
  return snapshot.docs.map((warrantyDoc) => mapWarranty(warrantyDoc.id, warrantyDoc.data()));
}

export async function getWarranties(user: UserData): Promise<PosWarranty[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(collection(db, 'warranties'));
  return snapshot.docs.map((warrantyDoc) => mapWarranty(warrantyDoc.id, warrantyDoc.data()));
}

export async function getWarrantyById(warrantyId: string, user: UserData): Promise<PosWarranty> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDoc(doc(db, 'warranties', warrantyId));
  if (!snapshot.exists()) throw new Error('Warranty not found');
  return mapWarranty(snapshot.id, snapshot.data());
}

export async function ensureWarrantySignatureToken(warranty: PosWarranty, user: UserData): Promise<string> {
  assertCan(user.role, 'pos.operate');
  const warrantyRef = doc(db, 'warranties', warranty.warrantyId);
  const snapshot = await getDoc(warrantyRef);
  if (!snapshot.exists()) throw new Error('Warranty not found');
  const data = snapshot.data();
  const existingToken = String(data.publicWarrantyToken || '');
  const existingStatus = String(data.publicWarrantyTokenStatus || 'active');
  if (existingToken && existingStatus !== 'revoked') return existingToken;

  const publicWarrantyToken = generatePublicToken();
  await updateDoc(warrantyRef, {
    publicWarrantyToken,
    publicWarrantyTokenCreatedAt: serverTimestamp(),
    publicWarrantyTokenExpiresAt: null,
    publicWarrantyTokenStatus: 'active',
    warrantyTermsVersion: defaultWarrantyTermsSnapshot.version,
    warrantyTermsSnapshot: defaultWarrantyTermsSnapshot,
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: warranty.warrantyId,
    action: 'warranty_terms_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicWarrantyToken', before: existingToken ? 'revoked' : null, after: 'created' }],
    note: 'Warranty terms public signature token created',
  });
  return publicWarrantyToken;
}

function invoiceWarrantyItemKey(index: number, item: PosLineItem): string {
  return `${index}_${item.priceItemId || item.name.replace(/\s+/g, '_')}`;
}

async function createWarrantyForInvoiceItem(
  invoice: PosInvoice,
  user: UserData,
  item: PosLineItem,
  index: number,
  warrantyDurationDays: number,
): Promise<PosWarranty> {
  const startDate = new Date();
  const warrantyRef = doc(collection(db, 'warranties'));
  await setDoc(warrantyRef, {
    invoiceId: invoice.invoiceId,
    invoiceItemKey: invoiceWarrantyItemKey(index, item),
    jobId: cleanText(invoice.jobId),
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    deviceId: cleanText(invoice.deviceId),
    deviceLabel: cleanText(invoice.deviceLabel),
    deviceName: cleanText(invoice.deviceName),
    deviceBrand: cleanText(invoice.deviceBrand),
    deviceModel: cleanText(invoice.deviceModel),
    serialNumber: cleanText(invoice.serialNumber),
    imei: cleanText(invoice.imei),
    branchId: invoice.branchId,
    itemName: item.name,
    warrantyDurationDays,
    startDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(addDays(startDate, warrantyDurationDays)),
    claimLimit: 'unlimited',
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });
  const snapshot = await getDoc(warrantyRef);
  return mapWarranty(warrantyRef.id, snapshot.data() || {});
}

export async function ensureInvoiceWarrantySignatureTarget(invoice: PosInvoice, user: UserData): Promise<PosWarranty> {
  assertCan(user.role, 'pos.operate');
  if (invoice.jobId) throw new Error('Linked repair job invoices use Job Warranty, not POS Warranty Agreement.');
  const existingSnapshot = await getDocs(query(collection(db, 'warranties'), where('invoiceId', '==', invoice.invoiceId)));
  const existingWarranties = existingSnapshot.docs.map((warrantyDoc) => mapWarranty(warrantyDoc.id, warrantyDoc.data()));
  const unsignedExisting = existingWarranties.find((warranty) => !warranty.warrantyTermsAccepted && !warranty.warrantySignedAt && warranty.status !== 'void');
  if (unsignedExisting) return unsignedExisting;
  const activeExisting = existingWarranties.find((warranty) => warranty.status !== 'void');
  if (activeExisting) return activeExisting;

  const warrantyItemIndex = invoice.items.findIndex((item) => Number(item.warrantyDurationDays || 0) > 0);
  const item = warrantyItemIndex >= 0 ? invoice.items[warrantyItemIndex] : invoice.items[0];
  if (!item) throw new Error('Invoice has no item to attach warranty terms.');
  const warrantyDurationDays = Math.max(1, Number(item.warrantyDurationDays || 0) || 1);
  return createWarrantyForInvoiceItem(invoice, user, item, Math.max(0, warrantyItemIndex), warrantyDurationDays);
}

export async function logWarrantyTermsWhatsAppSent(warranty: PosWarranty, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  await writeAuditLog({
    entityType: 'pos',
    entityId: warranty.warrantyId,
    action: 'warranty_terms_sent_whatsapp',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [],
    note: 'Warranty terms signature link prepared for WhatsApp',
  });
}

export async function getPosWarrantyClaimsByWarranty(warrantyId: string, user: UserData): Promise<PosWarrantyClaim[]> {
  assertCan(user.role, 'pos.operate');
  const snapshot = await getDocs(query(collection(db, 'warrantyClaims'), where('warrantyId', '==', warrantyId)));
  return snapshot.docs.map((claimDoc) => mapWarrantyClaim(claimDoc.id, claimDoc.data()));
}

async function recalculateInvoicePaymentSummary(invoice: PosInvoice, user: UserData): Promise<PosInvoice> {
  const [payments, refunds] = await Promise.all([
    getPaymentsByInvoice(invoice.invoiceId, user),
    getRefundsByInvoice(invoice.invoiceId, user),
  ]);
  const completedPaid = payments
    .filter((payment) => (payment.status || 'completed') === 'completed')
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const refundedAmount = refunds.reduce((total, refund) => total + Number(refund.amount || 0), 0);
  const amountPaid = Math.max(0, completedPaid - refundedAmount);
  const balance = Math.max(0, invoice.total - amountPaid);
  let paymentStatus: InvoicePaymentStatus = amountPaid <= 0 ? 'unpaid' : balance <= 0 ? 'paid' : 'partial';
  if (refundedAmount > 0 && amountPaid <= 0) paymentStatus = 'refunded';
  await updateDoc(doc(db, 'invoices', invoice.invoiceId), {
    amountPaid,
    balance,
    paymentStatus,
    updatedAt: serverTimestamp(),
  });
  return { ...invoice, amountPaid, balance, paymentStatus };
}

export async function reverseInvoicePayment(invoice: PosInvoice, payment: PosPayment, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const reversalReason = cleanText(reason);
  if (!reversalReason) throw new Error('Reversal reason is required');
  if (invoice.paymentStatus === 'void') throw new Error('Cannot reverse payment for a void invoice');
  if ((payment.status || 'completed') !== 'completed') throw new Error('Only completed payments can be reversed');
  await updateDoc(doc(db, 'payments', payment.paymentId), {
    status: 'reversed',
    reversedAt: serverTimestamp(),
    reversedBy: user.uid,
    reversalReason,
  });
  const nextInvoice = await recalculateInvoicePaymentSummary(invoice, user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_payment_reversed',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'paymentStatus', before: invoice.paymentStatus, after: nextInvoice.paymentStatus },
      { field: 'paymentId', before: payment.paymentId, after: 'reversed' },
    ],
    note: reversalReason,
  });
}

export async function createInvoiceRefund(invoice: PosInvoice, input: {
  amount: number;
  method: PosPaymentMethod;
  reason: string;
  paymentId?: string;
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (invoice.paymentStatus === 'void') throw new Error('Cannot refund a void invoice');
  const amount = Number(input.amount || 0);
  const reason = cleanText(input.reason);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Refund amount must be valid');
  if (!reason) throw new Error('Refund reason is required');
  const existingRefunds = await getRefundsByInvoice(invoice.invoiceId, user);
  const previousRefunds = existingRefunds.reduce((total, refund) => total + Number(refund.amount || 0), 0);
  if (amount > invoice.amountPaid - previousRefunds) throw new Error('Refund exceeds refundable amount');

  const refundRef = await addDoc(collection(db, 'refunds'), {
    refundNo: nextNumber('RF'),
    invoiceId: invoice.invoiceId,
    paymentId: cleanText(input.paymentId),
    branchId: invoice.branchId,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    amount,
    method: input.method,
    reason,
    approvedBy: user.uid,
    refundedBy: user.uid,
    refundedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  const nextInvoice = await recalculateInvoicePaymentSummary(invoice, user);
  await writeAuditLog({
    entityType: 'pos',
    entityId: invoice.invoiceId,
    action: 'pos_refund_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'refundId', before: null, after: refundRef.id },
      { field: 'paymentStatus', before: invoice.paymentStatus, after: nextInvoice.paymentStatus },
    ],
    note: reason,
  });
}

export async function createPosWarrantyClaim(warranty: PosWarranty, claimReason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.operate');
  const reason = cleanText(claimReason);
  if (!reason) throw new Error('Claim reason is required');
  if (warranty.endDate?.toMillis?.() < Date.now()) throw new Error('Warranty has expired');
  const claimRef = await addDoc(collection(db, 'warrantyClaims'), {
    claimNo: nextNumber('WC'),
    warrantyId: warranty.warrantyId,
    invoiceId: warranty.invoiceId,
    jobId: cleanText(warranty.jobId),
    customerId: warranty.customerId,
    customerName: warranty.customerName,
    customerPhone: warranty.customerPhone,
    deviceId: cleanText(warranty.deviceId),
    branchId: warranty.branchId,
    itemName: warranty.itemName,
    claimReason: reason,
    status: 'open',
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: claimRef.id,
    action: 'pos_warranty_claim_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: null, after: 'open' }],
    note: reason,
  });
}

export async function updatePosWarrantyClaimStatus(claim: PosWarrantyClaim, status: PosWarrantyClaimStatus, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await updateDoc(doc(db, 'warrantyClaims', claim.claimId), {
    status,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: claim.claimId,
    action: 'pos_warranty_claim_status_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: claim.status, after: status }],
    note: 'POS warranty claim status updated',
  });
}

export async function preparePendingCommissionsFromPaidInvoice(invoiceId: string, user: UserData): Promise<number> {
  assertCan(user.role, 'pos.manage');
  const invoice = await getInvoiceById(invoiceId, user);
  if (invoice.paymentStatus !== 'paid') throw new Error('Commission can only be prepared for paid invoices');
  const existingSnapshot = await getDocs(query(collection(db, 'posCommissionEntries'), where('invoiceId', '==', invoiceId)));
  const existingKeys = new Set(existingSnapshot.docs.map((entryDoc) => String(entryDoc.data().invoiceItemKey || '')));
  let createdCount = 0;

  for (const [index, item] of invoice.items.entries()) {
    if (!item.priceItemId) continue;
    const itemSnapshot = await getDoc(doc(db, 'priceItems', item.priceItemId));
    const itemData = itemSnapshot.exists() ? itemSnapshot.data() : null;
    const commissionEligible = typeof item.commissionEligible === 'boolean'
      ? item.commissionEligible
      : itemData?.commissionEligible === true;
    if (!commissionEligible) continue;
    const invoiceItemKey = `${index}_${item.priceItemId}`;
    if (existingKeys.has(invoiceItemKey)) continue;
    const partsCost = Number(item.costPrice ?? itemData?.costPrice ?? 0) * Number(item.quantity || 0);
    const commissionCalculation = await calculateSuggestedCommissionForInvoiceItem(item, invoice.branchId, user, { partsCost });
    if (process.env.NODE_ENV === 'development') {
      console.warn('[POS COMMISSION DEBUG]', JSON.stringify({
        saleId: invoice.invoiceId,
        lineItemId: invoiceItemKey,
        priceItemId: item.priceItemId,
        commissionEligible,
        netProfit: commissionCalculation.netProfit,
        matchedRuleId: commissionCalculation.ruleId,
        commissionAmount: commissionCalculation.amount,
      }));
    }
    await addDoc(collection(db, 'posCommissionEntries'), {
      sourceType: 'invoice',
      sourceId: invoiceId,
      invoiceId,
      invoiceItemKey,
      priceItemId: item.priceItemId,
      itemName: item.name,
      category: cleanText(item.category),
      itemType: cleanText(item.type),
      branchId: invoice.branchId,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      sourceTotal: item.total,
      commissionBasis: 'net_profit',
      suggestedCommissionAmount: commissionCalculation.amount,
      commissionAmount: commissionCalculation.amount,
      commissionRate: commissionCalculation.rate,
      amountCollected: commissionCalculation.amountCollected,
      partsCost: commissionCalculation.partsCost,
      outsourceCost: commissionCalculation.outsourceCost,
      otherDirectCost: commissionCalculation.otherDirectCost,
      totalDirectCost: commissionCalculation.totalDirectCost,
      netProfit: commissionCalculation.netProfit,
      commissionRuleId: commissionCalculation.ruleId,
      commissionRuleName: commissionCalculation.ruleName,
      calculatedAt: serverTimestamp(),
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    createdCount += 1;
  }

  if (createdCount > 0) {
    await writeAuditLog({
      entityType: 'pos',
      entityId: invoiceId,
      action: 'pos_commission_prepared',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [{ field: 'posCommissionEntries', before: 0, after: createdCount }],
      note: 'Pending POS commission entries prepared',
    });
  }

  return createdCount;
}

export async function getCommissionRules(user: UserData): Promise<CommissionRule[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'commissionRules'));
  return snapshot.docs.map((ruleDoc) => mapCommissionRule(ruleDoc.id, ruleDoc.data()));
}

function isDefaultCommissionRuleData(data: Record<string, unknown>): boolean {
  return String(data.name || '') === DEFAULT_COMMISSION_RULE_NAME
    && String(data.priceItemId || '') === ''
    && String(data.category || '') === ''
    && String(data.itemType || '') === '';
}

function isDefaultCommissionPayload(payload: {
  name: string;
  category?: string;
  itemType?: PriceItemType | '';
  priceItemId?: string;
}): boolean {
  return payload.name === DEFAULT_COMMISSION_RULE_NAME
    && !cleanText(payload.priceItemId)
    && !cleanText(payload.category)
    && !cleanText(payload.itemType);
}

async function deactivateOtherActiveDefaultCommissionRules(keepRuleId: string): Promise<void> {
  const snapshot = await getDocs(query(collection(db, 'commissionRules'), where('name', '==', DEFAULT_COMMISSION_RULE_NAME)));
  await Promise.all(snapshot.docs.map(async (ruleDoc) => {
    const data = ruleDoc.data();
    if (ruleDoc.id === keepRuleId || data.active !== true || !isDefaultCommissionRuleData(data)) return;
    await updateDoc(doc(db, 'commissionRules', ruleDoc.id), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  }));
}

export async function ensureStandardCommissionRule(user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(collection(db, 'commissionRules'), where('name', '==', DEFAULT_COMMISSION_RULE_NAME)));
  const activeDefaultRules = snapshot.docs.filter((ruleDoc) => {
    const data = ruleDoc.data();
    return data.active === true && isDefaultCommissionRuleData(data);
  });

  if (activeDefaultRules.length === 0) {
    await addDoc(collection(db, 'commissionRules'), {
      name: DEFAULT_COMMISSION_RULE_NAME,
      category: '',
      itemType: '',
      priceItemId: '',
      calculationType: 'percentage',
      commissionBasis: 'net_profit',
      value: DEFAULT_COMMISSION_PERCENTAGE,
      branchId: '',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
    });
    return;
  }

  await Promise.all(activeDefaultRules.map(async (ruleDoc, index) => {
    const data = ruleDoc.data();
    if (index > 0) {
      await updateDoc(doc(db, 'commissionRules', ruleDoc.id), {
        active: false,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (
      data.calculationType === 'percentage'
      && Number(data.value || 0) === DEFAULT_COMMISSION_PERCENTAGE
      && String(data.priceItemId || '') === ''
      && String(data.category || '') === ''
      && String(data.itemType || '') === ''
    ) {
      return;
    }

    await updateDoc(doc(db, 'commissionRules', ruleDoc.id), {
      calculationType: 'percentage',
      commissionBasis: 'net_profit',
      value: DEFAULT_COMMISSION_PERCENTAGE,
      priceItemId: '',
      category: '',
      itemType: '',
      updatedAt: serverTimestamp(),
    });
  }));
}

function validateCommissionRule(input: {
  name: string;
  category?: string;
  itemType?: PriceItemType | '';
  priceItemId?: string;
  calculationType: 'fixed' | 'percentage';
  value: number;
  branchId?: string;
  active: boolean;
}) {
  const name = cleanText(input.name);
  const value = Number(input.value || 0);
  if (!name) throw new Error('Name is required');
  if (!['fixed', 'percentage'].includes(input.calculationType)) throw new Error('Calculation type is required');
  if (!Number.isFinite(value) || value <= 0) throw new Error('Rule value must be greater than 0');
  if (input.calculationType === 'percentage' && value > 100) throw new Error('Percentage cannot exceed 100');
  if (!cleanText(input.priceItemId) && !cleanText(input.category) && !cleanText(input.itemType)) {
    if (name !== DEFAULT_COMMISSION_RULE_NAME) {
      throw new Error('Rule must target price item, category, item type, or use the Standard Technician Net Profit Commission default rule');
    }
  }
  return {
    name,
    category: cleanText(input.category),
    itemType: cleanText(input.itemType) as PriceItemType | '',
    priceItemId: cleanText(input.priceItemId),
    calculationType: input.calculationType,
    commissionBasis: 'net_profit' as const,
    value,
    branchId: cleanText(input.branchId),
    active: input.active,
  };
}

export async function createCommissionRule(input: {
  name: string;
  category?: string;
  itemType?: PriceItemType | '';
  priceItemId?: string;
  calculationType: 'fixed' | 'percentage';
  value: number;
  branchId?: string;
  active: boolean;
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const payload = validateCommissionRule(input);
  if (payload.active && isDefaultCommissionPayload(payload)) {
    const snapshot = await getDocs(query(collection(db, 'commissionRules'), where('name', '==', DEFAULT_COMMISSION_RULE_NAME)));
    const hasActiveDefault = snapshot.docs.some((ruleDoc) => {
      const data = ruleDoc.data();
      return data.active === true && isDefaultCommissionRuleData(data);
    });
    if (hasActiveDefault) throw new Error('Active default commission rule already exists');
  }
  const ruleRef = await addDoc(collection(db, 'commissionRules'), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: ruleRef.id,
    action: 'pos_commission_rule_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'name', before: null, after: payload.name }],
    note: 'POS commission rule created',
  });
}

export async function updateCommissionRule(rule: CommissionRule, input: {
  name: string;
  category?: string;
  itemType?: PriceItemType | '';
  priceItemId?: string;
  calculationType: 'fixed' | 'percentage';
  value: number;
  branchId?: string;
  active: boolean;
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const payload = validateCommissionRule(input);
  if (payload.active && isDefaultCommissionPayload(payload)) {
    await deactivateOtherActiveDefaultCommissionRules(rule.ruleId);
  }
  await updateDoc(doc(db, 'commissionRules', rule.ruleId), {
    ...payload,
    createdBy: rule.createdBy,
    createdAt: rule.createdAt,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: rule.ruleId,
    action: rule.active !== payload.active
      ? payload.active ? 'pos_commission_rule_activated' : 'pos_commission_rule_deactivated'
      : 'pos_commission_rule_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'active', before: rule.active, after: payload.active },
      { field: 'value', before: rule.value, after: payload.value },
    ],
    note: 'POS commission rule updated',
  });
}

export async function calculateSuggestedCommissionForInvoiceItem(
  item: PosLineItem,
  branchId: string,
  user: UserData,
  costs: { partsCost?: number; outsourceCost?: number; otherDirectCost?: number } = {},
): Promise<{
  amount: number;
  rate: number;
  ruleId: string;
  ruleName: string;
  amountCollected: number;
  partsCost: number;
  outsourceCost: number;
  otherDirectCost: number;
  totalDirectCost: number;
  netProfit: number;
}> {
  const rules = (await getCommissionRules(user)).filter((rule) => {
    return rule.active && (!rule.branchId || rule.branchId === branchId);
  });
  const prioritized = [
    rules.find((rule) => rule.priceItemId && rule.priceItemId === item.priceItemId),
    rules.find((rule) => rule.category && item.category && rule.category === item.category),
    rules.find((rule) => rule.itemType && rule.itemType === item.type),
    rules.find((rule) => !rule.priceItemId && !rule.category && !rule.itemType && rule.name === DEFAULT_COMMISSION_RULE_NAME),
  ].filter(Boolean) as CommissionRule[];
  const rule = prioritized[0];
  if (!rule) {
    const result = calculateTechnicianCommission({
      amountCollected: Number(item.total || 0),
      partsCost: costs.partsCost || 0,
      outsourceCost: costs.outsourceCost || 0,
      otherDirectCost: costs.otherDirectCost || 0,
      commissionRate: DEFAULT_COMMISSION_PERCENTAGE / 100,
    });
    return {
      amount: result.commissionAmount,
      rate: DEFAULT_COMMISSION_PERCENTAGE,
      ruleId: 'system_default',
      ruleName: DEFAULT_COMMISSION_RULE_NAME,
      amountCollected: result.amountCollected,
      partsCost: result.partsCost,
      outsourceCost: result.outsourceCost,
      otherDirectCost: result.otherDirectCost,
      totalDirectCost: result.totalDirectCost,
      netProfit: result.netProfit,
    };
  }
  if (rule.calculationType === 'fixed') {
    const result = calculateTechnicianCommission({
      amountCollected: Number(item.total || 0),
      partsCost: costs.partsCost || 0,
      outsourceCost: costs.outsourceCost || 0,
      otherDirectCost: costs.otherDirectCost || 0,
      commissionRate: 0,
    });
    return {
      amount: result.netProfit > 0 ? Number(Number(rule.value || 0).toFixed(2)) : 0,
      rate: 0,
      ruleId: rule.ruleId,
      ruleName: rule.name,
      amountCollected: result.amountCollected,
      partsCost: result.partsCost,
      outsourceCost: result.outsourceCost,
      otherDirectCost: result.otherDirectCost,
      totalDirectCost: result.totalDirectCost,
      netProfit: result.netProfit,
    };
  }
  const rate = Number(rule.value || 0);
  const result = calculateTechnicianCommission({
    amountCollected: Number(item.total || 0),
    partsCost: costs.partsCost || 0,
    outsourceCost: costs.outsourceCost || 0,
    otherDirectCost: costs.otherDirectCost || 0,
    commissionRate: rate / 100,
  });
  return {
    amount: result.commissionAmount,
    rate,
    ruleId: rule.ruleId,
    ruleName: rule.name,
    amountCollected: result.amountCollected,
    partsCost: result.partsCost,
    outsourceCost: result.outsourceCost,
    otherDirectCost: result.otherDirectCost,
    totalDirectCost: result.totalDirectCost,
    netProfit: result.netProfit,
  };
}

export async function getPosCommissionEntries(user: UserData): Promise<PosCommissionEntry[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'posCommissionEntries'));
  return snapshot.docs.map((entryDoc) => mapCommissionEntry(entryDoc.id, entryDoc.data()));
}

export async function updatePosCommissionAmount(entry: PosCommissionEntry, amount: number, note: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (entry.status !== 'pending') throw new Error('Only pending commission entries can be updated');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Commission amount must be valid');
  await updateDoc(doc(db, 'posCommissionEntries', entry.entryId), {
    commissionAmount: amount,
    note: cleanText(note),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: entry.entryId,
    action: 'pos_commission_amount_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'commissionAmount', before: entry.commissionAmount, after: amount }],
    note: cleanText(note) || 'POS commission amount updated',
  });
}

export async function approvePosCommissionEntry(entry: PosCommissionEntry, invoice: PosInvoice, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (entry.status !== 'pending') throw new Error('Only pending commission entries can be approved');
  if (invoice.paymentStatus === 'void' || invoice.paymentStatus === 'refunded') throw new Error('Cannot approve commission from void or refunded invoice');
  if (invoice.paymentStatus !== 'paid') throw new Error('Commission can only become payable after payment is confirmed');
  await requireLinkedJobLifecycle(
    invoice.jobId,
    ['delivered', 'warranty_active'],
    'Commission can only become payable after the job is delivered or warranty is active',
  );
  if (!Number.isFinite(entry.commissionAmount) || entry.commissionAmount <= 0) throw new Error('Commission amount must be greater than 0');
  await updateDoc(doc(db, 'posCommissionEntries', entry.entryId), {
    status: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: entry.entryId,
    action: 'pos_commission_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: entry.status, after: 'approved' }],
    note: 'POS commission approved',
  });
}

export async function rejectPosCommissionEntry(entry: PosCommissionEntry, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const rejectionReason = cleanText(reason);
  if (!rejectionReason) throw new Error('Rejection reason is required');
  if (entry.status !== 'pending') throw new Error('Only pending commission entries can be rejected');
  await updateDoc(doc(db, 'posCommissionEntries', entry.entryId), {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedBy: user.uid,
    rejectionReason,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: entry.entryId,
    action: 'pos_commission_rejected',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: entry.status, after: 'rejected' }],
    note: rejectionReason,
  });
}

export async function prepareInventoryMovementsFromPaidInvoice(invoiceId: string, user: UserData): Promise<number> {
  assertCan(user.role, 'pos.manage');
  const invoice = await getInvoiceById(invoiceId, user);
  if (invoice.paymentStatus !== 'paid') throw new Error('Inventory movement can only be prepared for paid invoices');
  const existingSnapshot = await getDocs(query(collection(db, 'inventoryMovements'), where('invoiceId', '==', invoiceId)));
  const existingKeys = new Set(existingSnapshot.docs.map((movementDoc) => String(movementDoc.data().invoiceItemKey || '')));
  let createdCount = 0;

  for (const [index, item] of invoice.items.entries()) {
    if (item.type !== 'part') continue;
    const invoiceItemKey = `${index}_${item.priceItemId || item.name.replace(/\s+/g, '_')}`;
    if (existingKeys.has(invoiceItemKey)) continue;
    await addDoc(collection(db, 'inventoryMovements'), {
      sourceType: 'invoice',
      sourceId: invoiceId,
      invoiceId,
      invoiceItemKey,
      itemName: item.name,
      priceItemId: cleanText(item.priceItemId),
      quantity: Number(item.quantity || 0),
      branchId: invoice.branchId,
      movementType: 'deduct',
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    createdCount += 1;
  }

  if (createdCount > 0) {
    await writeAuditLog({
      entityType: 'pos',
      entityId: invoiceId,
      action: 'pos_inventory_movement_prepared',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [{ field: 'inventoryMovements', before: 0, after: createdCount }],
      note: 'Pending POS inventory movements prepared',
    });
  }

  return createdCount;
}

export async function getInventoryMovements(user: UserData): Promise<InventoryMovement[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'inventoryMovements'));
  return snapshot.docs.map((movementDoc) => mapInventoryMovement(movementDoc.id, movementDoc.data()));
}

export async function getInventoryItems(user: UserData): Promise<InventoryItem[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'inventoryItems'));
  return snapshot.docs.map((itemDoc) => mapInventoryItem(itemDoc.id, itemDoc.data()));
}

export async function createInventoryItem(input: {
  name: string;
  sku?: string;
  category?: string;
  branchId: string;
  quantity: number;
  reorderLevel?: number;
  costPrice?: number;
  sellingPrice?: number;
  active: boolean;
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (!cleanText(input.name)) throw new Error('Name is required');
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error('Quantity must be valid');
  await addDoc(collection(db, 'inventoryItems'), {
    name: cleanText(input.name),
    sku: cleanText(input.sku),
    category: cleanText(input.category),
    branchId: cleanText(input.branchId),
    quantity: Number(input.quantity || 0),
    reorderLevel: Number(input.reorderLevel || 0),
    costPrice: Number(input.costPrice || 0),
    sellingPrice: Number(input.sellingPrice || 0),
    active: input.active,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  });
}

export async function updateInventoryItemQuantity(item: InventoryItem, quantity: number, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantity must be valid');
  await updateDoc(doc(db, 'inventoryItems', item.inventoryItemId), {
    quantity,
    updatedAt: serverTimestamp(),
  });
}

export async function getInventoryItemById(inventoryItemId: string, user: UserData): Promise<InventoryItem> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDoc(doc(db, 'inventoryItems', inventoryItemId));
  if (!snapshot.exists()) throw new Error('Inventory item not found');
  return mapInventoryItem(snapshot.id, snapshot.data());
}

export async function getInventoryStockLedger(inventoryItemId: string, user: UserData): Promise<InventoryStockLedgerEntry[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(collection(db, 'inventoryStockLedger'), where('inventoryItemId', '==', inventoryItemId)));
  return snapshot.docs
    .map((ledgerDoc) => mapInventoryStockLedgerEntry(ledgerDoc.id, ledgerDoc.data()))
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0));
}

export async function getAllInventoryStockLedger(user: UserData): Promise<InventoryStockLedgerEntry[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'inventoryStockLedger'));
  return snapshot.docs.map((ledgerDoc) => mapInventoryStockLedgerEntry(ledgerDoc.id, ledgerDoc.data()));
}

export async function adjustInventoryItemQuantity(item: InventoryItem, quantityAfter: number, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const nextQuantity = Number(quantityAfter);
  const adjustmentReason = cleanText(reason);
  if (!Number.isFinite(nextQuantity) || nextQuantity < 0) throw new Error('Quantity must be valid');
  if (!adjustmentReason) throw new Error('Adjustment reason is required');
  const quantityBefore = Number(item.quantity || 0);
  await runTransaction(db, async (transaction) => {
    const itemRef = doc(db, 'inventoryItems', item.inventoryItemId);
    const ledgerRef = doc(collection(db, 'inventoryStockLedger'));
    transaction.update(itemRef, {
      quantity: nextQuantity,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      inventoryItemId: item.inventoryItemId,
      inventoryItemName: item.name,
      branchId: item.branchId,
      movementType: 'manual_adjustment',
      quantityChange: nextQuantity - quantityBefore,
      quantityBefore,
      quantityAfter: nextQuantity,
      sourceType: 'manual',
      sourceId: item.inventoryItemId,
      reason: adjustmentReason,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: item.inventoryItemId,
    action: 'inventory_manual_adjustment_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'quantity', before: quantityBefore, after: nextQuantity }],
    note: adjustmentReason,
  });
}

export async function receiveInventoryStock(params: {
  inventoryItemId: string;
  quantityReceived: number;
  unitCost?: number;
  supplierName?: string;
  referenceNo?: string;
  reason?: string;
  updateCostPrice?: boolean;
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const quantityReceived = Number(params.quantityReceived || 0);
  if (!params.inventoryItemId) throw new Error('Inventory item is required');
  if (!Number.isFinite(quantityReceived) || quantityReceived <= 0) throw new Error('Received quantity must be greater than 0');
  const reason = cleanText(params.reason) || 'Stock received';
  let quantityBefore = 0;
  let quantityAfter = 0;
  let itemName = '';
  let branchId = '';
  await runTransaction(db, async (transaction) => {
    const itemRef = doc(db, 'inventoryItems', params.inventoryItemId);
    const ledgerRef = doc(collection(db, 'inventoryStockLedger'));
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists()) throw new Error('Inventory item not found');
    const data = itemSnapshot.data();
    quantityBefore = Number(data.quantity || 0);
    quantityAfter = quantityBefore + quantityReceived;
    itemName = String(data.name || 'Inventory item');
    branchId = String(data.branchId || '');
    const updatePayload: Record<string, unknown> = {
      quantity: quantityAfter,
      updatedAt: serverTimestamp(),
    };
    if (params.updateCostPrice && Number.isFinite(Number(params.unitCost)) && Number(params.unitCost) >= 0) {
      updatePayload.costPrice = Number(params.unitCost || 0);
    }
    transaction.update(itemRef, updatePayload);
    transaction.set(ledgerRef, {
      inventoryItemId: params.inventoryItemId,
      inventoryItemName: itemName,
      branchId,
      movementType: 'receive',
      quantityChange: quantityReceived,
      quantityBefore,
      quantityAfter,
      sourceType: 'manual',
      sourceId: params.inventoryItemId,
      reason,
      unitCost: Number(params.unitCost || 0),
      supplierName: cleanText(params.supplierName),
      referenceNo: cleanText(params.referenceNo),
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: params.inventoryItemId,
    action: 'inventory_stock_received',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'quantity', before: quantityBefore, after: quantityAfter }],
    note: reason,
  });
}

export async function createInventoryCorrection(params: {
  inventoryItemId: string;
  quantityChange: number;
  reason: string;
  sourceType?: 'manual' | 'refund' | 'warranty_claim';
}, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const quantityChange = Number(params.quantityChange || 0);
  const reason = cleanText(params.reason);
  if (!params.inventoryItemId) throw new Error('Inventory item is required');
  if (!Number.isFinite(quantityChange) || quantityChange === 0) throw new Error('Quantity change must be valid');
  if (!reason) throw new Error('Correction reason is required');
  let quantityBefore = 0;
  let quantityAfter = 0;
  await runTransaction(db, async (transaction) => {
    const itemRef = doc(db, 'inventoryItems', params.inventoryItemId);
    const ledgerRef = doc(collection(db, 'inventoryStockLedger'));
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists()) throw new Error('Inventory item not found');
    const data = itemSnapshot.data();
    quantityBefore = Number(data.quantity || 0);
    quantityAfter = quantityBefore + quantityChange;
    if (quantityAfter < 0) throw new Error('Correction would make stock negative');
    transaction.update(itemRef, {
      quantity: quantityAfter,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      inventoryItemId: params.inventoryItemId,
      inventoryItemName: String(data.name || 'Inventory item'),
      branchId: String(data.branchId || ''),
      movementType: 'correction',
      quantityChange,
      quantityBefore,
      quantityAfter,
      sourceType: params.sourceType || 'manual',
      sourceId: params.inventoryItemId,
      reason,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: params.inventoryItemId,
    action: 'inventory_correction_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'quantity', before: quantityBefore, after: quantityAfter }],
    note: reason,
  });
}

export async function mapInventoryMovementToItem(movement: InventoryMovement, inventoryItemId: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  await updateDoc(doc(db, 'inventoryMovements', movement.movementId), {
    inventoryItemId,
    status: movement.status === 'needs_inventory_mapping' ? 'pending' : movement.status,
    updatedAt: serverTimestamp(),
  });
}

export async function approveInventoryMovement(movement: InventoryMovement, invoice: PosInvoice, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (movement.status !== 'pending' && movement.status !== 'needs_inventory_mapping') throw new Error('Only pending movements can be approved');
  if (!movement.inventoryItemId) throw new Error('Inventory item mapping is required');
  if (invoice.paymentStatus === 'void' || invoice.paymentStatus === 'refunded') throw new Error('Cannot approve movement from void or refunded invoice');
  await updateDoc(doc(db, 'inventoryMovements', movement.movementId), {
    status: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: movement.movementId,
    action: 'pos_inventory_movement_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: movement.status, after: 'approved' }],
    note: 'POS inventory movement approved',
  });
}

export async function rejectInventoryMovement(movement: InventoryMovement, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const rejectionReason = cleanText(reason);
  if (!rejectionReason) throw new Error('Rejection reason is required');
  if (movement.status === 'applied') throw new Error('Applied movement cannot be rejected');
  await updateDoc(doc(db, 'inventoryMovements', movement.movementId), {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedBy: user.uid,
    reason: rejectionReason,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: movement.movementId,
    action: 'pos_inventory_movement_rejected',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: movement.status, after: 'rejected' }],
    note: rejectionReason,
  });
}

export async function applyInventoryMovement(movement: InventoryMovement, invoice: PosInvoice, user: UserData): Promise<void> {
  assertCan(user.role, 'pos.manage');
  if (movement.status !== 'approved') throw new Error('Only approved movements can be applied');
  if (!movement.inventoryItemId) throw new Error('Inventory item mapping is required');
  if (invoice.paymentStatus === 'void' || invoice.paymentStatus === 'refunded') throw new Error('Cannot apply movement from void or refunded invoice');
  await runTransaction(db, async (transaction) => {
    const itemRef = doc(db, 'inventoryItems', movement.inventoryItemId || '');
    const movementRef = doc(db, 'inventoryMovements', movement.movementId);
    const ledgerRef = doc(collection(db, 'inventoryStockLedger'));
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists()) throw new Error('Inventory item not found');
    const currentQuantity = Number(itemSnapshot.data().quantity || 0);
    const quantity = Number(movement.quantity || 0);
    const itemName = String(itemSnapshot.data().name || movement.itemName);
    const unitCost = Number(itemSnapshot.data().costPrice || 0);
    if (currentQuantity < quantity) throw new Error('Insufficient stock');
    const quantityAfter = currentQuantity - quantity;
    transaction.update(itemRef, {
      quantity: quantityAfter,
      updatedAt: serverTimestamp(),
    });
    transaction.update(movementRef, {
      status: 'applied',
      appliedAt: serverTimestamp(),
      appliedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      inventoryItemId: movement.inventoryItemId,
      inventoryItemName: itemName,
      branchId: movement.branchId,
      movementType: 'deduct',
      quantityChange: -quantity,
      quantityBefore: currentQuantity,
      quantityAfter,
      sourceType: 'invoice',
      sourceId: invoice.invoiceId || movement.movementId,
      reason: `Invoice ${invoice.invoiceNo}`,
      unitCost,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: movement.movementId,
    action: 'pos_inventory_movement_applied',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: movement.status, after: 'applied' }],
    note: 'POS inventory movement applied',
  });
  await writeAuditLog({
    entityType: 'pos',
    entityId: movement.movementId,
    action: 'pos_inventory_stock_ledger_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'inventoryStockLedger', before: null, after: movement.inventoryItemId }],
    note: 'Inventory stock ledger created from invoice movement',
  });
}

export async function getApprovedCommissionsForTechnicianMonth(technicianId: string, month: string, user: UserData): Promise<{ total: number; entries: PosCommissionEntry[] }> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(
    collection(db, 'posCommissionEntries'),
    where('status', '==', 'approved'),
    where('technicianId', '==', technicianId),
  ));
  const entries = snapshot.docs
    .map((entryDoc) => mapCommissionEntry(entryDoc.id, entryDoc.data()))
    .filter((entry) => {
      if (entry.payrollId || entry.status === 'paid') return false;
      const date = entry.approvedAt?.toDate?.() || entry.createdAt?.toDate?.();
      if (!date) return false;
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).format(date) === month;
    });
  return {
    entries,
    total: entries.reduce((sum, entry) => sum + Number(entry.commissionAmount || 0), 0),
  };
}

export async function linkApprovedCommissionsToPayroll(params: {
  technicianId: string;
  month: string;
  payrollId: string;
  linkedBy: string;
}, user: UserData): Promise<{ total: number; entries: PosCommissionEntry[] }> {
  assertCan(user.role, 'pos.manage');
  if (params.linkedBy !== user.uid) throw new Error('Linked by user mismatch');
  const result = await getApprovedCommissionsForTechnicianMonth(params.technicianId, params.month, user);
  const linkedEntries: PosCommissionEntry[] = [];
  for (const entry of result.entries) {
    await updateDoc(doc(db, 'posCommissionEntries', entry.entryId), {
      payrollId: params.payrollId,
      payrollLinkedAt: serverTimestamp(),
      payrollLinkedBy: user.uid,
      status: 'payroll_linked',
      updatedAt: serverTimestamp(),
    });
    linkedEntries.push({ ...entry, payrollId: params.payrollId, payrollLinkedBy: user.uid, status: 'payroll_linked' });
  }
  await writeAuditLog({
    entityType: 'pos',
    entityId: params.payrollId,
    action: 'pos_commission_linked_to_payroll',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'linkedCommissions', before: 0, after: linkedEntries.length }],
    note: `Linked POS commissions for ${params.technicianId} ${params.month}`,
  });
  return {
    entries: linkedEntries,
    total: linkedEntries.reduce((sum, entry) => sum + Number(entry.commissionAmount || 0), 0),
  };
}

export async function markPayrollLinkedCommissionsAsPaid(payrollId: string, paidBy: string, user: UserData): Promise<number> {
  assertCan(user.role, 'pos.manage');
  if (paidBy !== user.uid) throw new Error('Paid by user mismatch');
  const snapshot = await getDocs(query(
    collection(db, 'posCommissionEntries'),
    where('payrollId', '==', payrollId),
    where('status', '==', 'payroll_linked'),
  ));
  for (const entryDoc of snapshot.docs) {
    await updateDoc(doc(db, 'posCommissionEntries', entryDoc.id), {
      status: 'paid',
      paidAt: serverTimestamp(),
      paidBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  }
  await writeAuditLog({
    entityType: 'pos',
    entityId: payrollId,
    action: 'pos_commission_marked_paid',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'paidCommissions', before: 0, after: snapshot.size }],
    note: 'POS payroll-linked commissions marked paid',
  });
  return snapshot.size;
}

export async function getPosCommissionsForPayroll(payrollId: string, user: UserData): Promise<PosCommissionEntry[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(query(collection(db, 'posCommissionEntries'), where('payrollId', '==', payrollId)));
  return snapshot.docs.map((entryDoc) => mapCommissionEntry(entryDoc.id, entryDoc.data()));
}

async function getInventoryCostForInvoice(invoiceId: string, user: UserData): Promise<number> {
  assertCan(user.role, 'pos.operate');
  const ledgerSnapshot = await getDocs(query(collection(db, 'inventoryStockLedger'), where('sourceId', '==', invoiceId)));
  let total = 0;
  for (const ledgerDoc of ledgerSnapshot.docs) {
    const ledger = mapInventoryStockLedgerEntry(ledgerDoc.id, ledgerDoc.data());
    if (ledger.movementType !== 'deduct') continue;
    if (Number(ledger.unitCost || 0) > 0) {
      total += Math.abs(Number(ledger.quantityChange || 0)) * Number(ledger.unitCost || 0);
      continue;
    }
    if (!ledger.inventoryItemId) continue;
    const itemSnapshot = await getDoc(doc(db, 'inventoryItems', ledger.inventoryItemId));
    if (itemSnapshot.exists()) {
      total += Math.abs(Number(ledger.quantityChange || 0)) * Number(itemSnapshot.data().costPrice || 0);
    }
  }
  return total;
}

export async function getJobFinancialSummary(jobId: string, user: UserData): Promise<JobFinancialSummary> {
  assertCan(user.role, 'pos.operate');
  const [quotationSnapshot, invoiceSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'quotations'), where('jobId', '==', jobId))),
    getDocs(query(collection(db, 'invoices'), where('jobId', '==', jobId))),
  ]);
  const quotations = quotationSnapshot.docs.map((quotationDoc) => mapQuotation(quotationDoc.id, quotationDoc.data()));
  const invoices = invoiceSnapshot.docs
    .map((invoiceDoc) => mapInvoice(invoiceDoc.id, invoiceDoc.data()))
    .filter((invoice) => invoice.paymentStatus !== 'void');
  const invoiceIds = invoices.map((invoice) => invoice.invoiceId);
  let refundTotal = 0;
  let approvedCommissionTotal = 0;
  let payrollLinkedCommissionTotal = 0;
  let paidCommissionTotal = 0;
  let inventoryCostTotal = 0;
  for (const invoice of invoices) {
    const [refundSnapshot, commissionSnapshot, invoiceInventoryCost] = await Promise.all([
      getDocs(query(collection(db, 'refunds'), where('invoiceId', '==', invoice.invoiceId))),
      getDocs(query(collection(db, 'posCommissionEntries'), where('invoiceId', '==', invoice.invoiceId))),
      getInventoryCostForInvoice(invoice.invoiceId, user),
    ]);
    refundTotal += refundSnapshot.docs.reduce((total, refundDoc) => total + Number(refundDoc.data().amount || 0), 0);
    inventoryCostTotal += invoiceInventoryCost;
    commissionSnapshot.docs.forEach((entryDoc) => {
      const entry = entryDoc.data();
      if (entry.status === 'approved') approvedCommissionTotal += Number(entry.commissionAmount || 0);
      if (entry.status === 'payroll_linked') payrollLinkedCommissionTotal += Number(entry.commissionAmount || 0);
      if (entry.status === 'paid') paidCommissionTotal += Number(entry.commissionAmount || 0);
    });
  }
  const paidAmount = invoices.reduce((total, invoice) => total + Number(invoice.amountPaid || 0), 0);
  return {
    jobId,
    quotationTotal: quotations.reduce((total, quotation) => total + Number(quotation.total || 0), 0),
    invoiceTotal: invoices.reduce((total, invoice) => total + Number(invoice.total || 0), 0),
    paidAmount,
    outstandingBalance: invoices.reduce((total, invoice) => total + Number(invoice.balance || 0), 0),
    refundTotal,
    approvedCommissionTotal,
    payrollLinkedCommissionTotal,
    paidCommissionTotal,
    inventoryCostTotal,
    grossProfitEstimate: paidAmount - refundTotal - approvedCommissionTotal - inventoryCostTotal,
    quotationIds: quotations.map((quotation) => quotation.quotationId),
    invoiceIds,
  };
}

export async function getPosOperationalReportCounts(user: UserData): Promise<{
  activeWarranties: number;
  openWarrantyClaims: number;
  pendingCommissionEntries: number;
  pendingCommissionAmount: number;
  approvedCommissionAmount: number;
  rejectedCommissionCount: number;
  pendingInventoryMovements: number;
  appliedInventoryMovements: number;
  lowStockCount: number;
  payrollLinkedCommissionAmount: number;
  paidCommissionAmount: number;
  activeCommissionRules: number;
  inventoryLedgerMovementCount: number;
  manualStockAdjustmentCount: number;
  lowStockByBranch: Record<string, number>;
  inventoryReceivedCount: number;
  inventoryReceivedQuantity: number;
  grossProfitEstimate: number;
  topLowStockItems: Array<{ inventoryItemId: string; name: string; branchId: string; quantity: number; reorderLevel: number }>;
}> {
  assertCan(user.role, 'pos.operate');
  const [warrantySnapshot, claimSnapshot, commissionSnapshot, approvedCommissionSnapshot, rejectedCommissionSnapshot, payrollLinkedSnapshot, paidCommissionSnapshot, movementSnapshot, appliedMovementSnapshot, inventorySnapshot, activeRuleSnapshot, ledgerSnapshot, manualLedgerSnapshot, receivedLedgerSnapshot, invoiceSnapshot, refundSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'warranties'), where('status', '==', 'active'))),
    getDocs(query(collection(db, 'warrantyClaims'), where('status', '==', 'open'))),
    getDocs(query(collection(db, 'posCommissionEntries'), where('status', '==', 'pending'))),
    getDocs(query(collection(db, 'posCommissionEntries'), where('status', '==', 'approved'))),
    getDocs(query(collection(db, 'posCommissionEntries'), where('status', '==', 'rejected'))),
    getDocs(query(collection(db, 'posCommissionEntries'), where('status', '==', 'payroll_linked'))),
    getDocs(query(collection(db, 'posCommissionEntries'), where('status', '==', 'paid'))),
    getDocs(query(collection(db, 'inventoryMovements'), where('status', '==', 'pending'))),
    getDocs(query(collection(db, 'inventoryMovements'), where('status', '==', 'applied'))),
    getDocs(collection(db, 'inventoryItems')),
    getDocs(query(collection(db, 'commissionRules'), where('active', '==', true))),
    getDocs(collection(db, 'inventoryStockLedger')),
    getDocs(query(collection(db, 'inventoryStockLedger'), where('movementType', '==', 'manual_adjustment'))),
    getDocs(query(collection(db, 'inventoryStockLedger'), where('movementType', '==', 'receive'))),
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'refunds')),
  ]);
  const pendingCommissionAmount = commissionSnapshot.docs.reduce((total, entryDoc) => total + Number(entryDoc.data().commissionAmount || 0), 0);
  const approvedCommissionAmount = approvedCommissionSnapshot.docs.reduce((total, entryDoc) => total + Number(entryDoc.data().commissionAmount || 0), 0);
  const payrollLinkedCommissionAmount = payrollLinkedSnapshot.docs.reduce((total, entryDoc) => total + Number(entryDoc.data().commissionAmount || 0), 0);
  const paidCommissionAmount = paidCommissionSnapshot.docs.reduce((total, entryDoc) => total + Number(entryDoc.data().commissionAmount || 0), 0);
  const lowStockCount = inventorySnapshot.docs.filter((itemDoc) => Number(itemDoc.data().quantity || 0) <= Number(itemDoc.data().reorderLevel || 0)).length;
  const lowStockByBranch = inventorySnapshot.docs.reduce<Record<string, number>>((rows, itemDoc) => {
    const data = itemDoc.data();
    if (Number(data.quantity || 0) <= Number(data.reorderLevel || 0)) {
      const branch = String(data.branchId || 'unknown');
      rows[branch] = (rows[branch] || 0) + 1;
    }
    return rows;
  }, {});
  const topLowStockItems = inventorySnapshot.docs
    .map((itemDoc): Record<string, unknown> & { inventoryItemId: string } => ({ inventoryItemId: itemDoc.id, ...itemDoc.data() }))
    .filter((item) => Number(item.quantity || 0) <= Number(item.reorderLevel || 0))
    .sort((left, right) => Number(left.quantity || 0) - Number(right.quantity || 0))
    .slice(0, 5)
    .map((item) => ({
      inventoryItemId: String(item.inventoryItemId || ''),
      name: String(item.name || 'Inventory item'),
      branchId: String(item.branchId || 'unknown'),
      quantity: Number(item.quantity || 0),
      reorderLevel: Number(item.reorderLevel || 0),
    }));
  const paidRevenue = invoiceSnapshot.docs
    .filter((invoiceDoc) => invoiceDoc.data().paymentStatus !== 'void')
    .reduce((total, invoiceDoc) => total + Number(invoiceDoc.data().amountPaid || 0), 0);
  const refundTotal = refundSnapshot.docs.reduce((total, refundDoc) => total + Number(refundDoc.data().amount || 0), 0);
  const inventoryCostTotal = ledgerSnapshot.docs.reduce((total, ledgerDoc) => {
    const data = ledgerDoc.data();
    if (data.movementType !== 'deduct') return total;
    return total + Math.abs(Number(data.quantityChange || 0)) * Number(data.unitCost || 0);
  }, 0);
  return {
    activeWarranties: warrantySnapshot.size,
    openWarrantyClaims: claimSnapshot.size,
    pendingCommissionEntries: commissionSnapshot.size,
    pendingCommissionAmount,
    approvedCommissionAmount,
    rejectedCommissionCount: rejectedCommissionSnapshot.size,
    pendingInventoryMovements: movementSnapshot.size,
    appliedInventoryMovements: appliedMovementSnapshot.size,
    lowStockCount,
    payrollLinkedCommissionAmount,
    paidCommissionAmount,
    activeCommissionRules: activeRuleSnapshot.size,
    inventoryLedgerMovementCount: ledgerSnapshot.size,
    manualStockAdjustmentCount: manualLedgerSnapshot.size,
    lowStockByBranch,
    inventoryReceivedCount: receivedLedgerSnapshot.size,
    inventoryReceivedQuantity: receivedLedgerSnapshot.docs.reduce((total, ledgerDoc) => total + Number(ledgerDoc.data().quantityChange || 0), 0),
    grossProfitEstimate: paidRevenue - refundTotal - approvedCommissionAmount - inventoryCostTotal,
    topLowStockItems,
  };
}

export interface CreateAiPricelistImportInput {
  branchId?: string;
  sourceFile?: File | null;
  rawText?: string;
}

export interface ReviewAiDetectedItemInput {
  suggestedName: string;
  suggestedCategory?: string;
  suggestedType: PriceItemType;
  suggestedPrice: number;
  suggestedWarrantyDurationDays?: number;
  suggestedCostPrice?: number;
  commissionEligible?: boolean;
  active?: boolean;
  updateExistingPriceItemId?: string;
}

export async function createAiPricelistImport(input: CreateAiPricelistImportInput, user: UserData): Promise<AiPricelistImport> {
  assertCan(user.role, 'pos.manage');
  const rawExtractedText = cleanText(input.rawText);
  if (!input.sourceFile && !rawExtractedText) throw new Error('Upload a file or paste pricelist text');

  const importRef = doc(collection(db, 'aiPricelistImports'));
  const importData: Record<string, unknown> = {
    importNo: nextNumber('AI-PL'),
    status: 'uploaded',
    detectedItems: [],
    rawExtractedText,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const branchId = cleanText(input.branchId);
  if (branchId) importData.branchId = branchId;
  if (input.sourceFile) {
    importData.sourceFileName = input.sourceFile.name;
    importData.sourceMimeType = input.sourceFile.type;
  }

  await setDoc(importRef, importData);
  if (input.sourceFile) {
    const sourceFileUrl = await uploadAiPricelistSourceFile(importRef.id, input.sourceFile, user, branchId);
    await updateDoc(importRef, {
      sourceFileUrl,
      updatedAt: serverTimestamp(),
    });
  }

  await writeAuditLog({
    entityType: 'pos',
    entityId: importRef.id,
    action: 'pos_ai_pricelist_import_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'status', before: null, after: 'uploaded' }],
    note: 'AI pricelist import created',
  });

  const snapshot = await getDoc(importRef);
  return mapAiPricelistImport(snapshot.id, snapshot.data() || {});
}

export async function getAiPricelistImports(user: UserData): Promise<AiPricelistImport[]> {
  assertCan(user.role, 'pos.manage');
  const snapshot = await getDocs(collection(db, 'aiPricelistImports'));
  return snapshot.docs
    .map((importDoc) => mapAiPricelistImport(importDoc.id, importDoc.data()))
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0));
}

export async function approveAiPricelistDetectedItem(
  importRecord: AiPricelistImport,
  itemId: string,
  input: ReviewAiDetectedItemInput,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const detectedItems = importRecord.detectedItems || [];
  const item = detectedItems.find((detectedItem) => detectedItem.id === itemId);
  if (!item) throw new Error('Detected item not found');
  if (item.status === 'approved') throw new Error('Detected item already approved');

  const name = cleanText(input.suggestedName);
  const category = cleanText(input.suggestedCategory);
  const suggestedPrice = Number(input.suggestedPrice || 0);
  const suggestedCostPrice = Number(input.suggestedCostPrice || 0);
  const suggestedWarrantyDurationDays = Number(input.suggestedWarrantyDurationDays || 0);
  if (!name) throw new Error('Suggested name is required');
  if (!input.suggestedType) throw new Error('Suggested type is required');
  if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) throw new Error('Suggested price must be greater than 0');

  const updateExistingPriceItemId = cleanText(input.updateExistingPriceItemId);
  let approvedPriceItemId = updateExistingPriceItemId;
  if (updateExistingPriceItemId) {
    await updateDoc(doc(db, 'priceItems', updateExistingPriceItemId), {
      name,
      category,
      type: input.suggestedType,
      basePrice: suggestedPrice,
      costPrice: suggestedCostPrice,
      warrantyDurationDays: suggestedWarrantyDurationDays,
      active: input.active ?? true,
      updatedAt: serverTimestamp(),
    });
  } else {
    const priceItemRef = await addDoc(collection(db, 'priceItems'), {
      name,
      category,
      type: input.suggestedType,
      basePrice: suggestedPrice,
      costPrice: suggestedCostPrice,
      warrantyDurationDays: suggestedWarrantyDurationDays,
      commissionEligible: input.commissionEligible ?? false,
      active: input.active ?? true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
    });
    approvedPriceItemId = priceItemRef.id;
  }

  const reviewedAt = Timestamp.now();
  const updatedItems = detectedItems.map((detectedItem) => {
    if (detectedItem.id !== itemId) return detectedItem;
    return {
      ...detectedItem,
      suggestedName: name,
      suggestedCategory: category,
      suggestedType: input.suggestedType,
      suggestedPrice,
      suggestedCostPrice,
      suggestedWarrantyDurationDays,
      status: 'approved' as const,
      approvedPriceItemId,
      reviewedBy: user.uid,
      reviewedAt,
      rejectionReason: '',
    };
  });

  await updateDoc(doc(db, 'aiPricelistImports', importRecord.importId), {
    detectedItems: updatedItems,
    status: deriveAiPricelistImportStatus(updatedItems),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'pos',
    entityId: importRecord.importId,
    action: updateExistingPriceItemId ? 'pos_ai_pricelist_item_updated_existing' : 'pos_ai_pricelist_item_approved',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'detectedItem', before: item.status, after: 'approved' }],
    note: updateExistingPriceItemId ? 'AI detected item updated existing price item' : 'AI detected item approved as new price item',
  });
}

export async function rejectAiPricelistDetectedItem(
  importRecord: AiPricelistImport,
  itemId: string,
  reason: string,
  user: UserData,
): Promise<void> {
  assertCan(user.role, 'pos.manage');
  const rejectionReason = cleanText(reason);
  if (!rejectionReason) throw new Error('Rejection reason is required');
  const detectedItems = importRecord.detectedItems || [];
  const item = detectedItems.find((detectedItem) => detectedItem.id === itemId);
  if (!item) throw new Error('Detected item not found');
  if (item.status === 'approved') throw new Error('Approved detected item cannot be rejected');

  const reviewedAt = Timestamp.now();
  const updatedItems = detectedItems.map((detectedItem) => detectedItem.id === itemId
    ? {
        ...detectedItem,
        status: 'rejected' as const,
        reviewedBy: user.uid,
        reviewedAt,
        rejectionReason,
      }
    : detectedItem);

  await updateDoc(doc(db, 'aiPricelistImports', importRecord.importId), {
    detectedItems: updatedItems,
    status: deriveAiPricelistImportStatus(updatedItems),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'pos',
    entityId: importRecord.importId,
    action: 'pos_ai_pricelist_item_rejected',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'detectedItem', before: item.status, after: 'rejected' }],
    note: rejectionReason,
  });
}

export function buildQuotationWhatsAppLink(quotation: PosQuotation): string {
  const message = buildQuotationWhatsAppMessage(quotation);
  return buildWaMeLink({ branch: quotation.branchId, recipientPhone: quotation.customerPhone, message });
}

export function buildQuotationWhatsAppMessage(quotation: PosQuotation): string {
  const token = quotation.quotationApprovalToken || quotation.publicToken || '';
  const origin = process.env.NEXT_PUBLIC_APP_URL || globalThis.location?.origin || '';
  const approvalLink = token && origin ? `${origin}/quotation/${token}` : '';
  const deviceInfo = [quotation.items?.[0]?.name, quotation.items?.length > 1 ? `and ${quotation.items.length - 1} more item(s)` : ''].filter(Boolean).join(' ') || 'your device';
  const reportedIssue = quotation.items?.[0]?.name || '-';
  const repairId = quotation.jobNumber || (/^RIGX-\d{6}$/.test(quotation.jobId || '') ? quotation.jobId : quotation.quotationNo);
  return [
    'Hi, this is Genius Advanced.',
    '',
    'Your repair quotation is now ready for review.',
    '',
    `Repair ID: ${repairId}`,
    `Device: ${deviceInfo}`,
    `Issue Reported: ${reportedIssue}`,
    `Total Quotation: RM ${Number(quotation.total || 0).toFixed(2)}`,
    '',
    'Kindly review the quotation and confirm whether you would like us to proceed using the secure link below:',
    approvalLink,
    '',
    'Repair work will only begin after your approval has been submitted.',
    '',
    'Thank you for choosing Genius Advanced.',
  ].filter((line) => line !== undefined).join('\n');
}

export function buildInvoiceWhatsAppLink(invoice: PosInvoice): string {
  if (invoice.paymentStatus === 'void') return '#';
  const message = buildInvoiceWhatsAppMessage(invoice);
  return buildWaMeLink({ branch: invoice.branchId, recipientPhone: invoice.customerPhone, message });
}

export function buildInvoiceWhatsAppMessage(invoice: PosInvoice): string {
  return buildInvoiceMessageTemplate(invoice);
}
