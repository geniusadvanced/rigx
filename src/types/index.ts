import type { Timestamp } from 'firebase/firestore';

export type Role = 'admin' | 'manager' | 'technician';
export type JobCostProfile = 'parts_required' | 'service_only' | 'custom';
export type JobLifecycleStatus =
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
export type RepairLifecycleStatus =
  | 'received'
  | 'diagnosis'
  | 'quotation_pending'
  | 'quotation_sent'
  | 'customer_approved'
  | 'customer_rejected'
  | 'repair_in_progress'
  | 'repair_completed'
  | 'ready_for_pickup'
  | 'delivered'
  | 'warranty_active'
  | 'warranty_expired'
  | 'cancelled';
export type QuotationStatus = 'draft' | 'sent' | 'approved' | 'rejected';
export type JobPaymentStatus = 'unpaid' | 'deposit_paid' | 'partial_paid' | 'paid' | 'refunded';

export interface UserData {
  uid: string;
  staffId: string;
  email: string;
  name?: string;
  displayName: string;
  role: Role;
  branchId: string;
  isActive: boolean;
  baseSalary?: number;
  phone?: string;
  icNumber?: string;
  employmentType?: 'full_time' | 'part_time' | 'intern' | 'contract';
  approvedDeviceId: string;
}

export interface Job {
  docId: string;
  jobNo?: string;
  jobNumber?: string;
  agnJobNumber?: string;
  jobSheetNo?: string;
  customerName: string;
  customerPhone?: string;
  customerId?: string | null;
  customerNumber?: string;
  normalizedPhone?: string;
  device: string;
  deviceId?: string | null;
  deviceType?: string;
  deviceBrand?: string;
  deviceModel?: string;
  devicePassword?: string;
  serialNumber?: string;
  issueDescription?: string;
  totalSale: number;
  pricingMode?: 'diagnosis_first' | 'quote_now';
  quotedPriceItems?: Array<{
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
  }>;
  paymentStatus?: JobPaymentStatus | string;
  totalAmountDue?: number;
  totalPaid?: number;
  balanceDue?: number;
  discountAmount?: number;
  refundAmount?: number;
  lastPaymentAt?: Timestamp | null;
  technicianId: string;
  technicianName?: string;
  status:
    | 'pending'
    | 'in_progress'
    | 'done'
    | 'pending_approval'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | JobLifecycleStatus;
  lifecycleStatus?: RepairLifecycleStatus;
  lifecycleHistory?: Array<{
    status: RepairLifecycleStatus;
    changedBy: string;
    changedByDisplayName: string;
    changedAt: Timestamp;
    note: string;
    overrideUsed?: boolean;
  }>;
  receivedAt?: Timestamp | null;
  diagnosisStartedAt?: Timestamp | null;
  diagnosisCompletedAt?: Timestamp | null;
  customerApprovedAt?: Timestamp | null;
  customerRejectedAt?: Timestamp | null;
  repairStartedAt?: Timestamp | null;
  repairCompletedAt?: Timestamp | null;
  readyForPickupAt?: Timestamp | null;
  readyForPickupBy?: string;
  readyForPickupByDisplayName?: string;
  pickupNotifiedAt?: Timestamp | null;
  pickupNotifiedBy?: string;
  pickupNotifiedByDisplayName?: string;
  deliveredAt?: Timestamp | null;
  warrantyStartedAt?: Timestamp | null;
  warrantyExpiresAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  statusHistory?: Array<{
    status: JobLifecycleStatus;
    changedBy: string;
    changedByDisplayName: string;
    changedAt: Timestamp;
    note: string;
  }>;
  diagnosisNote?: string;
  diagnosisSummaryPublic?: string;
  repairSummaryPublic?: string;
  estimatedCompletionAt?: Timestamp | null;
  publicTrackingCode?: string;
  publicTrackingToken?: string;
  publicTrackingCreatedAt?: Timestamp | null;
  customerFirstTrackedAt?: Timestamp | null;
  customerLastTrackedAt?: Timestamp | null;
  customerTrackViewCount?: number;
  quotationAmount?: number;
  quotationId?: string;
  quotationNumber?: string;
  quotationNote?: string;
  quotationStatus?: QuotationStatus;
  quotationCreatedAt?: Timestamp | null;
  quotationCreatedBy?: string | null;
  quotationSentAt?: Timestamp | null;
  quotationApprovedAt?: Timestamp | null;
  quotationRejectedAt?: Timestamp | null;
  quotationApprovedBy?: string | null;
  quotationApprovedByDisplayName?: string | null;
  quotationRejectedReason?: string | null;
  quotationProofUrl?: string | null;
  customerApprovalStatus?: 'pending' | 'approved' | 'rejected';
  jobSheetConsentToken?: string;
  jobSheetConsentTokenCreatedAt?: Timestamp | null;
  jobSheetConsentStatus?: 'pending' | 'signed';
  jobSheetSignedAt?: Timestamp | null;
  jobSheetSignedBy?: string;
  jobSheetConsentMethod?: string;
  jobSheetTermsAccepted?: boolean;
  consentCompleted?: boolean;
  jobSheetManualConsent?: boolean;
  jobSheetManualConsentName?: string;
  jobSheetManualConsentPhone?: string;
  jobSheetManualConsentNotes?: string;
  jobSheetSigner?: {
    name?: string;
    icOrPassportNo?: string;
    phone?: string;
    signedDate?: string;
  };
  jobSheetSignature?: {
    signatureData?: string;
  };
  jobSheetConsentChecklist?: {
    inspectionDiagnosisAuthorised?: boolean;
    dataLossAcknowledged?: boolean;
    preExistingFaultAcknowledged?: boolean;
    electronicApprovalAccepted?: boolean;
    termsAccepted?: boolean;
  };
  repairNote?: string;
  qcNote?: string;
  collectionNote?: string;
  branchId?: string;
  costProfile?: JobCostProfile;
  requiredDocuments?: string[];
  approvalStatus: 'draft' | 'submitted' | 'approved' | 'rejected';
  commissionAmount: number;
  commissionStatus:
    | 'not_eligible'
    | 'pending_documents'
    | 'pending_approval'
    | 'approved'
    | 'paid';
}
