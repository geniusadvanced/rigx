'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  approvePayroll,
  closePayrollMonth,
  createPayrollAdjustment,
  generatePayrollForTechnician,
  getPayrollMonth,
  getPayrollPreRunChecklist,
  logPayslipGenerated,
  markPayrollPaid,
  reopenPayrollMonth,
} from '@/features/payroll/services/payrollService';
import { PayslipPreviewModal } from '@/features/payroll/components/PayslipPreviewModal';
import type { Payroll, PayrollAdjustmentType, PayrollPreRunChecklist } from '@/features/payroll/types';
import { canGeneratePayslip, generatePayslipPdf } from '@/features/payroll/utils/generatePayslipPdf';
import {
  getApprovedCommissionsForTechnicianMonth,
  getPosCommissionsForPayroll,
  linkApprovedCommissionsToPayroll,
  markPayrollLinkedCommissionsAsPaid,
} from '@/features/pos/posService';
import type { PosCommissionEntry } from '@/features/pos/types';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdmin } from '@/lib/rbac/can';
import type { UserData } from '@/types';

interface TechnicianOption {
  uid: string;
  staffId?: string;
  displayName?: string;
  branchId?: string;
}

interface BatchResult {
  technicianId: string;
  label: string;
  status: 'generated' | 'skipped' | 'failed';
  message: string;
}

interface AdjustmentFormState {
  technicianId: string;
  technicianLabel: string;
  type: PayrollAdjustmentType;
  category: string;
  amount: string;
  reason: string;
}

function getCurrentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function buildWorkingDays(month: string, workingDaysCount: number): string[] {
  if (!month || !workingDaysCount) return [];

  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const count = Math.min(workingDaysCount, daysInMonth);

  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(value || 0);
}

function getStatusClass(status?: string): string {
  if (status === 'approved') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'paid') return 'border-amber-500/35 text-amber-300';
  return 'border-white/15 text-slate-300';
}

function getSyncStatusClass(status?: string): string {
  if (status === 'Ready') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'Blocked') return 'border-red-500/40 text-red-300';
  return 'border-amber-500/40 text-amber-300';
}

