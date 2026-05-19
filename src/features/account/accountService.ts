import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { PartnerJob } from '@/features/genius-partners/types';
import type { JobPayment, JobPaymentMethod } from '@/features/payments/types';
import type { PartsOrder } from '@/features/parts-orders/types';
import type { Payroll } from '@/features/payroll/types';
import type { Job, Role } from '@/types';

export type AccountBranchFilter = 'all' | 'bangi' | 'cyberjaya';
export type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'software'
  | 'tools'
  | 'courier'
  | 'marketing_ads'
  | 'salary_adjustment'
  | 'misc';
export type AccountPaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';

export interface ManualExpense {
  expenseId: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  branch: AccountBranchFilter;
  expenseDate: Timestamp;
  paymentMethod: JobPaymentMethod;
  notes: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface ManualExpenseInput {
  title: string;
  category: ExpenseCategory;
  amount: number;
  branch: AccountBranchFilter;
  expenseDate: string;
  paymentMethod: JobPaymentMethod;
  notes: string;
  createdBy: string;
  role: Role;
}

export interface PaymentTrackingRow {
  jobId: string;
  jobSheetNo: string;
  customerName: string;
  branch: AccountBranchFilter | 'unknown';
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: AccountPaymentStatus;
  paymentMethod: JobPaymentMethod | 'not_recorded';
  paymentDate?: Timestamp | null;
  paymentNotes?: string;
  refundedAmount: number;
}

export interface PaymentSummary {
  paidRevenue: number;
  partialPaid: number;
  unpaidAmount: number;
  refundedAmount: number;
  outstandingBalance: number;
  paidJobs: number;
  partialPaidJobs: number;
  unpaidJobs: number;
  refundedJobs: number;
}

export interface AccountSummary {
  totalRevenue: number;
  paidRevenue: number;
  partialPaid: number;
  unpaidAmount: number;
  refundedAmount: number;
  outstandingBalance: number;
  unpaidJobs: number;
  paidJobs: number;
  partialPaidJobs: number;
  refundedJobs: number;
  payrollCost: number;
  partsCost: number;
  outsourceCost: number;
  manualExpenses: number;
  estimatedProfit: number;
  estimatedNetProfit: number;
  totalJobs: number;
  completedJobs: number;
  cancelledJobs: number;
  pendingJobs: number;
}

export interface AccountBreakdownRow {
  label: string;
  revenue: number;
  totalRevenue: number;
  paidRevenue: number;
  outstanding: number;
  outstandingBalance: number;
  expenses: number;
  payrollCost: number;
  partsCost: number;
  outsourceCost: number;
  manualExpenses: number;
  estimatedNetProfit: number;
  estimatedProfit: number;
  totalJobs: number;
  completedJobs: number;
  cancelledJobs: number;
  pendingJobs: number;
}

export interface TechnicianAccountBreakdown {
  technicianId: string;
  technicianName: string;
  revenue: number;
  jobsHandled: number;
  completedJobs: number;
}

export interface AccountReport {
  month: string;
  branch: AccountBranchFilter;
  generatedBy?: string;
  generatedAt?: unknown;
  summary: AccountSummary;
  paymentSummary: PaymentSummary;
  branchBreakdown: AccountBreakdownRow[];
  technicianBreakdown: TechnicianAccountBreakdown[];
}

interface AccountSourceData {
  jobs: Job[];
  payments: JobPayment[];
  partsOrders: PartsOrder[];
  partnerJobs: PartnerJob[];
  payroll: Payroll[];
  expenses: ManualExpense[];
}

function timestampToDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  return typeof toDate === 'function' ? toDate.call(value) : null;
}

function dateStringToTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(`${value}T00:00:00+08:00`));
}

