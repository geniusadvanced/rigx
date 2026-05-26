import type { Timestamp } from 'firebase/firestore';

export type CustomerBranch = 'cyberjaya' | 'bangi' | 'unknown';
export type CustomerSource = 'manual' | 'job' | 'pos' | 'invoice' | 'quotation' | 'warranty' | 'payment' | 'import';

export interface Customer {
  customerId: string;
  customerNumber?: string;
  fullName: string;
  phone: string;
  normalizedPhone?: string;
  secondaryPhone?: string;
  email: string;
  address: string;
  branch: CustomerBranch;
  source?: CustomerSource | string;
  sources?: string[];
  notes?: string;
  tags?: string[];
  lastJobId?: string;
  lastJobNo?: string;
  lastJobNumber?: string;
  lastJobReference?: string;
  lastInvoiceId?: string;
  lastVisitAt?: Timestamp;
  totalJobs?: number;
  totalSpent?: number;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  deletedByName?: string;
  deleteReason?: string;
  restoredAt?: Timestamp;
  restoredBy?: string;
}

export interface Device {
  deviceId: string;
  customerId: string;
  customerName: string;
  deviceType: string;
  brand: string;
  model: string;
  serialNumber: string;
  imei: string;
  notes: string;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CustomerFormInput {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  branch: CustomerBranch;
}

export interface DeviceFormInput {
  customerId: string;
  customerName: string;
  deviceType: string;
  brand: string;
  model: string;
  serialNumber: string;
  imei: string;
  notes: string;
}
