'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ExternalLink, FileCheck2, X } from 'lucide-react';
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
  type DocumentData,
  type Query,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { isAdmin, isManager } from '@/lib/rbac/can';
import type { UserData } from '@/types';

interface ApprovalNotification {
  notificationId: string;
  title: string;
  message: string;
  type: string;
  branchId?: string;
  actionUrl?: string;
  relatedModule?: string;
  targetRoles?: string[];
  targetUserIds?: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: {
    actionUrl?: string;
    relatedModule?: string;
    jobId?: string;
    jobNumber?: string;
    quotationId?: string;
    customerId?: string;
    nextAction?: string;
    warrantyId?: string;
    checklistId?: string;
    invoiceId?: string;
    paymentId?: string;
    submissionId?: string;
  };
  readBy?: string[];
  createdAt?: Timestamp;
}

function formatTime(value?: Timestamp): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
}

function notificationAction(notification: ApprovalNotification): { href: string; label: string } | null {
  const metadata = notification.metadata || {};
  const actionUrl = notification.actionUrl || metadata.actionUrl;
  if (actionUrl) return { href: actionUrl, label: actionLabel(notification) };
  if (notification.relatedEntityType === 'quotation' && notification.relatedEntityId) {
    return { href: `/dashboard/pos/quotations/${notification.relatedEntityId}`, label: 'Open Quotation' };
  }
  if (metadata.quotationId) return { href: `/dashboard/pos/quotations/${metadata.quotationId}`, label: 'Open Quotation' };
  if (notification.relatedEntityType === 'warranty' && notification.relatedEntityId) return { href: `/dashboard/warranties/${notification.relatedEntityId}`, label: 'Open Warranty' };
  if (metadata.warrantyId) return { href: `/dashboard/warranties/${metadata.warrantyId}`, label: 'Open Warranty' };
  if (notification.relatedEntityType === 'paymentSubmission') {
    return { href: '/dashboard/pos/payment-submissions', label: 'Open Payment' };
  }
  if (notification.relatedEntityType === 'invoice' && notification.relatedEntityId) return { href: `/dashboard/pos/invoices/${notification.relatedEntityId}`, label: 'Open Invoice' };
  if (metadata.invoiceId) return { href: `/dashboard/pos/invoices/${metadata.invoiceId}`, label: 'Open Invoice' };
  if (notification.relatedEntityType === 'warrantyClaim' && notification.relatedEntityId) return { href: '/dashboard/warranty-claims', label: 'Open Warranty Claim' };
  if (metadata.customerId) return { href: `/dashboard/customers/${metadata.customerId}`, label: 'Open Customer' };
  if (notification.relatedEntityType === 'customer' && notification.relatedEntityId) return { href: `/dashboard/customers/${notification.relatedEntityId}`, label: 'Open Customer' };
  if (metadata.jobId) return { href: `/dashboard/jobs?jobId=${encodeURIComponent(metadata.jobId)}`, label: 'Open Job' };
  if (notification.relatedEntityType === 'job' && notification.relatedEntityId) return { href: `/dashboard/jobs?jobId=${encodeURIComponent(notification.relatedEntityId)}`, label: 'Open Job' };
  if (notification.relatedEntityType === 'deviceChecklist' && metadata.jobId) return { href: `/dashboard/jobs?jobId=${encodeURIComponent(metadata.jobId)}`, label: 'Open Job' };
  return null;
}

function actionLabel(notification: ApprovalNotification): string {
  const type = `${notification.type} ${notification.relatedEntityType || ''} ${notification.relatedModule || ''}`.toLowerCase();
  if (type.includes('quotation')) return 'Open Quotation';
  if (type.includes('payment')) return 'Open Payment';
  if (type.includes('warrantyclaim')) return 'Open Warranty Claim';
  if (type.includes('warranty')) return 'Open Warranty';
  if (type.includes('customer')) return 'Open Customer';
  if (type.includes('job') || type.includes('checklist')) return 'Open Job';
  if (type.includes('invoice')) return 'Open Invoice';
  return 'Open Related Record';
}

function moduleLabel(notification: ApprovalNotification): string {
  return notification.relatedModule || notification.relatedEntityType || notification.type || '-';
}

