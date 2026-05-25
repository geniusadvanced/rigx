import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db, storage } from '@/lib/firebase/init';
import type { Job, UserData } from '@/types';
import type { CreateJobDocumentInput, JobDocumentRecord, JobDocumentRecordType, WarrantyPeriodType } from '../types';

const allowedFileTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxFileSize = 10 * 1024 * 1024;
export const geniusAdvancedWarrantyPolicyText = [
  'Warranty applies only to repair services and replaced parts performed by Genius Advanced.',
  'Warranty covers only functional performance of the replaced/repaired part.',
  'Warranty does not cover unrelated components, pre-existing faults, subsequent failures, or damage unrelated to repaired parts.',
  'Warranty is void if device is opened, tampered with, or repaired by unauthorized third party.',
  'Warranty is void if there is physical damage after repair, including cracks, broken parts, screen damage, scratches, dents, battery swelling, or liquid/moisture damage.',
  'Warranty is void if serial number or warranty sticker is missing, altered, or damaged.',
  'Warranty does not cover diagnostics, formatting, OS installation, data services, internal cleaning, labour/service charges unless explicitly stated.',
  'Genius Advanced is not liable for data loss.',
  'No return/refund/exchange.',
  'Claim is subject to inspection and verification.',
].join('\n');

const warrantyPeriodDaysByType: Record<WarrantyPeriodType, number> = {
  '7_days': 7,
  '1_month': 30,
  '3_months': 90,
  '6_months': 180,
  '12_months': 365,
};

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function normalizeText(value: string): string {
  return value.trim();
}

function generatePublicToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mapDocument(documentId: string, data: Record<string, unknown>): JobDocumentRecord {
  return {
    ...(data as Omit<JobDocumentRecord, 'documentId'>),
    documentId,
  };
}