function getMonthKey(value: unknown): string {
  const date = timestampToDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function getJobCompletionDate(job: Job): unknown {
  const completedHistory = (job.statusHistory || [])
    .filter((item) => item.status === 'completed' || item.status === 'collected')
    .at(-1);
  return completedHistory?.changedAt || (job as Job & { updatedAt?: unknown }).updatedAt || (job as Job & { createdAt?: unknown }).createdAt;
}

function normalizeBranch(value?: string | null): AccountBranchFilter | 'unknown' {
  const branch = String(value || '').toLowerCase();
  if (branch.includes('bangi')) return 'bangi';
  if (branch.includes('cyberjaya')) return 'cyberjaya';
  return 'unknown';
}

function branchMatches(branch: AccountBranchFilter | 'unknown', selectedBranch: AccountBranchFilter): boolean {
  return selectedBranch === 'all' || branch === selectedBranch;
}

function isCompletedJob(job: Job): boolean {
  return job.status === 'completed' || job.status === 'collected';
}

function isCancelledJob(job: Job): boolean {
  return job.status === 'cancelled' || job.status === 'rejected';
}

function getJobBranch(job: Job): AccountBranchFilter | 'unknown' {
  return normalizeBranch(job.branchId);
}

function getJobTotalAmount(job: Job): number {
  const financeJob = job as Job & { totalAmount?: number; totalAmountDue?: number };
  return Number(financeJob.totalAmount || financeJob.totalAmountDue || job.quotationAmount || job.totalSale || 0);
}

function getPartnerCost(partnerJob: PartnerJob): number {
  const values = partnerJob as PartnerJob & { outsourceCost?: number; costPrice?: number; cost?: number };
  return Number(values.outsourceCost || values.costPrice || values.cost || 0);
}

function normalizePaymentStatus(value: unknown, totalAmount: number, paidAmount: number, refundedAmount: number): AccountPaymentStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'refunded' || refundedAmount > 0) return 'refunded';
  if (status === 'paid' || (totalAmount > 0 && paidAmount >= totalAmount)) return 'paid';
  if (status === 'partial' || status === 'partial_paid' || status === 'deposit_paid' || paidAmount > 0) return 'partial';
  return 'unpaid';
}

async function loadAccountSourceData(): Promise<AccountSourceData> {
  const [jobsSnapshot, paymentsSnapshot, partsSnapshot, partnerSnapshot, payrollSnapshot, expensesSnapshot] = await Promise.all([
    getDocs(collection(db, 'jobs')),
    getDocs(collection(db, 'jobPayments')),
    getDocs(collection(db, 'partsOrders')),
    getDocs(collection(db, 'partnerJobs')),
    getDocs(collection(db, 'payroll')),
    getDocs(collection(db, 'expenses')),
  ]);

  return {
    jobs: jobsSnapshot.docs.map((jobDoc) => ({ docId: jobDoc.id, ...(jobDoc.data() as Omit<Job, 'docId'>) })),
    payments: paymentsSnapshot.docs.map((paymentDoc) => ({
      paymentId: paymentDoc.id,
      ...(paymentDoc.data() as Omit<JobPayment, 'paymentId'>),
    })),
    partsOrders: partsSnapshot.docs.map((partsDoc) => ({
      partsOrderId: partsDoc.id,
      ...(partsDoc.data() as Omit<PartsOrder, 'partsOrderId'>),
    })),
    partnerJobs: partnerSnapshot.docs.map((partnerDoc) => ({
      partnerJobId: partnerDoc.id,
      ...(partnerDoc.data() as Omit<PartnerJob, 'partnerJobId'>),
    })),
    payroll: payrollSnapshot.docs.map((payrollDoc) => payrollDoc.data() as Payroll),
    expenses: expensesSnapshot.docs.map((expenseDoc) => ({
      expenseId: expenseDoc.id,
      ...(expenseDoc.data() as Omit<ManualExpense, 'expenseId'>),
    })),
  };
}

