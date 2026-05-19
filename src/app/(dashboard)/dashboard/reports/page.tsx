'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import type { JobDocumentRecord } from '@/features/job-documents/types';
import type { PartsOrder } from '@/features/parts-orders/types';
import type { PartnerJob } from '@/features/genius-partners/types';
import type { Payroll } from '@/features/payroll/types';
import type { JobPayment } from '@/features/payments/types';
import type { WarrantyClaim } from '@/features/warranty-claims/types';
import { calculateJobSla } from '@/features/sla/slaService';

interface ReportData {
  jobs: Job[];
  payroll: Payroll[];
  partsOrders: PartsOrder[];
  jobPayments: JobPayment[];
  partnerJobs: PartnerJob[];
  jobDocuments: JobDocumentRecord[];
  warrantyClaims: WarrantyClaim[];
  users: UserData[];
}

interface BreakdownRow {
  label: string;
  count: number;
  revenue: number;
  cost?: number;
  secondary?: string;
}

function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const format = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  return { startDate: format(start), endDate: format(end) };
}

function timestampToDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  return typeof toDate === 'function' ? toDate.call(value) : null;
}

function timestampToMillis(value: unknown): number | null {
  const date = timestampToDate(value);
  return date ? date.getTime() : null;
}

function dateInRange(value: unknown, startDate: string, endDate: string): boolean {
  const date = timestampToDate(value);
  if (!date) return false;
  const start = new Date(`${startDate}T00:00:00+08:00`).getTime();
  const end = new Date(`${endDate}T23:59:59+08:00`).getTime();
  const time = date.getTime();
  return time >= start && time <= end;
}

function getCompletionTimestamp(job: Job): unknown {
  const completedHistory = (job.statusHistory || [])
    .filter((item) => item.status === 'completed' || item.status === 'collected')
    .at(-1);
  return completedHistory?.changedAt || (job as Job & { updatedAt?: unknown }).updatedAt || (job as Job & { createdAt?: unknown }).createdAt;
}

function isCompletedRevenueJob(job: Job): boolean {
  return job.status === 'completed' || job.status === 'collected';
}

