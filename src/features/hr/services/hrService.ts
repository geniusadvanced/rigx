import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { Role } from '@/types';
import type { StaffProfile, StaffProfileCreate, StaffProfileUpdate } from '../types';
import {
  assertPayrollCriticalFieldsForActiveTechnician,
  assertValidBaseSalary,
  assertValidStaffProfileCreate,
  assertValidStaffProfileUpdate,
} from '../utils/staffValidation';

interface CreateStaffProfileParams {
  staff: StaffProfileCreate;
  createdBy: string;
  createdByRole: Role;
}

interface UpdateStaffProfileParams {
  uid: string;
  update: StaffProfileUpdate;
  updatedBy: string;
  updatedByRole: Role;
}

interface UpdateStaffSalaryParams {
  uid: string;
  baseSalary: number;
  updatedBy: string;
  updatedByRole: Role;
}

interface DeactivateStaffParams {
  uid: string;
  deactivatedBy: string;
  deactivatedByRole: Role;
}

interface RecordInviteFallbackSentParams {
  uid: string;
  sentBy: string;
  sentByRole: Role;
  email: string;
}

function createAuditRef() {
  return doc(collection(db, 'audit_logs'));
}

function mapStaffDocument(uid: string, data: Record<string, unknown>): StaffProfile {
  const name = String(data.name || data.displayName || '');

  return {
    ...(data as Omit<StaffProfile, 'uid' | 'name' | 'baseSalary'>),
    uid,
    name,
    baseSalary: Number(data.baseSalary || 0),
  };
}

