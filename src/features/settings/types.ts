import type { Timestamp } from 'firebase/firestore';

export interface CompanyProfileSettings {
  companyName: string;
  registrationNumber: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  logoUrl?: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface BranchSettings {
  branchId: string;
  name: string;
  displayName: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  operatingHours: string;
  latitude: number | null;
  longitude: number | null;
  radiusInMeters: number | null;
  isActive: boolean;
  managerId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface AttendanceLocationSettings {
  branchId: string;
  latitude: number | null;
  longitude: number | null;
  radiusInMeters: number | null;
  clockInEnabled: boolean;
  allowOutsideRadiusWithReason: boolean;
  requireSelfie: boolean;
  updatedAt?: Timestamp;
  updatedBy?: string;
}
