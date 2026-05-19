'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getWhatsAppMessages, type PosWhatsAppMessageLog } from '@/features/pos/whatsappMessageService';
import { sendPosWhatsAppBusinessMessage } from '@/features/pos/whatsappService';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

function statusClass(status: string): string {
  if (status === 'sent') return 'border-green-500/20 bg-green-500/10 text-green-300';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-300';
  return 'border-white/10 bg-white/5 text-zinc-300';
}

function relatedLink(message: PosWhatsAppMessageLog): string {
  if (message.relatedEntityType === 'quotation' && message.relatedEntityId) return `/dashboard/pos/quotations/${message.relatedEntityId}`;
  if (message.relatedEntityType === 'invoice' && message.relatedEntityId) return `/dashboard/pos/invoices/${message.relatedEntityId}`;
  if (message.relatedEntityType === 'warranty' && message.relatedEntityId) return `/dashboard/warranties/${message.relatedEntityId}`;
  if (message.relatedEntityType === 'job') return '/dashboard/jobs';
  if (message.relatedEntityType === 'paymentSubmission') return '/dashboard/pos/payment-submissions';
  return '';
}

export default function PosWhatsAppMessagesPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [messages, setMessages] = useState<PosWhatsAppMessageLog[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  async function loadMessages() {
    if (!profile || !canManage) return;
    setMessages(await getWhatsAppMessages(profile));
  }

  useEffect(() => {
    void loadMessages().catch((error) => setNotice(error instanceof Error ? error.message : 'Unable to load WhatsApp messages'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  const filteredMessages = useMemo(() => messages.filter((message) => {
    if (branchFilter !== 'all' && message.branchId !== branchFilter) return false;
    if (statusFilter !== 'all' && message.status !== statusFilter) return false;
    if (typeFilter !== 'all' && message.messageType !== typeFilter) return false;
    return true;
  }), [branchFilter, messages, statusFilter, typeFilter]);

  async function retryMessage(message: PosWhatsAppMessageLog) {
    if (!firebaseUser || !message.messageBody.trim()) return;
    setBusy(true);
    setNotice('');
    try {
      const idToken = await firebaseUser.getIdToken();
      await sendPosWhatsAppBusinessMessage({
        branchId: message.branchId,
        recipientPhone: message.recipientPhone,
        message: message.messageBody,
        messageType: message.messageType,
        relatedEntityType: message.relatedEntityType,
        relatedEntityId: message.relatedEntityId,
        retryOfMessageId: message.messageId,
      }, idToken);
      setNotice('WhatsApp message retry sent');
      await loadMessages();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to retry WhatsApp message');
      await loadMessages();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading WhatsApp messages</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">WhatsApp Messages</h1>
      </div>

      {notice ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{notice}</div> : null}

      <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#111111]/90 p-5 md:grid-cols-3">
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All branches</option>
          <option value="bangi">Bangi</option>
          <option value="cyberjaya">Cyberjaya</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All status</option>
          <option value="draft">draft</option>
          <option value="sent">sent</option>
          <option value="failed">failed</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All message type</option>
          <option value="quotation">quotation</option>
          <option value="invoice">invoice</option>
          <option value="payment_request">payment_request</option>
          <option value="warranty">warranty</option>
          <option value="payment_submission">payment_submission</option>
          <option value="custom">custom</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-[1120px] w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Message date</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Sender number</th>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Message type</th>
              <th className="px-4 py-3">Related</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Sent by</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredMessages.map((message) => {
              const href = relatedLink(message);
              return (
                <tr key={message.messageId} className="border-b border-white/10 last:border-b-0 align-top">
                  <td className="px-4 py-3 text-zinc-300">{formatDate(message.sentAt || message.createdAt)}</td>
                  <td className="px-4 py-3 text-zinc-300">{message.branchId}</td>
                  <td className="px-4 py-3 text-zinc-300">{message.senderNumber}</td>
                  <td className="px-4 py-3 text-zinc-300">{message.recipientPhone}</td>
                  <td className="px-4 py-3 text-zinc-300">{message.messageType}</td>
                  <td className="px-4 py-3 text-zinc-300">
                    {href ? <Link href={href} className="text-orange-200">{message.relatedEntityType}</Link> : message.relatedEntityType || '-'}
                  </td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs ${statusClass(message.status)}`}>{message.status}</span></td>
                  <td className="px-4 py-3 text-zinc-300">{message.sentBy || '-'}</td>
                  <td className="max-w-[240px] px-4 py-3 text-xs text-red-300">{message.errorMessage || '-'}</td>
                  <td className="px-4 py-3">
                    {message.status === 'failed' ? <button disabled={busy} onClick={() => retryMessage(message)} className="text-orange-200 disabled:text-zinc-600">Retry</button> : null}
                  </td>
                </tr>
              );
            })}
            {filteredMessages.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-zinc-500">No WhatsApp messages found</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