export async function createStaffProfile(params: CreateStaffProfileParams): Promise<StaffProfile> {
  assertCan(params.createdByRole, 'hr.manage');
  const staffInput: StaffProfileCreate = {
    ...params.staff,
    staffId: params.staff.staffId.trim(),
    name: params.staff.name.trim(),
    email: params.staff.email.trim(),
    branchId: params.staff.branchId.trim(),
    baseSalary: Number(params.staff.baseSalary),
    phone: params.staff.phone?.trim() || '',
    icNumber: params.staff.icNumber?.trim() || '',
    isActive: params.staff.isActive ?? true,
  };

  assertValidStaffProfileCreate(staffInput);

  const staffRef = staffInput.uid?.trim()
    ? doc(db, 'users', staffInput.uid.trim())
    : doc(collection(db, 'users'));

  await runTransaction(db, async (transaction) => {
    const existingStaff = await transaction.get(staffRef);

    if (existingStaff.exists()) {
      throw new Error('Staff profile already exists for this UID');
    }

    const staffPayload = {
      uid: staffRef.id,
      staffId: staffInput.staffId,
      name: staffInput.name,
      displayName: staffInput.name,
      email: staffInput.email,
      role: staffInput.role,
      branchId: staffInput.branchId,
      isActive: staffInput.isActive,
      baseSalary: staffInput.baseSalary,
      phone: staffInput.phone || '',
      icNumber: staffInput.icNumber || '',
      employmentType: staffInput.employmentType || '',
      ...(staffInput.joinedAt ? { joinedAt: Timestamp.fromDate(new Date(`${staffInput.joinedAt}T00:00:00`)) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(staffRef, staffPayload);

    transaction.set(createAuditRef(), {
      actorId: params.createdBy,
      action: 'hr.staff_created',
      targetCollection: 'users',
      targetId: staffRef.id,
      userId: params.createdBy,
      staffUid: staffRef.id,
      generatedAt: serverTimestamp(),
      metadata: {
        staffId: staffInput.staffId,
        role: staffInput.role,
        branchId: staffInput.branchId,
        isActive: staffInput.isActive,
        baseSalary: staffInput.baseSalary,
      },
      createdAt: serverTimestamp(),
    });
  });

  return {
    uid: staffRef.id,
    staffId: staffInput.staffId,
    name: staffInput.name,
    displayName: staffInput.name,
    email: staffInput.email,
    role: staffInput.role,
    branchId: staffInput.branchId,
    isActive: staffInput.isActive,
    baseSalary: staffInput.baseSalary,
    phone: staffInput.phone,
    icNumber: staffInput.icNumber,
    employmentType: staffInput.employmentType,
  };
}

export async function getStaffList(): Promise<StaffProfile[]> {
  const snapshot = await getDocs(query(collection(db, 'users'), orderBy('staffId')));
  return snapshot.docs
    .map((staffDoc) => mapStaffDocument(staffDoc.id, staffDoc.data()))
    .filter((staff) => staff.deleted !== true);
}

export async function getStaffById(uid: string): Promise<StaffProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return null;
  return mapStaffDocument(snapshot.id, snapshot.data());
}

export async function updateStaffProfile(params: UpdateStaffProfileParams): Promise<void> {
  assertCan(params.updatedByRole, 'hr.manage');
  const staffRef = doc(db, 'users', params.uid);

  await runTransaction(db, async (transaction) => {
    const staffSnapshot = await transaction.get(staffRef);

    if (!staffSnapshot.exists()) {
      throw new Error('Staff profile not found');
    }

    const existingStaff = mapStaffDocument(staffSnapshot.id, staffSnapshot.data());
    assertValidStaffProfileUpdate(params.update, existingStaff.baseSalary);

    transaction.update(staffRef, {
      staffId: params.update.staffId.trim(),
      name: params.update.name.trim(),
      displayName: params.update.name.trim(),
      email: params.update.email.trim(),
      role: params.update.role,
      branchId: params.update.branchId.trim(),
      isActive: params.update.isActive,
      phone: params.update.phone?.trim() || '',
      icNumber: params.update.icNumber?.trim() || '',
      employmentType: params.update.employmentType || '',
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.updatedBy,
      action: 'hr.staff_updated',
      targetCollection: 'users',
      targetId: params.uid,
      userId: params.updatedBy,
      staffUid: params.uid,
      generatedAt: serverTimestamp(),
      metadata: {
        previousRole: existingStaff.role,
        nextRole: params.update.role,
        previousIsActive: existingStaff.isActive,
        nextIsActive: params.update.isActive,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function updateStaffSalary(params: UpdateStaffSalaryParams): Promise<void> {
  assertCan(params.updatedByRole, 'hr.manage');
  assertValidBaseSalary(params.baseSalary);

  const staffRef = doc(db, 'users', params.uid);

  await runTransaction(db, async (transaction) => {
    const staffSnapshot = await transaction.get(staffRef);

    if (!staffSnapshot.exists()) {
      throw new Error('Staff profile not found');
    }

    const existingStaff = mapStaffDocument(staffSnapshot.id, staffSnapshot.data());
    assertPayrollCriticalFieldsForActiveTechnician({
      ...existingStaff,
      baseSalary: params.baseSalary,
    });

    transaction.update(staffRef, {
      baseSalary: params.baseSalary,
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.updatedBy,
      action: 'hr.salary_updated',
      targetCollection: 'users',
      targetId: params.uid,
      userId: params.updatedBy,
      staffUid: params.uid,
      generatedAt: serverTimestamp(),
      metadata: {
        previousBaseSalary: existingStaff.baseSalary,
        nextBaseSalary: params.baseSalary,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function deactivateStaff(params: DeactivateStaffParams): Promise<void> {
  assertCan(params.deactivatedByRole, 'hr.manage');
  const staffRef = doc(db, 'users', params.uid);

  await runTransaction(db, async (transaction) => {
    const staffSnapshot = await transaction.get(staffRef);

    if (!staffSnapshot.exists()) {
      throw new Error('Staff profile not found');
    }

    transaction.update(staffRef, {
      isActive: false,
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.deactivatedBy,
      action: 'hr.staff_deactivated',
      targetCollection: 'users',
      targetId: params.uid,
      userId: params.deactivatedBy,
      staffUid: params.uid,
      generatedAt: serverTimestamp(),
      metadata: {},
      createdAt: serverTimestamp(),
    });
  });
}

export async function recordStaffInviteFallbackSent(params: RecordInviteFallbackSentParams): Promise<void> {
  assertCan(params.sentByRole, 'hr.manage');

  await updateDoc(doc(db, 'users', params.uid), {
    inviteEmailSent: true,
    inviteEmailStatus: 'sent',
    inviteEmailSentAt: serverTimestamp(),
    inviteEmailFallbackProvider: 'firebase_password_reset',
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'audit_logs'), {
    actorId: params.sentBy,
    action: 'hr.invite_sent',
    targetCollection: 'users',
    targetId: params.uid,
    userId: params.sentBy,
    staffUid: params.uid,
    generatedAt: serverTimestamp(),
    metadata: {
      email: params.email,
      fallbackProvider: 'firebase_password_reset',
    },
    createdAt: serverTimestamp(),
  });
}