function PayrollPosCommissionPanel({
  payroll,
  profile,
  onLinked,
}: {
  payroll: Payroll;
  profile: UserData;
  onLinked: () => Promise<void>;
}) {
  const [approvedEntries, setApprovedEntries] = useState<PosCommissionEntry[]>([]);
  const [linkedEntries, setLinkedEntries] = useState<PosCommissionEntry[]>([]);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [commissionMessage, setCommissionMessage] = useState('');

  const approvedTotal = useMemo(
    () => approvedEntries.reduce((total, entry) => total + Number(entry.commissionAmount || 0), 0),
    [approvedEntries],
  );
  const linkedTotal = useMemo(
    () => linkedEntries.reduce((total, entry) => total + Number(entry.commissionAmount || 0), 0),
    [linkedEntries],
  );

  const loadCommissions = useCallback(async () => {
    setLoadingCommissions(true);
    setCommissionMessage('');
    try {
      const [approvedResult, linkedRows] = await Promise.all([
        getApprovedCommissionsForTechnicianMonth(payroll.technicianId, payroll.month, profile),
        getPosCommissionsForPayroll(payroll.payrollId, profile),
      ]);
      setApprovedEntries(approvedResult.entries);
      setLinkedEntries(linkedRows);
    } catch (error) {
      setCommissionMessage(error instanceof Error ? error.message : 'Unable to load POS commissions');
    } finally {
      setLoadingCommissions(false);
    }
  }, [payroll.month, payroll.payrollId, payroll.technicianId, profile]);

  useEffect(() => {
    void loadCommissions();
  }, [loadCommissions]);

  async function handleLinkCommissions() {
    if (!window.confirm('Link approved POS commissions to this payroll?')) return;
    setLoadingCommissions(true);
    setCommissionMessage('');
    try {
      const result = await linkApprovedCommissionsToPayroll({
        technicianId: payroll.technicianId,
        month: payroll.month,
        payrollId: payroll.payrollId,
        linkedBy: profile.uid,
      }, profile);
      setCommissionMessage(`Linked ${result.entries.length} POS commission entries`);
      await loadCommissions();
      await onLinked();
    } catch (error) {
      setCommissionMessage(error instanceof Error ? error.message : 'Unable to link POS commissions');
    } finally {
      setLoadingCommissions(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">POS Commissions</h3>
          <div className="mt-1 text-xs text-slate-500">Approved POS commissions available for this technician and month</div>
        </div>
        <button
          type="button"
          onClick={handleLinkCommissions}
          disabled={loadingCommissions || approvedEntries.length === 0 || payroll.status === 'paid'}
          className="rounded-md border border-orange-500/25 px-3 py-2 text-xs text-orange-200 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Link Approved POS Commissions
        </button>
      </div>
      {commissionMessage ? <div className="mt-3 text-sm text-slate-300">{commissionMessage}</div> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-white/10 bg-[#151515] p-3">
          <div className="text-xs uppercase text-slate-500">Available Approved</div>
          <div className="mt-1 text-lg font-semibold text-white">{formatCurrency(approvedTotal)}</div>
        </div>
        <div className="rounded-md border border-white/10 bg-[#151515] p-3">
          <div className="text-xs uppercase text-slate-500">Already Linked</div>
          <div className="mt-1 text-lg font-semibold text-white">{formatCurrency(linkedTotal)}</div>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {[...approvedEntries, ...linkedEntries].map((entry) => (
              <tr key={entry.entryId} className="border-b border-white/10 last:border-b-0">
                <td className="px-3 py-3 text-slate-300">{entry.itemName}</td>
                <td className="px-3 py-3 text-slate-300">{entry.invoiceId}</td>
                <td className="px-3 py-3 text-slate-300">{formatCurrency(entry.commissionAmount)}</td>
                <td className="px-3 py-3 text-slate-300">{entry.status}</td>
              </tr>
            ))}
            {approvedEntries.length === 0 && linkedEntries.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No POS commissions for this payroll</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [month, setMonth] = useState(getCurrentMonth);
  const [workingDaysInMonth, setWorkingDaysInMonth] = useState('26');
  const [branchFilter, setBranchFilter] = useState('all');
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [payrollRows, setPayrollRows] = useState<Payroll[]>([]);
  const [preRunChecklist, setPreRunChecklist] = useState<PayrollPreRunChecklist | null>(null);
  const [payrollMonthStatus, setPayrollMonthStatus] = useState<'open' | 'closed'>('open');
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null);
  const [previewPayroll, setPreviewPayroll] = useState<Payroll | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState('');
  const [statusActionId, setStatusActionId] = useState('');
  const [message, setMessage] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentFormState | null>(null);
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);

  const canAccess = can(profile?.role, 'payroll.view.all');
  const workingDays = useMemo(
    () => buildWorkingDays(month, Number(workingDaysInMonth)),
    [month, workingDaysInMonth],
  );
  const payrollByTechnician = useMemo(() => {
    return new Map(payrollRows.map((payroll) => [payroll.technicianId, payroll]));
  }, [payrollRows]);
  const branchOptions = useMemo(() => {
    return Array.from(new Set(technicians.map((technician) => technician.branchId).filter(Boolean))).sort();
  }, [technicians]);
  const visibleTechnicians = useMemo(() => {
    if (branchFilter === 'all') return technicians;
    return technicians.filter((technician) => technician.branchId === branchFilter);
  }, [branchFilter, technicians]);
  const visibleTechnicianIds = useMemo(() => {
    return new Set(visibleTechnicians.map((technician) => technician.uid));
  }, [visibleTechnicians]);
  const blockedTechnicianIds = useMemo(() => {
    return new Set(preRunChecklist?.blockedTechnicianIds ?? []);
  }, [preRunChecklist]);
  const visibleCriticalIssues = useMemo(() => {
    return (preRunChecklist?.criticalIssues ?? []).filter((issue) => visibleTechnicianIds.has(issue.technicianId));
  }, [preRunChecklist, visibleTechnicianIds]);
  const visibleWarnings = useMemo(() => {
    return (preRunChecklist?.warnings ?? []).filter((issue) => visibleTechnicianIds.has(issue.technicianId));
  }, [preRunChecklist, visibleTechnicianIds]);
  const visibleReadyCount = useMemo(() => {
    return (preRunChecklist?.readyTechnicianIds ?? []).filter((technicianId) => visibleTechnicianIds.has(technicianId))
      .length;
  }, [preRunChecklist, visibleTechnicianIds]);
  const visibleAttendanceSync = useMemo(() => {
    return (preRunChecklist?.attendanceSync ?? []).filter((sync) => visibleTechnicianIds.has(sync.technicianId));
  }, [preRunChecklist, visibleTechnicianIds]);
  const hasDraftPayrollForMonth = useMemo(() => {
    return payrollRows.some((payroll) => payroll.month === month && payroll.status === 'draft');
  }, [month, payrollRows]);
  const monthSummary = useMemo(() => {
    return payrollRows.reduce(
      (summary, payroll) => ({
        totalTechnicians: summary.totalTechnicians + 1,
        totalBaseSalary: summary.totalBaseSalary + Number(payroll.baseSalary || 0),
        totalCommission: summary.totalCommission + Number(payroll.approvedCommission || 0),
        totalDeductions: summary.totalDeductions + Number(payroll.deductions?.totalDeduction || 0),
        totalNetSalary: summary.totalNetSalary + Number(payroll.netSalary || 0),
      }),
      {
        totalTechnicians: 0,
        totalBaseSalary: 0,
        totalCommission: 0,
        totalDeductions: 0,
        totalNetSalary: 0,
      },
    );
  }, [payrollRows]);
  const hasMissingClockOut = useMemo(() => {
    return (preRunChecklist?.attendanceSync ?? []).some((sync) => sync.recordsMissingClockOut.length > 0);
  }, [preRunChecklist]);
  const hasBlockedTechnicians = useMemo(() => {
    return (preRunChecklist?.blockedTechnicianIds ?? []).length > 0;
  }, [preRunChecklist]);
  const hasUnapprovedPayroll = useMemo(() => {
    return payrollRows.some((payroll) => payroll.status !== 'approved' && payroll.status !== 'paid');
  }, [payrollRows]);
  const closeBlockedReason = useMemo(() => {
    if (hasDraftPayrollForMonth) return 'Cannot close month while draft payroll remains';
    if (hasMissingClockOut) return 'Cannot close month while attendance records are missing clock-out';
    if (hasBlockedTechnicians) return 'Cannot close month while blocked technicians remain';
    if (hasUnapprovedPayroll) return 'Cannot close month until all payroll is approved or paid';
    if (payrollRows.length === 0) return 'Cannot close month without generated payroll';
    return '';
  }, [hasBlockedTechnicians, hasDraftPayrollForMonth, hasMissingClockOut, hasUnapprovedPayroll, payrollRows.length]);

  const loadTechnicians = useCallback(async () => {
    const techniciansQuery = query(
      collection(db, 'users'),
      where('role', '==', 'technician'),
      where('isActive', '==', true),
    );
    const snapshot = await getDocs(techniciansQuery);

    setTechnicians(
      snapshot.docs.map((technicianDoc) => {
        const data = technicianDoc.data();
        return {
          uid: data.uid || technicianDoc.id,
          staffId: data.staffId,
          displayName: data.displayName,
          branchId: data.branchId,
        };
      }),
    );
  }, []);

  const loadPayrollRows = useCallback(async () => {
    const payrollQuery = query(collection(db, 'payroll'), where('month', '==', month));
    const snapshot = await getDocs(payrollQuery);

    setPayrollRows(
      snapshot.docs.map((payrollDoc) => ({
        ...(payrollDoc.data() as Payroll),
        payrollId: payrollDoc.id,
      })),
    );
  }, [month]);

  const loadPreRunChecklist = useCallback(async () => {
    const checklist = await getPayrollPreRunChecklist(month, {
      workingDaysInMonth: workingDays,
    });
    setPreRunChecklist(checklist);
  }, [month, workingDays]);

  const loadPayrollMonth = useCallback(async () => {
    const payrollMonth = await getPayrollMonth(month);
    setPayrollMonthStatus(payrollMonth?.status || 'open');
  }, [month]);

  useEffect(() => {
    if (!canAccess || !profile?.role) return;

    setPageLoading(true);
    setMessage('');
    setProgressMessage('');
    setSelectedPayroll(null);
    setBatchResults([]);
    setAdjustmentForm(null);

    if (process.env.NODE_ENV === 'development') console.time('loadPayrollPage');
    Promise.all([loadTechnicians(), loadPayrollRows(), loadPreRunChecklist(), loadPayrollMonth()])
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Unable to load payroll data');
      })
      .finally(() => {
        if (process.env.NODE_ENV === 'development') console.timeEnd('loadPayrollPage');
        setPageLoading(false);
      });
  }, [canAccess, loadPayrollMonth, loadPayrollRows, loadPreRunChecklist, loadTechnicians, profile?.role]);

  async function handleGenerate(technicianId: string) {
    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    if (blockedTechnicianIds.has(technicianId)) {
      setMessage('Resolve this technician critical checklist issues before generating payroll');
      return;
    }

    if (payrollMonthStatus === 'closed') {
      setMessage(`Payroll month ${month} is closed`);
      return;
    }

    setGeneratingId(technicianId);
    setMessage('');
    setProgressMessage('');
    setBatchResults([]);

    try {
      await generatePayrollForTechnician({
        technicianId,
        month,
        generatedBy: firebaseUser.uid,
        generatedByRole: profile.role,
        workingDaysInMonth: workingDays,
      });
      setMessage('Payroll generated');
      await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate payroll');
    } finally {
      setGeneratingId('');
    }
  }

  async function handleApprove(payrollId: string) {
    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    setStatusActionId(payrollId);
    setMessage('');

    try {
      await approvePayroll({
        payrollId,
        approvedBy: firebaseUser.uid,
        approvedByRole: profile.role,
      });
      setMessage('Payroll approved and locked');
      await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve payroll');
    } finally {
      setStatusActionId('');
    }
  }

  async function handleMarkPaid(payrollId: string) {
    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    if (visibleCriticalIssues.length > 0) {
      setMessage('Resolve critical payroll checklist issues before generating payroll for all');
      return;
    }

    if (payrollMonthStatus === 'closed') {
      setMessage(`Payroll month ${month} is closed`);
      return;
    }

    setStatusActionId(payrollId);
    setMessage('');

    try {
      await markPayrollPaid({
        payrollId,
        paidBy: firebaseUser.uid,
        paidByRole: profile.role,
      });
      await markPayrollLinkedCommissionsAsPaid(payrollId, firebaseUser.uid, profile);
      setMessage('Payroll marked as paid and locked');
      await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to mark payroll as paid');
    } finally {
      setStatusActionId('');
    }
  }

  async function handleGenerateAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    setGeneratingId('all');
    setMessage('');
    setProgressMessage('');
    setBatchResults([]);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const nextBatchResults: BatchResult[] = [];

    for (let index = 0; index < visibleTechnicians.length; index += 1) {
      const technician = visibleTechnicians[index];
      const label = technician.displayName || 'Unknown User';
      setProgressMessage(`Generating ${index + 1} of ${visibleTechnicians.length}`);

      try {
        await generatePayrollForTechnician({
          technicianId: technician.uid,
          month,
          generatedBy: firebaseUser.uid,
          generatedByRole: profile.role,
          workingDaysInMonth: workingDays,
        });
        successCount += 1;
        nextBatchResults.push({
          technicianId: technician.uid,
          label,
          status: 'generated',
          message: 'Generated',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '';
        if (errorMessage.includes('locked') || errorMessage.includes('approved') || errorMessage.includes('paid')) {
          skippedCount += 1;
          nextBatchResults.push({
            technicianId: technician.uid,
            label,
            status: 'skipped',
            message: errorMessage || 'Skipped',
          });
        } else {
          failCount += 1;
          console.error('Payroll batch generation failed', {
            technicianId: technician.uid,
            errorMessage: errorMessage || 'Failed',
          });
          nextBatchResults.push({
            technicianId: technician.uid,
            label,
            status: 'failed',
            message: errorMessage || 'Failed',
          });
        }

        setBatchResults([...nextBatchResults]);
      }

      setBatchResults([...nextBatchResults]);
    }

    setMessage(`Generated: ${successCount}. Skipped: ${skippedCount}. Failed: ${failCount}.`);
    setProgressMessage('');
    setGeneratingId('');
    await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
  }

  async function handleCloseMonth() {
    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    if (!isAdmin(profile?.role)) {
      setMessage('Admin access required to close payroll month');
      return;
    }

    if (closeBlockedReason) {
      setMessage(closeBlockedReason);
      return;
    }

    setStatusActionId(`close-month-${month}`);
    setMessage('');

    try {
      await closePayrollMonth({
        month,
        closedBy: firebaseUser.uid,
        closedByRole: profile.role,
      });
      setMessage(`Payroll month ${month} closed`);
      await Promise.all([loadPayrollRows(), loadPreRunChecklist(), loadPayrollMonth()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to close payroll month');
    } finally {
      setStatusActionId('');
    }
  }

  async function handleReopenMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    if (!isAdmin(profile?.role)) {
      setMessage('Admin access required to reopen payroll month');
      return;
    }

    setStatusActionId(`reopen-month-${month}`);
    setMessage('');

    try {
      await reopenPayrollMonth({
        month,
        reopenedBy: firebaseUser.uid,
        reopenedByRole: profile.role,
        reason: reopenReason,
      });
      setReopenReason('');
      setMessage(`Payroll month ${month} reopened`);
      await Promise.all([loadPayrollRows(), loadPreRunChecklist(), loadPayrollMonth()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reopen payroll month');
    } finally {
      setStatusActionId('');
    }
  }

  async function handleCreateAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !adjustmentForm) {
      setMessage('Current user is not loaded');
      return;
    }

    setAdjustmentSaving(true);
    setMessage('');

    try {
      await createPayrollAdjustment({
        technicianId: adjustmentForm.technicianId,
        month,
        type: adjustmentForm.type,
        category: adjustmentForm.category,
        amount: Number(adjustmentForm.amount),
        reason: adjustmentForm.reason,
        createdBy: firebaseUser.uid,
        createdByRole: profile.role,
      });
      setMessage('Payroll adjustment added. Regenerate draft payroll to include it.');
      setAdjustmentForm(null);
      await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add payroll adjustment');
    } finally {
      setAdjustmentSaving(false);
    }
  }

  async function handleDownloadPayslip(payroll: Payroll, generatedOn: Date) {
    if (!profile?.uid) {
      setMessage('Current user is not loaded');
      return;
    }

    try {
      const fileName = generatePayslipPdf(payroll, profile, { generatedOn });
      await logPayslipGenerated({
        userId: profile.uid,
        payrollId: payroll.payrollId,
        fileName,
      });
      setPreviewPayroll(null);
      setMessage('Payslip downloaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate payslip');
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading payroll</div>;
  }

  if (!canAccess) {
    return <div className="text-sm text-red-300">Admin or manager access required</div>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Payroll</h1>
        <p className="mt-1 text-sm text-slate-400">Monthly salary, commission, and deduction summary</p>
      </div>

      <form onSubmit={handleGenerateAll} className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Payroll Pre-Run Checklist</h2>
              <div className="mt-1 text-sm text-slate-400">
                {month} readiness before monthly generation · Month {payrollMonthStatus}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {pageLoading ? <div className="text-sm text-slate-400">Checking</div> : null}
              {isAdmin(profile?.role) ? (
                <button
                  type="button"
                  onClick={handleCloseMonth}
                  disabled={
                    pageLoading ||
                    payrollMonthStatus === 'closed' ||
                    Boolean(closeBlockedReason) ||
                    Boolean(statusActionId)
                  }
                  className="rounded-md border border-red-700/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {statusActionId === `close-month-${month}` ? 'Closing Month' : 'Close Month'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mb-3 grid gap-3 md:grid-cols-5">
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Technicians</div>
              <div className="mt-1 text-lg font-semibold text-white">{monthSummary.totalTechnicians}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Base Salary</div>
              <div className="mt-1 text-lg font-semibold text-white">{formatCurrency(monthSummary.totalBaseSalary)}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Commission</div>
              <div className="mt-1 text-lg font-semibold text-white">{formatCurrency(monthSummary.totalCommission)}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Deductions</div>
              <div className="mt-1 text-lg font-semibold text-white">{formatCurrency(monthSummary.totalDeductions)}</div>
            </div>
            <div className="rounded-md border border-orange-500/25 bg-[#1F160E] p-3">
              <div className="text-xs uppercase text-orange-200">Net Payout</div>
              <div className="mt-1 text-lg font-semibold text-orange-100">{formatCurrency(monthSummary.totalNetSalary)}</div>
            </div>
          </div>

          {isAdmin(profile?.role) && payrollMonthStatus === 'closed' ? (
            <form onSubmit={handleReopenMonth} className="mb-3 rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
              <div className="mb-2 text-sm font-semibold text-amber-100">Reopen Month</div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={reopenReason}
                  onChange={(event) => setReopenReason(event.target.value)}
                  required
                  placeholder="Reason for reopening"
                  className="rounded-md border border-amber-700/50 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
                <button
                  type="submit"
                  disabled={Boolean(statusActionId)}
                  className="rounded-md border border-amber-700/60 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {statusActionId === `reopen-month-${month}` ? 'Reopening' : 'Reopen Month'}
                </button>
              </div>
            </form>
          ) : null}

          {isAdmin(profile?.role) && closeBlockedReason && payrollMonthStatus !== 'closed' ? (
            <div className="mb-3 rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-100">
              {closeBlockedReason}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-red-500/30 bg-red-950/20 p-3">
              <div className="text-xs uppercase text-red-200">Critical issues</div>
              <div className="mt-1 text-2xl font-semibold text-red-100">{visibleCriticalIssues.length}</div>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
              <div className="text-xs uppercase text-amber-200">Warnings</div>
              <div className="mt-1 text-2xl font-semibold text-amber-100">{visibleWarnings.length}</div>
            </div>
            <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3">
              <div className="text-xs uppercase text-emerald-200">Ready count</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-100">{visibleReadyCount}</div>
            </div>
          </div>

          {preRunChecklist ? (
            <>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                  <div className="mb-2 text-sm font-semibold text-white">Critical</div>
                  {visibleCriticalIssues.length === 0 ? (
                    <div className="text-sm text-slate-400">No blocking issues for visible technicians</div>
                  ) : (
                    <div className="space-y-2">
                      {visibleCriticalIssues.map((issue, index) => (
                        <div key={`${issue.technicianId}-${issue.code}-${index}`} className="text-sm text-red-200">
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                  <div className="mb-2 text-sm font-semibold text-white">Warnings</div>
                  {visibleWarnings.length === 0 ? (
                    <div className="text-sm text-slate-400">No warnings for visible technicians</div>
                  ) : (
                    <div className="space-y-2">
                      {visibleWarnings.map((issue, index) => (
                        <div key={`${issue.technicianId}-${issue.code}-${index}`} className="text-sm text-amber-200">
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-md border border-white/10 bg-[#050505] p-3">
                <div className="mb-3 text-sm font-semibold text-white">Attendance Payroll Sync</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Technician</th>
                        <th className="px-3 py-2">Expected Days</th>
                        <th className="px-3 py-2">Records</th>
                        <th className="px-3 py-2">Missing Attendance</th>
                        <th className="px-3 py-2">Missing Clock Out</th>
                        <th className="px-3 py-2">Approved Leave</th>
                        <th className="px-3 py-2">Corrections</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAttendanceSync.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                            No attendance sync records found
                          </td>
                        </tr>
                      ) : null}

                      {visibleAttendanceSync.map((sync) => (
                        <tr key={sync.technicianId} className="border-b border-white/10 last:border-b-0">
                          <td className="px-3 py-3 text-slate-200">
                            {sync.displayName || 'Unknown User'}
                            {sync.staffId ? <div className="mt-1 text-xs text-slate-500">{sync.staffId}</div> : null}
                          </td>
                          <td className="px-3 py-3 text-slate-300">{sync.expectedWorkingDays}</td>
                          <td className="px-3 py-3 text-slate-300">{sync.attendanceRecordsFound}</td>
                          <td className="px-3 py-3 text-amber-300">{sync.missingAttendanceDays.length}</td>
                          <td className="px-3 py-3 text-red-300">{sync.recordsMissingClockOut.length}</td>
                          <td className="px-3 py-3 text-slate-300">{sync.approvedLeaveDays}</td>
                          <td className="px-3 py-3 text-amber-300">{sync.correctionNotes}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full border px-2 py-1 text-xs ${getSyncStatusClass(sync.status)}`}>
                              {sync.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Missing attendance without approved leave is shown as a warning and remains payroll-deductible.
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-[180px_180px_180px_1fr]">
          <label className="block text-sm text-slate-300">
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              required
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Working Days
            <input
              type="number"
              value={workingDaysInMonth}
              onChange={(event) => setWorkingDaysInMonth(event.target.value)}
              min="1"
              required
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Branch
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All branches</option>
              {branchOptions.map((branchId) => (
                <option key={branchId} value={branchId}>
                  {branchId}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={
                pageLoading ||
                generatingId === 'all' ||
                visibleTechnicians.length === 0 ||
                visibleCriticalIssues.length > 0 ||
                payrollMonthStatus === 'closed'
              }
              className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generatingId === 'all' ? 'Generating All' : 'Generate Payroll for All Active Technicians'}
            </button>
          </div>
        </div>

        {progressMessage ? <div className="mt-4 text-sm text-orange-200">{progressMessage}</div> : null}
        {message ? <div className="mt-4 text-sm text-slate-300">{message}</div> : null}
        {batchResults.length > 0 ? (
          <div className="mt-4 space-y-1 border-t border-white/10 pt-3">
            {batchResults.map((result) => (
              <div
                key={result.technicianId}
                className={`text-xs ${
                  result.status === 'generated'
                    ? 'text-emerald-300'
                    : result.status === 'skipped'
                      ? 'text-amber-300'
                      : 'text-red-300'
                }`}
              >
                {result.label}: {result.message}
              </div>
            ))}
          </div>
        ) : null}
      </form>

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Technician Payroll</h2>
          <div className="mt-1 text-sm text-slate-400">
            {pageLoading ? 'Loading payroll' : `${visibleTechnicians.length} active technicians · ${month}`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Staff ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Base Salary</th>
                <th className="px-3 py-2">Approved Commission</th>
                <th className="px-3 py-2">Deductions</th>
                <th className="px-3 py-2">Net Salary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleTechnicians.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    No active technicians found
                  </td>
                </tr>
              ) : null}

              {visibleTechnicians.map((technician) => {
                const payroll = payrollByTechnician.get(technician.uid);
                const isLocked = payroll?.status === 'approved' || payroll?.status === 'paid';
                const isStatusBusy = payroll ? statusActionId === payroll.payrollId : false;
                const canAddAdjustment = !payroll || payroll.status === 'draft';
                const hasCriticalIssue = blockedTechnicianIds.has(technician.uid);

                return (
                  <tr key={technician.uid} className="border-b border-white/10 last:border-b-0">
                    <td className="px-3 py-3 text-slate-300">{payroll?.staffId || technician.staffId || '-'}</td>
                    <td className="px-3 py-3 text-slate-200">{payroll?.displayName || technician.displayName || 'Unknown User'}</td>
                    <td className="px-3 py-3 text-slate-300">{payroll?.branchId || technician.branchId || '-'}</td>
                    <td className="px-3 py-3 text-slate-300">{payroll ? formatCurrency(payroll.baseSalary) : '-'}</td>
                    <td className="px-3 py-3 text-slate-300">{payroll ? formatCurrency(payroll.approvedCommission) : '-'}</td>
                    <td className="px-3 py-3 text-slate-300">{payroll ? formatCurrency(payroll.deductions?.totalDeduction) : '-'}</td>
                    <td className="px-3 py-3 text-orange-200">{payroll ? formatCurrency(payroll.netSalary) : '-'}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2 py-1 text-xs ${getStatusClass(payroll?.status)}`}>
                        {payroll?.status || 'not generated'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerate(technician.uid)}
                          disabled={
                            Boolean(generatingId) ||
                            Boolean(statusActionId) ||
                            isLocked ||
                            hasCriticalIssue ||
                            payrollMonthStatus === 'closed'
                          }
                          className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {generatingId === technician.uid
                            ? 'Generating'
                            : payroll
                              ? 'Regenerate Payroll'
                              : 'Generate Payroll'}
                        </button>
                        <button
                          type="button"
                          onClick={() => payroll && setSelectedPayroll(payroll)}
                          disabled={!payroll}
                          className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          View Details
                        </button>
                        {payroll?.status === 'draft' ? (
                          <button
                            type="button"
                            onClick={() => handleApprove(payroll.payrollId)}
                            disabled={Boolean(generatingId) || Boolean(statusActionId)}
                            className="rounded-md border border-emerald-700/60 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isStatusBusy ? 'Approving' : 'Approve'}
                          </button>
                        ) : null}
                        {payroll?.status === 'approved' ? (
                          <button
                            type="button"
                            onClick={() => handleMarkPaid(payroll.payrollId)}
                            disabled={Boolean(generatingId) || Boolean(statusActionId)}
                            className="rounded-md border border-amber-500/30 px-3 py-2 text-xs text-amber-300 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isStatusBusy ? 'Marking paid' : 'Mark Paid'}
                          </button>
                        ) : null}
                        {payroll && canGeneratePayslip(payroll, profile) ? (
                          <button
                            type="button"
                            onClick={() => setPreviewPayroll(payroll)}
                            disabled={Boolean(generatingId) || Boolean(statusActionId)}
                            className="rounded-md border border-orange-500/25 px-3 py-2 text-xs text-orange-200 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Generate Payslip
                          </button>
                        ) : null}
                        {canAddAdjustment ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAdjustmentForm({
                                technicianId: technician.uid,
                                technicianLabel: technician.displayName || 'Unknown User',
                                type: 'deduction',
                                category: '',
                                amount: '',
                                reason: '',
                              })
                            }
                            disabled={Boolean(generatingId) || Boolean(statusActionId)}
                            className="rounded-md border border-amber-700/60 px-3 py-2 text-xs text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Add Adjustment
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adjustmentForm ? (
        <form onSubmit={handleCreateAdjustment} className="mt-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Payroll Adjustment</h2>
              <div className="mt-1 text-sm text-slate-400">
                {adjustmentForm.technicianLabel} · {month}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAdjustmentForm(null)}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[160px_1fr_160px]">
            <label className="block text-sm text-slate-300">
              Type
              <select
                value={adjustmentForm.type}
                onChange={(event) =>
                  setAdjustmentForm({
                    ...adjustmentForm,
                    type: event.target.value as PayrollAdjustmentType,
                  })
                }
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                <option value="deduction">Deduction</option>
                <option value="bonus">Bonus</option>
              </select>
            </label>

            <label className="block text-sm text-slate-300">
              Category
              <input
                value={adjustmentForm.category}
                onChange={(event) => setAdjustmentForm({ ...adjustmentForm, category: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={adjustmentForm.amount}
                onChange={(event) => setAdjustmentForm({ ...adjustmentForm, amount: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
          </div>

          <label className="mt-4 block text-sm text-slate-300">
            Reason
            <textarea
              value={adjustmentForm.reason}
              onChange={(event) => setAdjustmentForm({ ...adjustmentForm, reason: event.target.value })}
              required
              rows={3}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>

          <button
            type="submit"
            disabled={adjustmentSaving}
            className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adjustmentSaving ? 'Saving Adjustment' : 'Save Adjustment'}
          </button>
        </form>
      ) : null}

      {selectedPayroll ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Payroll Details</h2>
              <div className="mt-1 text-sm text-slate-400">
                {selectedPayroll.displayName} · {selectedPayroll.month}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPayroll(null)}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
            >
              Close
            </button>
            {canGeneratePayslip(selectedPayroll, profile) ? (
              <button
                type="button"
                onClick={() => setPreviewPayroll(selectedPayroll)}
                className="rounded-md border border-orange-500/25 px-3 py-2 text-xs text-orange-200 hover:bg-[#1F160E]"
              >
                Generate Payslip
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Base Salary</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {formatCurrency(selectedPayroll.breakdown?.baseSalary ?? selectedPayroll.baseSalary)}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Approved Commission</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {formatCurrency(selectedPayroll.breakdown?.approvedCommission ?? selectedPayroll.approvedCommission)}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <div className="text-xs uppercase text-slate-500">Final Net Salary</div>
              <div className="mt-1 text-lg font-semibold text-orange-200">{formatCurrency(selectedPayroll.netSalary)}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <h3 className="mb-3 text-sm font-semibold text-white">Attendance Summary</h3>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                <div>Working days</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.workingDaysInMonth ?? selectedPayroll.attendanceSummary.workingDays}</div>
                <div>Present days</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.presentDays ?? selectedPayroll.attendanceSummary.presentDays}</div>
                <div>Late days</div>
                <div className="text-right">{selectedPayroll.attendanceSummary.lateDays}</div>
                <div>Late minutes</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.lateMinutes ?? selectedPayroll.attendanceSummary.lateMinutes ?? 0}</div>
                <div>Half days</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.halfDays ?? selectedPayroll.attendanceSummary.halfDays}</div>
                <div>Absent days</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.absentDays ?? selectedPayroll.attendanceSummary.absentDays}</div>
                <div>Approved leave days</div>
                <div className="text-right">{selectedPayroll.breakdown?.attendance.approvedLeaveDays ?? selectedPayroll.attendanceSummary.approvedLeaveDays}</div>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-[#050505] p-3">
              <h3 className="mb-3 text-sm font-semibold text-white">Deductions</h3>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                <div>Absent deduction</div>
                <div className="text-right">{formatCurrency(selectedPayroll.breakdown?.deductions.absentDeduction ?? selectedPayroll.deductions.absentDeduction)}</div>
                <div>Half-day deduction</div>
                <div className="text-right">{formatCurrency(selectedPayroll.breakdown?.deductions.halfDayDeduction ?? selectedPayroll.deductions.halfDayDeduction)}</div>
                <div>Manual deduction</div>
                <div className="text-right">{formatCurrency(selectedPayroll.breakdown?.deductions.manualDeduction ?? selectedPayroll.deductions.manualDeduction)}</div>
                <div>Adjustment bonus</div>
                <div className="text-right">{formatCurrency(selectedPayroll.breakdown?.adjustments?.bonuses ?? selectedPayroll.deductions.adjustmentBonus)}</div>
                <div className="font-medium text-white">Total deduction</div>
                <div className="text-right font-medium text-white">{formatCurrency(selectedPayroll.deductions.totalDeduction)}</div>
              </div>
            </div>
          </div>

          {selectedPayroll.breakdown?.adjustments?.records.length ? (
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
              <h3 className="mb-3 text-sm font-semibold text-white">Adjustment Snapshot</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPayroll.breakdown.adjustments.records.map((adjustment) => (
                      <tr key={adjustment.adjustmentId} className="border-b border-white/10 last:border-b-0">
                        <td className="px-3 py-3 text-slate-300">{adjustment.type}</td>
                        <td className="px-3 py-3 text-slate-300">{adjustment.category}</td>
                        <td className="px-3 py-3 text-slate-300">{formatCurrency(adjustment.amount)}</td>
                        <td className="px-3 py-3 text-slate-400">{adjustment.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {profile ? (
            <PayrollPosCommissionPanel
              payroll={selectedPayroll}
              profile={profile}
              onLinked={async () => {
                await Promise.all([loadPayrollRows(), loadPreRunChecklist()]);
              }}
            />
          ) : null}

          {selectedPayroll.warnings?.length ? (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
              <h3 className="mb-2 text-sm font-semibold text-amber-200">Warnings</h3>
              <div className="space-y-1 text-sm text-amber-100">
                {selectedPayroll.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {previewPayroll ? (
        <PayslipPreviewModal
          payroll={previewPayroll}
          onClose={() => setPreviewPayroll(null)}
          onDownload={(generatedOn) => handleDownloadPayslip(previewPayroll, generatedOn)}
        />
      ) : null}
    </section>
  );
}
