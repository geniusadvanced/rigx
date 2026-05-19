import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db } from '@/lib/firebase/init';
import { assertCan, can } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import type { PartsOrder, PartsOrderFormInput } from '../types';

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function normalizeText(value: string): string {
  return value.trim();
}

function timestampFromDate(value: string): Timestamp | null {
  if (!value) return null;
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

function mapPartsOrder(partsOrderId: string, data: Record<string, unknown>): PartsOrder {
  return {
    ...(data as Omit<PartsOrder, 'partsOrderId'>),
    partsOrderId,
  };
}

function buildPayload(input: PartsOrderFormInput, role: UserData['role']) {
  const costPrice = role === 'technician' ? 0 : Number(input.costPrice || 0);
  const sellingPrice = role === 'technician' ? 0 : Number(input.sellingPrice || 0);

  if (!normalizeText(input.jobId)) throw new Error('Job is required');
  if (!normalizeText(input.partName)) throw new Error('Part name is required');
  if (!Number.isFinite(costPrice) || costPrice < 0) throw new Error('Cost price must be valid');
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw new Error('Selling price must be valid');

  return {
    jobId: normalizeText(input.jobId),
    branchId: normalizeText(input.branchId || ''),
    jobSheetNo: normalizeText(input.jobSheetNo),
    technicianId: normalizeText(input.technicianId),
    customerName: normalizeText(input.customerName),
    deviceBrand: normalizeText(input.deviceBrand),
    deviceModel: normalizeText(input.deviceModel),
    partName: normalizeText(input.partName),
    partCategory: input.partCategory,
    partDescription: normalizeText(input.partDescription),
    supplierName: role === 'technician' ? '' : normalizeText(input.supplierName),
    supplierContact: role === 'technician' ? '' : normalizeText(input.supplierContact),
    costPrice,
    sellingPrice,
    orderedDate: timestampFromDate(input.orderedDate),
    etaDate: role === 'technician' ? null : timestampFromDate(input.etaDate),
    arrivedDate: role === 'technician' ? null : timestampFromDate(input.arrivedDate),
    installedDate: role === 'technician' ? null : timestampFromDate(input.installedDate),
    status: role === 'technician' ? 'requested' : input.status,
    remarks: normalizeText(input.remarks),
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

function sortPartsOrders(orders: PartsOrder[]): PartsOrder[] {
  return [...orders].sort((left, right) => {
    const leftTime = left.updatedAt?.toMillis?.() || left.createdAt?.toMillis?.() || 0;
    const rightTime = right.updatedAt?.toMillis?.() || right.createdAt?.toMillis?.() || 0;
    return rightTime - leftTime;
  });
}

export async function getPartsOrdersForUser(user: UserData): Promise<PartsOrder[]> {
  assertCan(user.role, 'partsOrders.view');
  const partsOrdersRef = collection(db, 'partsOrders');
  const partsOrdersQuery =
    user.role === 'technician'
      ? query(partsOrdersRef, where('technicianId', '==', user.uid))
      : user.role === 'manager'
        ? query(partsOrdersRef, where('branchId', '==', user.branchId || ''))
      : partsOrdersRef;
  const snapshot = await getDocs(partsOrdersQuery);
  return sortPartsOrders(snapshot.docs.map((orderDoc) => mapPartsOrder(orderDoc.id, orderDoc.data())));
}

export async function getPartsOrdersByJob(jobId: string): Promise<PartsOrder[]> {
  const snapshot = await getDocs(query(collection(db, 'partsOrders'), where('jobId', '==', jobId)));
  return sortPartsOrders(snapshot.docs.map((orderDoc) => mapPartsOrder(orderDoc.id, orderDoc.data())));
}

export function inputFromJob(job: Job): Pick<
  PartsOrderFormInput,
  'jobId' | 'branchId' | 'jobSheetNo' | 'technicianId' | 'customerName' | 'deviceBrand' | 'deviceModel'
> {
  return {
    jobId: job.docId,
    branchId: job.branchId || '',
    jobSheetNo: job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || '',
    technicianId: job.technicianId,
    customerName: job.customerName || '',
    deviceBrand: job.deviceBrand || '',
    deviceModel: job.deviceModel || job.device || '',
  };
}

export async function createPartsOrder(input: PartsOrderFormInput, user: UserData): Promise<string> {
  // TODO RBAC MISMATCH:
  // Technicians may create assigned-job part requests, but the first RBAC permission list only has
  // global partsOrders.manage. Firestore rules must continue enforcing assigned-job linkage.
  if (!can(user.role, 'partsOrders.manage') && !can(user.role, 'partsOrders.view')) {
    assertCan(user.role, 'partsOrders.manage');
  }

  const payload = buildPayload(input, user.role);
  const orderRef = await addDoc(collection(db, 'partsOrders'), {
    ...payload,
    requestedBy: user.uid,
    requestedByDisplayName: displayNameForUser(user),
    approvedBy: payload.status === 'approved' ? user.uid : null,
    approvedByDisplayName: payload.status === 'approved' ? displayNameForUser(user) : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'parts_order',
    entityId: orderRef.id,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'jobSheetNo', before: null, after: payload.jobSheetNo },
      { field: 'partName', before: null, after: payload.partName },
      { field: 'status', before: null, after: payload.status },
    ],
    note: 'Parts order created',
  });

  return orderRef.id;
}

export async function updatePartsOrder(order: PartsOrder, input: PartsOrderFormInput, user: UserData): Promise<void> {
  assertCan(user.role, 'partsOrders.manage');
  const payload = buildPayload(input, user.role);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'partName', order.partName, payload.partName);
  addChange(changes, 'partCategory', order.partCategory, payload.partCategory);
  addChange(changes, 'partDescription', order.partDescription, payload.partDescription);
  addChange(changes, 'supplierName', order.supplierName, payload.supplierName);
  addChange(changes, 'supplierContact', order.supplierContact, payload.supplierContact);
  addChange(changes, 'costPrice', order.costPrice, payload.costPrice);
  addChange(changes, 'sellingPrice', order.sellingPrice, payload.sellingPrice);
  addChange(changes, 'status', order.status, payload.status);
  addChange(changes, 'remarks', order.remarks, payload.remarks);

  await updateDoc(doc(db, 'partsOrders', order.partsOrderId), {
    ...payload,
    approvedBy:
      payload.status === 'approved' && !order.approvedBy
        ? user.uid
        : order.approvedBy || null,
    approvedByDisplayName:
      payload.status === 'approved' && !order.approvedByDisplayName
        ? displayNameForUser(user)
        : order.approvedByDisplayName || null,
    requestedBy: order.requestedBy,
    requestedByDisplayName: order.requestedByDisplayName,
    createdAt: order.createdAt,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'parts_order',
      entityId: order.partsOrderId,
      action: order.status !== payload.status ? 'status_change' : 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: order.status !== payload.status ? 'Parts order status changed' : 'Parts order updated',
    });
  }
}

export async function deletePartsOrder(order: PartsOrder, user: UserData): Promise<void> {
  assertCan(user.role, 'partsOrders.manage');
  await deleteDoc(doc(db, 'partsOrders', order.partsOrderId));
}
