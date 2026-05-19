import type { Timestamp } from 'firebase/firestore';

export type WarrantyClaimType = 'repair_issue' | 'part_failure' | 'other';

export type WarrantyClaimStatus =
  | 'created'
  | 'inspection'
  | 'approved'
  | 'rejected'
  | 'in_repair'
  | 'completed';

export interface WarrantyClaimHistoryItem {
  status: WarrantyClaimStatus;
  changedBy: string;
  changedByDisplayName: string;
  changedAt: Timestamp;
  note: string;
}

export interface WarrantyClaim {
  claimId: string;
  originalJobId: string;
  originalJobSheetNo: string;
  warrantyDocumentId: string;
  warrantyStartDate: Timestamp | null;
  warrantyEndDate: Timestamp | null;
  technicianId: string;
  branchId: string;
  customerName: string;
  deviceBrand: string;
  deviceModel: string;
  claimReason: string;
  claimType: WarrantyClaimType;
  status: WarrantyClaimStatus;
  inspectionNote: string;
  decisionNote: string;
  handledBy: string;
  handledByDisplayName: string;
  statusHistory: WarrantyClaimHistoryItem[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateWarrantyClaimInput {
  claimReason: string;
  claimType: WarrantyClaimType;
}
