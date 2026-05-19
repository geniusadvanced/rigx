import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import type { UserData } from '@/types';
import type {
  PartnerHardwareChecklistInput,
  PartnerHardwareChecklistPartInput,
  PartnerJob,
  PartnerJobFormInput,
} from '../types';

function normalizeText(value: string): string {
  return value.trim();
}

function timestampFromDateInput(value: string): Timestamp | null {
  if (!value) return null;
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

function isMotherboardRepair(input: PartnerJobFormInput): boolean {
  return input.outsourceType === 'motherboard_repair' || input.partnerName.toLowerCase().includes('motherboard');
}

function mapPartnerJob(partnerJobId: string, data: Record<string, unknown>): PartnerJob {
  return {
    ...(data as Omit<PartnerJob, 'partnerJobId'>),
    partnerJobId,
  };
}

function formatHardwarePart(label: string, part: PartnerHardwareChecklistPartInput): string {
  if (part.included === false) return `${label}: Not included`;
  const count = part.unitCount ? `${part.unitCount} x ` : '';
  return `${label}: ${count}${normalizeText(part.capacity)} ${normalizeText(part.type)}`.trim();
}

function buildHardwareChecklistSummary(checklist: PartnerHardwareChecklistInput): string {
  const wifiCard = checklist.wifiCard.included
    ? `WiFi Card: Included${normalizeText(checklist.wifiCard.model) ? ` (${normalizeText(checklist.wifiCard.model)})` : ''}`
    : 'WiFi Card: Not included';

  return [
    formatHardwarePart('RAM', checklist.ram),
    formatHardwarePart('SSD', checklist.ssd),
    formatHardwarePart('HDD', checklist.hdd),
    wifiCard,
  ].join(' | ');
}

function validateHardwarePart(label: string, part: PartnerHardwareChecklistPartInput): void {
  if (part.included === null) throw new Error('Internal hardware checklist is required before sending motherboard repair to partner.');
  if (!part.included) return;
  if (!part.unitCount || part.unitCount < 1) throw new Error(`${label} unit count is required`);
  if (!normalizeText(part.capacity)) throw new Error(`${label} capacity is required`);
  if (!normalizeText(part.type)) throw new Error(`${label} type is required`);
}

function buildHardwareChecklistPayload(input: PartnerJobFormInput, user: UserData) {
  if (!isMotherboardRepair(input)) return {};

  const checklist = input.hardwareChecklist;
  validateHardwarePart('RAM', checklist.ram);
  validateHardwarePart('SSD', checklist.ssd);
  validateHardwarePart('HDD', checklist.hdd);

  if (checklist.wifiCard.included === null) {
    throw new Error('Internal hardware checklist is required before sending motherboard repair to partner.');
  }

  const hardwareChecklist = {
    ram: {
      included: Boolean(checklist.ram.included),
      unitCount: checklist.ram.included ? checklist.ram.unitCount : null,
      capacity: checklist.ram.included ? normalizeText(checklist.ram.capacity) : '',
      type: checklist.ram.included ? normalizeText(checklist.ram.type) : '',
      notes: normalizeText(checklist.ram.notes),
    },
    ssd: {
      included: Boolean(checklist.ssd.included),
      unitCount: checklist.ssd.included ? checklist.ssd.unitCount : null,
      capacity: checklist.ssd.included ? normalizeText(checklist.ssd.capacity) : '',
      type: checklist.ssd.included ? normalizeText(checklist.ssd.type) : '',
      notes: normalizeText(checklist.ssd.notes),
    },
    hdd: {
      included: Boolean(checklist.hdd.included),
      unitCount: checklist.hdd.included ? checklist.hdd.unitCount : null,
      capacity: checklist.hdd.included ? normalizeText(checklist.hdd.capacity) : '',
      type: checklist.hdd.included ? normalizeText(checklist.hdd.type) : '',
      notes: normalizeText(checklist.hdd.notes),
    },
    wifiCard: {
      included: Boolean(checklist.wifiCard.included),
      model: checklist.wifiCard.included ? normalizeText(checklist.wifiCard.model) : '',
      notes: normalizeText(checklist.wifiCard.notes),
    },
    otherRemarks: normalizeText(checklist.otherRemarks),
    checkedBy: displayNameForUser(user),
    checkedAt: serverTimestamp(),
  };

  return {
    hardwareChecklist,
    hardwareChecklistSummary: buildHardwareChecklistSummary(checklist),
  };
}

function buildPartnerJobPayload(input: PartnerJobFormInput, user: UserData) {
  if (!normalizeText(input.geniusJobSheetNo)) throw new Error('Genius Job Sheet No is required');
  if (!normalizeText(input.partnerName)) throw new Error('Partner Name is required');
  if (!normalizeText(input.partnerJobSheetNo)) throw new Error('Partner Job Sheet No is required');
  if (!normalizeText(input.customerName)) throw new Error('Customer Name is required');
  if (!normalizeText(input.deviceModel)) throw new Error('Device Model is required');
  if (!normalizeText(input.issueDescription)) throw new Error('Issue Description is required');

  const sentDate = timestampFromDateInput(input.sentDate);
  if (!sentDate) throw new Error('Sent Date is required');

  return {
    sourceJobId: normalizeText(input.sourceJobId || ''),
    rigxJobNumber: normalizeText(input.rigxJobNumber || input.geniusJobSheetNo),
    geniusJobSheetNo: normalizeText(input.geniusJobSheetNo),
    partnerName: normalizeText(input.partnerName),
    partnerExternalJobId: normalizeText(input.partnerExternalJobId || ''),
    partnerJobSheetNo: normalizeText(input.partnerJobSheetNo),
    outsourceType: input.outsourceType,
    customerName: normalizeText(input.customerName),
    customerPhone: normalizeText(input.customerPhone || ''),
    device: normalizeText(input.device || input.deviceModel),
    deviceBrand: normalizeText(input.deviceBrand),
    deviceModel: normalizeText(input.deviceModel),
    deviceSerial: normalizeText(input.deviceSerial),
    issueDescription: normalizeText(input.issueDescription),
    branchId: normalizeText(input.branchId || ''),
    branch: normalizeText(input.branch || input.branchId || ''),
    assignedTechnicianId: normalizeText(input.assignedTechnicianId || ''),
    assignedTechnicianName: normalizeText(input.assignedTechnicianName || ''),
    sentDate,
    expectedReturnDate: timestampFromDateInput(input.expectedReturnDate),
    status: input.status,
    remarks: normalizeText(input.remarks),
    ...buildHardwareChecklistPayload(input, user),
  };
}

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function addChange(
  changes: Array<{ field: string; before: unknown; after: unknown }>,
  field: string,
  before: unknown,
  after: unknown,
) {
  if (before !== after) {
    changes.push({ field, before, after });
  }
}

export async function getPartnerJobs(): Promise<PartnerJob[]> {
  const snapshot = await getDocs(collection(db, 'partnerJobs'));
  return snapshot.docs
    .map((partnerJobDoc) => mapPartnerJob(partnerJobDoc.id, partnerJobDoc.data()))
    .sort((left, right) => {
      const leftTime = left.updatedAt?.toMillis?.() ?? left.createdAt?.toMillis?.() ?? 0;
      const rightTime = right.updatedAt?.toMillis?.() ?? right.createdAt?.toMillis?.() ?? 0;
      return rightTime - leftTime;
    });
}

export async function createPartnerJob(input: PartnerJobFormInput, user: UserData): Promise<string> {
  const payload = buildPartnerJobPayload(input, user);
  const partnerJobRef = await addDoc(collection(db, 'partnerJobs'), {
    ...payload,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'partner_job',
    entityId: partnerJobRef.id,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'geniusJobSheetNo', before: null, after: payload.geniusJobSheetNo },
      { field: 'sourceJobId', before: null, after: payload.sourceJobId },
      { field: 'rigxJobNumber', before: null, after: payload.rigxJobNumber },
      { field: 'partnerName', before: null, after: payload.partnerName },
      { field: 'partnerExternalJobId', before: null, after: payload.partnerExternalJobId },
      { field: 'status', before: null, after: payload.status },
    ],
    note: 'Partner job created',
  });

  return partnerJobRef.id;
}

