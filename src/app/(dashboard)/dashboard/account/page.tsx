'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  addManualExpense,
  generateMonthlyAccountReport,
  getBranchProfitLoss,
  getManualExpenses,
  getPaymentSummary,
  getRealtimeAccountSummary,
  saveAccountReport,
  type AccountBranchFilter,
  type AccountBreakdownRow,
  type AccountReport,
  type AccountSummary,
  type ExpenseCategory,
  type ManualExpense,
  type PaymentSummary,
  type PaymentTrackingRow,
} from '@/features/account/accountService';
import type { JobPaymentMethod } from '@/features/payments/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

const expenseCategories: ExpenseCategory[] = [
  'rent',
  'utilities',
  'software',
  'tools',
  'courier',
  'marketing_ads',
  'salary_adjustment',
  'misc',
];

const paymentMethods: JobPaymentMethod[] = ['cash', 'bank_transfer', 'card', 'ewallet', 'other'];

function getCurrentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function getTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(Number(value || 0));
}

function formatDate(value: unknown): string {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return '-';
  return value.toDate().toLocaleDateString('en-MY');
}

function prettify(value: string): string {
  return value.replaceAll('_', ' ');
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
      <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryGrid({ summary }: { summary: AccountSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard title="Total Revenue" value={formatCurrency(summary.totalRevenue)} />
      <MetricCard title="Outstanding Balance" value={formatCurrency(summary.outstandingBalance)} />
      <MetricCard title="Unpaid Jobs" value={String(summary.unpaidJobs)} />
      <MetricCard title="Payroll Cost" value={formatCurrency(summary.payrollCost)} />
      <MetricCard title="Parts Cost" value={formatCurrency(summary.partsCost)} />
      <MetricCard title="Outsource Cost" value={formatCurrency(summary.outsourceCost)} />
      <MetricCard title="Estimated Profit" value={formatCurrency(summary.estimatedProfit)} />
    </div>
  );
}

function PaymentSummaryGrid({ summary }: { summary: PaymentSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard title="Paid Revenue" value={formatCurrency(summary.paidRevenue)} />
      <MetricCard title="Partial Paid" value={formatCurrency(summary.partialPaid)} />
      <MetricCard title="Unpaid Amount" value={formatCurrency(summary.unpaidAmount)} />
      <MetricCard title="Refunded Amount" value={formatCurrency(summary.refundedAmount)} />
      <MetricCard title="Outstanding Balance" value={formatCurrency(summary.outstandingBalance)} />
    </div>
  );
}

function PaymentTable({ rows }: { rows: PaymentTrackingRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-[#151515] text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-3">Job ID</th>
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Branch</th>
            <th className="px-3 py-3">Total Amount</th>
            <th className="px-3 py-3">Paid Amount</th>
            <th className="px-3 py-3">Balance</th>
            <th className="px-3 py-3">Payment Status</th>
            <th className="px-3 py-3">Payment Method</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.jobId} className="border-b border-white/10 last:border-b-0">
              <td className="px-3 py-3 text-white">{row.jobSheetNo}</td>
              <td className="px-3 py-3 text-zinc-300">{row.customerName}</td>
              <td className="px-3 py-3 capitalize text-zinc-300">{row.branch}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.totalAmount)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.paidAmount)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.balanceAmount)}</td>
              <td className="px-3 py-3 capitalize text-zinc-300">{prettify(row.paymentStatus)}</td>
              <td className="px-3 py-3 capitalize text-zinc-300">{prettify(row.paymentMethod)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">No data</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function BranchProfitLossTable({ rows }: { rows: AccountBreakdownRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-[#151515] text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-3">Branch</th>
            <th className="px-3 py-3">Revenue</th>
            <th className="px-3 py-3">Paid Revenue</th>
            <th className="px-3 py-3">Payroll Cost</th>
            <th className="px-3 py-3">Parts Cost</th>
            <th className="px-3 py-3">Outsource Cost</th>
            <th className="px-3 py-3">Manual Expenses</th>
            <th className="px-3 py-3">Estimated Net Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
              <td className="px-3 py-3 text-white">{row.label}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.revenue)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.paidRevenue)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.payrollCost)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.partsCost)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.outsourceCost)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.manualExpenses)}</td>
              <td className="px-3 py-3 text-zinc-300">{formatCurrency(row.estimatedNetProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportPreview({ report }: { report: AccountReport }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Revenue</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="Total Revenue" value={formatCurrency(report.summary.totalRevenue)} />
          <MetricCard title="Paid Revenue" value={formatCurrency(report.summary.paidRevenue)} />
          <MetricCard title="Outstanding Balance" value={formatCurrency(report.summary.outstandingBalance)} />
          <MetricCard title="Unpaid Amount" value={formatCurrency(report.summary.unpaidAmount)} />
          <MetricCard title="Refunded Amount" value={formatCurrency(report.summary.refundedAmount)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Cost</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Payroll Cost" value={formatCurrency(report.summary.payrollCost)} />
          <MetricCard title="Parts Cost" value={formatCurrency(report.summary.partsCost)} />
          <MetricCard title="Outsource Cost" value={formatCurrency(report.summary.outsourceCost)} />
          <MetricCard title="Manual Expenses" value={formatCurrency(report.summary.manualExpenses)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Profit</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MetricCard title="Estimated Net Profit" value={formatCurrency(report.summary.estimatedNetProfit)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Jobs</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total Jobs" value={String(report.summary.totalJobs)} />
          <MetricCard title="Completed Jobs" value={String(report.summary.completedJobs)} />
          <MetricCard title="Cancelled Jobs" value={String(report.summary.cancelledJobs)} />
          <MetricCard title="Pending Jobs" value={String(report.summary.pendingJobs)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Payments</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Paid Jobs" value={String(report.summary.paidJobs)} />
          <MetricCard title="Partial Paid Jobs" value={String(report.summary.partialPaidJobs)} />
          <MetricCard title="Unpaid Jobs" value={String(report.summary.unpaidJobs)} />
          <MetricCard title="Refunded Jobs" value={String(report.summary.refundedJobs)} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Branch breakdown</h3>
        <BranchProfitLossTable rows={report.branchBreakdown} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#D88A32]">Technician Breakdown</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Technician</th>
                <th className="px-3 py-2">Revenue</th>
                <th className="px-3 py-2">Jobs Handled</th>
                <th className="px-3 py-2">Completed Jobs</th>
              </tr>
            </thead>
            <tbody>
              {report.technicianBreakdown.map((row) => (
                <tr key={row.technicianId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-2 text-white">{row.technicianName}</td>
                  <td className="px-3 py-2 text-zinc-300">{formatCurrency(row.revenue)}</td>
                  <td className="px-3 py-2 text-zinc-300">{row.jobsHandled}</td>
                  <td className="px-3 py-2 text-zinc-300">{row.completedJobs}</td>
                </tr>
              ))}
              {report.technicianBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">No data</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { profile, loading } = useUser();
  const [realtimeReport, setRealtimeReport] = useState<AccountReport | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [paymentRows, setPaymentRows] = useState<PaymentTrackingRow[]>([]);
  const [expenses, setExpenses] = useState<ManualExpense[]>([]);
  const [branchProfitLoss, setBranchProfitLoss] = useState<AccountBreakdownRow[]>([]);
  const [generatedReport, setGeneratedReport] = useState<AccountReport | null>(null);
  const [month, setMonth] = useState(getCurrentMonth());
  const [branch, setBranch] = useState<AccountBranchFilter>('all');
  const [pageLoading, setPageLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    category: 'misc' as ExpenseCategory,
    amount: '',
    branch: 'bangi' as AccountBranchFilter,
    expenseDate: getTodayDate(),
    paymentMethod: 'cash' as JobPaymentMethod,
    notes: '',
  });
  const canAccessAccount = can(profile?.role, 'account.view');

  const branchOptions = useMemo<Array<{ value: AccountBranchFilter; label: string }>>(() => [
    { value: 'all', label: 'All branches' },
    { value: 'bangi', label: 'Bangi' },
    { value: 'cyberjaya', label: 'Cyberjaya' },
  ], []);

  async function loadAccountData() {
    if (!profile?.role || !canAccessAccount) return;

    setPageLoading(true);
    setMessage('');

    try {
      const [realtime, payments, expenseRows, pnlRows] = await Promise.all([
        getRealtimeAccountSummary(profile.role),
        getPaymentSummary({ month, branch, role: profile.role }),
        getManualExpenses({ month, branch, role: profile.role }),
        getBranchProfitLoss({ month, role: profile.role }),
      ]);
      setRealtimeReport(realtime);
      setPaymentSummary(payments.summary);
      setPaymentRows(payments.rows);
      setExpenses(expenseRows);
      setBranchProfitLoss(pnlRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load account data');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    void loadAccountData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessAccount, profile?.role, month, branch]);

  async function handleAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.role || !canAccessAccount) return;

    setExpenseSaving(true);
    setMessage('');

    try {
      await addManualExpense({
        title: expenseForm.title,
        category: expenseForm.category,
        amount: Number(expenseForm.amount),
        branch: expenseForm.branch,
        expenseDate: expenseForm.expenseDate,
        paymentMethod: expenseForm.paymentMethod,
        notes: expenseForm.notes,
        createdBy: profile.uid,
        role: profile.role,
      });
      setExpenseForm({
        title: '',
        category: 'misc',
        amount: '',
        branch: 'bangi',
        expenseDate: getTodayDate(),
        paymentMethod: 'cash',
        notes: '',
      });
      setMessage('Expense added');
      await loadAccountData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add expense');
    } finally {
      setExpenseSaving(false);
    }
  }

  async function handleGenerateReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.role || !canAccessAccount) return;

    setGenerating(true);
    setMessage('');

    try {
      const report = await generateMonthlyAccountReport({ month, branch, role: profile.role });
      setGeneratedReport(report);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate account report');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveReport() {
    if (!profile || !generatedReport) return;

    setSaving(true);
    setMessage('');

    try {
      await saveAccountReport(generatedReport, { generatedBy: profile.uid, role: profile.role });
      setMessage('Account report saved');
    } catch (error) {
      if (error instanceof Error && error.message === 'Account report already exists') {
        const confirmed = window.confirm('Account report already exists. Overwrite saved report?');
        if (confirmed) {
          await saveAccountReport(generatedReport, { generatedBy: profile.uid, role: profile.role, overwrite: true });
          setMessage('Account report saved');
        } else {
          setMessage(error.message);
        }
      } else {
        setMessage(error instanceof Error ? error.message : 'Unable to save account report');
      }
    } finally {
      setSaving(false);
    }
  }

  const totalExpenses = expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);

  if (loading) return <div className="text-sm text-zinc-400">Loading account</div>;

  if (!canAccessAccount) {
    return (
      <section className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6">
        <h1 className="text-xl font-semibold text-white">Account</h1>
        <p className="mt-2 text-sm text-zinc-400">Admin or manager access is required.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-zinc-400">Real-time financial overview and monthly account reporting.</p>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      <SectionCard title="Real-Time Account">
        {pageLoading ? <div className="text-sm text-zinc-500">Loading account data</div> : null}
        {!pageLoading && realtimeReport ? <SummaryGrid summary={realtimeReport.summary} /> : null}
        {!pageLoading && !realtimeReport ? <div className="text-sm text-zinc-500">No data</div> : null}
      </SectionCard>

      <SectionCard title="Payment Tracking">
        {paymentSummary ? <PaymentSummaryGrid summary={paymentSummary} /> : null}
        <PaymentTable rows={paymentRows} />
      </SectionCard>

      <SectionCard title="Manual Expenses">
        <form onSubmit={handleAddExpense} className="grid gap-3 lg:grid-cols-4">
          <input
            value={expenseForm.title}
            onChange={(event) => setExpenseForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Title"
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500/35"
          />
          <select
            value={expenseForm.category}
            onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value as ExpenseCategory }))}
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
          >
            {expenseCategories.map((category) => <option key={category} value={category}>{prettify(category)}</option>)}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={expenseForm.amount}
            onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
            placeholder="Amount"
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500/35"
          />
          <select
            value={expenseForm.branch}
            onChange={(event) => setExpenseForm((current) => ({ ...current, branch: event.target.value as AccountBranchFilter }))}
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
          >
            <option value="bangi">Bangi</option>
            <option value="cyberjaya">Cyberjaya</option>
          </select>
          <input
            type="date"
            value={expenseForm.expenseDate}
            onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))}
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
          />
          <select
            value={expenseForm.paymentMethod}
            onChange={(event) => setExpenseForm((current) => ({ ...current, paymentMethod: event.target.value as JobPaymentMethod }))}
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
          >
            {paymentMethods.map((method) => <option key={method} value={method}>{prettify(method)}</option>)}
          </select>
          <input
            value={expenseForm.notes}
            onChange={(event) => setExpenseForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Notes"
            className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500/35"
          />
          <button
            type="submit"
            disabled={expenseSaving}
            className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:from-[#D97706] hover:to-[#FB923C] disabled:opacity-60"
          >
            Add Expense
          </button>
        </form>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total Expenses" value={formatCurrency(totalExpenses)} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-[#151515] text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Branch</th>
                <th className="px-3 py-3">Expense Date</th>
                <th className="px-3 py-3">Payment Method</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.expenseId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-white">{expense.title}</td>
                  <td className="px-3 py-3 capitalize text-zinc-300">{prettify(expense.category)}</td>
                  <td className="px-3 py-3 text-zinc-300">{formatCurrency(expense.amount)}</td>
                  <td className="px-3 py-3 capitalize text-zinc-300">{expense.branch}</td>
                  <td className="px-3 py-3 text-zinc-300">{formatDate(expense.expenseDate)}</td>
                  <td className="px-3 py-3 capitalize text-zinc-300">{prettify(expense.paymentMethod)}</td>
                </tr>
              ))}
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">No data</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Branch P&L">
        <BranchProfitLossTable rows={branchProfitLoss} />
      </SectionCard>

      <SectionCard title="Monthly Account Report">
        <form onSubmit={handleGenerateReport} className="grid gap-3 md:grid-cols-[180px_220px_auto] md:items-end">
          <label className="text-sm text-zinc-300">
            <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-zinc-500">Month selector</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
            />
          </label>
          <label className="text-sm text-zinc-300">
            <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-zinc-500">Branch selector</span>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value as AccountBranchFilter)}
              className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
            >
              {[
                { value: 'all' as const, label: 'All branches' },
                { value: 'bangi' as const, label: 'Bangi' },
                { value: 'cyberjaya' as const, label: 'Cyberjaya' },
              ].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="submit"
            disabled={generating || !month}
            className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:from-[#D97706] hover:to-[#FB923C] disabled:opacity-60"
          >
            Generate Report
          </button>
        </form>

        {generatedReport ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#1F160E]"
              >
                Print Report
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveReport}
                className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#1F160E] disabled:opacity-60"
              >
                Save Report Snapshot
              </button>
            </div>
            <ReportPreview report={generatedReport} />
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
