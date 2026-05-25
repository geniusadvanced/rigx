'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createPosWarrantyClaim,
  ensureWarrantySignatureToken,
  getPosWarrantyClaimsByWarranty,
  getWarrantyById,
  logWarrantyTermsWhatsAppSent,
  updatePosWarrantyClaimStatus,
} from '@/features/pos/posService';
import { buildWarrantyWhatsAppLink } from '@/features/pos/whatsappService';
import type { PosWarranty, PosWarrantyClaim, PosWarrantyClaimStatus } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

export default function WarrantyDetailPage() {
  const params = useParams<{ warrantyId: string }>();
  const { profile, loading } = useUser();
  const [warranty, setWarranty] = useState<PosWarranty | null>(null);
  const [claims, setClaims] = useState<PosWarrantyClaim[]>([]);
  const [claimReason, setClaimReason] = useState('');
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const canOperate = can(profile?.role, 'pos.operate');
  const canManage = can(profile?.role, 'pos.manage');

  const loadWarranty = useCallback(async () => {
    if (!profile || !canOperate) return;
    try {
      const nextWarranty = await getWarrantyById(params.warrantyId, profile);
      const claimRows = await getPosWarrantyClaimsByWarranty(nextWarranty.warrantyId, profile);
      setWarranty(nextWarranty);
      setClaims(claimRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load warranty');
    }
  }, [canOperate, params.warrantyId, profile]);

  useEffect(() => {
    void loadWarranty();
  }, [loadWarranty]);

  async function handleCreateClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !warranty) return;
    setActionLoading(true);
    try {
      await createPosWarrantyClaim(warranty, claimReason, profile);
      setClaimReason('');
      setMessage('Warranty claim created');
      await loadWarranty();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create warranty claim');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatus(claim: PosWarrantyClaim, status: PosWarrantyClaimStatus) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await updatePosWarrantyClaimStatus(claim, status, profile);
      setMessage('Warranty claim updated');
      await loadWarranty();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update warranty claim');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWhatsAppWarranty() {
    if (!profile || !warranty) return;
    if (!warranty.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }
    setActionLoading(true);
    try {
      const token = await ensureWarrantySignatureToken(warranty, profile);
      const nextWarranty = { ...warranty, publicWarrantyToken: token };
      setWarranty(nextWarranty);
      window.open(buildWarrantyWhatsAppLink(nextWarranty), '_blank', 'noopener,noreferrer');
      await logWarrantyTermsWhatsAppSent(nextWarranty, profile).catch(() => undefined);
      setMessage('Warranty terms WhatsApp link opened.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare warranty terms link');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading warranty</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;
  if (!warranty) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">{message || 'Warranty not found'}</div>;

  const expired = warranty.endDate?.toMillis?.() < nowMs;
  const isVoid = warranty.status === 'void';

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">{warranty.itemName}</h1>
        <p className="mt-1 text-sm text-zinc-400">{warranty.customerName} · {warranty.customerPhone}</p>
        {warranty.customerId ? <Link href={`/dashboard/customers/${warranty.customerId}`} className="mt-2 inline-flex text-sm text-orange-200">Customer 360</Link> : null}
      </div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Warranty Info</h2>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="text-zinc-400">Invoice: <Link href={`/dashboard/pos/invoices/${warranty.invoiceId}`} className="text-orange-200">{warranty.invoiceId}</Link></div>
              <div className="text-zinc-400">Job: <span className="text-white">{warranty.jobId || '-'}</span></div>
              <div className="text-zinc-400">Branch: <span className="text-white">{warranty.branchId}</span></div>
              <div className="text-zinc-400">Device: <span className="text-white">{warranty.deviceId || '-'}</span></div>
              <div className="text-zinc-400">Start: <span className="text-white">{formatDate(warranty.startDate)}</span></div>
              <div className="text-zinc-400">End: <span className="text-white">{formatDate(warranty.endDate)}</span></div>
              <div className="text-zinc-400">Claim Limit: <span className="text-white">{warranty.claimLimit}</span></div>
              <div className="text-zinc-400">Status: <span className={expired || isVoid ? 'text-red-300' : 'text-emerald-300'}>{isVoid ? 'void' : expired ? 'expired' : 'active'}</span></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Claim History</h2>
            <div className="mt-4 space-y-2">
              {claims.map((claim) => <div key={claim.claimId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium text-white">{claim.claimNo}</div><div className="text-xs text-zinc-500">{claim.claimReason}</div><div className="mt-1 text-xs text-zinc-500">Created {formatDate(claim.createdAt)} · Updated {formatDate(claim.updatedAt)}</div></div><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-2 py-1 text-xs capitalize ${claim.status === 'approved' || claim.status === 'completed' ? 'border-emerald-500/40 text-emerald-300' : claim.status === 'rejected' ? 'border-red-500/40 text-red-300' : 'border-orange-500/30 text-orange-200'}`}>{claim.status}</span>{canManage ? <select disabled={actionLoading} value={claim.status} onChange={(event) => handleStatus(claim, event.target.value as PosWarrantyClaimStatus)} className="rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-xs text-white"><option value="open">open</option><option value="checking">checking</option><option value="approved">approved</option><option value="rejected">rejected</option><option value="completed">completed</option></select> : null}</div></div></div>)}
              {claims.length === 0 ? <div className="text-sm text-zinc-500">No warranty claims</div> : null}
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <button
            type="button"
            onClick={handleWhatsAppWarranty}
            disabled={actionLoading}
            className="mb-4 w-full rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50"
          >
            {warranty.warrantySignedAt ? 'Resend Warranty Link' : 'Send Warranty Terms via WhatsApp'}
          </button>
          {warranty.warrantySignedAt ? (
            <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              Signed by {warranty.warrantySignedName || 'customer'} on {formatDate(warranty.warrantySignedAt)}
            </div>
          ) : null}
          <Link
            href={`/dashboard/documents/warranties/${warranty.warrantyId}/print`}
            className="mb-4 flex w-full justify-center rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200"
          >
            {warranty.warrantySignedAt ? 'View Signed Warranty' : 'Official print view'}
          </Link>
          <h2 className="text-lg font-semibold text-white">Create Warranty Claim</h2>
          <form onSubmit={handleCreateClaim} className="mt-4 grid gap-3">
            <textarea required disabled={expired || isVoid} value={claimReason} onChange={(event) => setClaimReason(event.target.value)} placeholder="Claim reason" className="min-h-28 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-50" />
            <button disabled={actionLoading || expired || isVoid || !claimReason.trim()} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create warranty claim</button>
          </form>
          {expired ? <p className="mt-3 text-xs text-red-300">Expired warranty cannot receive new claims.</p> : null}
          {isVoid ? <p className="mt-3 text-xs text-red-300">Void warranty cannot receive new claims.</p> : null}
        </aside>
      </div>
    </section>
  );
}