function getJobRevenue(job: Job): number {
  return Number(job.quotationAmount || job.totalSale || 0);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function percent(value: number): string {
  return `${formatNumber(value)}%`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getUserLabel(usersById: Map<string, UserData>, uid: string, fallback?: string): string {
  const user = usersById.get(uid);
  return user?.displayName || user?.name || fallback || 'Unknown User';
}

function getBranchForJob(job: Job, usersById: Map<string, UserData>): string {
  return job.branchId || usersById.get(job.technicianId)?.branchId || 'unknown';
}

function getBarWidth(value: number, maxValue: number): string {
  if (maxValue <= 0) return '0%';
  return `${Math.max(4, Math.min(100, (value / maxValue) * 100))}%`;
}

function SummaryCard({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="flex h-full flex-col rounded-md border border-white/10 bg-[#151515] p-4">
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-400">{note}</div> : null}
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-white/10 pt-5 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

function BarTable({ title, rows, valueLabel }: { title: string; rows: BreakdownRow[]; valueLabel: 'revenue' | 'count' | 'cost' }) {
  const maxValue = Math.max(...rows.map((row) => Number(row[valueLabel] || 0)), 0);

  return (
    <div className="rounded-md border border-white/10 bg-[#151515] p-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? <div className="text-sm text-slate-500">No data</div> : null}
        {rows.map((row) => {
          const value = Number(row[valueLabel] || 0);
          return (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <div className="truncate text-slate-300">{row.label}</div>
                <div className="whitespace-nowrap text-slate-400">
                  {valueLabel === 'count' ? row.count : formatCurrency(value)}
                </div>
              </div>
              <div className="h-2 rounded-full bg-[#1A1A1A]">
                <div className="h-2 rounded-full bg-[#F97316]" style={{ width: getBarWidth(value, maxValue) }} />
              </div>
              {row.secondary ? <div className="mt-1 text-xs text-slate-500">{row.secondary}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { profile, loading } = useUser();
  const monthRange = useMemo(() => getCurrentMonthRange(), []);
  const [startDate, setStartDate] = useState(monthRange.startDate);
  const [endDate, setEndDate] = useState(monthRange.endDate);
  const [branchFilter, setBranchFilter] = useState('all');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [data, setData] = useState<ReportData>({
    jobs: [],
    payroll: [],
    partsOrders: [],
    jobPayments: [],
    partnerJobs: [],
    jobDocuments: [],
    warrantyClaims: [],
    users: [],
  });
  const [pageLoading, setPageLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [nowMs] = useState(() => Date.now());

  const canReadReports = can(profile?.role, 'reports.view');

  const loadData = useCallback(async () => {
    if (!canReadReports || !profile?.role) return;
    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadReports');
      const [jobsSnapshot, payrollSnapshot, partsSnapshot, paymentsSnapshot, partnerSnapshot, documentsSnapshot, claimsSnapshot, usersSnapshot] =
        await Promise.all([
          getDocs(collection(db, 'jobs')),
          getDocs(collection(db, 'payroll')),
          getDocs(collection(db, 'partsOrders')),
          getDocs(collection(db, 'jobPayments')),
          getDocs(collection(db, 'partnerJobs')),
          getDocs(collection(db, 'jobDocuments')),
          getDocs(collection(db, 'warrantyClaims')),
          getDocs(collection(db, 'users')),
        ]);

      setData({
        jobs: jobsSnapshot.docs.map((jobDoc) => ({ docId: jobDoc.id, ...(jobDoc.data() as Omit<Job, 'docId'>) })),
        payroll: payrollSnapshot.docs.map((payrollDoc) => payrollDoc.data() as Payroll),
        partsOrders: partsSnapshot.docs.map((partsDoc) => ({
          partsOrderId: partsDoc.id,
          ...(partsDoc.data() as Omit<PartsOrder, 'partsOrderId'>),
        })),
        jobPayments: paymentsSnapshot.docs.map((paymentDoc) => ({
          paymentId: paymentDoc.id,
          ...(paymentDoc.data() as Omit<JobPayment, 'paymentId'>),
        })),
        partnerJobs: partnerSnapshot.docs.map((partnerDoc) => ({
          partnerJobId: partnerDoc.id,
          ...(partnerDoc.data() as Omit<PartnerJob, 'partnerJobId'>),
        })),
        jobDocuments: documentsSnapshot.docs.map((documentDoc) => ({
          documentId: documentDoc.id,
          ...(documentDoc.data() as Omit<JobDocumentRecord, 'documentId'>),
        })),
        warrantyClaims: claimsSnapshot.docs.map((claimDoc) => ({
          claimId: claimDoc.id,
          ...(claimDoc.data() as Omit<WarrantyClaim, 'claimId'>),
        })),
        users: usersSnapshot.docs.map((userDoc) => ({
          ...(userDoc.data() as UserData),
          uid: String(userDoc.data().uid || userDoc.id),
        })),
      });
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadReports');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadReports');
      setMessage(error instanceof Error ? error.message : 'Unable to load reports');
    } finally {
      setPageLoading(false);
    }
  }, [canReadReports, profile?.role]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const report = useMemo(() => {
    const usersById = new Map(data.users.map((user) => [user.uid, user]));
    const branchOptions = Array.from(
      new Set([
        ...data.jobs.map((job) => getBranchForJob(job, usersById)),
        ...data.users.map((user) => user.branchId).filter(Boolean),
      ]),
    ).sort();
    const technicianOptions = Array.from(
      new Map(
        data.jobs
          .filter((job) => job.technicianId)
          .map((job) => [
            job.technicianId,
            getUserLabel(usersById, job.technicianId, job.technicianName),
          ] as const),
      ).entries(),
    ).sort((left, right) => left[1].localeCompare(right[1]));

    const jobsInRange = data.jobs.filter((job) => {
      const date = (job as Job & { createdAt?: unknown }).createdAt || getCompletionTimestamp(job);
      const matchesDate = dateInRange(date, startDate, endDate);
      const matchesBranch = branchFilter === 'all' || getBranchForJob(job, usersById) === branchFilter;
      const matchesTechnician = technicianFilter === 'all' || job.technicianId === technicianFilter;
      return matchesDate && matchesBranch && matchesTechnician;
    });
    const revenueJobs = data.jobs.filter((job) => {
      const matchesDate = dateInRange(getCompletionTimestamp(job), startDate, endDate);
      const matchesBranch = branchFilter === 'all' || getBranchForJob(job, usersById) === branchFilter;
      const matchesTechnician = technicianFilter === 'all' || job.technicianId === technicianFilter;
      return isCompletedRevenueJob(job) && matchesDate && matchesBranch && matchesTechnician;
    });
    const completedJobs = jobsInRange.filter(isCompletedRevenueJob);
    const cancelledJobs = jobsInRange.filter((job) => job.status === 'cancelled' || job.status === 'rejected');
    const paymentsInRange = data.jobPayments.filter((payment) => dateInRange(payment.paidAt, startDate, endDate));
    const paymentsByJob = new Map<string, JobPayment[]>();
    data.jobPayments.forEach((payment) => {
      const current = paymentsByJob.get(payment.jobId) || [];
      current.push(payment);
      paymentsByJob.set(payment.jobId, current);
    });
    const actualCollectedRevenue = paymentsInRange
      .filter((payment) => ['deposit', 'partial', 'full_payment'].includes(payment.type))
      .reduce((total, payment) => total + Number(payment.amount || 0), 0) -
      paymentsInRange
        .filter((payment) => payment.type === 'refund')
        .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const legacyRevenue = revenueJobs
      .filter((job) => !(paymentsByJob.get(job.docId)?.length))
      .reduce((total, job) => total + getJobRevenue(job), 0);
    const totalRevenue = actualCollectedRevenue + legacyRevenue;
    const outstandingBalance = jobsInRange.reduce((total, job) => total + Number(job.balanceDue || 0), 0);
    const unpaidJobsCount = jobsInRange.filter((job) => !job.paymentStatus || job.paymentStatus === 'unpaid').length;

    const revenueByBranch = new Map<string, BreakdownRow>();
    revenueJobs.forEach((job) => {
      const branch = getBranchForJob(job, usersById);
      const current = revenueByBranch.get(branch) || { label: branch, count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += getJobRevenue(job);
      revenueByBranch.set(branch, current);
    });

    const technicianRows = new Map<string, BreakdownRow & { completed: number; turnaroundHours: number[] }>();
    jobsInRange.forEach((job) => {
      const label = getUserLabel(usersById, job.technicianId, job.technicianName);
      const current = technicianRows.get(job.technicianId) || {
        label,
        count: 0,
        completed: 0,
        revenue: 0,
        turnaroundHours: [],
      };
      current.count += 1;
      if (isCompletedRevenueJob(job)) {
        current.completed += 1;
        current.revenue += getJobRevenue(job);
        const createdAt = timestampToMillis((job as Job & { createdAt?: unknown }).createdAt);
        const completedAt = timestampToMillis(getCompletionTimestamp(job));
        if (createdAt && completedAt && completedAt >= createdAt) {
          current.turnaroundHours.push((completedAt - createdAt) / (1000 * 60 * 60));
        }
      }
      technicianRows.set(job.technicianId, current);
    });

    const partsInRange = data.partsOrders.filter((order) => {
      const date = order.createdAt || order.orderedDate || order.updatedAt;
      const matchesDate = dateInRange(date, startDate, endDate);
      const matchesTechnician = technicianFilter === 'all' || order.technicianId === technicianFilter;
      return matchesDate && matchesTechnician;
    });
    const totalPartsCost = partsInRange.reduce((total, order) => total + Number(order.costPrice || 0), 0);
    const partsByJob = new Map<string, PartsOrder[]>();
    data.partsOrders.forEach((order) => {
      const current = partsByJob.get(order.jobId) || [];
      current.push(order);
      partsByJob.set(order.jobId, current);
    });
    const slaResults = jobsInRange.map((job) => calculateJobSla(job, partsByJob.get(job.docId) || []));
    const overdueJobs = slaResults.filter((sla) => sla.status === 'overdue').length;
    const warningJobs = slaResults.filter((sla) => sla.status === 'warning').length;
    const partsDelayHours = partsInRange
      .map((order) => {
        const ordered = timestampToMillis(order.orderedDate);
        const arrived = timestampToMillis(order.arrivedDate);
        return ordered && arrived && arrived >= ordered ? (arrived - ordered) / (1000 * 60 * 60) : null;
      })
      .filter((value): value is number => value !== null);

    const partnerInRange = data.partnerJobs.filter((job) => dateInRange(job.sentDate || job.createdAt, startDate, endDate));
    const completedPartnerJobs = partnerInRange.filter((job) => job.status === 'completed' || job.status === 'returned');
    const partnerDurations = completedPartnerJobs
      .map((job) => {
        const start = timestampToMillis(job.sentDate);
        const end = timestampToMillis(job.updatedAt);
        return start && end && end >= start ? (end - start) / (1000 * 60 * 60 * 24) : null;
      })
      .filter((value): value is number => value !== null);
    const totalOutsourceCost = partnerInRange.reduce((total, job) => {
      const cost = (job as PartnerJob & { outsourceCost?: number; costPrice?: number }).outsourceCost ||
        (job as PartnerJob & { outsourceCost?: number; costPrice?: number }).costPrice ||
        0;
      return total + Number(cost || 0);
    }, 0);

    const warrantyDocuments = data.jobDocuments.filter((documentRecord) => documentRecord.type === 'warranty');
    const activeWarranties = warrantyDocuments.filter((documentRecord) => {
      const end = timestampToMillis(documentRecord.warrantyEndDate);
      return end !== null && end >= nowMs;
    });
    const expiredWarranties = warrantyDocuments.filter((documentRecord) => {
      const end = timestampToMillis(documentRecord.warrantyEndDate);
      return end !== null && end < nowMs;
    });
    const claimsInRange = data.warrantyClaims.filter((claim) => dateInRange(claim.createdAt, startDate, endDate));
    const approvedClaims = claimsInRange.filter((claim) => claim.status === 'approved' || claim.status === 'in_repair' || claim.status === 'completed');
    const rejectedClaims = claimsInRange.filter((claim) => claim.status === 'rejected');

    const payrollInRange = data.payroll.filter((payroll) => {
      const month = payroll.month;
      return month >= startDate.slice(0, 7) && month <= endDate.slice(0, 7);
    });
    const payrollCost = payrollInRange.reduce((total, payroll) => total + Number(payroll.netSalary || 0), 0);

    return {
      branchOptions,
      technicianOptions,
      totalJobs: jobsInRange.length,
      completedJobs: completedJobs.length,
      cancelledJobs: cancelledJobs.length,
      overdueJobs,
      warningJobs,
      conversionRate: jobsInRange.length ? (completedJobs.length / jobsInRange.length) * 100 : 0,
      totalRevenue,
      legacyRevenue,
      actualCollectedRevenue,
      outstandingBalance,
      unpaidJobsCount,
      payrollCost,
      estimatedProfit: totalRevenue - payrollCost - totalPartsCost - totalOutsourceCost,
      revenueByBranch: Array.from(revenueByBranch.values()).sort((left, right) => right.revenue - left.revenue),
      technicianRows: Array.from(technicianRows.values())
        .map((row) => ({
          ...row,
          secondary: `${row.completed} completed · Avg turnaround ${formatNumber(average(row.turnaroundHours))}h`,
        }))
        .sort((left, right) => right.revenue - left.revenue),
      parts: {
        totalOrdered: partsInRange.length,
        totalCost: totalPartsCost,
        averageCostPerJob: revenueJobs.length ? totalPartsCost / revenueJobs.length : 0,
        averageDelayHours: average(partsDelayHours),
      },
      partner: {
        totalJobs: partnerInRange.length,
        totalCost: totalOutsourceCost,
        averageDurationDays: average(partnerDurations),
        completionRate: partnerInRange.length ? (completedPartnerJobs.length / partnerInRange.length) * 100 : 0,
      },
      warranty: {
        active: activeWarranties.length,
        expired: expiredWarranties.length,
        claims: claimsInRange.length,
        approvedClaims: approvedClaims.length,
        rejectedClaims: rejectedClaims.length,
      },
    };
  }, [branchFilter, data, endDate, startDate, technicianFilter]);

  if (loading) return <div className="text-sm text-slate-400">Loading reports</div>;

  if (!canReadReports) {
    return (
      <section className="rounded-md border border-white/10 bg-[#151515] p-6">
        <h1 className="text-xl font-semibold text-white">Reports</h1>
        <p className="mt-2 text-sm text-slate-400">Admin or manager access is required.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">Business insights across jobs, payroll, parts, partners, and warranty.</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={pageLoading}
          className="rounded-md border border-orange-500/30 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
        >
          {pageLoading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {message ? <div className="mb-4 rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-300">{message}</div> : null}

      <div className="mb-4 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-4">
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All branches</option>
          {report.branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select>
        <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All technicians</option>
          {report.technicianOptions.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
        </select>
      </div>

      <ReportSection title="Financial Overview">
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Collected Revenue" value={formatCurrency(report.totalRevenue)} note="Uses payments when available, legacy job value as fallback" />
          <SummaryCard title="Payroll Cost" value={formatCurrency(report.payrollCost)} note="Payroll snapshots in range" />
          <SummaryCard title="Estimated Profit" value={formatCurrency(report.estimatedProfit)} note="Revenue minus payroll, parts, outsource cost" />
          <SummaryCard title="Conversion Rate" value={percent(report.conversionRate)} note={`${report.completedJobs} completed / ${report.totalJobs} total`} />
        </div>
      </ReportSection>

      <ReportSection title="Job Performance">
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard title="Total Jobs" value={String(report.totalJobs)} />
          <SummaryCard title="Completed Jobs" value={String(report.completedJobs)} />
          <SummaryCard title="Cancelled Jobs" value={String(report.cancelledJobs)} />
          <SummaryCard title="Outstanding Balance" value={formatCurrency(report.outstandingBalance)} />
          <SummaryCard title="Unpaid Jobs" value={String(report.unpaidJobsCount)} />
        </div>
      </ReportSection>

      <ReportSection title="SLA Monitoring">
        <div className="grid items-stretch gap-4 md:grid-cols-2">
          <SummaryCard title="SLA Overdue Jobs" value={String(report.overdueJobs)} note="Jobs past the current stage SLA threshold" />
          <SummaryCard title="SLA Warning Jobs" value={String(report.warningJobs)} note="Jobs nearing the SLA threshold or blocked by payment" />
        </div>
      </ReportSection>

      <ReportSection title="Revenue Breakdown">
        <div className="grid gap-4 xl:grid-cols-2">
          <BarTable title="Revenue by Branch" rows={report.revenueByBranch} valueLabel="revenue" />
          <BarTable title="Revenue by Technician" rows={report.technicianRows} valueLabel="revenue" />
        </div>
      </ReportSection>

      <ReportSection title="Parts & Cost">
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Parts Ordered" value={String(report.parts.totalOrdered)} />
          <SummaryCard title="Total Parts Cost" value={formatCurrency(report.parts.totalCost)} />
          <SummaryCard title="Avg Cost Per Job" value={formatCurrency(report.parts.averageCostPerJob)} />
          <SummaryCard title="Avg Parts Delay" value={`${formatNumber(report.parts.averageDelayHours)}h`} note="Ordered to arrived" />
        </div>
      </ReportSection>

      <ReportSection title="Outsource">
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Outsourced Jobs" value={String(report.partner.totalJobs)} />
          <SummaryCard title="Outsource Cost" value={formatCurrency(report.partner.totalCost)} note="Uses cost field if present" />
          <SummaryCard title="Avg Outsource Duration" value={`${formatNumber(report.partner.averageDurationDays)}d`} />
          <SummaryCard title="Outsource Completion" value={percent(report.partner.completionRate)} />
        </div>
      </ReportSection>

      <ReportSection title="Warranty">
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard title="Active Warranties" value={String(report.warranty.active)} />
          <SummaryCard title="Expired Warranties" value={String(report.warranty.expired)} />
          <SummaryCard title="Warranty Claims" value={String(report.warranty.claims)} />
          <SummaryCard title="Approved Claims" value={String(report.warranty.approvedClaims)} />
          <SummaryCard title="Rejected Claims" value={String(report.warranty.rejectedClaims)} />
        </div>
      </ReportSection>

      <ReportSection title="Technician KPI">
        <div className="rounded-md border border-white/10 bg-[#151515] p-4">
          <h2 className="text-lg font-semibold text-white">Technician KPI</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Technician</th>
                  <th className="px-4 py-3">Jobs Handled</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Revenue</th>
                  <th className="px-4 py-3">Avg Turnaround</th>
                </tr>
              </thead>
              <tbody>
                {report.technicianRows.map((row) => (
                  <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                    <td className="px-4 py-3 text-white">{row.label}</td>
                    <td className="px-4 py-3 text-slate-300">{row.count}</td>
                    <td className="px-4 py-3 text-slate-300">{(row as BreakdownRow & { completed: number }).completed}</td>
                    <td className="px-4 py-3 text-slate-300">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-3 text-slate-300">{row.secondary?.split('Avg turnaround ')[1] || '0h'}</td>
                  </tr>
                ))}
                {report.technicianRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No technician KPI data</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </ReportSection>
    </section>
  );
}