function isRelevant(notification: ApprovalNotification, user: UserData): boolean {
  if (isAdmin(user.role)) return true;
  if (notification.targetUserIds?.includes(user.uid)) return true;
  if (isManager(user.role)) {
    return Boolean(notification.targetRoles?.includes('manager') && (!notification.branchId || notification.branchId === user.branchId));
  }
  return false;
}

function sortNotifications(rows: ApprovalNotification[]): ApprovalNotification[] {
  return rows
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))
    .slice(0, 12);
}

function mapNotificationRows(snapshotDocs: Array<{ id: string; data: () => DocumentData }>, user: UserData): ApprovalNotification[] {
  const rows = snapshotDocs
    .map((row) => ({ ...(row.data() as Omit<ApprovalNotification, 'notificationId'>), notificationId: row.id }))
    .filter((row) => isRelevant(row, user));
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.notificationId, row])).values());
  return sortNotifications(uniqueRows);
}

function notificationQuery(user: UserData): Query<DocumentData> {
  const notificationsRef = collection(db, 'notifications');
  if (isAdmin(user.role)) return notificationsRef;
  if (isManager(user.role) && user.branchId) return query(notificationsRef, where('branchId', '==', user.branchId));
  return query(notificationsRef, where('targetUserIds', 'array-contains', user.uid));
}