function buildPaymentRows(data: AccountSourceData, month: string | null, branch: AccountBranchFilter): PaymentTrackingRow[] {
  const paymentsByJobId = new Map<string, JobPayment[]>();
  data.payments.forEach((payment) => {
    const current = paymentsByJobId.get(payment.jobId) || [];
    current.push(payment);
    paymentsByJobId.set(payment.jobId, current);
  });

  return data.jobs
    .filter((job) => branchMatches(getJobBranch(job), branch))
    .filter((job) => !month || getMonthKey((job as Job & { createdAt?: unknown }).createdAt || getJobCompletionDate(job)) === month)
    .map((job) => {
      const payments = paymentsByJobId.get(job.docId) || [];
      const positivePayments = payments.filter((payment) => ['deposit', 'partial', 'full_payment'].includes(payment.type));
      const refunds = payments.filter((payment) => payment.type === 'refund');
      const latestPayment = [...payments].sort((left, right) => {
        const leftTime = timestampToDate(left.paidAt)?.getTime() || 0;
        const rightTime = timestampToDate(right.paidAt)?.getTime() || 0;
        return rightTime - leftTime;
      })[0];
      const financeJob = job as Job & {
        totalAmount?: number;
        paidAmount?: number;
        balanceAmount?: number;
        totalPaid?: number;
        balanceDue?: number;
        paymentMethod?: JobPaymentMethod;
        paymentDate?: Timestamp | null;
        paymentNotes?: string;
      };
      const totalAmount = getJobTotalAmount(job);
      const paidAmount = positivePayments.length
        ? positivePayments.reduce((total, payment) => total + Number(payment.amount || 0), 0)
        : Number(financeJob.paidAmount || financeJob.totalPaid || 0);
      const refundedAmount = refunds.reduce((total, payment) => total + Number(payment.amount || 0), 0);
      const balanceAmount = Number.isFinite(Number(financeJob.balanceAmount ?? financeJob.balanceDue))
        ? Number(financeJob.balanceAmount ?? financeJob.balanceDue)
        : Math.max(0, totalAmount - paidAmount);

      return {
        jobId: job.docId,
        jobSheetNo: job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || job.docId,
        customerName: job.customerName || 'Unknown customer',
        branch: getJobBranch(job),
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentStatus: normalizePaymentStatus(job.paymentStatus, totalAmount, paidAmount, refundedAmount),
        paymentMethod: latestPayment?.method || financeJob.paymentMethod || 'not_recorded',
        paymentDate: latestPayment?.paidAt || financeJob.paymentDate || null,
        paymentNotes: latestPayment?.note || financeJob.paymentNotes || '',
        refundedAmount,
      };
    });
}

function buildPaymentSummary(rows: PaymentTrackingRow[]): PaymentSummary {
  return {
    paidRevenue: rows.reduce((total, row) => total + row.paidAmount, 0) - rows.reduce((total, row) => total + row.refundedAmount, 0),
    partialPaid: rows.filter((row) => row.paymentStatus === 'partial').reduce((total, row) => total + row.paidAmount, 0),
    unpaidAmount: rows.filter((row) => row.paymentStatus === 'unpaid').reduce((total, row) => total + row.totalAmount, 0),
    refundedAmount: rows.reduce((total, row) => total + row.refundedAmount, 0),
    outstandingBalance: rows.reduce((total, row) => total + row.balanceAmount, 0),
    paidJobs: rows.filter((row) => row.paymentStatus === 'paid').length,
    partialPaidJobs: rows.filter((row) => row.paymentStatus === 'partial').length,
    unpaidJobs: rows.filter((row) => row.paymentStatus === 'unpaid').length,
    refundedJobs: rows.filter((row) => row.paymentStatus === 'refunded').length,
  };
}

