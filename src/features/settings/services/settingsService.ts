import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { isAdmin } from '@/lib/rbac/can';
import type { UserData } from '@/types';
import type { AttendanceLocationSettings, BranchSettings, CompanyProfileSettings } from '../types';

export const CORE_BRANCH_IDS = ['bangi', 'cyberjaya'] as const;

const fallbackCoreBranches: BranchSettings[] = [
  {
    branchId: 'bangi',
    name: 'Genius Advanced Bangi',
    displayName: 'Bangi',
    address: '11-1-1B, Jalan Medan PB2A, Seksyen 9, Bandar Baru Bangi, 43650 Bangi, Selangor.',
    phone: '',
    whatsapp: '01114888499',
    email: 'hq.geniusadvanced@gmail.com',
    operatingHours: '',
    latitude: 2.962185,
    longitude: 101.756249,
    radiusInMeters: 500,
    isActive: true,
    managerId: '',
  },
  {
    branchId: 'cyberjaya',
    name: 'Genius Advanced Cyberjaya',
    displayName: 'Cyberjaya',
    address: 'GF-04 Menara Paragon Pangaea, Persiaran Bestari, Cyber 11, 63000 Cyberjaya, Selangor.',
    phone: '',
    whatsapp: '0199933371',
    email: 'geniuscyberjaya@gmail.com',
    operatingHours: '',
    latitude: 2.921989,
    longitude: 101.653872,
    radiusInMeters: 500,
    isActive: true,
    managerId: '',
  },
];

export const emptyCompanyProfileSettings: CompanyProfileSettings = {
  companyName: '',
  registrationNumber: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  logoUrl: '',
};

function assertAdmin(user: UserData | null | undefined): asserts user is UserData {
  if (!isAdmin(user?.role)) throw new Error('Admin access is required');
}

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

function toNullableNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeBranchId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function isCoreBranchId(branchId: string): boolean {
  return CORE_BRANCH_IDS.includes(branchId.toLowerCase() as (typeof CORE_BRANCH_IDS)[number]);
}

export function validateLatitude(latitude: number | null): boolean {
  return latitude !== null && latitude >= -90 && latitude <= 90;
}

export function validateLongitude(longitude: number | null): boolean {
  return longitude !== null && longitude >= -180 && longitude <= 180;
}

export function validateRadius(radiusInMeters: number | null): boolean {
  return radiusInMeters !== null && radiusInMeters > 0;
}

function mapCompanyProfile(data: Record<string, unknown> | undefined): CompanyProfileSettings {
  if (!data) return emptyCompanyProfileSettings;
  return {
    companyName: cleanText(data.companyName),
    registrationNumber: cleanText(data.registrationNumber),
    address: cleanText(data.address),
    phone: cleanText(data.phone),
    email: cleanText(data.email),
    website: cleanText(data.website),
    bankName: cleanText(data.bankName),
    bankAccountName: cleanText(data.bankAccountName),
    bankAccountNumber: cleanText(data.bankAccountNumber),
    logoUrl: cleanText(data.logoUrl),
    updatedAt: data.updatedAt as CompanyProfileSettings['updatedAt'],
    updatedBy: cleanText(data.updatedBy),
  };
}

function mapBranch(branchId: string, data: Record<string, unknown>): BranchSettings {
  return {
    branchId: cleanText(data.branchId) || branchId,
    name: cleanText(data.name),
    displayName: cleanText(data.displayName),
    address: cleanText(data.address),
    phone: cleanText(data.phone),
    whatsapp: cleanText(data.whatsapp),
    email: cleanText(data.email),
    operatingHours: cleanText(data.operatingHours),
    latitude: toNullableNumber((data.location as { latitude?: unknown } | undefined)?.latitude ?? data.latitude),
    longitude: toNullableNumber((data.location as { longitude?: unknown } | undefined)?.longitude ?? data.longitude),
    radiusInMeters: toNullableNumber(data.radiusInMeters ?? data.radiusMeters),
    isActive: data.isActive !== false && data.active !== false,
    managerId: cleanText(data.managerId),
    createdAt: data.createdAt as BranchSettings['createdAt'],
    updatedAt: data.updatedAt as BranchSettings['updatedAt'],
    updatedBy: cleanText(data.updatedBy),
  };
}

function mapAttendanceSettings(branchId: string, data: Record<string, unknown> | undefined): AttendanceLocationSettings {
  return {
    branchId,
    latitude: toNullableNumber(data?.latitude),
    longitude: toNullableNumber(data?.longitude),
    radiusInMeters: toNullableNumber(data?.radiusInMeters),
    clockInEnabled: data?.clockInEnabled !== false,
    allowOutsideRadiusWithReason: data?.allowOutsideRadiusWithReason === true,
    requireSelfie: data?.requireSelfie === true,
    updatedAt: data?.updatedAt as AttendanceLocationSettings['updatedAt'],
    updatedBy: cleanText(data?.updatedBy),
  };
}

