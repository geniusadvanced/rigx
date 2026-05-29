'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { downloadInvoicePdf } from '@/features/pos/generatePosPdf';
import { buildInvoiceWhatsAppLink, ensureInvoicePaymentToken, ensureInvoiceWarrantySignatureTarget, ensureWarrantySignatureToken, getInvoices, getWarranties, voidInvoice } from '@/features/pos/posService';
import { buildInvoiceWithWarrantyWhatsAppLink, buildInvoiceWithWarrantyWhatsAppMessage, sendPosWhatsAppBusinessMessage } from '@/features/pos/whatsappService';
import type { PosInvoice, PosWarranty } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function PosInvoicesPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [invoices, setInvoices] = useState<PosInvoice[]>([]);
  const [warranties, setWarranties] = useState<PosWarranty[]>([]);
  const [message, setMessage] = useState('');
  const [voidTarget, setVoidTarget] = useState<PosInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canOperate = can(profile?.role, 'pos.operate');
  const canManage = can(profile?.role, 'pos.manage');

  async function loadInvoices() {
    if (!profile || !canOperate) return;
    try {
      const [invoiceRows, warrantyRows] = await Promise.all([
        getInvoices(profile),
        getWarranties(profile),
      ]);
      setInvoices(invoiceRows);
      setWarranties(warrantyRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load invoices');
    }
  }

  function appOrigin(): string {
    return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  }

  function invoiceLink(token: string): string {
    return `${appOrigin()}/invoice/${token}`;
  }

  function warrantyLink(token: string): string {
    return `${appOrigin()}/warranty/${token}`;
  }

  async function prepareInvoiceLinks(invoice: PosInvoice): Promise<{
    invoice: PosInvoice;
    warranty: PosWarranty;
    invoiceLink: string;
    warrantyLink: string;
  }> {
    if (!profile) throw new Error('User profile is required');
    const [invoiceToken, warrantyTarget] = await Promise.all([
      ensureInvoicePaymentToken(invoice.invoiceId, profile),
      ensureInvoiceWarrantySignatureTarget(invoice, profile),
    ]);
    const warrantyToken = await ensureWarrantySignatureToken(warrantyTarget, profile);
    return {
      invoice: { ...invoice, publicPaymentToken: invoiceToken },
      warranty: { ...warrantyTarget, publicWarrantyToken: warrantyToken },
      invoiceLink: invoiceLink(invoiceToken),
      warrantyLink: warrantyLink(warrantyToken),
    };
  }

  function warrantySignatureStatus(invoice: PosInvoice): string {
    if (invoice.jobId) return 'Job Warranty';
    const invoiceWarranties = warranties.filter((warranty) => warranty.invoiceId === invoice.invoiceId && warranty.status !== 'void');
    if (invoiceWarranties.some((warranty) => warranty.acceptedTerms || warranty.warrantyTermsAccepted || warranty.warrantySignedAt)) return 'Signed';
    return 'Pending Signature';
  }

  useEffect(() => {
    if (!profile || !canOperate) return;
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOperate, profile]);

  async function handleVoidInvoice() {
    if (!profile || !voidTarget) return;
    setActionLoading(true);
    setMessage('');
    try {
      await voidInvoice(voidTarget, voidReason, profile);
      setMessage('Invoice voided');
      setVoidTarget(null);
      setVoidReason('');
      await loadInvoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to void invoice');
    } finally {
      setActionLoading(false);
    }
  }

  async function openWhatsApp(invoice: PosInvoice) {
    if (!profile) return;
    setActionLoading(true);
    try {
      if (invoice.jobId) {
        const token = await ensureInvoicePaymentToken(invoice.invoiceId, profile);
        window.open(buildInvoiceWhatsAppLink({ ...invoice, publicPaymentToken: token }), '_blank', 'noopener,noreferrer');
        await loadInvoices();
        return;
      }
      const prepared = await prepareInvoiceLinks(invoice);
      window.open(buildInvoiceWithWarrantyWhatsAppLink({
        invoice: prepared.invoice,
        invoiceLink: prepared.invoiceLink,
        warrantySignatureLink: prepared.warrantyLink,
      }), '_blank', 'noopener,noreferrer');
      await loadInvoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp invoice link');
    } finally {
      setActionLoading(false);
    }
  }

  async function sendWhatsAppApi(invoice: PosInvoice) {
    if (!firebaseUser || !profile) return;
    setActionLoading(true);
    try {
      if (invoice.jobId) {
        setMessage('Linked repair job invoices use Job Warranty. Send warranty signature from the Job Warranty section.');
        return;
      }
      const prepared = await prepareInvoiceLinks(invoice);
      const idToken = await firebaseUser.getIdToken();
      const result = await sendPosWhatsAppBusinessMessage({
        branchId: prepared.invoice.branchId,
        recipientPhone: prepared.invoice.customerPhone,
        message: buildInvoiceWithWarrantyWhatsAppMessage({
          invoiceLink: prepared.invoiceLink,
          warrantySignatureLink: prepared.warrantyLink,
        }),
        messageType: 'invoice',
        relatedEntityType: 'invoice',
        relatedEntityId: prepared.invoice.invoiceId,
      }, idToken);
      setMessage(`WhatsApp sent from ${result.senderPhone}`);
      await loadInvoices();
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Use wa.me fallback link.` : 'Unable to send WhatsApp message');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading invoices</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Invoices</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Warranty</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody>{invoices.map((invoice) => {
            const isVoid = invoice.paymentStatus === 'void';
            return (
              <tr key={invoice.invoiceId} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3 text-white"><Link href={`/dashboard/pos/invoices/${invoice.invoiceId}`} className="text-orange-200">{invoice.invoiceNo}</Link></td>
                <td className="px-4 py-3 text-zinc-300">{invoice.customerName}</td>
                <td className="px-4 py-3 text-zinc-300">{formatCurrency(invoice.total)}</td>
                <td className="px-4 py-3 text-zinc-300">{formatCurrency(invoice.amountPaid)}</td>
                <td className="px-4 py-3 text-zinc-300">{formatCurrency(invoice.balance)}</td>
                <td className="px-4 py-3 text-zinc-300">{invoice.paymentStatus}</td>
                <td className="px-4 py-3 text-zinc-300">{warrantySignatureStatus(invoice)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/dashboard/pos/invoices/${invoice.invoiceId}`} className="text-orange-200">Edit</Link>
                    {!isVoid ? <button disabled={actionLoading} className="text-orange-200 disabled:text-zinc-600" onClick={() => openWhatsApp(invoice)}>WhatsApp</button> : null}
                    {!isVoid ? <button disabled={actionLoading} className="text-orange-200 disabled:text-zinc-600" onClick={() => sendWhatsAppApi(invoice)}>Send API</button> : null}
                    <button type="button" onClick={() => downloadInvoicePdf(invoice)} className="text-orange-200">PDF</button>
                    {canManage && !isVoid ? <button type="button" onClick={() => setVoidTarget(invoice)} className="text-red-300">Void</button> : null}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {voidTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <h2 className="text-lg font-semibold text-white">Void invoice</h2>
            <p className="mt-2 text-sm text-zinc-400">Void {voidTarget.invoiceNo}? This keeps the invoice record and blocks future payments.</p>
            <textarea
              required
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Void reason"
              className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setVoidTarget(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Cancel</button>
              <button type="button" disabled={actionLoading || !voidReason.trim()} onClick={handleVoidInvoice} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Void</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
