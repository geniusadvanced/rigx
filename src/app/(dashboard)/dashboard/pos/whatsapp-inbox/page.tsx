'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import {
  addWhatsAppConversationNote,
  assignWhatsAppConversation,
  createCustomerFromWhatsAppConversation,
  getWhatsAppConversations,
  getWhatsAppInboundMessages,
  getWhatsAppMessages,
  linkWhatsAppConversationCustomer,
  linkWhatsAppConversationEntity,
  unlinkWhatsAppConversationCustomer,
  unlinkWhatsAppConversationEntity,
  updateWhatsAppConversationControls,
  updateWhatsAppInboundMessagesStatus,
  type PosWhatsAppConversation,
  type PosWhatsAppConversationPriority,
  type PosWhatsAppConversationStatus,
  type PosWhatsAppInboundMessage,
  type PosWhatsAppMessageLog,
} from '@/features/pos/whatsappMessageService';
import { buildWaMeLink, getWhatsAppSenderForBranch, sendPosWhatsAppBusinessMessage } from '@/features/pos/whatsappService';
import {
  getInvoices,
  getPaymentSubmissions,
  getQuotations,
  getWarranties,
} from '@/features/pos/posService';
import type { PaymentSubmission, PosInvoice, PosQuotation, PosWarranty } from '@/features/pos/types';
import { getCustomers } from '@/features/customers/services/customerService';
import type { Customer } from '@/features/customers/types';
import { getStaffList } from '@/features/hr/services/hrService';
import type { StaffProfile } from '@/features/hr/types';
import { storage } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { useJobs } from '@/lib/hooks/useJobs';
import { can } from '@/lib/rbac/can';
import type { Job } from '@/types';

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

function relatedLink(type?: string, id?: string): string {
  if (type === 'quotation' && id) return `/dashboard/pos/quotations/${id}`;
  if (type === 'invoice' && id) return `/dashboard/pos/invoices/${id}`;
  if (type === 'warranty' && id) return `/dashboard/warranties/${id}`;
  if (type === 'job') return '/dashboard/jobs';
  if (type === 'paymentSubmission') return '/dashboard/pos/payment-submissions';
  if (type === 'customer') return '/dashboard/customers';
  return '';
}

const quickReplies = [
  'Hi, terima kasih. Kami akan semak dan update sebentar lagi.',
  'Baik, quotation telah diterima. Kami akan teruskan selepas pengesahan.',
  'Boleh share gambar/video masalah device untuk kami semak dahulu?',
  'Payment proof diterima. Team kami akan verify dan update status sebentar lagi.',
];

