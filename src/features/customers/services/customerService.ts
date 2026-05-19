import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db } from '@/lib/firebase/init';
import { generateCustomerNumber } from '@/lib/numbering/publicNumberService';
import { assertCan, can } from '@/lib/rbac/can';
import { normalizeMalaysiaPhoneNumber } from '@/lib/utils/phone';
import type { Job, Role, UserData } from '@/types';
import type { Customer, CustomerBranch, CustomerFormInput, Device, DeviceFormInput } from '../types';

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function getUnknownErrorDetails(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode:
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined,
    errorString: String(error),
  };
}

function warnTechnicianAddJobDebug(payload: Record<string, unknown>) {
  console.warn('[TECHNICIAN ADD JOB DEBUG]', JSON.stringify(payload, null, 2));
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeBranch(value: CustomerBranch): CustomerBranch {
  if (value === 'cyberjaya' || value === 'bangi') return value;
  return 'unknown';
}

function normalizeUserBranch(value?: string | null): CustomerBranch | '' {
  const normalized = String(value || '').trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  if (compact === 'cyberjaya') return 'cyberjaya';
  if (compact === 'bangi') return 'bangi';
  return '';
}

export function normalizeCustomerPhone(phone?: string | null): string {
  return normalizeMalaysiaPhoneNumber(phone);
}

function mapCustomer(customerId: string, data: Record<string, unknown>): Customer {
  return {
    ...(data as Omit<Customer, 'customerId'>),
    customerId,
  };
}

function mapDevice(deviceId: string, data: Record<string, unknown>): Device {
  return {
    ...(data as Omit<Device, 'deviceId'>),
    deviceId,
  };
}

function buildCustomerPayload(input: CustomerFormInput) {
  if (!normalizeText(input.fullName)) throw new Error('Customer name is required');
  if (!normalizeText(input.phone)) throw new Error('Customer phone is required');

  return {
    fullName: normalizeText(input.fullName),
    phone: normalizeText(input.phone),
    normalizedPhone: normalizeCustomerPhone(input.phone),
    email: normalizeText(input.email),
    address: normalizeText(input.address),
    branch: normalizeBranch(input.branch),
  };
}

function buildDevicePayload(input: DeviceFormInput) {
  if (!normalizeText(input.customerId)) throw new Error('Customer is required');
  if (!normalizeText(input.customerName)) throw new Error('Customer name is required');
  if (!normalizeText(input.model)) throw new Error('Device model is required');

  return {
    customerId: normalizeText(input.customerId),
    customerName: normalizeText(input.customerName),
    deviceType: normalizeText(input.deviceType),
    brand: normalizeText(input.brand),
    model: normalizeText(input.model),
    serialNumber: normalizeText(input.serialNumber),
    imei: normalizeText(input.imei),
    notes: normalizeText(input.notes),
  };
}

function addChange(
  changes: Array<{ field: string; before: unknown; after: unknown }>,
  field: string,
  before: unknown,
  after: unknown,
) {
  if (before !== after) changes.push({ field, before, after });
}

export async function getCustomers(userOrRole: Role | UserData): Promise<Customer[]> {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role;
  const branchId = typeof userOrRole === 'string' ? '' : normalizeUserBranch(userOrRole.branchId);
  if (!can(role, 'customers.view') && !can(role, 'jobs.create')) assertCan(role, 'customers.view');
  if ((role === 'manager' || role === 'technician') && !branchId) {
    return [];
  }
  const customersQuery =
    branchId && (role === 'manager' || role === 'technician')
      ? query(collection(db, 'customers'), where('branch', '==', branchId))
      : collection(db, 'customers');
  const snapshot = await getDocs(customersQuery);
  return snapshot.docs
    .map((customerDoc) => mapCustomer(customerDoc.id, customerDoc.data()))
    .filter((customer) => customer.isDeleted !== true)
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function getDevices(role: Role): Promise<Device[]> {
  assertCan(role, 'devices.view');
  const snapshot = await getDocs(collection(db, 'devices'));
  return snapshot.docs
    .map((deviceDoc) => mapDevice(deviceDoc.id, deviceDoc.data()))
    .sort((left, right) => {
      const leftTime = left.updatedAt?.toMillis?.() || 0;
      const rightTime = right.updatedAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}

export async function getDevicesByCustomer(customerId: string, role: Role): Promise<Device[]> {
  assertCan(role, 'devices.view');
  const snapshot = await getDocs(query(collection(db, 'devices'), where('customerId', '==', customerId)));
  return snapshot.docs.map((deviceDoc) => mapDevice(deviceDoc.id, deviceDoc.data()));
}

export async function getJobsByCustomer(customerId: string, role: Role): Promise<Job[]> {
  assertCan(role, 'customers.view');
  const snapshot = await getDocs(query(collection(db, 'jobs'), where('customerId', '==', customerId)));
  return snapshot.docs.map((jobDoc) => ({
    docId: jobDoc.id,
    ...(jobDoc.data() as Omit<Job, 'docId'>),
  }));
}

export async function getJobsByDevice(deviceId: string, role: Role): Promise<Job[]> {
  assertCan(role, 'devices.view');
  const snapshot = await getDocs(query(collection(db, 'jobs'), where('deviceId', '==', deviceId)));
  return snapshot.docs.map((jobDoc) => ({
    docId: jobDoc.id,
    ...(jobDoc.data() as Omit<Job, 'docId'>),
  }));
}

export async function createCustomer(input: CustomerFormInput, user: UserData): Promise<string> {
  assertCan(user.role, 'customers.manage');
  const payload = buildCustomerPayload(input);
  const customerNumber = await generateCustomerNumber();
  const customerRef = await addDoc(collection(db, 'customers'), {
    ...payload,
    customerNumber,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'customer',
    entityId: customerRef.id,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'fullName', before: null, after: payload.fullName },
      { field: 'customerNumber', before: null, after: customerNumber },
      { field: 'phone', before: null, after: payload.phone },
      { field: 'branch', before: null, after: payload.branch },
    ],
    note: 'Customer created',
  });

  return customerRef.id;
}

export interface JobCustomerInput {
  customerId?: string | null;
  fullName: string;
  phone: string;
  email?: string;
  address?: string;
  branch: CustomerBranch;
}

export async function createOrUpdateCustomerFromJobInput(input: JobCustomerInput, user: UserData): Promise<Customer> {
  if (!can(user.role, 'customers.manage') && !can(user.role, 'jobs.create')) assertCan(user.role, 'customers.manage');
  const payload = buildCustomerPayload({
    fullName: input.fullName,
    phone: input.phone,
    email: input.email || '',
    address: input.address || '',
    branch: input.branch,
  });
  if (!payload.normalizedPhone) throw new Error('Customer phone is required');
  const userBranch = normalizeUserBranch(user.branchId);
  if ((user.role === 'manager' || user.role === 'technician') && userBranch && payload.branch !== userBranch) {
    throw new Error('Customer branch must match your branch');
  }

  let matchedCustomer: Customer | null = null;
  if (input.customerId) {
    const selectedSnapshot = await getDoc(doc(db, 'customers', input.customerId));
    if (selectedSnapshot.exists() && selectedSnapshot.data().isDeleted !== true) {
      matchedCustomer = mapCustomer(selectedSnapshot.id, selectedSnapshot.data());
    }
  }

  if (!matchedCustomer) {
    const customerLookup =
      user.role === 'admin'
        ? query(collection(db, 'customers'), where('normalizedPhone', '==', payload.normalizedPhone))
        : query(
          collection(db, 'customers'),
          where('normalizedPhone', '==', payload.normalizedPhone),
          where('branch', '==', payload.branch),
        );
    let snapshot = await getDocs(customerLookup);
    if (snapshot.empty) {
      const phoneFallback =
        user.role === 'admin'
          ? query(collection(db, 'customers'), where('phone', '==', payload.phone))
          : query(collection(db, 'customers'), where('phone', '==', payload.phone), where('branch', '==', payload.branch));
      snapshot = await getDocs(phoneFallback);
    }
    const matches = snapshot.docs
      .map((customerDoc) => mapCustomer(customerDoc.id, customerDoc.data()))
      .filter((customer) => customer.isDeleted !== true)
      .sort((left, right) => (right.updatedAt?.toMillis?.() || 0) - (left.updatedAt?.toMillis?.() || 0));
    if (matches.length > 1) {
      console.warn('[CUSTOMER PHONE DUPLICATE]', {
        normalizedPhone: payload.normalizedPhone,
        customerIds: matches.map((customer) => customer.customerId),
      });
    }
    matchedCustomer = matches[0] || null;
  }

  if (matchedCustomer) {
    if ((user.role === 'manager' || user.role === 'technician') && userBranch && matchedCustomer.branch !== userBranch) {
      throw new Error('Selected customer is outside your branch');
    }
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    const nextCustomerNumber = matchedCustomer.customerNumber || await generateCustomerNumber();
    if (!matchedCustomer.customerNumber) {
      updates.customerNumber = nextCustomerNumber;
      addChange(changes, 'customerNumber', '', nextCustomerNumber);
    }
    if (payload.fullName && payload.fullName !== matchedCustomer.fullName) {
      updates.fullName = payload.fullName;
      addChange(changes, 'fullName', matchedCustomer.fullName || '', payload.fullName);
    }
    if (payload.phone && payload.phone !== matchedCustomer.phone) {
      updates.phone = payload.phone;
      addChange(changes, 'phone', matchedCustomer.phone || '', payload.phone);
    }
    if (payload.normalizedPhone && payload.normalizedPhone !== matchedCustomer.normalizedPhone) {
      updates.normalizedPhone = payload.normalizedPhone;
      addChange(changes, 'normalizedPhone', matchedCustomer.normalizedPhone || '', payload.normalizedPhone);
    }
    if (payload.email && payload.email !== matchedCustomer.email) {
      updates.email = payload.email;
      addChange(changes, 'email', matchedCustomer.email || '', payload.email);
    }
    if (payload.address && payload.address !== matchedCustomer.address) {
      updates.address = payload.address;
      addChange(changes, 'address', matchedCustomer.address || '', payload.address);
    }
    if (payload.branch !== 'unknown' && payload.branch !== matchedCustomer.branch) {
      updates.branch = payload.branch;
      addChange(changes, 'branch', matchedCustomer.branch || 'unknown', payload.branch);
    }
    if (changes.length > 0) {
      try {
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:customerCreate:start',
          operation: 'updateDoc',
          firestorePath: `customers/${matchedCustomer.customerId}`,
          profileUid: user.uid,
          profileRole: user.role,
          rawProfileBranchId: user.branchId,
          customerPayloadBranch: payload.branch,
          payloadKeys: Object.keys(updates),
        });
        await updateDoc(doc(db, 'customers', matchedCustomer.customerId), updates);
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:customerCreate:success',
          operation: 'updateDoc',
          firestorePath: `customers/${matchedCustomer.customerId}`,
          profileUid: user.uid,
          profileRole: user.role,
          rawProfileBranchId: user.branchId,
          customerPayloadBranch: payload.branch,
          payloadKeys: Object.keys(updates),
        });
      } catch (error) {
        warnTechnicianAddJobDebug({
          checkpoint: 'addJob:customerCreate:failed',
          operation: 'updateDoc',
          firestorePath: `customers/${matchedCustomer.customerId}`,
          profileUid: user.uid,
          profileRole: user.role,
          rawProfileBranchId: user.branchId,
          customerPayloadBranch: payload.branch,
          payloadKeys: Object.keys(updates),
          ...getUnknownErrorDetails(error),
        });
        throw error;
      }
      await writeAuditLog({
        entityType: 'customer',
        entityId: matchedCustomer.customerId,
        action: 'update',
        changedBy: user.uid,
        changedByDisplayName: displayNameForUser(user),
        changes,
        note: 'Customer updated from Add Job flow',
      }).catch(() => undefined);
    }
    return {
      ...matchedCustomer,
      ...payload,
      customerNumber: nextCustomerNumber,
      customerId: matchedCustomer.customerId,
    };
  }

  let customerNumber = '';
  try {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:customerCreate:start',
      operation: 'customerNumber',
      firestorePath: 'counters/customerNumber_{year}',
      profileUid: user.uid,
      profileRole: user.role,
      rawProfileBranchId: user.branchId,
      customerPayloadBranch: payload.branch,
    });
    customerNumber = await generateCustomerNumber();
  } catch (error) {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:customerCreate:failed',
      operation: 'customerNumber',
      firestorePath: 'counters/customerNumber_{year}',
      profileUid: user.uid,
      profileRole: user.role,
      rawProfileBranchId: user.branchId,
      customerPayloadBranch: payload.branch,
      ...getUnknownErrorDetails(error),
    });
    throw error;
  }

  const customerPayload = {
    ...payload,
    customerNumber,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  let customerRef;
  try {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:customerCreate:start',
      operation: 'addDoc',
      firestorePath: 'customers/{autoId}',
      profileUid: user.uid,
      profileRole: user.role,
      rawProfileBranchId: user.branchId,
      customerPayloadBranch: payload.branch,
      payloadKeys: Object.keys(customerPayload),
    });
    customerRef = await addDoc(collection(db, 'customers'), customerPayload);
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:customerCreate:success',
      operation: 'addDoc',
      firestorePath: `customers/${customerRef.id}`,
      profileUid: user.uid,
      profileRole: user.role,
      rawProfileBranchId: user.branchId,
      customerPayloadBranch: payload.branch,
      payloadKeys: Object.keys(customerPayload),
    });
  } catch (error) {
    warnTechnicianAddJobDebug({
      checkpoint: 'addJob:customerCreate:failed',
      operation: 'addDoc',
      firestorePath: 'customers/{autoId}',
      profileUid: user.uid,
      profileRole: user.role,
      rawProfileBranchId: user.branchId,
      customerPayloadBranch: payload.branch,
      payloadKeys: Object.keys(customerPayload),
      ...getUnknownErrorDetails(error),
    });
    throw error;
  }
  await writeAuditLog({
    entityType: 'customer',
    entityId: customerRef.id,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'customerNumber', before: null, after: customerNumber },
      { field: 'fullName', before: null, after: payload.fullName },
      { field: 'phone', before: null, after: payload.phone },
      { field: 'branch', before: null, after: payload.branch },
    ],
    note: 'Customer created from Add Job flow',
  }).catch(() => undefined);
  return {
    customerId: customerRef.id,
    customerNumber,
    ...payload,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

export async function updateCustomer(customer: Customer, input: CustomerFormInput, user: UserData): Promise<void> {
  assertCan(user.role, 'customers.manage');
  const payload = buildCustomerPayload(input);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'fullName', customer.fullName || '', payload.fullName);
  addChange(changes, 'phone', customer.phone || '', payload.phone);
  addChange(changes, 'email', customer.email || '', payload.email);
  addChange(changes, 'address', customer.address || '', payload.address);
  addChange(changes, 'branch', customer.branch || 'unknown', payload.branch);

  await updateDoc(doc(db, 'customers', customer.customerId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'customer',
      entityId: customer.customerId,
      action: 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: 'Customer updated',
    });
  }
}

