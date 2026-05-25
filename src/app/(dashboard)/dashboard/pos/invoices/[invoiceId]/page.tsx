'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getAuditLogsForEntity } from '@/features/audit/services/auditLogService';
import type { AuditLog } from '@/features/audit/types';
import { downloadInvoicePdf, downloadReceiptPdf, downloadRefundPdf } from '@/features/pos/generatePosPdf';
import {
  buildInvoiceWhatsAppLink,
  createInvoiceRefund,
  ensureInvoicePaymentToken,
  ensureInvoiceWarrantySignatureTarget,
  ensureWarrantySignatureToken,
  getInvoiceById,
  getPaymentsByInvoice,
  getQuotationById,
  getRefundsByInvoice,
  getWarrantiesByInvoice,
  prepareInventoryMovementsFromPaidInvoice,
  preparePendingCommissionsFromPaidInvoice,
  recordInvoicePayment,
  regenerateInvoicePaymentToken,
  revokeInvoicePaymentToken,
  reverseInvoicePayment,
  voidInvoice,
} from '@/features/pos/posService';
import { buildInvoiceWithWarrantyWhatsAppLink, buildInvoiceWithWarrantyWhatsAppMessage, buildPaymentReminderWhatsAppLink, buildWarrantyWhatsAppLink, sendPosWhatsAppBusinessMessage } from '@/features/pos/whatsappService';
import { getWhatsAppInboundMessagesForEntity, getWhatsAppMessagesForEntity, type PosWhatsAppInboundMessage, type PosWhatsAppMessageLog } from '@/features/pos/whatsappMessageService';
import type { PosInvoice, PosPayment, PosPaymentMethod, PosQuotation, PosRefund, PosWarranty } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