export async function updatePartnerJob(job: PartnerJob, input: PartnerJobFormInput, user: UserData): Promise<void> {
  const payload = buildPartnerJobPayload(input, user);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  addChange(changes, 'sourceJobId', job.sourceJobId || '', payload.sourceJobId);
  addChange(changes, 'rigxJobNumber', job.rigxJobNumber || job.geniusJobSheetNo || '', payload.rigxJobNumber);
  addChange(changes, 'geniusJobSheetNo', job.geniusJobSheetNo || '', payload.geniusJobSheetNo);
  addChange(changes, 'partnerName', job.partnerName || '', payload.partnerName);
  addChange(changes, 'partnerExternalJobId', job.partnerExternalJobId || '', payload.partnerExternalJobId);
  addChange(changes, 'partnerJobSheetNo', job.partnerJobSheetNo || '', payload.partnerJobSheetNo);
  addChange(changes, 'outsourceType', job.outsourceType, payload.outsourceType);
  addChange(changes, 'customerName', job.customerName || '', payload.customerName);
  addChange(changes, 'deviceModel', job.deviceModel || '', payload.deviceModel);
  addChange(changes, 'status', job.status, payload.status);
  addChange(changes, 'remarks', job.remarks || '', payload.remarks);
  addChange(changes, 'hardwareChecklistSummary', job.hardwareChecklistSummary || '', payload.hardwareChecklistSummary || '');

  await updateDoc(doc(db, 'partnerJobs', job.partnerJobId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: 'partner_job',
      entityId: job.partnerJobId,
      action: 'update',
      changedBy: user.uid,
      changedByDisplayName: displayNameForUser(user),
      changes,
      note: 'Partner job updated',
    });
  }
}

export async function deletePartnerJob(partnerJobId: string): Promise<void> {
  await deleteDoc(doc(db, 'partnerJobs', partnerJobId));
}