export async function softDeleteCustomer(customerId: string, reason: string, user: UserData): Promise<void> {
  assertCan(user.role, 'customers.manage');
  const customerRef = doc(db, 'customers', customerId);
  const snapshot = await getDoc(customerRef);
  if (!snapshot.exists()) throw new Error('Customer not found');
  const customer = mapCustomer(snapshot.id, snapshot.data());
  const deleteReason = normalizeText(reason || '');

  await updateDoc(customerRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: user.uid,
    deletedByName: displayNameForUser(user),
    deleteReason,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'customer',
    entityId: customerId,
    action: 'customer_deleted',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'customerId', before: customerId, after: customerId },
      { field: 'customerName', before: customer.fullName || '', after: customer.fullName || '' },
      { field: 'customerPhone', before: customer.phone || '', after: customer.phone || '' },
      { field: 'deleteReason', before: '', after: deleteReason },
      { field: 'isDeleted', before: customer.isDeleted === true, after: true },
    ],
    note: 'Customer soft deleted',
  });
}

export async function restoreCustomer(customerId: string, user: UserData): Promise<void> {
  assertCan(user.role, 'customers.manage');
  const customerRef = doc(db, 'customers', customerId);
  const snapshot = await getDoc(customerRef);
  if (!snapshot.exists()) throw new Error('Customer not found');
  const customer = mapCustomer(snapshot.id, snapshot.data());

  await updateDoc(customerRef, {
    isDeleted: false,
    restoredAt: serverTimestamp(),
    restoredBy: user.uid,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'customer',
    entityId: customerId,
    action: 'customer_restored',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'customerId', before: customerId, after: customerId },
      { field: 'customerName', before: customer.fullName || '', after: customer.fullName || '' },
      { field: 'customerPhone', before: customer.phone || '', after: customer.phone || '' },
      { field: 'isDeleted', before: customer.isDeleted === true, after: false },
    ],
    note: 'Customer restored',
  });
}