export default function PosInvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const { firebaseUser, profile, loading } = useUser();
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [payments, setPayments] = useState<PosPayment[]>([]);
  const [refunds, setRefunds] = useState<PosRefund[]>([]);
  const [warranties, setWarranties] = useState<PosWarranty[]>([]);
  const [quotation, setQuotation] = useState<PosQuotation | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [whatsAppMessages, setWhatsAppMessages] = useState<PosWhatsAppMessageLog[]>([]);
  const [inboundWhatsAppMessages, setInboundWhatsAppMessages] = useState<PosWhatsAppInboundMessage[]>([]);
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash' as PosPaymentMethod, referenceNo: '', proofFile: null as File | null });
  const [voidReason, setVoidReason] = useState('');
  const [reversalTarget, setReversalTarget] = useState<PosPayment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash' as PosPaymentMethod, reason: '', paymentId: '' });
  const canOperate = can(profile?.role, 'pos.operate');
  const canManage = can(profile?.role, 'pos.manage');

  const loadInvoice = useCallback(async () => {
    if (!profile || !canOperate) return;
    try {
      const nextInvoice = await getInvoiceById(params.invoiceId, profile);
      const [paymentRows, refundRows, warrantyRows] = await Promise.all([
        getPaymentsByInvoice(nextInvoice.invoiceId, profile),
        getRefundsByInvoice(nextInvoice.invoiceId, profile),
        getWarrantiesByInvoice(nextInvoice.invoiceId, profile),
      ]);
      const auditRows = await getAuditLogsForEntity(profile.role, 'pos', nextInvoice.invoiceId).catch(() => []);
      const whatsAppRows = await getWhatsAppMessagesForEntity(profile, 'invoice', nextInvoice.invoiceId).catch(() => []);
      const inboundRows = await getWhatsAppInboundMessagesForEntity(profile, 'invoice', nextInvoice.invoiceId).catch(() => []);
      setInvoice(nextInvoice);
      setPayments(paymentRows);
      setRefunds(refundRows);
      setWarranties(warrantyRows);
      setAuditLogs(auditRows);
      setWhatsAppMessages(whatsAppRows);
      setInboundWhatsAppMessages(inboundRows);
      if (nextInvoice.quotationId) {
        setQuotation(await getQuotationById(nextInvoice.quotationId, profile).catch(() => null));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load invoice');
    }
  }, [canOperate, params.invoiceId, profile]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  async function handleAddPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !invoice) return;
    setActionLoading(true);
    setMessage('');
    try {
      await recordInvoicePayment(invoice, { amount: Number(paymentForm.amount), method: paymentForm.method, referenceNo: paymentForm.referenceNo, proofFile: paymentForm.proofFile }, profile);
      setPaymentForm({ amount: '', method: 'cash', referenceNo: '', proofFile: null });
      setMessage('Payment recorded');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record payment');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleVoid() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      await voidInvoice(invoice, voidReason, profile);
      setVoidReason('');
      setMessage('Invoice voided');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to void invoice');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReverse() {
    if (!profile || !invoice || !reversalTarget) return;
    setActionLoading(true);
    try {
      await reverseInvoicePayment(invoice, reversalTarget, reversalReason, profile);
      setReversalTarget(null);
      setReversalReason('');
      setMessage('Payment reversed');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reverse payment');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      await createInvoiceRefund(invoice, { amount: Number(refundForm.amount), method: refundForm.method, reason: refundForm.reason, paymentId: refundForm.paymentId }, profile);
      setRefundForm({ amount: '', method: 'cash', reason: '', paymentId: '' });
      setMessage('Refund created');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create refund');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePrepareCommission() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      const count = await preparePendingCommissionsFromPaidInvoice(invoice.invoiceId, profile);
      setMessage(`${count} pending commission entr${count === 1 ? 'y' : 'ies'} prepared`);
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare commissions');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePrepareInventory() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      const count = await prepareInventoryMovementsFromPaidInvoice(invoice.invoiceId, profile);
      setMessage(`${count} pending inventory movement${count === 1 ? '' : 's'} prepared`);
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare inventory movements');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWhatsAppInvoice() {
    if (!profile || !invoice) return;
    if (!invoice.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }
    setActionLoading(true);
    try {
      if (invoice.jobId) {
        const token = await ensureInvoicePaymentToken(invoice.invoiceId, profile);
        const nextInvoice = { ...invoice, publicPaymentToken: token };
        setInvoice(nextInvoice);
        window.open(buildInvoiceWhatsAppLink(nextInvoice), '_blank', 'noopener,noreferrer');
        await loadInvoice();
        return;
      }
      const [token, warrantyTarget] = await Promise.all([
        ensureInvoicePaymentToken(invoice.invoiceId, profile),
        ensureInvoiceWarrantySignatureTarget(invoice, profile),
      ]);
      const warrantyToken = await ensureWarrantySignatureToken(warrantyTarget, profile);
      const nextInvoice = { ...invoice, publicPaymentToken: token };
      setInvoice(nextInvoice);
      window.open(buildInvoiceWithWarrantyWhatsAppLink({
        invoice: nextInvoice,
        invoiceLink: `${appOrigin()}/invoice/${token}`,
        warrantySignatureLink: `${appOrigin()}/warranty/${warrantyToken}`,
      }), '_blank', 'noopener,noreferrer');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp invoice link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendWhatsAppApi() {
    if (!firebaseUser || !profile || !invoice) return;
    setActionLoading(true);
    try {
      if (invoice.jobId) {
        setMessage('Linked repair job invoices use Job Warranty. Send warranty signature from the Job Warranty section.');
        return;
      }
      const [token, warrantyTarget] = await Promise.all([
        ensureInvoicePaymentToken(invoice.invoiceId, profile),
        ensureInvoiceWarrantySignatureTarget(invoice, profile),
      ]);
      const warrantyToken = await ensureWarrantySignatureToken(warrantyTarget, profile);
      const nextInvoice = { ...invoice, publicPaymentToken: token };
      setInvoice(nextInvoice);
      const idToken = await firebaseUser.getIdToken();
      const result = await sendPosWhatsAppBusinessMessage({
        branchId: nextInvoice.branchId,
        recipientPhone: nextInvoice.customerPhone,
        message: buildInvoiceWithWarrantyWhatsAppMessage({
          invoiceLink: `${appOrigin()}/invoice/${token}`,
          warrantySignatureLink: `${appOrigin()}/warranty/${warrantyToken}`,
        }),
        messageType: 'invoice',
        relatedEntityType: 'invoice',
        relatedEntityId: nextInvoice.invoiceId,
      }, idToken);
      setMessage(`WhatsApp sent from ${result.senderPhone}`);
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Use wa.me fallback link.` : 'Unable to send WhatsApp message');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWarrantyTermsWhatsApp() {
    if (!profile || !invoice) return;
    if (invoice.jobId) {
      setMessage('Linked repair job invoices use Job Warranty. Send warranty signature from the Job Warranty section.');
      return;
    }
    setActionLoading(true);
    try {
      const warrantyTarget = await ensureInvoiceWarrantySignatureTarget(invoice, profile);
      const token = await ensureWarrantySignatureToken(warrantyTarget, profile);
      window.open(buildWarrantyWhatsAppLink({ ...warrantyTarget, publicWarrantyToken: token }), '_blank', 'noopener,noreferrer');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare warranty signature link');
    } finally {
      setActionLoading(false);
    }
  }

  function handleWhatsAppPaymentReminder() {
    if (!invoice) return;
    if (!invoice.customerPhone) {
      setMessage('Customer phone number is missing. Please update customer details first.');
      return;
    }
    window.open(buildPaymentReminderWhatsAppLink(invoice), '_blank', 'noopener,noreferrer');
  }

  async function handleRegeneratePaymentLink() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      const token = await regenerateInvoicePaymentToken(invoice, profile);
      setInvoice({ ...invoice, publicPaymentToken: token, publicPaymentTokenStatus: 'active' });
      setMessage('Public payment link regenerated');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to regenerate public payment link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokePaymentLink() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      await revokeInvoicePaymentToken(invoice, profile);
      setMessage('Public payment link revoked');
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to revoke public payment link');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading invoice</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;
  if (!invoice) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">{message || 'Invoice not found'}</div>;

  const isVoid = invoice.paymentStatus === 'void';
  const canAddPayment = !isVoid && invoice.balance > 0;
  const warrantySigned = warranties.some((warranty) => warranty.acceptedTerms || warranty.warrantyTermsAccepted || warranty.warrantySignedAt);

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">{invoice.invoiceNo}</h1>
            <p className="mt-1 text-sm text-zinc-400">{invoice.customerName} · {invoice.customerPhone}</p>
            {invoice.customerId ? <Link href={`/dashboard/customers/${invoice.customerId}`} className="mt-2 inline-flex text-sm text-orange-200">Customer 360</Link> : null}
          </div>
          <span className="rounded-full border border-orange-500/30 px-3 py-1 text-xs capitalize text-orange-200">{invoice.paymentStatus}</span>
        </div>
      </div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Invoice Details</h2>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="text-zinc-400">Branch: <span className="text-white">{invoice.branchId}</span></div>
              <div className="text-zinc-400">Created: <span className="text-white">{formatDate(invoice.createdAt)}</span></div>
              <div className="text-zinc-400">Device/Job: <span className="text-white">{invoice.deviceId || invoice.jobId || '-'}</span></div>
              {quotation ? <Link href={`/dashboard/pos/quotations/${quotation.quotationId}`} className="text-orange-200">Quotation: {quotation.quotationNo}</Link> : null}
              {invoice.jobId ? <Link href="/dashboard/jobs" className="text-orange-200">Related job</Link> : null}
              {isVoid ? <div className="md:col-span-2 text-zinc-400">Void Reason: <span className="text-white">{invoice.voidReason || '-'}</span></div> : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Total</th></tr></thead>
              <tbody>{invoice.items.map((item, index) => <tr key={`${item.name}-${index}`} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white">{item.name}</td><td className="px-4 py-3 text-zinc-300">{item.quantity}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.unitPrice)}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.total)}</td></tr>)}</tbody>
            </table>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Payment History</h2>
            <div className="mt-4 space-y-2">
              {payments.map((payment) => <div key={payment.paymentId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium text-white">{formatCurrency(payment.amount)} · {payment.method}</div><div className="text-xs text-zinc-500">{formatDate(payment.receivedAt)} · {payment.referenceNo || '-'}</div></div><div className="flex flex-wrap gap-2"><span className="text-xs text-zinc-400">{payment.status || 'completed'}</span>{payment.proofImageUrl ? <a href={payment.proofImageUrl} target="_blank" rel="noreferrer" className="text-orange-200">Proof</a> : null}<Link href={`/dashboard/documents/receipts/${payment.paymentId}/print`} className="text-orange-200">Receipt print</Link><button onClick={() => downloadReceiptPdf(invoice, payment)} className="text-orange-200">Receipt PDF</button>{canManage && (payment.status || 'completed') === 'completed' && !isVoid ? <button onClick={() => setReversalTarget(payment)} className="text-red-300">Reverse</button> : null}</div></div></div>)}
              {payments.length === 0 ? <div className="text-sm text-zinc-500">No payments recorded</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Warranty Records</h2>
            <div className="mt-2 text-sm text-zinc-400">Signature status: <span className={invoice.jobId ? 'text-zinc-300' : warrantySigned ? 'text-emerald-300' : 'text-amber-300'}>{invoice.jobId ? 'Handled by Job Warranty' : warrantySigned ? 'Signed' : 'Pending Signature'}</span></div>
            <div className="mt-4 space-y-2">
              {warranties.map((warranty) => <Link key={warranty.warrantyId} href={`/dashboard/warranties/${warranty.warrantyId}`} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm text-zinc-300 hover:border-orange-500/30"><span className="text-white">{warranty.itemName}</span> · Ends {formatDate(warranty.endDate)} · {warranty.acceptedTerms || warranty.warrantyTermsAccepted || warranty.warrantySignedAt ? 'Signed' : 'Pending Signature'}</Link>)}
              {warranties.length === 0 ? <div className="text-sm text-zinc-500">No warranty records</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Audit Timeline</h2>
            <div className="mt-4 space-y-2">
              {auditLogs.map((log) => <div key={log.auditLogId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm"><div className="font-medium text-white">{log.action}</div><div className="text-xs text-zinc-500">{log.changedByDisplayName} · {formatDate(log.createdAt)}</div>{log.note ? <div className="mt-1 text-xs text-zinc-400">{log.note}</div> : null}</div>)}
              {auditLogs.length === 0 ? <div className="text-sm text-zinc-500">No audit records found</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Customer Payment Activity</h2>
            <div className="mt-4 grid gap-2 text-sm text-zinc-300">
              <div>Payment token created: <span className="text-white">{formatDate(invoice.publicPaymentTokenCreatedAt)}</span></div>
              <div>Payment page viewed: <span className="text-white">{formatDate(invoice.customerPaymentPageViewedAt)}</span></div>
              <div>Token status: <span className="text-white">{invoice.publicPaymentTokenStatus || (invoice.publicPaymentToken ? 'active' : 'not created')}</span></div>
              <div>Token revoked: <span className="text-white">{formatDate(invoice.publicPaymentTokenRevokedAt)}</span></div>
              <div>Payment submissions: <span className="text-white">{auditLogs.filter((log) => log.action.includes('payment_submission')).length}</span></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">WhatsApp Messages</h2>
            <div className="mt-4 space-y-2">
              {whatsAppMessages.slice(0, 5).map((row) => (
                <div key={row.messageId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white">{row.messageType} · {row.status}</span>
                    <span className="text-xs text-zinc-500">{formatDate(row.sentAt || row.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{row.senderNumber} → {row.recipientPhone}</div>
                  {row.errorMessage ? <div className="mt-1 text-xs text-red-300">{row.errorMessage}</div> : null}
                </div>
              ))}
              {whatsAppMessages.length === 0 ? <div className="text-sm text-zinc-500">No WhatsApp messages found</div> : null}
            </div>
            {inboundWhatsAppMessages.length > 0 ? (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="text-sm font-medium text-white">Inbound Replies</div>
                <div className="mt-2 space-y-2">
                  {inboundWhatsAppMessages.slice(0, 5).map((row) => (
                    <div key={row.inboundMessageId} className="rounded-2xl border border-white/10 bg-[#101010] p-3 text-sm">
                      <div className="text-xs text-zinc-500">{row.senderName || row.senderPhone} · {formatDate(row.receivedAt)}</div>
                      <div className="mt-1 text-zinc-300">{row.textBody || row.mediaCaption || row.messageType}</div>
                      {row.mediaId ? (
                        <div className="mt-2 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-xs text-zinc-400">
                          Media: {row.mediaFileName || row.mediaMimeType || row.messageType}{row.mediaStoragePath ? ' · saved' : ' · download not available'}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <div className="space-y-2 border-b border-white/10 pb-4 text-sm">
              <div className="flex justify-between text-zinc-300"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
              <div className="flex justify-between text-zinc-300"><span>Discount</span><span>{formatCurrency(invoice.discountAmount)}</span></div>
              <div className="flex justify-between text-white"><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
              <div className="flex justify-between text-zinc-300"><span>Amount paid</span><span>{formatCurrency(invoice.amountPaid)}</span></div>
              <div className="flex justify-between text-lg font-semibold text-white"><span>Balance</span><span>{formatCurrency(invoice.balance)}</span></div>
            </div>
            <div className="mt-4 grid gap-2">
              {!isVoid ? <button type="button" onClick={handleWhatsAppInvoice} disabled={actionLoading} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50">WhatsApp Invoice</button> : null}
              {!isVoid && !invoice.jobId ? <button type="button" onClick={handleWarrantyTermsWhatsApp} disabled={actionLoading} className="rounded-xl border border-emerald-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-emerald-200 disabled:opacity-50">Send Warranty/Terms for Signature</button> : null}
              {!isVoid && invoice.balance > 0 ? <button type="button" onClick={handleWhatsAppPaymentReminder} disabled={actionLoading} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50">WhatsApp Payment Reminder</button> : null}
              {!isVoid ? <button type="button" onClick={handleSendWhatsAppApi} disabled={actionLoading} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50">Send WhatsApp API</button> : null}
              {!isVoid ? <div className="rounded-xl border border-white/10 bg-[#151515] p-3 text-xs text-zinc-400"><div className="font-medium text-white">Public payment link</div><div className="mt-1 break-all">{invoice.publicPaymentToken ? `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/pay/${invoice.publicPaymentToken}` : 'No link generated'}</div><div className="mt-1 capitalize">Status: {invoice.publicPaymentTokenStatus || (invoice.publicPaymentToken ? 'active' : 'not created')}</div></div> : null}
              {!isVoid ? <button type="button" onClick={handleRegeneratePaymentLink} disabled={actionLoading} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-50">Regenerate public payment link</button> : null}
              {!isVoid ? <button type="button" onClick={handleRevokePaymentLink} disabled={actionLoading || !invoice.publicPaymentToken || invoice.publicPaymentTokenStatus === 'revoked'} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300 disabled:opacity-50">Revoke public payment link</button> : null}
              <Link href={`/dashboard/documents/invoices/${invoice.invoiceId}/print`} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200">Official print view</Link>
              <button onClick={() => downloadInvoicePdf(invoice)} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200">Download invoice PDF</button>
            </div>
          </div>

          {canAddPayment ? <form onSubmit={handleAddPayment} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5"><h2 className="text-lg font-semibold text-white">Add Payment</h2><div className="mt-4 grid gap-2"><input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Payment amount" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /><select value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value as PosPaymentMethod }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="cash">cash</option><option value="bank_transfer">bank_transfer</option><option value="card">card</option><option value="ewallet">ewallet</option><option value="duitnow">duitnow</option><option value="other">other</option></select><input value={paymentForm.referenceNo} onChange={(event) => setPaymentForm((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="Reference no" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />{['bank_transfer', 'duitnow', 'ewallet'].includes(paymentForm.method) ? <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setPaymentForm((current) => ({ ...current, proofFile: event.target.files?.[0] || null }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /> : null}<button disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add payment</button></div></form> : null}

          {canManage ? <form onSubmit={handleRefund} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5"><h2 className="text-lg font-semibold text-white">Refund</h2><div className="mt-4 grid gap-2"><input required type="number" min="0.01" step="0.01" value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Refund amount" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /><select value={refundForm.method} onChange={(event) => setRefundForm((current) => ({ ...current, method: event.target.value as PosPaymentMethod }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="cash">cash</option><option value="bank_transfer">bank_transfer</option><option value="card">card</option><option value="ewallet">ewallet</option><option value="duitnow">duitnow</option><option value="other">other</option></select><select value={refundForm.paymentId} onChange={(event) => setRefundForm((current) => ({ ...current, paymentId: event.target.value }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="">No specific payment</option>{payments.map((payment) => <option key={payment.paymentId} value={payment.paymentId}>{payment.paymentId} · {formatCurrency(payment.amount)}</option>)}</select><input required value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Refund reason" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /><button disabled={actionLoading || isVoid} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50">Create refund</button></div>{refunds.length > 0 ? <div className="mt-3 text-xs text-zinc-500">{refunds.length} refund record(s)</div> : null}</form> : null}

          {refunds.length > 0 ? <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5"><h2 className="text-lg font-semibold text-white">Refund Records</h2><div className="mt-4 space-y-2">{refunds.map((refund) => <div key={refund.refundId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm"><div className="font-medium text-white">{refund.refundNo} · {formatCurrency(refund.amount)}</div><div className="text-xs text-zinc-500">{refund.method} · {refund.reason}</div><button type="button" onClick={() => downloadRefundPdf(invoice, refund)} className="mt-2 text-orange-200">Refund PDF</button></div>)}</div></div> : null}

          {canManage && invoice.paymentStatus === 'paid' ? <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5"><h2 className="text-lg font-semibold text-white">Prepared Hooks</h2><div className="mt-4 grid gap-2"><button disabled={actionLoading} onClick={handlePrepareCommission} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-50">Prepare commissions</button><button disabled={actionLoading} onClick={handlePrepareInventory} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-50">Prepare inventory movements</button></div></div> : null}

          {canManage && !isVoid ? <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5"><h2 className="text-lg font-semibold text-white">Void Invoice</h2><textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Void reason" className="mt-4 min-h-20 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /><button disabled={actionLoading || !voidReason.trim()} onClick={handleVoid} className="mt-2 w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Void invoice</button></div> : null}
        </aside>
      </div>

      {reversalTarget ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-5"><h2 className="text-lg font-semibold text-white">Reverse payment</h2><textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Reversal reason" className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => setReversalTarget(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Cancel</button><button disabled={actionLoading || !reversalReason.trim()} onClick={handleReverse} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Reverse</button></div></div></div> : null}
    </section>
  );
}
