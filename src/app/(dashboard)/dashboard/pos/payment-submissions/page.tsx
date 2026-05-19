'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approvePaymentSubmission,
  getInvoiceById,
  getPaymentSubmissions,
  rejectPaymentSubmission,
} from '@/features/pos/posService';
import type { PaymentSubmission, PosInvoice } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

export default function PaymentSubmissionsPage() {
  const { profile, loading } = useUser();
  const [submissions, setSubmissions] = useState<PaymentSubmission[]>([]);
  const [invoiceById, setInvoiceById] = useState<Record<string, PosInvoice>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  const loadRows = useCallback(async () => {
    if (!profile || !canManage) return;
    try {
      const rows = await getPaymentSubmissions(profile);
      const invoices: Record<string, PosInvoice> = {};
      await Promise.all(rows.map(async (submission) => {
        if (!invoices[submission.invoiceId]) {
          const invoice = await getInvoiceById(submission.invoiceId, profile).catch(() => null);
          if (invoice) invoices[submission.invoiceId] = invoice;
        }
      }));
      setSubmissions(rows);
      setInvoiceById(invoices);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load payment submissions');
    }
  }, [canManage, profile]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const branchOptions = useMemo(() => Array.from(new Set(submissions.map((submission) => submission.branchId).filter(Boolean))).sort(), [submissions]);
  const methodOptions = useMemo(() => Array.from(new Set(submissions.map((submission) => submission.method).filter(Boolean))).sort(), [submissions]);
  const sorted = useMemo(() => submissions.filter((submission) => {
    return (statusFilter === 'all' || submission.status === statusFilter)
      && (branchFilter === 'all' || submission.branchId === branchFilter)
      && (methodFilter === 'all' || submission.method === methodFilter);
  }).sort((left, right) => {
    if (left.status === 'pending_review' && right.status !== 'pending_review') return -1;
    if (left.status !== 'pending_review' && right.status === 'pending_review') return 1;
    return (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0);
  }), [branchFilter, methodFilter, statusFilter, submissions]);

  async function approve(submission: PaymentSubmission) {
    if (!profile) return;
    const invoice = invoiceById[submission.invoiceId];
    if (!invoice) {
      setMessage('Invoice not found for this submission');
      return;
    }
    setActionLoading(true);
    try {
      await approvePaymentSubmission(submission, invoice, profile);
      setMessage('Payment submission approved');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve payment submission');
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(submission: PaymentSubmission) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await rejectPaymentSubmission(submission, reasons[submission.submissionId] || '', profile);
      setMessage('Payment submission rejected');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject payment submission');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading payment submissions</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Payment Submissions</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#111111]/90 p-5 md:grid-cols-3">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="all">All statuses</option><option value="pending_review">pending_review</option><option value="approved">approved</option><option value="rejected">rejected</option></select>
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="all">All branches</option>{branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
        <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="all">All methods</option>{methodOptions.map((method) => <option key={method} value={method}>{method}</option>)}</select>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-[1200px] w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
            <tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Proof</th><th className="px-4 py-3">Note</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Reviewed</th><th className="px-4 py-3">Rejection</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody>
            {sorted.map((submission) => {
              const invoice = invoiceById[submission.invoiceId];
              return (
                <tr key={submission.submissionId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3"><Link href={`/dashboard/pos/invoices/${submission.invoiceId}`} className="text-orange-200">{invoice?.invoiceNo || submission.invoiceNo || submission.invoiceId}</Link></td>
                  <td className="px-4 py-3 text-zinc-300">
                    {invoice?.customerId ? <Link href={`/dashboard/customers/${invoice.customerId}`} className="text-orange-200">{submission.customerName}</Link> : submission.customerName}
                    <div className="text-xs text-zinc-500">{submission.customerPhone}</div>
                  </td>
                  <td className="px-4 py-3 text-white">{formatCurrency(submission.amountClaimed)}</td>
                  <td className="px-4 py-3 text-zinc-300">{submission.method}</td>
                  <td className="px-4 py-3 text-zinc-300">{submission.referenceNo || '-'}</td>
                  <td className="px-4 py-3">{submission.proofImageUrl ? <a href={submission.proofImageUrl} target="_blank" rel="noreferrer" className="text-orange-200">Open proof</a> : <span className="text-zinc-500">-</span>}</td>
                  <td className="px-4 py-3 text-zinc-300">{submission.note || '-'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs ${submission.status === 'approved' ? 'border-emerald-500/40 text-emerald-300' : submission.status === 'rejected' ? 'border-red-500/40 text-red-300' : 'border-amber-500/40 text-amber-300'}`}>{submission.status}</span></td>
                  <td className="px-4 py-3 text-zinc-300">{formatDate(submission.createdAt)}</td>
                  <td className="px-4 py-3 text-zinc-300">{formatDate(submission.reviewedAt)}</td>
                  <td className="px-4 py-3 text-zinc-300">{submission.rejectionReason || '-'}</td>
                  <td className="px-4 py-3"><input value={reasons[submission.submissionId] || ''} onChange={(event) => setReasons((current) => ({ ...current, [submission.submissionId]: event.target.value }))} placeholder="Rejection reason" className="w-40 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white" /></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button disabled={actionLoading || submission.status !== 'pending_review'} onClick={() => approve(submission)} className="text-emerald-300 disabled:text-zinc-600">Approve</button><button disabled={actionLoading || submission.status !== 'pending_review'} onClick={() => reject(submission)} className="text-red-300 disabled:text-zinc-600">Reject</button></div></td>
                </tr>
              );
            })}
            {sorted.length === 0 ? <tr><td colSpan={13} className="px-4 py-6 text-center text-zinc-500">No payment submissions</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