export function ApprovalNotificationBell({ user }: { user: UserData | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<ApprovalNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<ApprovalNotification | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.uid) {
      setNotifications([]);
      return () => {
        cancelled = true;
      };
    }

    const activeQuery = notificationQuery(user);
    const unsubscribe = onSnapshot(
      activeQuery,
      (snapshot) => {
        if (!cancelled) setNotifications(mapNotificationRows(snapshot.docs, user));
      },
      (error) => {
        console.warn('[NOTIFICATIONS_REALTIME_FALLBACK]', error);
        void getDocs(activeQuery)
          .then((snapshot) => {
            if (!cancelled) setNotifications(mapNotificationRows(snapshot.docs, user));
          })
          .catch(() => {
            if (!cancelled) setNotifications([]);
          });
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.branchId, user?.role, user?.uid]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readBy?.includes(user?.uid || '')).length,
    [notifications, user?.uid],
  );

  const visibleNotifications = useMemo(
    () => filter === 'unread'
      ? notifications.filter((notification) => !notification.readBy?.includes(user?.uid || ''))
      : notifications,
    [filter, notifications, user?.uid],
  );

  async function markRead(notification: ApprovalNotification) {
    if (!user?.uid || notification.readBy?.includes(user.uid)) return;
    setNotifications((current) => current.map((row) => (
      row.notificationId === notification.notificationId
        ? { ...row, readBy: [...(row.readBy || []), user.uid] }
        : row
    )));
    await updateDoc(doc(db, 'notifications', notification.notificationId), {
      readBy: arrayUnion(user.uid),
    }).catch(() => undefined);
  }

  async function openNotificationDetail(notification: ApprovalNotification) {
    setSelectedNotification(
      user?.uid && !notification.readBy?.includes(user.uid)
        ? { ...notification, readBy: [...(notification.readBy || []), user.uid] }
        : notification,
    );
    await markRead(notification);
  }

  function openNotificationAction(notification: ApprovalNotification) {
    const action = notificationAction(notification);
    if (!action) return;
    setSelectedNotification(null);
    setOpen(false);
    router.push(action.href);
  }

  async function markAllRead() {
    if (!user?.uid || unreadCount === 0) return;
    const unreadNotifications = notifications.filter((notification) => !notification.readBy?.includes(user.uid));
    setNotifications((current) => current.map((row) => (
      row.readBy?.includes(user.uid)
        ? row
        : { ...row, readBy: [...(row.readBy || []), user.uid] }
    )));
    await Promise.all(unreadNotifications.map((notification) => (
      updateDoc(doc(db, 'notifications', notification.notificationId), {
        readBy: arrayUnion(user.uid),
      }).catch(() => undefined)
    )));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-2xl border border-white/10 bg-[#151515] p-2.5 text-zinc-200 shadow-lg shadow-black/20 hover:border-orange-500/40 hover:text-orange-200"
        aria-label="Approval notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 flex h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-full border-2 border-[#050505] bg-red-500 px-1.5 text-center text-[11px] font-extrabold leading-none text-white shadow-[0_0_14px_rgba(239,68,68,0.7)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 flex max-h-[420px] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-orange-500/20 bg-[#050505] shadow-2xl shadow-black/80 ring-1 ring-orange-500/10">
          <div className="shrink-0 border-b border-white/10 bg-[#080808] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Approval Notifications</div>
                <div className="text-xs text-zinc-400">{unreadCount} unread</div>
              </div>
              <button
                type="button"
                disabled={unreadCount === 0}
                onClick={markAllRead}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-orange-500/30 hover:text-orange-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            </div>
            <div className="mt-3 flex rounded-lg border border-white/10 bg-[#050505] p-1">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    filter === value
                      ? 'bg-orange-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 [scrollbar-color:#f97316_#111111] [scrollbar-width:thin]">
            {visibleNotifications.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#151515] p-4 text-sm text-zinc-400">
                {filter === 'unread' ? 'No unread approval notifications.' : 'No approval notifications.'}
              </div>
            ) : null}
            {visibleNotifications.map((notification) => {
              const unread = !notification.readBy?.includes(user?.uid || '');
              return (
                <button
                  type="button"
                  key={notification.notificationId}
                  onClick={() => void openNotificationDetail(notification)}
                  className={`grid w-full grid-cols-[2.25rem_1fr_auto] items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    unread
                      ? 'border-orange-500/35 bg-[#1b1208]'
                      : 'border-white/10 bg-[#121212] hover:border-white/20'
                  }`}
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    unread
                      ? 'border-orange-400/40 bg-orange-500/15 text-orange-200'
                      : 'border-white/10 bg-[#1a1a1a] text-zinc-400'
                  }`}
                  >
                    <FileCheck2 size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="line-clamp-1 text-sm font-semibold text-white">{notification.title}</div>
                      {notification.metadata?.jobNumber ? (
                        <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                          {notification.metadata.jobNumber}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-300">{notification.message}</div>
                    {notification.metadata?.nextAction ? (
                      <div className="mt-1 line-clamp-1 text-xs font-medium text-orange-200">Next: {notification.metadata.nextAction}</div>
                    ) : null}
                    <div className="mt-1 text-[11px] text-zinc-500">{formatTime(notification.createdAt)}</div>
                  </div>
                  {unread ? <span className="mt-2 h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.8)]" /> : <span />}
                </button>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-white/10 bg-[#080808] px-4 py-2.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-orange-500/30 hover:text-orange-200"
            >
              View all notifications
            </button>
          </div>
        </div>
      ) : null}
      {selectedNotification ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101010] shadow-2xl shadow-black/80">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-orange-200">{moduleLabel(selectedNotification)}</div>
                <h2 className="mt-1 text-lg font-semibold text-white">{selectedNotification.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white"
                aria-label="Close notification detail"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm leading-6 text-zinc-200">{selectedNotification.message}</p>
              <div className="grid gap-3 rounded-xl border border-white/10 bg-[#050505] p-3 text-xs text-zinc-400 sm:grid-cols-2">
                <div>
                  <div className="text-zinc-500">Created</div>
                  <div className="mt-1 text-zinc-200">{formatTime(selectedNotification.createdAt)}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Status</div>
                  <div className="mt-1 text-zinc-200">{selectedNotification.readBy?.includes(user?.uid || '') ? 'Read' : 'Unread'}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Type</div>
                  <div className="mt-1 text-zinc-200">{selectedNotification.type || '-'}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Related ID</div>
                  <div className="mt-1 break-all text-zinc-200">{selectedNotification.relatedEntityId || selectedNotification.metadata?.jobId || selectedNotification.metadata?.quotationId || selectedNotification.metadata?.invoiceId || selectedNotification.metadata?.customerId || '-'}</div>
                </div>
              </div>
              {selectedNotification.metadata?.nextAction ? (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-3 text-sm text-orange-100">
                  Next: {selectedNotification.metadata.nextAction}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:text-white"
              >
                Close
              </button>
              {notificationAction(selectedNotification) ? (
                <button
                  type="button"
                  onClick={() => openNotificationAction(selectedNotification)}
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
                >
                  {notificationAction(selectedNotification)?.label}
                  <ExternalLink size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-500"
                >
                  No linked record available.
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
