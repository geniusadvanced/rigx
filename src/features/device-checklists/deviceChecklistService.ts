import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import type { Customer, Device } from '@/features/customers/types';
import { getDisplayJobNumber } from '@/features/jobs/services/jobService';
import { buildWaMeLink } from '@/features/pos/whatsappService';
import { db } from '@/lib/firebase/init';
import { can } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import {
  createDefaultAccessories,
  createDefaultAfterRepairTestedItems,
  createDefaultChecklistItems,
  createDefaultInternalComponents,
  normalizeAccessories,
  normalizeAfterRepairTestedItems,
  normalizeChecklistItems,
  normalizeInternalComponents,
  type AfterRepairTestedItem,
  type DeviceChecklist,
  type DeviceChecklistAccessory,
  type DeviceChecklistInternalComponents,
  type DeviceChecklistItem,
} from './types';

const defaultDisclaimer = 'Customer acknowledges that the device condition above was checked and recorded before service. Some hidden issues may only be found after inspection or during the repair process.';
const verificationText = 'Auto verified by RIGX System';

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || user.email || 'Unknown User';
}

function mapChecklist(checklistId: string, data: Record<string, unknown>): DeviceChecklist {
  return {
    ...(data as Omit<DeviceChecklist, 'checklistId'>),
    checklistId,
    items: normalizeChecklistItems(data.items),
    accessories: normalizeAccessories(data.accessories, typeof data.accessoriesReceived === 'string' ? data.accessoriesReceived : ''),
    internalComponents: normalizeInternalComponents(data.internalComponents, typeof data.internalComponentInventory === 'string' ? data.internalComponentInventory : ''),
    testedItems: normalizeAfterRepairTestedItems(data.testedItems),
    disclaimer: typeof data.disclaimer === 'string' && data.disclaimer ? data.disclaimer : defaultDisclaimer,
  };
}

function secureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type DeviceChecklistJobLookup = {
  jobId: string;
  user: UserData;
  jobBranchId?: string;
  jobTechnicianId?: string;
};

function canManageChecklist(job: Job, user: UserData): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'manager') return !user.branchId || job.branchId === user.branchId;
  return job.technicianId === user.uid;
}

function deviceBrandModelFromJob(job: Job): string {
  return [job.deviceBrand, job.deviceModel || job.device].filter(Boolean).join(' ') || job.device || '';
}

function snapshotFromJob(job: Job, customer?: Customer | null, device?: Device | null) {
  return {
    jobId: job.docId,
    jobNumber: getDisplayJobNumber(job),
    customerId: customer?.customerId || job.customerId || '',
    customerNameSnapshot: customer?.fullName || job.customerName || '',
    customerPhoneSnapshot: customer?.phone || job.customerPhone || '',
    customerEmailSnapshot: customer?.email || (job as Job & { customerEmail?: string }).customerEmail || '',
    deviceId: device?.deviceId || job.deviceId || '',
    deviceCategorySnapshot: device?.deviceType || job.deviceType || job.device || '',
    deviceBrandModelSnapshot: device ? [device.brand, device.model].filter(Boolean).join(' ') : deviceBrandModelFromJob(job),
    deviceSerialOrImeiSnapshot: device?.serialNumber || device?.imei || job.serialNumber || '',
    reportedIssueSnapshot: job.issueDescription || '',
    branchId: job.branchId || '',
    assignedTechnicianId: job.technicianId || '',
    assignedTechnicianName: job.technicianName || '',
  };
}

function latestChecklistFromSnapshot(snapshot: QuerySnapshot<DocumentData>, checklistType: 'pre_repair' | 'after_repair' = 'pre_repair'): DeviceChecklist | null {
  const rows = snapshot.docs
    .map((row) => mapChecklist(row.id, row.data()))
    .filter((checklist) => checklistType === 'pre_repair'
      ? !checklist.checklistType || checklist.checklistType === 'pre_repair'
      : checklist.checklistType === checklistType);
  return rows.sort((left, right) => (right.updatedAt?.toMillis?.() || 0) - (left.updatedAt?.toMillis?.() || 0))[0] || null;
}

