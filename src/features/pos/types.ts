import type { Timestamp } from 'firebase/firestore';
import type { SignedWarrantySnapshot } from '@/features/job-documents/types';
import type { WarrantyTermsSnapshot } from './warrantyTerms';

export type PosBranch = 'bangi' | 'cyberjaya';
export type PriceItemType = 'service' | 'part' | 'package' | 'diagnostic' | 'labor';
export type PriceItemPricingType = 'fixed' | 'starting_from' | 'range' | 'quote_required' | 'free_or_waived';
export type QuotationStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'expired';
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'void';
export type PosPaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'ewallet' | 'duitnow' | 'other';
export type PosPaymentStatus = 'completed' | 'reversed' | 'refunded';
export type PaymentSubmissionStatus = 'pending_review' | 'approved' | 'rejected';
export type PublicTokenStatus = 'active' | 'revoked';
export type AiDetectedItemStatus = 'pending' | 'approved' | 'rejected' | 'needs_review';
export type AiPricelistImportStatus = 'uploaded' | 'processing' | 'parsed' | 'partially_approved' | 'approved' | 'rejected' | 'failed';
export type PosWarrantyClaimStatus = 'open' | 'checking' | 'approved' | 'rejected' | 'completed';
export type PosCommissionStatus = 'pending' | 'approved' | 'rejected' | 'void' | 'payroll_linked' | 'paid';
export type PosInventoryMovementStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'void' | 'needs_inventory_mapping';
export type CommissionCalculationType = 'fixed' | 'percentage';
export type CommissionBasis = 'net_profit' | 'legacy';
export type InventoryLedgerMovementType = 'deduct' | 'manual_adjustment' | 'receive' | 'return' | 'correction';
export type InventoryLedgerSourceType = 'invoice' | 'manual' | 'purchase_order' | 'refund' | 'warranty_claim';