export async function getCompanyProfileSettings(): Promise<CompanyProfileSettings> {
  const snapshot = await getDoc(doc(db, 'appSettings', 'companyProfile'));
  return mapCompanyProfile(snapshot.exists() ? snapshot.data() : undefined);
}

export async function saveCompanyProfileSettings(input: CompanyProfileSettings, user: UserData): Promise<void> {
  assertAdmin(user);
  await setDoc(
    doc(db, 'appSettings', 'companyProfile'),
    {
      companyName: cleanText(input.companyName),
      registrationNumber: cleanText(input.registrationNumber),
      address: cleanText(input.address),
      phone: cleanText(input.phone),
      email: cleanText(input.email),
      website: cleanText(input.website),
      bankName: cleanText(input.bankName),
      bankAccountName: cleanText(input.bankAccountName),
      bankAccountNumber: cleanText(input.bankAccountNumber),
      logoUrl: cleanText(input.logoUrl),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
}

export async function getBranchSettings(): Promise<BranchSettings[]> {
  const snapshot = await getDocs(collection(db, 'branches'));
  const branchesById = new Map(fallbackCoreBranches.map((branch) => [branch.branchId, branch]));
  snapshot.docs.forEach((branchDoc) => {
    const branch = mapBranch(branchDoc.id, branchDoc.data());
    branchesById.set(branch.branchId, branch);
  });
  return Array.from(branchesById.values())
    .sort((left, right) => left.branchId.localeCompare(right.branchId));
}

export async function saveBranchSettings(input: BranchSettings, user: UserData): Promise<void> {
  assertAdmin(user);
  const branchId = normalizeBranchId(input.branchId);
  if (!branchId) throw new Error('Branch ID is required');
  if (!cleanText(input.name)) throw new Error('Branch name is required');
  if (input.latitude !== null && !validateLatitude(input.latitude)) throw new Error('Latitude must be between -90 and 90');
  if (input.longitude !== null && !validateLongitude(input.longitude)) throw new Error('Longitude must be between -180 and 180');
  if (input.radiusInMeters !== null && !validateRadius(input.radiusInMeters)) throw new Error('Radius must be a positive number');
  if (isCoreBranchId(branchId) && input.isActive === false) throw new Error('Core Bangi and Cyberjaya branches cannot be deactivated');

  const branchRef = doc(db, 'branches', branchId);
  const existing = await getDoc(branchRef);
  await setDoc(
    branchRef,
    {
      branchId,
      name: cleanText(input.name),
      displayName: cleanText(input.displayName),
      address: cleanText(input.address),
      phone: cleanText(input.phone),
      whatsapp: cleanText(input.whatsapp),
      email: cleanText(input.email),
      operatingHours: cleanText(input.operatingHours),
      latitude: input.latitude,
      longitude: input.longitude,
      radiusInMeters: input.radiusInMeters,
      isActive: input.isActive !== false,
      managerId: cleanText(input.managerId),
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
}

export async function deactivateBranchSettings(branchId: string, user: UserData): Promise<void> {
  assertAdmin(user);
  const normalizedBranchId = normalizeBranchId(branchId);
  if (!normalizedBranchId) throw new Error('Branch ID is required');
  if (isCoreBranchId(normalizedBranchId)) throw new Error('Core Bangi and Cyberjaya branches cannot be deactivated');
  await updateDoc(doc(db, 'branches', normalizedBranchId), {
    isActive: false,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function getAttendanceLocationSettings(branchId: string): Promise<AttendanceLocationSettings> {
  const normalizedBranchId = normalizeBranchId(branchId);
  const snapshot = normalizedBranchId ? await getDoc(doc(db, 'attendanceSettings', normalizedBranchId)) : null;
  return mapAttendanceSettings(normalizedBranchId, snapshot?.exists() ? snapshot.data() : undefined);
}

export async function saveAttendanceLocationSettings(input: AttendanceLocationSettings, user: UserData): Promise<void> {
  assertAdmin(user);
  const branchId = normalizeBranchId(input.branchId);
  if (!branchId) throw new Error('Branch is required');
  if (!validateLatitude(input.latitude)) throw new Error('Latitude must be between -90 and 90');
  if (!validateLongitude(input.longitude)) throw new Error('Longitude must be between -180 and 180');
  if (!validateRadius(input.radiusInMeters)) throw new Error('Radius must be a positive number');

  await setDoc(
    doc(db, 'attendanceSettings', branchId),
    {
      branchId,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusInMeters: input.radiusInMeters,
      clockInEnabled: input.clockInEnabled !== false,
      allowOutsideRadiusWithReason: input.allowOutsideRadiusWithReason === true,
      requireSelfie: input.requireSelfie === true,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
}