async function queryLatestDeviceChecklist(filters: QueryConstraint[], checklistType: 'pre_repair' | 'after_repair' = 'pre_repair'): Promise<DeviceChecklist | null> {
  const snapshot = await getDocs(query(collection(db, 'deviceChecklists'), ...filters));
  return latestChecklistFromSnapshot(snapshot, checklistType);
}

export async function getDeviceChecklistByJob({
  jobId,
  user,
  jobBranchId,
  jobTechnicianId,
}: DeviceChecklistJobLookup): Promise<DeviceChecklist | null> {
  if (!can(user.role, 'jobs.view.all') && !can(user.role, 'jobs.view.assigned')) throw new Error('Job access required');

  if (user.role === 'manager') {
    return queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('branchId', '==', user.branchId),
    ]);
  }

  if (user.role === 'technician') {
    const assignedChecklist = await queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('assignedTechnicianId', '==', user.uid),
    ]);
    if (assignedChecklist || jobTechnicianId !== user.uid || !jobBranchId) return assignedChecklist;

    try {
      return await queryLatestDeviceChecklist([
        where('jobId', '==', jobId),
        where('branchId', '==', jobBranchId),
      ]);
    } catch {
      return null;
    }
  }

  if (jobBranchId) {
    return queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('branchId', '==', jobBranchId),
    ]);
  }

  return queryLatestDeviceChecklist([where('jobId', '==', jobId)]);
}

export async function getAfterRepairChecklistByJob({
  jobId,
  user,
  jobBranchId,
  jobTechnicianId,
}: DeviceChecklistJobLookup): Promise<DeviceChecklist | null> {
  if (!can(user.role, 'jobs.view.all') && !can(user.role, 'jobs.view.assigned')) throw new Error('Job access required');

  if (user.role === 'manager') {
    return queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('branchId', '==', user.branchId),
    ], 'after_repair');
  }

  if (user.role === 'technician') {
    const assignedChecklist = await queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('assignedTechnicianId', '==', user.uid),
    ], 'after_repair');
    if (assignedChecklist || jobTechnicianId !== user.uid || !jobBranchId) return assignedChecklist;

    try {
      return await queryLatestDeviceChecklist([
        where('jobId', '==', jobId),
        where('branchId', '==', jobBranchId),
      ], 'after_repair');
    } catch {
      return null;
    }
  }

  if (jobBranchId) {
    return queryLatestDeviceChecklist([
      where('jobId', '==', jobId),
      where('branchId', '==', jobBranchId),
    ], 'after_repair');
  }

  return queryLatestDeviceChecklist([where('jobId', '==', jobId)], 'after_repair');
}

export async function createDeviceChecklistFromJob(
  job: Job,
  user: UserData,
  input: {
    customer?: Customer | null;
    device?: Device | null;
    items?: DeviceChecklistItem[];
    accessories?: DeviceChecklistAccessory[];
    internalComponents?: DeviceChecklistInternalComponents;
    externalConditionSummary?: string;
    functionalChecklist?: string;
    accessoriesReceived?: string;
    internalComponentInventory?: string;
  } = {},
): Promise<string> {
  if (!canManageChecklist(job, user)) throw new Error('You do not have permission to create this device checklist');
  const snapshot = snapshotFromJob(job, input.customer, input.device);
  const checklistRef = await addDoc(collection(db, 'deviceChecklists'), {
    ...snapshot,
    checklistType: 'pre_repair',
    importedFromJob: true,
    importedFromCustomer: Boolean(input.customer?.customerId || job.customerId),
    importedFromDevice: Boolean(input.device?.deviceId || job.deviceId),
    items: normalizeChecklistItems(input.items || createDefaultChecklistItems()),
    accessories: normalizeAccessories(input.accessories || createDefaultAccessories(), input.accessoriesReceived),
    internalComponents: normalizeInternalComponents(input.internalComponents || createDefaultInternalComponents(), input.internalComponentInventory),
    externalConditionSummary: input.externalConditionSummary || '',
    functionalChecklist: input.functionalChecklist || '',
    accessoriesReceived: input.accessoriesReceived || (job as Job & { accessoriesReceived?: string }).accessoriesReceived || '',
    internalComponentInventory: input.internalComponentInventory || '',
    disclaimer: defaultDisclaimer,
    checklistStatus: 'draft',
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'device_checklist',
    entityId: checklistRef.id,
    action: 'device_checklist_imported_customer',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'customerId', before: null, after: snapshot.customerId || 'snapshot_only' }],
    note: 'Device checklist created with imported job/customer/device snapshot',
  });
  if (snapshot.deviceId) {
    await writeAuditLog({
      entityType: 'device_checklist',
      entityId: checklistRef.id,
      action: 'device_checklist_imported_device',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes: [{ field: 'deviceId', before: null, after: snapshot.deviceId }],
      note: 'Device details imported into checklist',
    });
  }
  return checklistRef.id;
}

