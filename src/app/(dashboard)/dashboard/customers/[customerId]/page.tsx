'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getCustomer360Data,
  type Customer360Data,
} from '@/features/customers/services/customer360Service';
import { softDeleteCustomer } from '@/features/customers/services/customerService';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleDateString('en-MY') || '-';
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111111]/90 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

export default function Customer360Page() {
  const params = useParams<{ customerId: string }>();
  const router = useRouter();
  const { profile, loading } = useUser();
  const [data, setData] = useState<Customer360Data | null>(null);
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteModalError, setDeleteModalError] = useState('');
  const canManage = can(profile?.role, 'customers.manage');

  useEffect(() => {
    let cancelled = false;
    if (!profile || !params.customerId || !can(profile.role, 'customers.view')) return;
    getCustomer360Data(params.customerId, profile)
      .then((nextData) => {
        if (!cancelled) setData(nextData);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load customer profile');
      });
    return () => {
      cancelled = true;
    };
  }, [params.customerId, profile]);

  if (loading) return <div className="text-sm text-zinc-400">Loading customer profile</div>;
  if (!can(profile?.role, 'customers.view')) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;
  if (message) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-300">{message}</div>;
  if (!data) return <div className="text-sm text-zinc-400">Loading customer profile</div>;

  async function handleDeleteCustomer() {
    if (!profile || !canManage) {
      setDeleteModalError('Only admin and manager can delete customers.');
      return;
    }
    if (!data) {
      setDeleteModalError('No customer selected for deletion.');
      return;
    }
    if (deleteConfirmation !== 'DELETE') {
      setDeleteModalError('Type DELETE to confirm customer deletion.');
      return;
    }
    setActionLoading(true);
    setDeleteModalError('');
    try {
      await softDeleteCustomer(data.customer.customerId, deleteReason, profile);
      router.push('/dashboard/customers');
    } catch (error) {
      console.error('[CUSTOMER DELETE ERROR]', error);
      setDeleteModalError('Failed to delete customer. Please check your permission or try again.');
      setActionLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <Link href="/dashboard/customers" className="text-sm text-orange-200">Back to Customers</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">{data.customer.fullName}</h1>
            <p className="mt-1 text-sm text-zinc-400">{data.customer.phone} · {data.customer.email || 'No email'} · {data.customer.branch}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-sm text-orange-200">Customer 360</div>
            {canManage ? (
              <button
                type="button"
                onClick={() => {
	                  setShowDeleteModal(true);
	                  setDeleteReason('');
	                  setDeleteConfirmation('');
	                  setDeleteModalError('');
	                }}
                className="rounded-md border border-red-500/30 px-3 py-1 text-sm text-red-200 hover:bg-red-500/10"
              >
                Delete Customer
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card label="Total quoted" value={formatCurrency(data.summary.totalQuoted)} />
        <Card label="Total invoiced" value={formatCurrency(data.summary.totalInvoiced)} />
        <Card label="Total paid" value={formatCurrency(data.summary.totalPaid)} />
        <Card label="Outstanding balance" value={formatCurrency(data.summary.outstandingBalance)} />
        <Card label="Total refunded" value={formatCurrency(data.summary.totalRefunded)} />
        <Card label="Active warranties" value={data.summary.activeWarrantyCount} />
        <Card label="Open jobs" value={data.summary.openJobCount} />
        <Card label="WhatsApp conversations" value={data.summary.whatsappConversationCount} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Quotation history</h2>
          <div className="mt-4 space-y-2">
            {data.quotations.map((quotation) => (
              <Link key={quotation.quotationId} href={`/dashboard/pos/quotations/${quotation.quotationId}`} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                <div className="font-medium text-white">{quotation.quotationNo}</div>
                <div className="mt-1 text-xs text-zinc-500">{quotation.status} · {formatCurrency(quotation.total)} · {formatDate(quotation.createdAt)}</div>
              </Link>
            ))}
            {data.quotations.length === 0 ? <div className="text-sm text-zinc-500">No quotation history</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Invoice history</h2>
          <div className="mt-4 space-y-2">
            {data.invoices.map((invoice) => (
              <Link key={invoice.invoiceId} href={`/dashboard/pos/invoices/${invoice.invoiceId}`} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                <div className="font-medium text-white">{invoice.invoiceNo}</div>
                <div className="mt-1 text-xs text-zinc-500">{invoice.paymentStatus} · paid {formatCurrency(invoice.amountPaid)} · balance {formatCurrency(invoice.balance)}</div>
              </Link>
            ))}
            {data.invoices.length === 0 ? <div className="text-sm text-zinc-500">No invoice history</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Job history</h2>
          <div className="mt-4 space-y-2">
            {data.jobs.map((job) => (
              <div key={job.docId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm">
                <div className="font-medium text-white">{job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || job.docId}</div>
                <div className="mt-1 text-xs text-zinc-500">{job.status} · {job.deviceBrand || job.device} {job.deviceModel || ''}</div>
              </div>
            ))}
            {data.jobs.length === 0 ? <div className="text-sm text-zinc-500">No job history</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Warranty history</h2>
          <div className="mt-4 space-y-2">
            {data.warranties.map((warranty) => (
              <Link key={warranty.warrantyId} href={`/dashboard/warranties/${warranty.warrantyId}`} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                <div className="font-medium text-white">{warranty.itemName}</div>
                <div className="mt-1 text-xs text-zinc-500">{warranty.status} · ends {formatDate(warranty.endDate)}</div>
              </Link>
            ))}
            {data.warranties.length === 0 ? <div className="text-sm text-zinc-500">No warranty history</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Payments and refunds</h2>
          <div className="mt-4 space-y-2">
            {data.payments.slice(0, 8).map((payment) => (
              <div key={payment.paymentId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm">
                <div className="font-medium text-white">{formatCurrency(payment.amount)}</div>
                <div className="mt-1 text-xs text-zinc-500">{payment.method} · {formatDate(payment.receivedAt)}</div>
              </div>
            ))}
            {data.refunds.map((refund) => (
              <div key={refund.refundId} className="rounded-2xl border border-red-500/20 bg-[#151515] p-3 text-sm">
                <div className="font-medium text-red-200">Refund {formatCurrency(refund.amount)}</div>
                <div className="mt-1 text-xs text-zinc-500">{refund.reason} · {formatDate(refund.refundedAt)}</div>
              </div>
            ))}
            {data.payments.length === 0 && data.refunds.length === 0 ? <div className="text-sm text-zinc-500">No payment history</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">WhatsApp and submissions</h2>
          <div className="mt-4 space-y-2">
            {data.whatsAppConversations.map((conversation) => (
              <Link key={conversation.conversationId} href="/dashboard/pos/whatsapp-inbox" className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                <div className="font-medium text-white">{conversation.phone}</div>
                <div className="mt-1 text-xs text-zinc-500">{conversation.status} · {conversation.latestMessagePreview || '-'}</div>
              </Link>
            ))}
            {data.paymentSubmissions.map((submission) => (
              <Link key={submission.submissionId} href="/dashboard/pos/payment-submissions" className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                <div className="font-medium text-white">{submission.invoiceNo}</div>
                <div className="mt-1 text-xs text-zinc-500">{submission.status} · {formatCurrency(submission.amountClaimed)}</div>
              </Link>
            ))}
            {data.whatsAppConversations.length === 0 && data.paymentSubmissions.length === 0 ? <div className="text-sm text-zinc-500">No WhatsApp or submission history</div> : null}
          </div>
        </div>
      </div>
      {showDeleteModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151515] p-5 shadow-2xl">
            <h2 className="text-xl font-semibold text-white">Delete Customer?</h2>
            <p className="mt-3 text-sm text-slate-300">
              This customer will be removed from the active customer list. Existing jobs, quotations, invoices, warranties, and audit records linked to this customer will remain.
            </p>
            {data.jobs.length > 0 ? (
              <div className="mt-3 rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-100">
                This customer has existing job records. The customer will be hidden from active lists, but job history and documents will remain.
              </div>
            ) : null}
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300">
              <div className="font-medium text-white">{data.customer.fullName}</div>
              <div className="mt-1 text-xs text-slate-500">{data.customer.phone || '-'} · {data.customer.email || 'No email'}</div>
            </div>
            {deleteModalError ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {deleteModalError}
              </div>
            ) : null}
            <label className="mt-4 block text-sm text-slate-300">
              Reason for deletion
              <textarea
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Reason for deletion"
                className="mt-2 min-h-20 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="mt-4 block text-sm text-slate-300">
              Type DELETE to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setShowDeleteModal(false)} disabled={actionLoading} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">Cancel</button>
              <button
                type="button"
                onClick={handleDeleteCustomer}
                disabled={actionLoading || deleteConfirmation !== 'DELETE'}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