function timestampFromDateInput(value?: string): Timestamp | null {
  if (!value) return null;
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

function addDays(startDate: string, days: number): Timestamp {
  const date = new Date(`${startDate}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return Timestamp.fromDate(date);
}

function addCalendarMonths(startDate: string, months: number): Timestamp {
  const date = new Date(`${startDate}T00:00:00+08:00`);
  date.setMonth(date.getMonth() + months);
  return Timestamp.fromDate(date);
}

export function getWarrantyPeriodDays(periodType: WarrantyPeriodType): number {
  return warrantyPeriodDaysByType[periodType];
}

export function calculateWarrantyEndDate(startDate: string, periodType: WarrantyPeriodType): Timestamp {
  if (periodType === '7_days') return addDays(startDate, 7);
  if (periodType === '1_month') return addCalendarMonths(startDate, 1);
  if (periodType === '3_months') return addCalendarMonths(startDate, 3);
  if (periodType === '6_months') return addCalendarMonths(startDate, 6);
  return addCalendarMonths(startDate, 12);
}

function normalizeWarrantyPeriodType(value?: WarrantyPeriodType | null): WarrantyPeriodType {
  if (value === '7_days' || value === '1_month' || value === '3_months' || value === '6_months' || value === '12_months') {
    return value;
  }
  return '3_months';
}

function validateFile(file?: File | null) {
  if (!file) return;
  if (!allowedFileTypes.includes(file.type)) throw new Error('Only JPG, PNG, or PDF files are allowed');
  if (file.size > maxFileSize) throw new Error('File must be 10MB or smaller');
}

function auditNoteForType(type: JobDocumentRecordType): string {
  if (type === 'warranty') return 'Warranty created';
  if (type === 'service_report') return 'Service report created';
  return 'Job attachment uploaded';
}

export function getWarrantyStatus(documentRecord: JobDocumentRecord): 'active' | 'expired' | null {
  if (documentRecord.type !== 'warranty' || !documentRecord.warrantyEndDate) return null;
  return documentRecord.warrantyEndDate.toMillis() >= Date.now() ? 'active' : 'expired';
}

export async function getJobDocumentRecords(jobId: string): Promise<JobDocumentRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'jobDocuments'), where('jobId', '==', jobId)));
  return snapshot.docs
    .map((documentRecord) => mapDocument(documentRecord.id, documentRecord.data()))
    .sort((left, right) => {
      const leftTime = left.createdAt?.toMillis?.() || 0;
      const rightTime = right.createdAt?.toMillis?.() || 0;
      return rightTime - leftTime;
    });
}

export async function getJobDocumentRecordById(documentId: string): Promise<JobDocumentRecord> {
  const snapshot = await getDoc(doc(db, 'jobDocuments', documentId));
  if (!snapshot.exists()) throw new Error('Job warranty document not found');
  return mapDocument(snapshot.id, snapshot.data());
}

export async function createJobDocumentRecord(
  input: CreateJobDocumentInput,
  user: UserData,
): Promise<string> {
  const title = normalizeText(input.title);
  if (!title) throw new Error('Document title is required');
  const warrantyPeriodType = normalizeWarrantyPeriodType(input.warrantyPeriodType);

  validateFile(input.file);

  let fileUrl = '';
  let fileName = '';
  let fileType = '';

  if (input.file) {
    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `job-documents/${input.jobId}/records/${Date.now()}_${safeName}`;
    const uploadSnapshot = await uploadBytes(ref(storage, filePath), input.file, {
      contentType: input.file.type,
    });
    fileUrl = await getDownloadURL(uploadSnapshot.ref);
    fileName = input.file.name;
    fileType = input.file.type;
  }

  const warrantyStartDate =
    input.type === 'warranty' ? timestampFromDateInput(input.warrantyStartDate) || Timestamp.now() : null;
  const warrantyStartDateKey =
    input.warrantyStartDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const warrantyEndDate =
    input.type === 'warranty'
      ? calculateWarrantyEndDate(warrantyStartDateKey, warrantyPeriodType)
      : null;

  const documentRef = await addDoc(collection(db, 'jobDocuments'), {
    jobId: input.jobId,
    jobSheetNo: input.jobSheetNo,
    type: input.type,
    title,
    description: normalizeText(input.description),
    fileUrl,
    fileName,
    fileType,
    warrantyPeriodType: input.type === 'warranty' ? warrantyPeriodType : null,
    warrantyPeriodDays: input.type === 'warranty' ? getWarrantyPeriodDays(warrantyPeriodType) : null,
    warrantyStartDate,
    warrantyEndDate,
    warrantyPolicyText: input.type === 'warranty' ? geniusAdvancedWarrantyPolicyText : '',
    warrantyClaimLimit: input.type === 'warranty' ? 'unlimited_within_period' : null,
    createdBy: user.uid,
    createdByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'job',
    entityId: input.jobId,
    action: 'create',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'documentType', before: null, after: input.type },
      { field: 'title', before: null, after: title },
      ...(input.type === 'warranty'
        ? [{ field: 'warrantyPeriodType', before: null, after: warrantyPeriodType }]
        : []),
    ],
    note: auditNoteForType(input.type),
  });

  return documentRef.id;
}

export async function updateJobDocumentRecord(
  documentRecord: JobDocumentRecord,
  input: Pick<CreateJobDocumentInput, 'title' | 'description' | 'warrantyPeriodType' | 'warrantyPeriodDays' | 'warrantyStartDate'>,
  user: UserData,
): Promise<void> {
  const title = normalizeText(input.title);
  if (!title) throw new Error('Document title is required');

  const warrantyStartDate =
    documentRecord.type === 'warranty'
      ? timestampFromDateInput(input.warrantyStartDate) || documentRecord.warrantyStartDate
      : null;
  const warrantyPeriodType = normalizeWarrantyPeriodType(input.warrantyPeriodType || documentRecord.warrantyPeriodType);
  const warrantyStartDateKey =
    input.warrantyStartDate ||
    (documentRecord.warrantyStartDate
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(documentRecord.warrantyStartDate.toDate())
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()));
  const warrantyEndDate =
    documentRecord.type === 'warranty'
      ? calculateWarrantyEndDate(warrantyStartDateKey, warrantyPeriodType)
      : documentRecord.warrantyEndDate;

  await updateDoc(doc(db, 'jobDocuments', documentRecord.documentId), {
    title,
    description: normalizeText(input.description),
    warrantyPeriodType: documentRecord.type === 'warranty' ? warrantyPeriodType : null,
    warrantyPeriodDays: documentRecord.type === 'warranty' ? getWarrantyPeriodDays(warrantyPeriodType) : null,
    warrantyStartDate,
    warrantyEndDate,
    warrantyPolicyText: documentRecord.type === 'warranty' ? geniusAdvancedWarrantyPolicyText : '',
    warrantyClaimLimit: documentRecord.type === 'warranty' ? 'unlimited_within_period' : null,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    entityType: 'job',
    entityId: documentRecord.jobId,
    action: 'update',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'title', before: documentRecord.title, after: title },
      { field: 'description', before: documentRecord.description, after: normalizeText(input.description) },
      ...(documentRecord.type === 'warranty'
        ? [
            { field: 'warrantyPeriodType', before: documentRecord.warrantyPeriodType || null, after: warrantyPeriodType },
            { field: 'warrantyEndDate', before: documentRecord.warrantyEndDate || null, after: warrantyEndDate },
          ]
        : []),
    ],
    note: documentRecord.type === 'warranty' ? 'Warranty period updated' : documentRecord.type === 'service_report' ? 'Service report updated' : 'Job document updated',
  });
}

export async function ensureJobWarrantySignatureToken(
  documentRecord: JobDocumentRecord,
  user: UserData,
): Promise<string> {
  if (documentRecord.type !== 'warranty') throw new Error('Only warranty records can be sent for signature');
  const existingToken = documentRecord.publicWarrantyToken || '';
  if (existingToken && documentRecord.publicWarrantyTokenStatus !== 'revoked') return existingToken;
  const publicWarrantyToken = generatePublicToken();
  await updateDoc(doc(db, 'jobDocuments', documentRecord.documentId), {
    publicWarrantyToken,
    publicWarrantyTokenCreatedAt: serverTimestamp(),
    publicWarrantyTokenStatus: 'active',
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    entityType: 'job',
    entityId: documentRecord.jobId,
    action: 'job_warranty_signature_token_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [{ field: 'publicWarrantyToken', before: existingToken ? 'revoked' : null, after: 'created' }],
    note: 'Job warranty public signature token created',
  }).catch(() => undefined);
  return publicWarrantyToken;
}

export async function deleteJobDocumentRecord(documentRecord: JobDocumentRecord): Promise<void> {
  await deleteDoc(doc(db, 'jobDocuments', documentRecord.documentId));
}

export function jobHasActiveWarranty(records: JobDocumentRecord[]): boolean {
  return records.some((record) => getWarrantyStatus(record) === 'active');
}