export async function completeAfterRepairChecklist(
  job: Job,
  user: UserData,
  input: {
    checklist?: DeviceChecklist | null;
    testedItems: AfterRepairTestedItem[];
    remarks?: string;
  },
): Promise<string> {
  if (!canManageChecklist(job, user)) throw new Error('You do not have permission to complete this after repair checklist');
  const snapshot = snapshotFromJob(job);
  const normalizedItems = normalizeAfterRepairTestedItems(input.testedItems || createDefaultAfterRepairTestedItems());
  const issueItem = normalizedItems.find((item) => item.status === 'issue');
  if (issueItem) throw new Error(`${issueItem.label} must be resolved or marked N/A before Ready for Pickup.`);
  const now = serverTimestamp();
  const remarks = String(input.remarks || '').trim();
  let checklistId = input.checklist?.checklistId || '';

  if (!checklistId) {
    const checklistRef = await addDoc(collection(db, 'deviceChecklists'), {
      ...snapshot,
      checklistType: 'after_repair',
      importedFromJob: true,
      importedFromCustomer: Boolean(snapshot.customerId),
      importedFromDevice: Boolean(snapshot.deviceId),
      items: [],
      accessories: [],
      internalComponents: {},
      externalConditionSummary: '',
      functionalChecklist: '',
      accessoriesReceived: (job as Job & { accessoriesReceived?: string }).accessoriesReceived || '',
      internalComponentInventory: '',
      disclaimer: defaultDisclaimer,
      checklistStatus: 'draft',
      testedItems: normalizedItems,
      remarks,
      technicianId: user.uid,
      createdBy: user.uid,
      createdByDisplayName: displayNameForUser(user),
      createdAt: now,
      updatedAt: now,
    });
    checklistId = checklistRef.id;
  }

  await updateDoc(doc(db, 'deviceChecklists', checklistId), {
    ...snapshot,
    checklistType: 'after_repair',
    importedFromJob: true,
    importedFromCustomer: Boolean(snapshot.customerId),
    importedFromDevice: Boolean(snapshot.deviceId),
    checklistStatus: 'completed',
    testedItems: normalizedItems,
    remarks,
    technicianId: user.uid,
    completedAt: serverTimestamp(),
    technicianVerification: {
      technicianId: job.technicianId || user.uid,
      technicianName: displayNameForUser(user),
      technicianRole: user.role,
      branchId: user.branchId || job.branchId || '',
      checkedAt: serverTimestamp(),
      authUid: user.uid,
      verificationText,
    },
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'device_checklist',
    entityId: checklistId,
    action: 'device_checklist_final_checked',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'checklistType', before: input.checklist?.checklistType || null, after: 'after_repair' }],
    note: 'After Repair Checklist completed before Ready for Pickup',
  }).catch(() => undefined);

  return checklistId;
}

