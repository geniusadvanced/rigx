import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import type {
  LeaveBalance,
  LeaveEntitlement,
  LeaveEntitlementType,
  LeaveRequest,
  LeaveType,
} from '../types';

const entitlementTypes: LeaveEntitlementType[] = ['annual', 'medical', 'emergency', 'others'];

function getCurrentYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
    }).format(new Date()),
  );
}

function getCurrentMonthNumber(): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      month: 'numeric',
    }).format(new Date()),
  );
}

function toFiniteNonNegativeNumber(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error('Leave entitlement must be a finite number greater than or equal to 0');
  }
  return numberValue;
}

function normalizeLeaveType(leaveType: LeaveType): LeaveEntitlementType | null {
  if (leaveType === 'annual' || leaveType === 'medical' || leaveType === 'emergency') return leaveType;
  if (leaveType === 'other') return 'others';
  return null;
}

function countInclusiveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function leaveTouchesYear(leave: LeaveRequest, year: number): boolean {
  return leave.startDate <= `${year}-12-31` && leave.endDate >= `${year}-01-01`;
}

function emptyEntitlement(technicianId: string): LeaveEntitlement {
  return {
    technicianId,
    annual: 0,
    medical: 0,
    emergency: 0,
    others: 0,
  };
}

function mapEntitlement(technicianId: string, data: Record<string, unknown>): LeaveEntitlement {
  return {
    technicianId,
    annual: Number(data.annual || 0),
    medical: Number(data.medical || 0),
    emergency: Number(data.emergency || 0),
    others: Number(data.others || 0),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    updatedAt: data.updatedAt as LeaveEntitlement['updatedAt'],
  };
}

export function calculateLeaveBalance(entitlement: LeaveEntitlement, approvedLeaves: LeaveRequest[]): LeaveBalance {
  const currentYear = getCurrentYear();
  const currentMonthNumber = getCurrentMonthNumber();
  const used: Record<LeaveEntitlementType, number> = {
    annual: 0,
    medical: 0,
    emergency: 0,
    others: 0,
  };

  approvedLeaves.forEach((leave) => {
    if (leave.status !== 'approved') return;
    const entitlementType = normalizeLeaveType(leave.leaveType);
    if (!entitlementType) return;
    if (entitlementType === 'annual' && !leaveTouchesYear(leave, currentYear)) return;
    used[entitlementType] += countInclusiveDays(leave.startDate, leave.endDate);
  });

  return entitlementTypes.reduce((balance, type) => {
    const total = entitlement[type] || 0;
    const available = type === 'annual' ? (total / 12) * currentMonthNumber : total;
    const usedDays = used[type] || 0;
    const rawRemaining = available - usedDays;
    return {
      ...balance,
      [type]: {
        type,
        entitlement: total,
        available,
        used: usedDays,
        remaining: Math.max(0, rawRemaining),
        overused: Math.max(0, usedDays - available),
      },
    };
  }, {} as LeaveBalance);
}

export async function getLeaveEntitlement(technicianId: string): Promise<LeaveEntitlement> {
  const snapshot = await getDoc(doc(db, 'leaveEntitlements', technicianId));
  if (!snapshot.exists()) return emptyEntitlement(technicianId);
  return mapEntitlement(technicianId, snapshot.data());
}

export async function getAllLeaveEntitlements(): Promise<LeaveEntitlement[]> {
  const snapshot = await getDocs(collection(db, 'leaveEntitlements'));
  return snapshot.docs.map((entitlementDoc) => mapEntitlement(entitlementDoc.id, entitlementDoc.data()));
}

export async function saveLeaveEntitlement(input: LeaveEntitlement & { updatedBy: string }): Promise<void> {
  if (!input.technicianId) throw new Error('Technician is required');

  await setDoc(
    doc(db, 'leaveEntitlements', input.technicianId),
    {
      technicianId: input.technicianId,
      annual: toFiniteNonNegativeNumber(input.annual),
      medical: toFiniteNonNegativeNumber(input.medical),
      emergency: toFiniteNonNegativeNumber(input.emergency),
      others: toFiniteNonNegativeNumber(input.others),
      updatedBy: input.updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getApprovedLeavesForTechnician(technicianId: string): Promise<LeaveRequest[]> {
  const snapshot = await getDocs(
    query(collection(db, 'leaves'), where('technicianId', '==', technicianId), where('status', '==', 'approved')),
  );
  return snapshot.docs.map((leaveDoc) => ({
    ...(leaveDoc.data() as Omit<LeaveRequest, 'leaveId'>),
    leaveId: leaveDoc.id,
  }));
}

export async function getMyLeaveBalance(technicianId: string): Promise<LeaveBalance> {
  const [entitlement, leaves] = await Promise.all([
    getLeaveEntitlement(technicianId),
    getApprovedLeavesForTechnician(technicianId),
  ]);
  return calculateLeaveBalance(entitlement, leaves);
}

export { entitlementTypes };
