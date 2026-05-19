import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db, storage } from '@/lib/firebase/init';
import type { Job, UserData } from '@/types';
import type { JobPayment, JobPaymentFormInput, JobPaymentSummary } from '../types';

interface CreateJobPaymentOptions {
  source?: 'manage_job' | 'legacy';
  invoiceId?: string;
  posPaymentId?: string;
}

const receiptTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxReceiptSize = 10 * 1024 * 1024;

function displayNameForUser(user: UserData): string {
  return user.displayName || user.name || 'Unknown User';
}

function normalizeText(value: string): string {
  return value.trim();
}

function timestampFromDate(value: string): Timestamp {
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

function todayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function mapPayment(paymentId: string, data: Record<string, unknown>): JobPayment {
  return {
    ...(data as Omit<JobPayment, 'paymentId'>),
    paymentId,
  };
}

function validatePaymentInput(input: JobPaymentFormInput) {
  const amount = Number(input.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than 0');

  return {
    amount,
    type: input.type,
    method: input.method,
    referenceNo: normalizeText(input.referenceNo),
    note: normalizeText(input.note),
    paidAt: timestampFromDate(input.paidAt || todayDateKey()),
  };
}

async function uploadReceipt(jobId: string, paymentId: string, file?: File | null): Promise<string | null> {
  if (!file) return null;
  if (!receiptTypes.includes(file.type)) throw new Error('Only JPG, PNG, or PDF receipts are allowed');
  if (file.size > maxReceiptSize) throw new Error('Receipt file must be 10MB or smaller');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadSnapshot = await uploadBytes(ref(storage, `job-documents/${jobId}/payments/${paymentId}/${safeName}`), file, {
    contentType: file.type,
  });
  return getDownloadURL(uploadSnapshot.ref);
}

export function calculatePaymentSummary(job: Job, payments: JobPayment[]): JobPaymentSummary {
  const discountAmount = payments
    .filter((payment) => payment.type === 'discount')
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const refundAmount = payments
    .filter((payment) => payment.type === 'refund')
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const totalPaid = payments
    .filter((payment) => ['deposit', 'partial', 'full_payment'].includes(payment.type))
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const totalAmountDue = Math.max(0, Number(job.quotationAmount || job.totalSale || 0) - discountAmount);
  const balanceDue = totalAmountDue - totalPaid + refundAmount;
  const hasDeposit = payments.some((payment) => payment.type === 'deposit');
  const lastPayment = payments
    .filter((payment) => payment.type !== 'discount')
    .sort((left, right) => (right.paidAt?.toMillis?.() || 0) - (left.paidAt?.toMillis?.() || 0))[0];

  let paymentStatus: JobPaymentSummary['paymentStatus'] = 'unpaid';
  if (refundAmount > 0) paymentStatus = 'refunded';
  else if (balanceDue <= 0 && totalPaid > 0) paymentStatus = 'paid';
  else if (hasDeposit && totalPaid > 0 && balanceDue > 0) paymentStatus = 'deposit_paid';
  else if (totalPaid > 0 && balanceDue > 0) paymentStatus = 'partial_paid';

  return {
    paymentStatus,
    totalAmountDue,
    totalPaid,
    balanceDue,
    discountAmount,
    refundAmount,
    lastPaymentAt: lastPayment?.paidAt || null,
  };
}

export async function getJobPayments(jobId: string): Promise<JobPayment[]> {
  const snapshot = await getDocs(query(collection(db, 'jobPayments'), where('jobId', '==', jobId)));
  return snapshot.docs
    .map((paymentDoc) => mapPayment(paymentDoc.id, paymentDoc.data()))
    .sort((left, right) => (right.paidAt?.toMillis?.() || 0) - (left.paidAt?.toMillis?.() || 0));
}

export async function getAllJobPayments(): Promise<JobPayment[]> {
  const snapshot = await getDocs(collection(db, 'jobPayments'));
  return snapshot.docs.map((paymentDoc) => mapPayment(paymentDoc.id, paymentDoc.data()));
}

export async function syncJobPaymentSummaryFromPosInvoice(
  job: Job,
  input: {
    total: number;
    amountPaid: number;
    balance: number;
    paymentStatus: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'void';
    lastPaymentAt?: Timestamp | null;
  },
): Promise<void> {
  const paymentStatus: JobPaymentSummary['paymentStatus'] = input.paymentStatus === 'paid'
    ? 'paid'
    : input.paymentStatus === 'refunded'
      ? 'refunded'
      : input.amountPaid > 0
        ? 'partial_paid'
        : 'unpaid';

  await updateDoc(doc(db, 'jobs', job.docId), {
    paymentStatus,
    totalAmountDue: Number(input.total || 0),
    totalPaid: Number(input.amountPaid || 0),
    balanceDue: Number(input.balance || 0),
    discountAmount: Number(job.discountAmount || 0),
    refundAmount: Number(job.refundAmount || 0),
    lastPaymentAt: input.lastPaymentAt || null,
    updatedAt: serverTimestamp(),
  });
}

async function updateJobPaymentSummary(job: Job): Promise<JobPaymentSummary> {
  const payments = await getJobPayments(job.docId);
  const summary = calculatePaymentSummary(job, payments);
  await updateDoc(doc(db, 'jobs', job.docId), {
    ...summary,
    updatedAt: serverTimestamp(),
  });
  return summary;
}

export async function createJobPayment(
  job: Job,
  input: JobPaymentFormInput,
  user: UserData,
  options: CreateJobPaymentOptions = {},
): Promise<string> {
  const payload = validatePaymentInput(input);
  if (options.posPaymentId) {
    const existingSnapshot = await getDocs(query(collection(db, 'jobPayments'), where('posPaymentId', '==', options.posPaymentId)));
    if (!existingSnapshot.empty) return existingSnapshot.docs[0].id;
  }
  const paymentRef = doc(collection(db, 'jobPayments'));
  const receiptUrl = await uploadReceipt(job.docId, paymentRef.id, input.receiptFile);

  await setDoc(paymentRef, {
    jobId: job.docId,
    jobSheetNo: job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber,
    customerName: job.customerName,
    ...payload,
    receiptUrl,
    source: options.source || 'legacy',
    invoiceId: options.invoiceId || '',
    posPaymentId: options.posPaymentId || '',
    receivedBy: user.uid,
    receivedByDisplayName: displayNameForUser(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const beforeSummary = {
    paymentStatus: job.paymentStatus || 'unpaid',
    totalAmountDue: Number(job.totalAmountDue || 0),
    totalPaid: Number(job.totalPaid || 0),
    balanceDue: Number(job.balanceDue || 0),
    discountAmount: Number(job.discountAmount || 0),
    refundAmount: Number(job.refundAmount || 0),
  };
  const afterSummary = await updateJobPaymentSummary(job);

  await writeAuditLog({
    entityType: 'payment',
    entityId: paymentRef.id,
    action: 'payment_created',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'paymentType', before: null, after: payload.type },
      { field: 'amount', before: null, after: payload.amount },
      { field: 'paymentSummary', before: beforeSummary, after: afterSummary },
    ],
    note: payload.type === 'discount' ? 'Discount applied' : payload.type === 'refund' ? 'Refund recorded' : 'Payment recorded',
  });
  return paymentRef.id;
}

export async function updateJobPayment(job: Job, payment: JobPayment, input: JobPaymentFormInput, user: UserData): Promise<void> {
  const payload = validatePaymentInput(input);
  const receiptUrl = input.receiptFile ? await uploadReceipt(job.docId, payment.paymentId, input.receiptFile) : payment.receiptUrl;

  await updateDoc(doc(db, 'jobPayments', payment.paymentId), {
    ...payload,
    receiptUrl,
    updatedAt: serverTimestamp(),
  });

  const afterSummary = await updateJobPaymentSummary(job);
  await writeAuditLog({
    entityType: 'payment',
    entityId: payment.paymentId,
    action: 'payment_updated',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'amount', before: payment.amount, after: payload.amount },
      { field: 'type', before: payment.type, after: payload.type },
      { field: 'paymentSummary', before: null, after: afterSummary },
    ],
    note: 'Payment updated',
  });
}

export async function deleteJobPayment(job: Job, payment: JobPayment, user: UserData): Promise<void> {
  await deleteDoc(doc(db, 'jobPayments', payment.paymentId));
  const afterSummary = await updateJobPaymentSummary(job);
  await writeAuditLog({
    entityType: 'payment',
    entityId: payment.paymentId,
    action: 'payment_deleted',
    changedBy: user.uid,
    changedByDisplayName: displayNameForUser(user),
    changes: [
      { field: 'amount', before: payment.amount, after: null },
      { field: 'paymentSummary', before: null, after: afterSummary },
    ],
    note: 'Payment deleted',
  });
}
