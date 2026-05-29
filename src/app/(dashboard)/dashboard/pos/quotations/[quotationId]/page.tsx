'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { formatJobDeviceLabel } from '@/components/documents/documentUtils';
import { getAuditLogsForEntity } from '@/features/audit/services/auditLogService';
import type { AuditLog } from '@/features/audit/types';
import { PosLineItemsEditor } from '@/features/pos/components/PosLineItemsEditor';
import { downloadQuotationPdf } from '@/features/pos/generatePosPdf';
import {
  approvePosQuotation,
  buildQuotationWhatsAppLink,
  createInvoiceFromQuotation,
  ensureQuotationPublicToken,
  expirePastQuotations,
  expirePosQuotation,
  getInvoices,
  getQuotationById,
  markQuotationSent,
  regenerateQuotationPublicToken,
  rejectPosQuotation,
  revokeQuotationPublicToken,
  updateQuotationLineItems,
} from '@/features/pos/posService';
import type { PosInvoice, PosLineItem, PosQuotation } from '@/features/pos/types';
import { getWhatsAppInboundMessagesForEntity, getWhatsAppMessagesForEntity, type PosWhatsAppInboundMessage, type PosWhatsAppMessageLog } from '@/features/pos/whatsappMessageService';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';
import type { Job } from '@/types';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleDateString('en-MY') || '-';
}