export async function updateDeviceChecklistStaffDetails(
  checklist: DeviceChecklist,
  job: Job,
  user: UserData,
  input: {
    customer?: Customer | null;
    device?: Device | null;
    items: DeviceChecklistItem[];
    accessories: DeviceChecklistAccessory[];
    internalComponents: DeviceChecklistInternalComponents;
    externalConditionSummary: string;
    functionalChecklist: string;
    accessoriesReceived: string;
    internalComponentInventory: string;
    completeByStaff?: boolean;
  },
): Promise<void> {
  if (!canManageChecklist(job, user)) throw new Error('You do not have permission to update this device checklist');
  const snapshot = snapshotFromJob(job, input.customer, input.device);
  const updatePayload: Record<string, unknown> = {
    ...snapshot,
    importedFromCustomer: Boolean(input.customer?.customerId || snapshot.customerId),
    importedFromDevice: Boolean(input.device?.deviceId || snapshot.deviceId),
    items: normalizeChecklistItems(input.items),
    accessories: normalizeAccessories(input.accessories, input.accessoriesReceived),
    internalComponents: normalizeInternalComponents(input.internalComponents, input.internalComponentInventory),
    externalConditionSummary: input.externalConditionSummary.trim(),
    functionalChecklist: input.functionalChecklist.trim(),
    accessoriesReceived: input.accessoriesReceived.trim(),
    internalComponentInventory: input.internalComponentInventory.trim(),
    checklistStatus: input.completeByStaff ? 'staff_completed' : 'draft',
    updatedAt: serverTimestamp(),
  };

  if (input.completeByStaff) {
    updatePayload.technicianVerification = {
      technicianId: job.technicianId || user.uid,
      technicianName: displayNameForUser(user),
      technicianRole: user.role,
      branchId: user.branchId || job.branchId || '',
      checkedAt: serverTimestamp(),
      authUid: user.uid,
      verificationText,
    };
  }

  await updateDoc(doc(db, 'deviceChecklists', checklist.checklistId), updatePayload);
}

export async function ensureDeviceChecklistSignatureToken(
  checklist: DeviceChecklist,
  job: Job,
  user: UserData,
): Promise<string> {
  if (!canManageChecklist(job, user)) throw new Error('You do not have permission to send this checklist');
  if (checklist.publicSignatureToken) return checklist.publicSignatureToken;
  const token = secureToken();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14));
  await updateDoc(doc(db, 'deviceChecklists', checklist.checklistId), {
    publicSignatureToken: token,
    publicSignatureTokenCreatedAt: serverTimestamp(),
    publicSignatureTokenExpiresAt: expiresAt,
    checklistStatus: checklist.checklistStatus === 'draft' ? 'staff_completed' : checklist.checklistStatus,
    updatedAt: serverTimestamp(),
  });
  return token;
}

export async function markDeviceChecklistSentWhatsApp(
  checklist: DeviceChecklist,
  job: Job,
  user: UserData,
): Promise<void> {
  if (!canManageChecklist(job, user)) throw new Error('You do not have permission to send this checklist');
  await updateDoc(doc(db, 'deviceChecklists', checklist.checklistId), {
    checklistStatus: 'sent_to_customer',
    sentToCustomerAt: serverTimestamp(),
    sentToCustomerBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'device_checklist',
    entityId: checklist.checklistId,
    action: 'device_checklist_sent_whatsapp',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'checklistStatus', before: checklist.checklistStatus, after: 'sent_to_customer' }],
    note: 'Device checklist signature link sent through WhatsApp fallback',
  });
}

export async function overrideDeviceChecklistSignature(
  checklist: DeviceChecklist,
  job: Job,
  user: UserData,
  reason: string,
): Promise<void> {
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Admin or manager access required');
  if (user.role === 'manager' && user.branchId && job.branchId !== user.branchId) throw new Error('Manager can only override own branch checklists');
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('Override reason is required');
  await updateDoc(doc(db, 'deviceChecklists', checklist.checklistId), {
    checklistStatus: 'signature_overridden',
    overrideBy: user.uid,
    overrideAt: serverTimestamp(),
    overrideReason: cleanReason,
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'device_checklist',
    entityId: checklist.checklistId,
    action: 'device_checklist_signature_overridden',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'overrideReason', before: null, after: cleanReason }],
    note: 'Device checklist customer signature requirement overridden',
  });
}

export function buildDeviceChecklistWhatsAppMessage(checklist: DeviceChecklist, signatureLink: string): string {
  return [
    'Hi, Genius Advanced here. We have prepared your device inspection checklist for your repair job. Please review the device condition and sign digitally using the link below.',
    '',
    'Checklist link:',
    signatureLink,
    '',
    'Thank you.',
  ].join('\n');
}

export function buildDeviceChecklistWhatsAppLink(checklist: DeviceChecklist, signatureLink: string): string {
  return buildWaMeLink({
    recipientPhone: checklist.customerPhoneSnapshot,
    message: buildDeviceChecklistWhatsAppMessage(checklist, signatureLink),
  });
}
