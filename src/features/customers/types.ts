import type { Timestamp } from 'firebase/firestore';

export type CustomerBranch = 'cyberjaya' | 'bangi' | 'unknown';

export interface Customer {
  customerId: string;
  customerNumber?: string;
  fullName: string;
  phone: string;
  normalizedPhone?: string;
  email: string;
  address: string;
  branch: CustomerBranch;
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