function formatDateTime(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

export default function PosQuotationDetailPage() {
  const params = useParams<{ quotationId: string }>();
  const { profile, loading } = useUser();
  const [quotation, setQuotation] = useState<PosQuotation | null>(null);
  const [linkedJob, setLinkedJob] = useState<Job | null>(null);
  const [linkedDevice, setLinkedDevice] = useState<Record<string, unknown> | null>(null);
  const [convertedInvoice, setConvertedInvoice] = useState<PosInvoice | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [whatsAppMessages, setWhatsAppMessages] = useState<PosWhatsAppMessageLog[]>([]);
  const [inboundWhatsAppMessages, setInboundWhatsAppMessages] = useState<PosWhatsAppInboundMessage[]>([]);
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'sent' | 'approved' | 'rejected' | 'expired' | 'invoice' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editItems, setEditItems] = useState<PosLineItem[]>([]);
  const [editDiscountAmount, setEditDiscountAmount] = useState('0');
  const [editDiscountReason, setEditDiscountReason] = useState('');
  const [editValidUntil, setEditValidUntil] = useState('');
  const canOperate = can(profile?.role, 'pos.operate');

  const loadQuotation = useCallback(async () => {
    if (!profile || !canOperate) return;
    try {
      await expirePastQuotations(profile);
      const nextQuotation = await getQuotationById(params.quotationId, profile);
      const [invoices, jobSnapshot, deviceSnapshot] = await Promise.all([
        getInvoices(profile),
        nextQuotation.jobId ? getDoc(doc(db, 'jobs', nextQuotation.jobId)).catch(() => null) : Promise.resolve(null),
        nextQuotation.deviceId ? getDoc(doc(db, 'devices', nextQuotation.deviceId)).catch(() => null) : Promise.resolve(null),
      ]);
      const auditRows = await getAuditLogsForEntity(profile.role, 'pos', nextQuotation.quotationId).catch(() => []);
      const whatsAppRows = await getWhatsAppMessagesForEntity(profile, 'quotation', nextQuotation.quotationId).catch(() => []);
      const inboundRows = await getWhatsAppInboundMessagesForEntity(profile, 'quotation', nextQuotation.quotationId).catch(() => []);
      setQuotation(nextQuotation);
      setLinkedJob(jobSnapshot?.exists() ? ({ docId: jobSnapshot.id, ...jobSnapshot.data() } as Job) : null);
      setLinkedDevice(deviceSnapshot?.exists() ? deviceSnapshot.data() : null);
      setConvertedInvoice(invoices.find((invoice) => invoice.quotationId === nextQuotation.quotationId) || null);
      setAuditLogs(auditRows);
      setWhatsAppMessages(whatsAppRows);
      setInboundWhatsAppMessages(inboundRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load quotation');
    }
  }, [canOperate, params.quotationId, profile]);

  useEffect(() => {
    void loadQuotation();
  }, [loadQuotation]);

  const canProgress = quotation?.status === 'draft' || quotation?.status === 'sent';
  const canConvert = quotation?.status === 'approved' && !convertedInvoice;
  const jobDeviceLabel = formatJobDeviceLabel({
    jobNumber: quotation?.jobNumber,
    jobNo: linkedJob?.jobNo,
    jobSheetNo: linkedJob?.jobSheetNo,
    deviceBrand: linkedJob?.deviceBrand || String(linkedDevice?.brand || ''),
    deviceModel: linkedJob?.deviceModel || String(linkedDevice?.model || ''),
    device: linkedJob?.device || String(linkedDevice?.deviceName || linkedDevice?.name || ''),
    deviceType: linkedJob?.deviceType || String(linkedDevice?.deviceType || ''),
  });
  const statusClass = useMemo(() => {
    if (quotation?.status === 'approved') return 'border-emerald-500/40 text-emerald-300';
    if (quotation?.status === 'rejected' || quotation?.status === 'expired') return 'border-red-500/40 text-red-300';
    return 'border-orange-500/30 text-orange-200';
  }, [quotation?.status]);

  async function runAction() {
    if (!profile || !quotation || !confirmAction) return;
    setActionLoading(true);
    setMessage('');
    try {
      if (confirmAction === 'sent') await markQuotationSent(quotation, profile);
      if (confirmAction === 'approved') await approvePosQuotation(quotation, profile);
      if (confirmAction === 'rejected') await rejectPosQuotation(quotation, rejectionReason, profile);
      if (confirmAction === 'expired') await expirePosQuotation(quotation, profile);
      if (confirmAction === 'invoice') {
        const invoice = await createInvoiceFromQuotation(quotation, profile);
        setConvertedInvoice(invoice);
      }
      setConfirmAction(null);
      setRejectionReason('');
      setMessage('Quotation updated');
      await loadQuotation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update quotation');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWhatsAppQuotation() {
    if (!profile || !quotation) return;
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
      const nextQuotation = { ...quotation, publicToken: token, quotationApprovalToken: token, status: quotation.status === 'draft' ? 'sent' as const : quotation.status };
      setQuotation(nextQuotation);
      const whatsappUrl = buildQuotationWhatsAppLink(nextQuotation);
      if (whatsappWindow) {
        whatsappWindow.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      }
      await loadQuotation();
    } catch (error) {
      whatsappWindow?.close();
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp quotation link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRegeneratePublicLink() {
    if (!profile || !quotation) return;
    setActionLoading(true);
    try {
      const token = await regenerateQuotationPublicToken(quotation, profile);
      setMessage('Public approval link regenerated');
      setQuotation({ ...quotation, publicToken: token, publicTokenStatus: 'active' });
      await loadQuotation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to regenerate public link');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokePublicLink() {
    if (!profile || !quotation) return;
    setActionLoading(true);
    try {
      await revokeQuotationPublicToken(quotation, profile);
      setMessage('Public approval link revoked');
      await loadQuotation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to revoke public link');
    } finally {
      setActionLoading(false);
    }
  }

  function openEditQuotation() {
    if (!quotation) return;
    setEditItems(quotation.items.length ? quotation.items : [{
      name: 'Service quotation',
      category: 'Service',
      type: 'service',
      quantity: 1,
      unitPrice: Number(quotation.total || 0),
      discount: 0,
      total: Number(quotation.total || 0),
    }]);
    setEditDiscountAmount(String(quotation.discountAmount || 0));
    setEditDiscountReason(quotation.discountReason || '');
    setEditValidUntil(quotation.validUntil?.toDate?.().toISOString().slice(0, 10) || '');
    setEditOpen(true);
  }

  async function handleSaveQuotationEdit() {
    if (!profile || !quotation) return;
    setActionLoading(true);
    setMessage('');
    try {
      const updated = await updateQuotationLineItems(quotation, {
        items: editItems,
        discountAmount: Number(editDiscountAmount || 0),
        discountReason: editDiscountReason,
        validUntil: editValidUntil,
      }, profile);
      setQuotation(updated);
      setEditOpen(false);
      setMessage('Quotation updated successfully.');
      await loadQuotation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update quotation');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading quotation</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;
  if (!quotation) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">{message || 'Quotation not found'}</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">{quotation.quotationNo}</h1>
            <p className="mt-1 text-sm text-zinc-400">{quotation.customerName} · {quotation.customerPhone}</p>
            {quotation.customerId ? <Link href={`/dashboard/customers/${quotation.customerId}`} className="mt-2 inline-flex text-sm text-orange-200">Customer 360</Link> : null}
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs capitalize ${statusClass}`}>{quotation.status}</span>
        </div>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Quotation Details</h2>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="text-zinc-400">Branch: <span className="text-white">{quotation.branchId}</span></div>
              <div className="text-zinc-400">Valid Until: <span className="text-white">{formatDate(quotation.validUntil)}</span></div>
              <div className="text-zinc-400">Created: <span className="text-white">{formatDate(quotation.createdAt)}</span></div>
              <div className="text-zinc-400">Device / Job: <span className="text-white">{jobDeviceLabel}</span></div>
              {quotation.rejectionReason ? <div className="md:col-span-2 text-zinc-400">Rejection Reason: <span className="text-white">{quotation.rejectionReason}</span></div> : null}
              {convertedInvoice ? <Link href={`/dashboard/pos/invoices/${convertedInvoice.invoiceId}`} className="text-orange-200 md:col-span-2">Converted Invoice: {convertedInvoice.invoiceNo}</Link> : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Discount</th><th className="px-4 py-3">Total</th></tr></thead>
              <tbody>{quotation.items.map((item, index) => <tr key={`${item.name}-${index}`} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white">{item.name}</td><td className="px-4 py-3 text-zinc-300">{item.quantity}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.unitPrice)}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(Number(item.discount || 0))}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.total)}</td></tr>)}</tbody>
            </table>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Audit Timeline</h2>
            <div className="mt-4 space-y-2">
              {auditLogs.map((log) => <div key={log.auditLogId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm"><div className="font-medium text-white">{log.action}</div><div className="text-xs text-zinc-500">{log.changedByDisplayName} · {formatDate(log.createdAt)}</div>{log.note ? <div className="mt-1 text-xs text-zinc-400">{log.note}</div> : null}</div>)}
              {auditLogs.length === 0 ? <div className="text-sm text-zinc-500">No audit records found</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Customer Activity</h2>
            <div className="mt-4 grid gap-2 text-sm text-zinc-300">
              <div>Public token created: <span className="text-white">{formatDateTime(quotation.publicTokenCreatedAt)}</span></div>
              <div>Customer viewed: <span className="text-white">{formatDateTime(quotation.customerViewedAt)}</span></div>
              <div>Customer approved: <span className="text-white">{formatDateTime(quotation.customerApprovedAt)}</span></div>
              <div>Customer rejected: <span className="text-white">{formatDateTime(quotation.customerRejectedAt)}</span></div>
              {quotation.customerRejectionReason ? <div>Rejection reason: <span className="text-white">{quotation.customerRejectionReason}</span></div> : null}
              <div>Token status: <span className="text-white">{quotation.publicTokenStatus || (quotation.publicToken ? 'active' : 'not created')}</span></div>
              <div>Token revoked: <span className="text-white">{formatDateTime(quotation.publicTokenRevokedAt)}</span></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">WhatsApp Messages</h2>
            <div className="mt-4 space-y-2">
              {whatsAppMessages.slice(0, 5).map((row) => (
                <div key={row.messageId} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white">{row.messageType} · {row.status}</span>
                    <span className="text-xs text-zinc-500">{formatDateTime(row.sentAt || row.createdAt)}</span>
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
                      <div className="text-xs text-zinc-500">{row.senderName || row.senderPhone} · {formatDateTime(row.receivedAt)}</div>
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

        <aside className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <div className="space-y-2 border-b border-white/10 pb-4 text-sm">
            <div className="flex justify-between text-zinc-300"><span>Subtotal</span><span>{formatCurrency(quotation.subtotal)}</span></div>
            <div className="flex justify-between text-zinc-300"><span>Discount</span><span>{formatCurrency(quotation.discountAmount)}</span></div>
            <div className="flex justify-between text-lg font-semibold text-white"><span>Total</span><span>{formatCurrency(quotation.total)}</span></div>
          </div>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={openEditQuotation} disabled={actionLoading || Boolean(convertedInvoice)} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50">
              Edit Quotation
            </button>
            {convertedInvoice ? <div className="text-xs text-zinc-500">Converted quotations are locked. Edit the invoice before payment if changes are needed.</div> : null}
            <button type="button" onClick={handleWhatsAppQuotation} disabled={actionLoading || quotation.status === 'approved' || quotation.status === 'rejected'} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200 disabled:opacity-50">Send Quotation via WhatsApp</button>
            <div className="rounded-xl border border-white/10 bg-[#151515] p-3 text-xs text-zinc-400">
              <div className="font-medium text-white">Public approval link</div>
              <div className="mt-1 break-all">{quotation.publicToken ? `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/quotation/${quotation.publicToken}` : 'No link generated'}</div>
              <div className="mt-1 capitalize">Status: {quotation.publicTokenStatus || (quotation.publicToken ? 'active' : 'not created')}</div>
            </div>
            <button type="button" onClick={handleRegeneratePublicLink} disabled={actionLoading} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-50">Regenerate public approval link</button>
            <button type="button" onClick={handleRevokePublicLink} disabled={actionLoading || !quotation.publicToken || quotation.publicTokenStatus === 'revoked'} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300 disabled:opacity-50">Revoke public approval link</button>
            <Link href={`/dashboard/documents/quotations/${quotation.quotationId}/print`} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-center text-sm text-orange-200">Official print view</Link>
            <button onClick={() => downloadQuotationPdf(quotation)} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200">Download quotation PDF</button>
            {quotation.status === 'draft' ? <button onClick={() => setConfirmAction('sent')} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-200">Mark as sent</button> : null}
            {canProgress ? <button onClick={() => setConfirmAction('approved')} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white">Approve quotation</button> : null}
            {canProgress ? <button onClick={() => setConfirmAction('rejected')} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300">Reject quotation</button> : null}
            {quotation.status !== 'approved' && quotation.status !== 'rejected' && quotation.status !== 'expired' ? <button onClick={() => setConfirmAction('expired')} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Expire quotation</button> : null}
            <button disabled={!canConvert} onClick={() => setConfirmAction('invoice')} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-40">Convert to invoice</button>
          </div>
        </aside>
      </div>

      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-5">
            <h2 className="text-lg font-semibold text-white">Confirm quotation action</h2>
            <p className="mt-2 text-sm text-zinc-400">Proceed with {confirmAction}?</p>
            {confirmAction === 'rejected' ? <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Rejection reason" className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" /> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Cancel</button>
              <button disabled={actionLoading || (confirmAction === 'rejected' && !rejectionReason.trim())} onClick={runAction} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-white/10 bg-[#151515] p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Edit Quotation</h2>
                <p className="mt-1 text-sm text-zinc-400">{quotation.quotationNo} · {quotation.customerName}</p>
              </div>
              <button type="button" onClick={() => setEditOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Close</button>
            </div>
            <PosLineItemsEditor
              items={editItems}
              discountAmount={editDiscountAmount}
              discountReason={editDiscountReason}
              onItemsChange={setEditItems}
              onDiscountAmountChange={setEditDiscountAmount}
              onDiscountReasonChange={setEditDiscountReason}
            />
            <label className="mt-4 block">
              <span className="mb-1 block text-xs uppercase text-zinc-500">Valid Until</span>
              <input type="date" value={editValidUntil} onChange={(event) => setEditValidUntil(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditOpen(false)} disabled={actionLoading} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleSaveQuotationEdit} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{actionLoading ? 'Saving...' : 'Save Quotation'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