function MediaPreview({ message }: { message: PosWhatsAppInboundMessage }) {
  const [url, setUrl] = useState(message.mediaDownloadUrl || '');

  useEffect(() => {
    let cancelled = false;
    if (!message.mediaStoragePath || message.mediaDownloadUrl) return;
    getDownloadURL(ref(storage, message.mediaStoragePath))
      .then((downloadUrl) => {
        if (!cancelled) setUrl(downloadUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [message.mediaDownloadUrl, message.mediaStoragePath]);

  if (!message.mediaId && !message.mediaStoragePath) return null;
  if (!url) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-[#050505] p-3 text-xs text-zinc-400">
        Media received, download not available
      </div>
    );
  }
  if (message.messageType === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={message.mediaCaption || message.mediaFileName || 'WhatsApp media'} className="max-h-56 rounded-xl border border-white/10 object-contain" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block rounded-xl border border-orange-500/20 bg-[#050505] p-3 text-xs text-orange-200">
      {message.mediaFileName || `${message.messageType} attachment`} {message.mediaSizeBytes ? `· ${(message.mediaSizeBytes / 1024).toFixed(1)} KB` : ''}
    </a>
  );
}

export default function PosWhatsAppInboxPage() {
  const { firebaseUser, profile, loading } = useUser();
  const { jobs } = useJobs(profile?.role ? profile : null);
  const [conversations, setConversations] = useState<PosWhatsAppConversation[]>([]);
  const [inboundMessages, setInboundMessages] = useState<PosWhatsAppInboundMessage[]>([]);
  const [outboundMessages, setOutboundMessages] = useState<PosWhatsAppMessageLog[]>([]);
  const [staffRows, setStaffRows] = useState<StaffProfile[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotations, setQuotations] = useState<PosQuotation[]>([]);
  const [invoices, setInvoices] = useState<PosInvoice[]>([]);
  const [warranties, setWarranties] = useState<PosWarranty[]>([]);
  const [paymentSubmissions, setPaymentSubmissions] = useState<PaymentSubmission[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [message, setMessage] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [noteText, setNoteText] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [entityType, setEntityType] = useState<'quotation' | 'invoice' | 'paymentSubmission' | 'warranty' | 'job' | 'customer'>('invoice');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityId, setEntityId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const canManage = can(profile?.role, 'pos.manage');

  async function loadMessages() {
    if (!profile || !canManage) return;
    const [conversationRows, inbound, outbound, staff, customerRows, quotationRows, invoiceRows, warrantyRows, submissionRows] = await Promise.all([
      getWhatsAppConversations(profile),
      getWhatsAppInboundMessages(profile),
      getWhatsAppMessages(profile),
      getStaffList().catch(() => []),
      getCustomers(profile).catch(() => []),
      getQuotations(profile).catch(() => []),
      getInvoices(profile).catch(() => []),
      getWarranties(profile).catch(() => []),
      getPaymentSubmissions(profile).catch(() => []),
    ]);
    setConversations(conversationRows);
    setInboundMessages(inbound);
    setOutboundMessages(outbound);
    setStaffRows(staff.filter((row) => row.role === 'admin' || row.role === 'manager'));
    setCustomers(customerRows);
    setQuotations(quotationRows);
    setInvoices(invoiceRows);
    setWarranties(warrantyRows);
    setPaymentSubmissions(submissionRows);
    setSelectedConversationId((current) => current || conversationRows[0]?.conversationId || '');
  }

  useEffect(() => {
    void loadMessages().catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load WhatsApp inbox'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    if (statusFilter !== 'all' && conversation.status !== statusFilter) return false;
    if (branchFilter !== 'all' && conversation.branchId !== branchFilter) return false;
    if (assignedFilter === 'me' && conversation.assignedTo !== profile?.uid) return false;
    if (assignedFilter === 'unassigned' && conversation.assignedTo) return false;
    if (priorityFilter !== 'all' && (conversation.priority || 'normal') !== priorityFilter) return false;
    if (unreadOnly && Number(conversation.unreadCount || 0) <= 0) return false;
    return true;
  }), [assignedFilter, branchFilter, conversations, priorityFilter, profile?.uid, statusFilter, unreadOnly]);

  const selectedConversation = conversations.find((item) => item.conversationId === selectedConversationId) || null;
  const selectedPhone = selectedConversation?.phone || '';
  const selectedInbound = inboundMessages.filter((item) => item.senderPhone === selectedPhone && (item.branchId || 'unknown') === (selectedConversation?.branchId || 'unknown'));
  const selectedOutbound = outboundMessages.filter((item) => item.recipientPhone === selectedPhone && (item.branchId || 'cyberjaya') === (selectedConversation?.branchId || 'cyberjaya'));
  const customerSearchResults = useMemo(() => {
    const normalized = customerSearch.trim().toLowerCase();
    if (!normalized) return customers.slice(0, 8);
    return customers.filter((customer) => [customer.fullName, customer.phone, customer.email].some((value) => String(value || '').toLowerCase().includes(normalized))).slice(0, 8);
  }, [customerSearch, customers]);
  const entitySearchResults = useMemo(() => {
    const normalized = entitySearch.trim().toLowerCase();
    const customerNeedles = [
      selectedConversation?.customerName,
      selectedConversation?.phone,
    ].filter(Boolean).map((value) => String(value).toLowerCase());
    const matches = (values: unknown[]) => {
      const haystack = values.map((value) => String(value || '').toLowerCase());
      if (normalized && haystack.some((value) => value.includes(normalized))) return true;
      return !normalized && customerNeedles.length > 0 && customerNeedles.some((needle) => haystack.some((value) => value.includes(needle)));
    };
    if (entityType === 'quotation') {
      return quotations
        .filter((row) => matches([row.quotationNo, row.customerName, row.customerPhone, row.quotationId]))
        .slice(0, 8)
        .map((row) => ({ id: row.quotationId, label: `${row.quotationNo} · ${row.customerName}` }));
    }
    if (entityType === 'invoice') {
      return invoices
        .filter((row) => matches([row.invoiceNo, row.customerName, row.customerPhone, row.invoiceId]))
        .slice(0, 8)
        .map((row) => ({ id: row.invoiceId, label: `${row.invoiceNo} · ${row.customerName}` }));
    }
    if (entityType === 'job') {
      return jobs
        .filter((row: Job) => matches([row.docId, row.jobNo, row.jobNumber, row.jobSheetNo, row.agnJobNumber, row.customerName, row.customerPhone]))
        .slice(0, 8)
        .map((row: Job) => ({ id: row.docId, label: `${row.jobNo || row.jobNumber || row.jobSheetNo || row.agnJobNumber || row.docId} · ${row.customerName || '-'}` }));
    }
    if (entityType === 'warranty') {
      return warranties
        .filter((row) => matches([row.warrantyId, row.itemName, row.customerName, row.customerPhone, row.invoiceId]))
        .slice(0, 8)
        .map((row) => ({ id: row.warrantyId, label: `${row.itemName} · ${row.customerName}` }));
    }
    if (entityType === 'paymentSubmission') {
      return paymentSubmissions
        .filter((row) => matches([row.submissionId, row.invoiceNo, row.customerName, row.customerPhone, row.referenceNo]))
        .slice(0, 8)
        .map((row) => ({ id: row.submissionId, label: `${row.invoiceNo} · ${row.customerName} · ${row.status}` }));
    }
    return customers
      .filter((row) => matches([row.customerId, row.fullName, row.phone, row.email]))
      .slice(0, 8)
      .map((row) => ({ id: row.customerId, label: `${row.fullName} · ${row.phone}` }));
  }, [customers, entitySearch, entityType, invoices, jobs, paymentSubmissions, quotations, selectedConversation?.customerName, selectedConversation?.phone, warranties]);
  const timeline = [
    ...selectedInbound.map((item) => ({ kind: 'inbound' as const, time: item.receivedAt, item })),
    ...selectedOutbound.map((item) => ({ kind: 'outbound' as const, time: item.sentAt || item.createdAt, item })),
  ].sort((left, right) => (left.time?.toMillis?.() || 0) - (right.time?.toMillis?.() || 0));
  const unreadCount = conversations.reduce((total, conversation) => total + Number(conversation.unreadCount || 0), 0);

  function slaLabel(conversation: PosWhatsAppConversation): { label: string; className: string } {
    if (conversation.status !== 'pending_staff' || !conversation.lastCustomerReplyAt?.toMillis) return { label: 'normal', className: 'text-zinc-500 border-white/10' };
    const hours = (nowMs - conversation.lastCustomerReplyAt.toMillis()) / (60 * 60 * 1000);
    if (hours > 4) return { label: 'overdue', className: 'text-red-300 border-red-500/30' };
    if (hours >= 1) return { label: 'warning', className: 'text-amber-200 border-amber-500/30' };
    return { label: 'normal', className: 'text-green-300 border-green-500/30' };
  }

  async function markSelected(status: 'read' | 'archived') {
    if (!profile || selectedInbound.length === 0) return;
    await updateWhatsAppInboundMessagesStatus(selectedInbound.map((item) => item.inboundMessageId), status, profile);
    if (selectedConversation) {
      await updateWhatsAppConversationControls(selectedConversation, { status: status === 'archived' ? 'archived' : selectedConversation.status }, profile);
    }
    setMessage(status === 'read' ? 'Conversation marked as read' : 'Conversation archived');
    await loadMessages();
  }

  async function sendReply() {
    if (!firebaseUser || !selectedPhone || !selectedConversation) return;
    const trimmedMessage = replyMessage.trim();
    if (!trimmedMessage) {
      setMessage('Reply message is required');
      return;
    }
    const unusualRecipient = !selectedPhone.startsWith('60') || selectedPhone.length < 10;
    if ((trimmedMessage.length > 700 || unusualRecipient) && !window.confirm('Send this WhatsApp reply?')) return;
    setReplySending(true);
    setMessage('');
    try {
      const idToken = await firebaseUser.getIdToken();
      await sendPosWhatsAppBusinessMessage({
        branchId: selectedConversation.branchId === 'unknown' ? 'cyberjaya' : selectedConversation.branchId,
        recipientPhone: selectedPhone,
        message: trimmedMessage,
        messageType: selectedConversation.relatedEntityType === 'quotation'
          ? 'quotation'
          : selectedConversation.relatedEntityType === 'invoice'
            ? 'invoice'
            : 'custom',
        relatedEntityType: selectedConversation.relatedEntityType,
        relatedEntityId: selectedConversation.relatedEntityId,
      }, idToken);
      setReplyMessage('');
      setMessage('WhatsApp reply sent');
      await loadMessages();
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Use wa.me fallback link.` : 'Unable to send WhatsApp reply');
      await loadMessages();
    } finally {
      setReplySending(false);
    }
  }

  async function assignSelf() {
    if (!profile || !selectedConversation) return;
    await assignWhatsAppConversation(selectedConversation, { uid: profile.uid, displayName: profile.displayName || profile.name || 'Unknown User' }, profile);
    setMessage('Conversation assigned');
    await loadMessages();
  }

  async function assignStaff(uid: string) {
    if (!profile || !selectedConversation) return;
    const staff = staffRows.find((row) => row.uid === uid);
    if (!staff) return;
    await assignWhatsAppConversation(selectedConversation, { uid: staff.uid, displayName: staff.displayName || staff.name }, profile);
    setMessage('Conversation assigned');
    await loadMessages();
  }

  async function unassign() {
    if (!profile || !selectedConversation) return;
    await assignWhatsAppConversation(selectedConversation, null, profile);
    setMessage('Conversation unassigned');
    await loadMessages();
  }

  async function updateControls(patch: { status?: PosWhatsAppConversationStatus; priority?: PosWhatsAppConversationPriority; nextFollowUpAt?: string }) {
    if (!profile || !selectedConversation) return;
    await updateWhatsAppConversationControls(selectedConversation, patch, profile);
    setMessage('Conversation updated');
    await loadMessages();
  }

  async function addNote() {
    if (!profile || !selectedConversation) return;
    await addWhatsAppConversationNote(selectedConversation, noteText, profile);
    setNoteText('');
    setMessage('Internal note added');
    await loadMessages();
  }

  async function linkCustomer() {
    if (!profile || !selectedConversation || !selectedCustomerId) return;
    const customer = customers.find((row) => row.customerId === selectedCustomerId);
    if (!customer) return;
    await linkWhatsAppConversationCustomer(selectedConversation, customer, profile);
    setSelectedCustomerId('');
    setMessage('Conversation linked to customer');
    await loadMessages();
  }

  async function unlinkCustomer() {
    if (!profile || !selectedConversation) return;
    await unlinkWhatsAppConversationCustomer(selectedConversation, profile);
    setMessage('Customer link removed');
    await loadMessages();
  }

  async function createCustomerFromConversation() {
    if (!profile || !selectedConversation) return;
    await createCustomerFromWhatsAppConversation(selectedConversation, {
      fullName: newCustomerName || selectedConversation.customerName || selectedConversation.phone,
      branch: selectedConversation.branchId === 'bangi' || selectedConversation.branchId === 'cyberjaya' ? selectedConversation.branchId : 'unknown',
    }, profile);
    setNewCustomerName('');
    setMessage('Customer created from WhatsApp conversation');
    await loadMessages();
  }

  async function linkEntity() {
    if (!profile || !selectedConversation) return;
    await linkWhatsAppConversationEntity(selectedConversation, { relatedEntityType: entityType, relatedEntityId: entityId }, profile);
    setEntityId('');
    setMessage('Conversation linked to related entity');
    await loadMessages();
  }

  async function unlinkEntity() {
    if (!profile || !selectedConversation) return;
    await unlinkWhatsAppConversationEntity(selectedConversation, profile);
    setMessage('Related entity link removed');
    await loadMessages();
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading WhatsApp inbox</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-white">WhatsApp Inbox</h1>
          <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-sm text-orange-200">{unreadCount} unread</div>
        </div>
      </div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#111111]/90 p-4 md:grid-cols-5">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All status</option>
          <option value="open">open</option>
          <option value="pending_customer">pending_customer</option>
          <option value="pending_staff">pending_staff</option>
          <option value="resolved">resolved</option>
          <option value="archived">archived</option>
        </select>
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All branches</option>
          <option value="bangi">Bangi</option>
          <option value="cyberjaya">Cyberjaya</option>
          <option value="unknown">unknown</option>
        </select>
        <select value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All assigned</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All priority</option>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-zinc-300">
          <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
          Unread only
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-4">
          <div className="space-y-2">
            {filteredConversations.map((conversation) => {
              const href = relatedLink(conversation.relatedEntityType, conversation.relatedEntityId);
              const sla = slaLabel(conversation);
              return (
                <button key={conversation.conversationId} type="button" onClick={() => setSelectedConversationId(conversation.conversationId)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedConversationId === conversation.conversationId ? 'border-orange-500/30 bg-[#1F160E]' : 'border-white/10 bg-[#151515]'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-white">{conversation.customerName || conversation.phone}</div>
                    {conversation.unreadCount > 0 ? <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">{conversation.unreadCount}</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{conversation.phone} · {conversation.branchId || 'unknown'} · {conversation.assignedToName || 'unassigned'}</div>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400">{conversation.status}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400">{conversation.priority || 'normal'}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${sla.className}`}>{sla.label}</span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-zinc-400">{conversation.latestMessagePreview || '-'}</div>
                  <div className="mt-1 text-xs text-zinc-600">{formatDate(conversation.latestMessageAt)}</div>
                  {href ? <div className="mt-2 text-xs text-orange-200">{conversation.relatedEntityType}</div> : null}
                </button>
              );
            })}
            {filteredConversations.length === 0 ? <div className="p-4 text-sm text-zinc-500">No inbound messages found</div> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          {!selectedPhone ? (
            <div className="text-sm text-zinc-500">Select a conversation</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedConversation?.customerName || selectedPhone}</h2>
                  <div className="mt-1 text-sm text-zinc-500">{selectedPhone} · {selectedConversation?.branchId || 'unknown'}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-white/10 px-2 py-1 text-zinc-400">{selectedConversation?.status}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-zinc-400">{selectedConversation?.priority || 'normal'}</span>
                    <span className={`rounded-full border px-2 py-1 ${selectedConversation ? slaLabel(selectedConversation).className : 'border-white/10 text-zinc-500'}`}>{selectedConversation ? slaLabel(selectedConversation).label : 'normal'}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-zinc-400">{selectedConversation?.assignedToName || 'unassigned'}</span>
                  </div>
                  {selectedConversation?.relatedEntityType ? (
                    <Link href={relatedLink(selectedConversation.relatedEntityType, selectedConversation.relatedEntityId)} className="mt-2 inline-flex text-sm text-orange-200">
                      Related {selectedConversation.relatedEntityType}
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => navigator.clipboard.writeText(selectedPhone)} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">Copy customer phone</button>
                  <a href={buildWaMeLink({ branch: selectedConversation?.branchId, recipientPhone: selectedPhone })} target="_blank" rel="noreferrer" className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200">Open wa.me fallback</a>
                  <button onClick={() => markSelected('read')} className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200">Mark read</button>
                  <button onClick={() => markSelected('archived')} className="rounded-xl border border-red-500/20 px-3 py-2 text-sm text-red-300">Archive</button>
                </div>
              </div>

              {selectedConversation ? (
                <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#151515]/90 p-4 md:grid-cols-4">
                  <button type="button" onClick={assignSelf} className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200">Assign to self</button>
                  <select value={selectedConversation.assignedTo || ''} onChange={(event) => event.target.value ? assignStaff(event.target.value) : unassign()} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="">Unassigned</option>
                    {staffRows.map((staff) => <option key={staff.uid} value={staff.uid}>{staff.displayName || staff.name}</option>)}
                  </select>
                  <select value={selectedConversation.status} onChange={(event) => updateControls({ status: event.target.value as PosWhatsAppConversationStatus })} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="open">open</option>
                    <option value="pending_customer">pending_customer</option>
                    <option value="pending_staff">pending_staff</option>
                    <option value="resolved">resolved</option>
                    <option value="archived">archived</option>
                  </select>
                  <select value={selectedConversation.priority || 'normal'} onChange={(event) => updateControls({ priority: event.target.value as PosWhatsAppConversationPriority })} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                  </select>
                  <input type="date" onChange={(event) => updateControls({ nextFollowUpAt: event.target.value })} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2" />
                  <button type="button" onClick={unassign} className="rounded-xl border border-red-500/20 px-3 py-2 text-sm text-red-300">Unassign</button>
                </div>
              ) : null}

              {selectedConversation ? (
                <div className="grid gap-4 rounded-3xl border border-white/10 bg-[#151515]/90 p-4 lg:grid-cols-2">
                  <div>
                    <div className="text-sm font-medium text-white">Customer Link</div>
                    <div className="mt-2 text-xs text-zinc-500">
                      Matched: {selectedConversation.customerName || selectedConversation.matchedCustomerId || 'No customer linked'}
                    </div>
                    {selectedConversation.matchedCustomerId ? (
                      <Link href={`/dashboard/customers/${selectedConversation.matchedCustomerId}`} className="mt-2 inline-flex text-xs text-orange-200">Open Customer 360</Link>
                    ) : null}
                    <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search customer by name, phone, email" className="mt-3 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                    <div className="mt-2 flex gap-2">
                      <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                        <option value="">Select existing customer</option>
                        {customerSearchResults.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.fullName} · {customer.phone}</option>)}
                      </select>
                      <button type="button" disabled={!selectedCustomerId} onClick={linkCustomer} className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200 disabled:opacity-50">Link</button>
                      <button type="button" disabled={!selectedConversation.matchedCustomerId} onClick={unlinkCustomer} className="rounded-xl border border-red-500/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">Unlink</button>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="New customer name" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                      <button type="button" onClick={createCustomerFromConversation} className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200">Create</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Related Entity</div>
                    <div className="mt-2 text-xs text-zinc-500">
                      Current: {selectedConversation.relatedEntityType || 'none'} {selectedConversation.relatedEntityId || ''}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr]">
                      <select value={entityType} onChange={(event) => setEntityType(event.target.value as typeof entityType)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                        <option value="quotation">quotation</option>
                        <option value="invoice">invoice</option>
                        <option value="job">job</option>
                        <option value="warranty">warranty</option>
                        <option value="paymentSubmission">paymentSubmission</option>
                        <option value="customer">customer</option>
                      </select>
                      <input value={entitySearch} onChange={(event) => setEntitySearch(event.target.value)} placeholder="Search number, name, phone, ID" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                        <option value="">Select related record</option>
                        {entitySearchResults.map((result) => <option key={result.id} value={result.id}>{result.label}</option>)}
                      </select>
                      <button type="button" disabled={!entityId.trim()} onClick={linkEntity} className="rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200 disabled:opacity-50">Link</button>
                      <button type="button" disabled={!selectedConversation.relatedEntityId} onClick={unlinkEntity} className="rounded-xl border border-red-500/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">Unlink</button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {timeline.map((row, index) => {
                  const isInbound = row.kind === 'inbound';
                  const inbound = isInbound ? row.item as PosWhatsAppInboundMessage : null;
                  const outbound = !isInbound ? row.item as PosWhatsAppMessageLog : null;
                  return (
                    <div key={`${row.kind}-${index}`} className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[78%] rounded-2xl border px-4 py-3 text-sm ${isInbound ? 'border-white/10 bg-[#151515] text-zinc-200' : 'border-orange-500/20 bg-orange-500/10 text-orange-100'}`}>
                        <div className="text-xs text-zinc-500">{isInbound ? 'Customer' : 'RIGX'} · {formatDate(row.time)}</div>
                        <div className="mt-1 whitespace-pre-wrap leading-6">{inbound?.textBody || inbound?.mediaCaption || outbound?.messageBody || inbound?.messageType || outbound?.messageType}</div>
                        {inbound ? <MediaPreview message={inbound} /> : null}
                        {inbound?.status ? <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs ${inbound.status === 'received' ? 'border-orange-500/25 text-orange-200' : 'border-white/10 text-zinc-500'}`}>{inbound.status}</div> : null}
                        {outbound?.status ? <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs ${outbound.status === 'sent' ? 'border-green-500/25 text-green-300' : outbound.status === 'failed' ? 'border-red-500/25 text-red-300' : 'border-white/10 text-zinc-500'}`}>{outbound.status}</div> : null}
                      </div>
                    </div>
                  );
                })}
                {timeline.length === 0 ? <div className="text-sm text-zinc-500">No messages in this conversation</div> : null}
              </div>

              {selectedConversation ? (
                <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-4">
                  <div className="text-sm font-medium text-white">Internal Notes</div>
                  <div className="mt-3 space-y-2">
                    {(selectedConversation.internalNotes || []).map((note, index) => (
                      <div key={`${note.createdBy}-${index}`} className="rounded-2xl border border-white/10 bg-[#101010] p-3 text-sm">
                        <div className="text-xs text-zinc-500">{note.createdBy} · {formatDate(note.createdAt)}</div>
                        <div className="mt-1 text-zinc-300">{note.note}</div>
                      </div>
                    ))}
                    {(selectedConversation.internalNotes || []).length === 0 ? <div className="text-sm text-zinc-500">No internal notes</div> : null}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Add internal note" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                    <button disabled={!noteText.trim()} onClick={addNote} className="rounded-xl border border-orange-500/20 px-4 py-2 text-sm text-orange-200 disabled:opacity-50">Add note</button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-4">
                <div className="text-sm font-medium text-white">Reply</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickReplies.map((reply) => (
                    <button key={reply} type="button" onClick={() => setReplyMessage(reply)} className="rounded-xl border border-white/10 bg-[#101010] px-3 py-2 text-left text-xs text-zinc-300 hover:border-orange-500/25 hover:text-orange-200">
                      {reply}
                    </button>
                  ))}
                </div>
                <textarea
                  value={replyMessage}
                  onChange={(event) => setReplyMessage(event.target.value)}
                  placeholder="Type WhatsApp reply..."
                  className="mt-3 min-h-28 w-full rounded-2xl border border-white/10 bg-[#050505] px-4 py-3 text-sm leading-6 text-white placeholder:text-zinc-600 focus:border-orange-500/40 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-zinc-500">Sender: {getWhatsAppSenderForBranch(selectedConversation?.branchId === 'unknown' ? 'cyberjaya' : selectedConversation?.branchId)}</div>
                  <div className="flex gap-2">
                    <a href={buildWaMeLink({ branch: selectedConversation?.branchId, recipientPhone: selectedPhone })} target="_blank" rel="noreferrer" className="rounded-xl border border-orange-500/20 px-4 py-2 text-sm text-orange-200">wa.me fallback</a>
                    <button disabled={replySending || !replyMessage.trim()} onClick={sendReply} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send reply</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
