'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approvePosCommissionEntry,
  getInvoiceById,
  getPosCommissionEntries,
  rejectPosCommissionEntry,
  updatePosCommissionAmount,
} from '@/features/pos/posService';
import type { PosCommissionEntry, PosInvoice } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

export default function PosCommissionsPage() {
  const { profile, loading } = useUser();
  const [entries, setEntries] = useState<PosCommissionEntry[]>([]);
  const [invoiceById, setInvoiceById] = useState<Record<string, PosInvoice>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  const loadEntries = useCallback(async () => {
    if (!profile || !canManage) return;
    try {
      const rows = await getPosCommissionEntries(profile);
      setEntries(rows);
      setAmounts(Object.fromEntries(rows.map((entry) => [entry.entryId, String(entry.commissionAmount || 0)])));
      const invoices: Record<string, PosInvoice> = {};
      await Promise.all(rows.map(async (entry) => {
        if (!invoices[entry.invoiceId]) invoices[entry.invoiceId] = await getInvoiceById(entry.invoiceId, profile).catch(() => null as unknown as PosInvoice);
      }));
      Object.keys(invoices).forEach((key) => { if (!invoices[key]) delete invoices[key]; });
      setInvoiceById(invoices);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load POS commissions');
    }
  }, [canManage, profile]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const sorted = useMemo(() => entries.slice().sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0)), [entries]);

  async function saveAmount(entry: PosCommissionEntry) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await updatePosCommissionAmount(entry, Number(amounts[entry.entryId] || 0), notes[entry.entryId] || '', profile);
      setMessage('Commission amount updated');
      await loadEntries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update commission amount');
    } finally {
      setActionLoading(false);
    }
  }

  async function approve(entry: PosCommissionEntry) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await approvePosCommissionEntry({ ...entry, commissionAmount: Number(amounts[entry.entryId] || entry.commissionAmount || 0) }, invoiceById[entry.invoiceId], profile);
      setMessage('Commission approved');
      await loadEntries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve commission');
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(entry: PosCommissionEntry) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await rejectPosCommissionEntry(entry, notes[entry.entryId] || '', profile);
      setMessage('Commission rejected');
      await loadEntries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject commission');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading POS commissions</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">POS Commissions</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-[1200px] w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Collected</th><th className="px-4 py-3">Net Profit Basis</th><th className="px-4 py-3">Suggested</th><th className="px-4 py-3">Final</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Note/Reason</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>{sorted.map((entry) => {
            const invoice = invoiceById[entry.invoiceId];
            return <tr key={entry.entryId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3"><Link href={`/dashboard/pos/invoices/${entry.invoiceId}`} className="text-orange-200">{invoice?.invoiceNo || entry.invoiceId}</Link></td><td className="px-4 py-3 text-zinc-300">{entry.branchId}</td><td className="px-4 py-3 text-zinc-300">{entry.customerName || invoice?.customerName || '-'}</td><td className="px-4 py-3 text-white">{entry.itemName}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(entry.amountCollected ?? entry.sourceTotal)}</td><td className="px-4 py-3 text-zinc-300"><div>{entry.commissionBasis === 'net_profit' ? `${Number(entry.commissionRate || 0)}% of Net Profit` : 'Legacy commission'}</div><div className="mt-1 text-xs text-zinc-500">Cost {formatCurrency(entry.totalDirectCost || 0)} · Net {formatCurrency(entry.netProfit ?? entry.sourceTotal)}</div></td><td className="px-4 py-3 text-zinc-300">{formatCurrency(entry.suggestedCommissionAmount || 0)}</td><td className="px-4 py-3"><input disabled={entry.status !== 'pending'} type="number" min="0" step="0.01" value={amounts[entry.entryId] || ''} onChange={(event) => setAmounts((current) => ({ ...current, [entry.entryId]: event.target.value }))} className="w-28 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white disabled:opacity-60" /></td><td className="px-4 py-3 text-zinc-300">{entry.status}</td><td className="px-4 py-3 text-zinc-300">{formatDate(entry.createdAt)}</td><td className="px-4 py-3"><input value={notes[entry.entryId] || ''} onChange={(event) => setNotes((current) => ({ ...current, [entry.entryId]: event.target.value }))} placeholder="Note/reason" className="w-40 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white" /></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button disabled={actionLoading || entry.status !== 'pending'} onClick={() => saveAmount(entry)} className="text-orange-200 disabled:text-zinc-600">Save</button><button disabled={actionLoading || entry.status !== 'pending'} onClick={() => approve(entry)} className="text-emerald-300 disabled:text-zinc-600">Approve</button><button disabled={actionLoading || entry.status !== 'pending'} onClick={() => reject(entry)} className="text-red-300 disabled:text-zinc-600">Reject</button></div></td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