export interface PriceItem {
  priceItemId: string;
  name: string;
  serviceGroup?: string;
  packageName?: string;
  category: string;
  type: PriceItemType;
  pricingType?: PriceItemPricingType;
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface PosLineItem {
  priceItemId?: string;
  name: string;
  category?: string;
  serviceGroup?: string;
  pricingType?: PriceItemPricingType;
  basePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  type: PriceItemType | string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  commissionEligible?: boolean;
  costPrice?: number;
  netProfit?: number;
  warrantyDurationDays?: number;
  total: number;
}

export interface PosQuotation {
  quotationId: string;
  quotationNo: string;
  quotationNumber?: string;
  customerNumber?: string;
  jobNumber?: string;
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
  subtotal: number;
  discountAmount: number;
  discountReason?: string;
  total: number;
  status: QuotationStatus;
  quotationApprovalStatus?: QuotationStatus;
  validUntil: Timestamp;
  createdBy: string;
  sentAt?: Timestamp;
  quotationSentAt?: Timestamp;
  approvedAt?: Timestamp;
  quotationApprovedAt?: Timestamp;
  quotationRejectedAt?: Timestamp;
  quotationApprovedByName?: string;
  quotationApprovedByPhone?: string;
  quotationRejectionReason?: string;
  quotationApprovalToken?: string;
  quotationApprovalTokenCreatedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectedBy?: string;
  rejectionReason?: string;
  expiredAt?: Timestamp;
  publicToken?: string;
  publicTokenCreatedAt?: Timestamp;
  publicTokenRevokedAt?: Timestamp;
  publicTokenRevokedBy?: string;
  publicTokenStatus?: PublicTokenStatus;
  customerViewedAt?: Timestamp;
  customerApprovedAt?: Timestamp;
  customerRejectedAt?: Timestamp;
  customerRejectionReason?: string;
  customerActionSource?: 'public_link';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosInvoice {
  invoiceId: string;
  invoiceNo: string;
  officialInvoiceNo?: string;
  quotationId?: string;
  jobId?: string;
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
  branchId: string;
  items: PosLineItem[];
  subtotal: number;
  discountAmount: number;
  discountReason?: string;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: InvoicePaymentStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  paidAt?: Timestamp;
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidReason?: string;
  publicPaymentToken?: string;
  publicPaymentTokenCreatedAt?: Timestamp;
  publicPaymentTokenRevokedAt?: Timestamp;
  publicPaymentTokenRevokedBy?: string;
  publicPaymentTokenStatus?: PublicTokenStatus;
  customerPaymentPageViewedAt?: Timestamp;
}

export interface PosPayment {
  paymentId: string;
  invoiceId: string;
  branchId: string;
  amount: number;
  method: PosPaymentMethod;
  referenceNo?: string;
  receivedBy: string;
  receivedAt: Timestamp;
  proofImageUrl?: string;
  status?: PosPaymentStatus;
  reversedAt?: Timestamp;
  reversedBy?: string;
  reversalReason?: string;
  balanceAfterPayment?: number;
}

export interface PaymentSubmission {
  submissionId: string;
  invoiceId: string;
  invoiceNo: string;
  branchId: string;
  customerName: string;
  customerPhone: string;
  amountClaimed: number;
  method: Extract<PosPaymentMethod, 'bank_transfer' | 'duitnow' | 'ewallet' | 'other'>;
  referenceNo?: string;
  proofImageUrl?: string;
  note?: string;
  status: PaymentSubmissionStatus;
  createdAt: Timestamp;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  paymentId?: string;
}

export interface PosWarranty {
  warrantyId: string;
  invoiceId: string;
  invoiceItemKey: string;
  jobId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId?: string;
  branchId: string;
  itemName: string;
  warrantyDurationDays: number;
  startDate: Timestamp;
  endDate: Timestamp;
  claimLimit: 'unlimited';
  status: 'active' | 'void';
  createdAt: Timestamp;
  createdBy: string;
  publicWarrantyToken?: string;
  publicWarrantyTokenCreatedAt?: Timestamp;
  publicWarrantyTokenExpiresAt?: Timestamp | null;
  publicWarrantyTokenStatus?: PublicTokenStatus;
  warrantyTermsVersion?: string;
  warrantyTermsAccepted?: boolean;
  acceptedTerms?: boolean;
  warrantySignedAt?: Timestamp;
  warrantySignedName?: string;
  warrantySignedPhone?: string;
  warrantySignatureDataUrl?: string;
  warrantyTypedSignature?: string;
  warrantySignatureTokenUsed?: string;
  warrantySignedIp?: string;
  warrantySignedUserAgent?: string;
  warrantySignature?: {
    name: string;
    phone: string;
    dataUrl?: string;
    typedSignature?: string;
    signedAt: Timestamp;
    tokenUsed: string;
  };
  warrantyTermsSnapshot?: WarrantyTermsSnapshot;
  signedWarrantySnapshot?: SignedWarrantySnapshot;
}

export interface PosRefund {
  refundId: string;
  refundNo: string;
  invoiceId: string;
  paymentId?: string;
  branchId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  method: PosPaymentMethod;
  reason: string;
  approvedBy: string;
  refundedBy: string;
  refundedAt: Timestamp;
  createdAt: Timestamp;
}

export interface PosWarrantyClaim {
  claimId: string;
  claimNo: string;
  warrantyId: string;
  invoiceId: string;
  jobId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId?: string;
  branchId: string;
  itemName: string;
  claimReason: string;
  status: PosWarrantyClaimStatus;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}

export interface AiDetectedPriceItem {
  id: string;
  rawText: string;
  suggestedName: string;
  suggestedCategory?: string;
  suggestedType: PriceItemType;
  suggestedPrice: number;
  suggestedWarrantyDurationDays?: number;
  suggestedCostPrice?: number;
  confidenceScore: number;
  duplicateCandidate?: boolean;
  matchedExistingPriceItemId?: string;
  warnings?: string[];
  status: AiDetectedItemStatus;
  approvedPriceItemId?: string;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
}

export interface AiPricelistImport {
  importId: string;
  importNo: string;
  branchId?: string;
  sourceFileName?: string;
  sourceFileUrl?: string;
  sourceMimeType?: string;
  status: AiPricelistImportStatus;
  detectedItems: AiDetectedPriceItem[];
  rawExtractedText?: string;
  aiModel?: string;
  errorMessage?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}

export interface CommissionRule {
  ruleId: string;
  name: string;
  category?: string;
  itemType?: PriceItemType;
  priceItemId?: string;
  calculationType: CommissionCalculationType;
  commissionBasis?: CommissionBasis;
  value: number;
  branchId?: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface PosCommissionEntry {
  entryId: string;
  sourceType: 'invoice';
  sourceId: string;
  invoiceId: string;
  invoiceItemKey: string;
  priceItemId?: string;
  itemName: string;
  category?: string;
  itemType?: string;
  branchId: string;
  customerId?: string;
  customerName?: string;
  technicianId?: string;
  technicianName?: string;
  sourceTotal: number;
  commissionBasis?: CommissionBasis;
  suggestedCommissionAmount: number;
  commissionAmount: number;
  commissionRate?: number;
  amountCollected?: number;
  partsCost?: number;
  outsourceCost?: number;
  otherDirectCost?: number;
  totalDirectCost?: number;
  netProfit?: number;
  commissionRuleId?: string;
  commissionRuleName?: string;
  calculatedAt?: Timestamp;
  status: PosCommissionStatus;
  note?: string;
  rejectionReason?: string;
  approvedAt?: Timestamp;
  approvedBy?: string;
  rejectedAt?: Timestamp;
  rejectedBy?: string;
  paidAt?: Timestamp;
  paidBy?: string;
  payrollId?: string;
  payrollLinkedAt?: Timestamp;
  payrollLinkedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
}

export interface InventoryItem {
  inventoryItemId: string;
  name: string;
  sku?: string;
  category?: string;
  branchId: string;
  quantity: number;
  reorderLevel?: number;
  costPrice?: number;
  sellingPrice?: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface InventoryMovement {
  movementId: string;
  sourceType: 'invoice';
  sourceId: string;
  invoiceId: string;
  invoiceItemKey: string;
  itemName: string;
  priceItemId?: string;
  inventoryItemId?: string;
  quantity: number;
  branchId: string;
  movementType: 'deduct';
  status: PosInventoryMovementStatus;
  reason?: string;
  note?: string;
  approvedAt?: Timestamp;
  approvedBy?: string;
  rejectedAt?: Timestamp;
  rejectedBy?: string;
  appliedAt?: Timestamp;
  appliedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface InventoryStockLedgerEntry {
  ledgerId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  branchId: string;
  movementType: InventoryLedgerMovementType;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  sourceType: InventoryLedgerSourceType;
  sourceId?: string;
  reason?: string;
  unitCost?: number;
  supplierName?: string;
  referenceNo?: string;
  createdAt: Timestamp;
  createdBy: string;
}
