import type { Timestamp } from 'firebase/firestore';

export type PartCategory =
  | 'screen'
  | 'battery'
  | 'keyboard'
  | 'motherboard_component'
  | 'charger'
  | 'storage'
  | 'ram'
  | 'hinge'
  | 'casing'
  | 'other';

export type PartsOrderStatus = 'requested' | 'approved' | 'ordered' | 'arrived' | 'installed' | 'cancelled';

export interface PartsOrder {
  partsOrderId: string;
  jobId: string;
  branchId?: string;
  jobSheetNo: string;
  technicianId: string;
  customerName: string;
  deviceBrand: string;
  deviceModel: string;
  partName: string;
  partCategory: PartCategory;
  partDescription: string;
  supplierName: string;
  supplierContact: string;
  costPrice: number;
  sellingPrice: number;
  requestedBy: string;
  requestedByDisplayName: string;
  approvedBy: string | null;
  approvedByDisplayName: string | null;
  orderedDate: Timestamp | null;
  etaDate: Timestamp | null;
  arrivedDate: Timestamp | null;
  installedDate: Timestamp | null;
  status: PartsOrderStatus;
  remarks: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PartsOrderFormInput {
  jobId: string;
  branchId?: string;
  jobSheetNo: string;
  technicianId: string;
  customerName: string;
  deviceBrand: string;
  deviceModel: string;
  partName: string;
  partCategory: PartCategory;
  partDescription: string;
  supplierName: string;
  supplierContact: string;
  costPrice: string;
  sellingPrice: string;
  orderedDate: string;
  etaDate: string;
  arrivedDate: string;
  installedDate: string;
  status: PartsOrderStatus;
  remarks: string;
}