export async function createDevice(input: DeviceFormInput, user: UserData): Promise<string> {
  assertCan(user.role, 'devices.manage');
  const payload = buildDevicePayload(input);
  const deviceRef = await addDoc(collection(db, 'devices'), {
    ...payload,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'device',
    entityId: deviceRef.id,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'customerName', before: null, after: payload.customerName },
      { field: 'brand', before: null, after: payload.brand },
      { field: 'model', before: null, after: payload.model },
      { field: 'serialNumber', before: null, after: payload.serialNumber },
    ],
    note: 'Device created',
  });

  return deviceRef.id;
}

export async function updateDevice(device: Device, input: DeviceFormInput, user: UserData): Promise<void> {
  assertCan(user.role, 'devices.manage');
  const payload = buildDevicePayload(input);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'deviceType', device.deviceType || '', payload.deviceType);
  addChange(changes, 'brand', device.brand || '', payload.brand);
  addChange(changes, 'model', device.model || '', payload.model);
  addChange(changes, 'serialNumber', device.serialNumber || '', payload.serialNumber);
  addChange(changes, 'imei', device.imei || '', payload.imei);
  addChange(changes, 'notes', device.notes || '', payload.notes);

  await updateDoc(doc(db, 'devices', device.deviceId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'device',
      entityId: device.deviceId,
      action: 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: 'Device updated',
    });
  }
}