function buildAccountSummary(data: AccountSourceData, month: string | null, branch: AccountBranchFilter): {
  summary: AccountSummary;
  filteredJobs: Job[];
  paymentRows: PaymentTrackingRow[];
  paymentSummary: PaymentSummary;
} {
  const jobsById = new Map(data.jobs.map((job) => [job.docId, job]));
  const jobsBySheetNo = new Map(
    data.jobs.flatMap((job) => [job.jobNo, job.jobNumber, job.jobSheetNo, job.agnJobNumber].filter(Boolean).map((sheetNo) => [sheetNo, job] as const)),
  );
  const monthMatches = (value: unknown) => !month || getMonthKey(value) === month;
  const jobMatches = (job: Job) => branchMatches(getJobBranch(job), branch);
  const jobMonthMatches = (job: Job) => !month || getMonthKey((job as Job & { createdAt?: unknown }).createdAt || getJobCompletionDate(job)) === month;
  const filteredJobs = data.jobs.filter((job) => jobMatches(job) && jobMonthMatches(job));
  const paymentRows = buildPaymentRows(data, month, branch);
  const paymentSummary = buildPaymentSummary(paymentRows);
  const totalRevenue = paymentRows.reduce((total, row) => total + row.totalAmount, 0);
  const payrollCost = data.payroll
    .filter((payroll) => (!month || payroll.month === month) && branchMatches(normalizeBranch(payroll.branchId), branch))
    .reduce((total, payroll) => total + Number(payroll.netSalary || 0), 0);
  const partsCost = data.partsOrders
    .filter((order) => {
      const job = jobsById.get(order.jobId);
      return monthMatches(order.createdAt || order.orderedDate || order.updatedAt) && (!job || jobMatches(job));
    })
    .reduce((total, order) => total + Number(order.costPrice || 0), 0);
  const outsourceCost = data.partnerJobs
    .filter((partnerJob) => {
      const job = jobsBySheetNo.get(partnerJob.geniusJobSheetNo);
      return monthMatches(partnerJob.sentDate || partnerJob.createdAt) && (!job || jobMatches(job));
    })
    .reduce((total, partnerJob) => total + getPartnerCost(partnerJob), 0);
  const manualExpenses = data.expenses
    .filter((expense) => monthMatches(expense.expenseDate) && branchMatches(expense.branch, branch))
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const estimatedNetProfit = paymentSummary.paidRevenue - payrollCost - partsCost - outsourceCost - manualExpenses;

  return {
    summary: {
      totalRevenue,
      paidRevenue: paymentSummary.paidRevenue,
      partialPaid: paymentSummary.partialPaid,
      unpaidAmount: paymentSummary.unpaidAmount,
      refundedAmount: paymentSummary.refundedAmount,
      outstandingBalance: paymentSummary.outstandingBalance,
      unpaidJobs: paymentSummary.unpaidJobs,
      paidJobs: paymentSummary.paidJobs,
      partialPaidJobs: paymentSummary.partialPaidJobs,
      refundedJobs: paymentSummary.refundedJobs,
      payrollCost,
      partsCost,
      outsourceCost,
      manualExpenses,
      estimatedProfit: estimatedNetProfit,
      estimatedNetProfit,
      totalJobs: filteredJobs.length,
      completedJobs: filteredJobs.filter(isCompletedJob).length,
      cancelledJobs: filteredJobs.filter(isCancelledJob).length,
      pendingJobs: filteredJobs.filter((job) => !isCompletedJob(job) && !isCancelledJob(job)).length,
    },
    filteredJobs,
    paymentRows,
    paymentSummary,
  };
}

function buildAccountReport(data: AccountSourceData, month: string | null, branch: AccountBranchFilter): AccountReport {
  const { summary, filteredJobs, paymentSummary } = buildAccountSummary(data, month, branch);
  const branchBreakdown = (['bangi', 'cyberjaya'] as const).map((branchName) => {
    const branchSummary = buildAccountSummary(data, month, branchName).summary;
    return {
      label: branchName === 'bangi' ? 'Bangi' : 'Cyberjaya',
      revenue: branchSummary.totalRevenue,
      totalRevenue: branchSummary.totalRevenue,
      paidRevenue: branchSummary.paidRevenue,
      outstanding: branchSummary.outstandingBalance,
      outstandingBalance: branchSummary.outstandingBalance,
      expenses: branchSummary.manualExpenses,
      payrollCost: branchSummary.payrollCost,
      partsCost: branchSummary.partsCost,
      outsourceCost: branchSummary.outsourceCost,
      manualExpenses: branchSummary.manualExpenses,
      estimatedNetProfit: branchSummary.estimatedNetProfit,
      estimatedProfit: branchSummary.estimatedNetProfit,
      totalJobs: branchSummary.totalJobs,
      completedJobs: branchSummary.completedJobs,
      cancelledJobs: branchSummary.cancelledJobs,
      pendingJobs: branchSummary.pendingJobs,
    };
  });

  const technicianRows = new Map<string, TechnicianAccountBreakdown>();
  filteredJobs.forEach((job) => {
    const technicianId = job.technicianId || 'unknown';
    const current = technicianRows.get(technicianId) || {
      technicianId,
      technicianName: job.technicianName || 'Unknown User',
      revenue: 0,
      jobsHandled: 0,
      completedJobs: 0,
    };
    current.jobsHandled += 1;
    if (isCompletedJob(job)) {
      current.completedJobs += 1;
      current.revenue += getJobTotalAmount(job);
    }
    technicianRows.set(technicianId, current);
  });

  return {
    month: month || 'all',
    branch,
    summary,
    paymentSummary,
    branchBreakdown,
    technicianBreakdown: Array.from(technicianRows.values()).sort((left, right) => right.revenue - left.revenue),
  };
}

