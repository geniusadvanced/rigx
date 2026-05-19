'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { downloadQuotationPdf } from '@/features/pos/generatePosPdf';
import {
  approvePosQuotation,
  buildQuotationWhatsAppLink,
  createInvoiceFromQuotation,
  ensureQuotationPublicToken,
  expirePastQuotations,
  expirePosQuotation,
  getQuotations,
  markQuotationSent,
  rejectPosQuotation,
} from '@/features/pos/posService';
import type { PosQuotation } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function PosQuotationsPage() {
  const { profile, loading } = useUser();
  const [quotations, setQuotations] = useState<PosQuotation[]>([]);
  const [message, setMessage] = useState('');
  const [selectedQuotation, setSelectedQuotation] = useState<PosQuotation | null>(null);
  const [confirmAction, setConfirmAction] = useState<'sent' | 'approved' | 'rejected' | 'expired' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canOperate = can(profile?.role, 'pos.operate');

  async function loadQuotations() {
    if (!profile || !canOperate) return;
    try {
      await expirePastQuotations(profile);
      setQuotations(await getQuotations(profile));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load quotations');
    }
  }

  useEffect(() => {
    if (!profile || !canOperate) return;
    loadQuotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOperate, profile]);

  async function convert(quotation: PosQuotation) {
    if (!profile) return;
    try {
      await createInvoiceFromQuotation(quotation, profile);
      setMessage('Invoice created');
      await loadQuotations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create invoice');
    }
  }

  async function openWhatsApp(quotation: PosQuotation) {
    if (!profile) return;
    if (!quotation.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }
    const whatsappWindow = window.open('', '_blank');
    if (whatsappWindow) whatsappWindow.opener = null;
    setActionLoading(true);
    try {
      if (quotation.status === 'draft') await markQuotationSent(quotation, profile, 'whatsapp');
      const token = await ensureQuotationPublicToken(quotation.quotationId, profile);
      const whatsappUrl = buildQuotationWhatsAppLink({
        ...quotation,
        publicToken: token,
        quotationApprovalToken: token,
        status: quotation.status === 'draft' ? 'sent' : quotation.status,
      });
      if (whatsappWindow) {
        whatsappWindow.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      }
      await loadQuotations();
    } catch (error) {
      whatsappWindow?.close();
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp quotation link');
    } finally {
      setActionLoading(false);
    }
  }

  function openConfirm(quotation: PosQuotation, action: 'sent' | 'approved' | 'rejected' | 'expired') {
    setSelectedQuotation(quotation);
    setConfirmAction(action);
    setRejectionReason('');
  }

  async function runConfirmedAction() {
    if (!profile || !selectedQuotation || !confirmAction) return;
    setActionLoading(true);
    setMessage('');
    try {
      if (confirmAction === 'sent') await markQuotationSent(selectedQuotation, profile);
      if (confirmAction === 'approved') await approvePosQuotation(selectedQuotation, profile);
      if (confirmAction === 'rejected') await rejectPosQuotation(selectedQuotation, rejectionReason, profile);
      if (confirmAction === 'expired') await expirePosQuotation(selectedQuotation, profile);
      setMessage(`Quotation ${confirmAction}`);
      setConfirmAction(null);
      setSelectedQuotation(null);
      await loadQuotations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update quotation');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading quotations</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Quotations</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Quotation</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody>{quotations.map((quotation) => {
            const canConvert = quotation.status === 'approved';
            const canProgress = quotation.status === 'draft' || quotation.status === 'sent';
            return (
              <tr key={quotation.quotationId} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3 text-white"><Link href={`/dashboard/pos/quotations/${quotation.quotationId}`} className="text-orange-200">{quotation.quotationNo}</Link></td>
                <td className="px-4 py-3 text-zinc-300">{quotation.customerName}</td>
                <td className="px-4 py-3 text-zinc-300">{quotation.branchId}</td>
                <td className="px-4 py-3 text-zinc-300">{formatCurrency(quotation.total)}</td>
                <td className="px-4 py-3 text-zinc-300">{quotation.status}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button disabled={actionLoading || quotation.status === 'approved' || quotation.status === 'rejected'} className="text-orange-200 disabled:text-zinc-600" onClick={() => openWhatsApp(quotation)}>Send Quotation via WhatsApp</button>
                    <button onClick={() => downloadQuotationPdf(quotation)} className="text-orange-200">PDF</button>
                    {quotation.status === 'draft' ? <button onClick={() => openConfirm(quotation, 'sent')} className="text-orange-200">Mark as sent</button> : null}
                    {canProgress ? <button onClick={() => openConfirm(quotation, 'approved')} className="text-orange-200">Approve quotation</button> : null}
                    {canProgress ? <button onClick={() => openConfirm(quotation, 'rejected')} className="text-red-300">Reject quotation</button> : null}
                    {quotation.status !== 'approved' && quotation.status !== 'rejected' && quotation.status !== 'expired' ? <button onClick={() => openConfirm(quotation, 'expired')} className="text-zinc-300">Expire quotation</button> : null}
                    <button disabled={!canConvert} onClick={() => convert(quotation)} className="text-orange-200 disabled:text-zinc-600">Invoice</button>
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {confirmAction && selectedQuotation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <h2 className="text-lg font-semibold text-white">Confirm quotation action</h2>
            <p className="mt-2 text-sm text-zinc-400">Update {selectedQuotation.quotationNo} to {confirmAction}?</p>
            {confirmAction === 'rejected' ? (
              <textarea
                required
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Rejection reason"
                className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmAction(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Cancel</button>
              <button type="button" disabled={actionLoading || (confirmAction === 'rejected' && !rejectionReason.trim())} onClick={runConfirmedAction} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