export async function getRealtimeAccountSummary(role: Role): Promise<AccountReport> {
  assertCan(role, 'account.view');
  const data = await loadAccountSourceData();
  return buildAccountReport(data, null, 'all');
}

export async function getPaymentSummary(params: {
  month?: string | null;
  branch: AccountBranchFilter;
  role: Role;
}): Promise<{ summary: PaymentSummary; rows: PaymentTrackingRow[] }> {
  assertCan(params.role, 'account.view');
  const data = await loadAccountSourceData();
  const rows = buildPaymentRows(data, params.month || null, params.branch);
  return { summary: buildPaymentSummary(rows), rows };
}

export async function getManualExpenses(params: {
  month?: string | null;
  branch: AccountBranchFilter;
  role: Role;
}): Promise<ManualExpense[]> {
  assertCan(params.role, 'account.view');
  const data = await loadAccountSourceData();
  return data.expenses
    .filter((expense) => (!params.month || getMonthKey(expense.expenseDate) === params.month) && branchMatches(expense.branch, params.branch))
    .sort((left, right) => (timestampToDate(right.expenseDate)?.getTime() || 0) - (timestampToDate(left.expenseDate)?.getTime() || 0));
}

export async function addManualExpense(input: ManualExpenseInput): Promise<void> {
  assertCan(input.role, 'account.view');
  if (!input.title.trim()) throw new Error('Expense title is required');
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error('Expense amount must be valid');
  if (!input.expenseDate) throw new Error('Expense date is required');

  await addDoc(collection(db, 'expenses'), {
    title: input.title.trim(),
    category: input.category,
    amount: input.amount,
    branch: input.branch,
    expenseDate: dateStringToTimestamp(input.expenseDate),
    paymentMethod: input.paymentMethod,
    notes: input.notes.trim(),
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
  });
}

export async function generateMonthlyAccountReport(params: {
  month: string;
  branch: AccountBranchFilter;
  role: Role;
}): Promise<AccountReport> {
  assertCan(params.role, 'account.view');
  const data = await loadAccountSourceData();
  return buildAccountReport(data, params.month, params.branch);
}

export async function getBranchProfitLoss(params: {
  month?: string | null;
  role: Role;
}): Promise<AccountBreakdownRow[]> {
  assertCan(params.role, 'account.view');
  const data = await loadAccountSourceData();
  return buildAccountReport(data, params.month || null, 'all').branchBreakdown;
}

export async function saveAccountReport(report: AccountReport, params: {
  generatedBy: string;
  role: Role;
  overwrite?: boolean;
}): Promise<void> {
  assertCan(params.role, 'account.view');
  const reportId = `${report.month}_${report.branch}`;
  const reportRef = doc(db, 'accountReports', reportId);
  const existing = await getDoc(reportRef);

  if (existing.exists() && !params.overwrite) {
    throw new Error('Account report already exists');
  }

  await setDoc(reportRef, {
    month: report.month,
    branch: report.branch,
    generatedAt: serverTimestamp(),
    generatedBy: params.generatedBy,
    summary: report.summary,
    paymentSummary: report.paymentSummary,
    branchBreakdown: report.branchBreakdown,
    technicianBreakdown: report.technicianBreakdown,
  });
}
