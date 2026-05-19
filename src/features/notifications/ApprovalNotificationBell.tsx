'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, FileCheck2 } from 'lucide-react';
import { arrayUnion, collection, getDocs, query, updateDoc, where, doc, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { isAdmin, isManager } from '@/lib/rbac/can';
import type { UserData } from '@/types';

interface ApprovalNotification {
  notificationId: string;
  title: string;
  message: string;
  type: string;
  branchId?: string;
  targetRoles?: string[];
  targetUserIds?: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: {
    jobId?: string;
    jobNumber?: string;
    nextAction?: string;
    warrantyId?: string;
    checklistId?: string;
    invoiceId?: string;
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

function notificationHref(notification: ApprovalNotification): string {
  const metadata = notification.metadata || {};
  if (metadata.jobId) return '/dashboard/jobs';
  if (notification.relatedEntityType === 'quotation' && notification.relatedEntityId) {
    return `/dashboard/pos/quotations/${notification.relatedEntityId}`;
  }
  if (notification.relatedEntityType === 'warranty' && notification.relatedEntityId) {
    return `/dashboard/documents/warranties/${notification.relatedEntityId}/print`;
  }
  if (notification.relatedEntityType === 'paymentSubmission') return '/dashboard/pos/payment-submissions';
  if (notification.relatedEntityType === 'deviceChecklist') return '/dashboard/jobs';
  if (notification.relatedEntityType === 'job') return '/dashboard/jobs';
  return '/dashboard';
}

function isRelevant(notification: ApprovalNotification, user: UserData): boolean {
  if (isAdmin(user.role)) return true;
  if (notification.targetUserIds?.includes(user.uid)) return true;
  if (isManager(user.role)) {
    return Boolean(notification.targetRoles?.includes('manager') && (!notification.branchId || notification.branchId === user.branchId));
  }
  return false;
}

export function ApprovalNotificationBell({ user }: { user: UserData | null }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<ApprovalNotification[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadNotifications() {
      if (!user?.uid) {
        setNotifications([]);
        return;
      }
      const notificationsRef = collection(db, 'notifications');
      const snapshot = isAdmin(user.role)
        ? await getDocs(notificationsRef)
        : isManager(user.role) && user.branchId
          ? await getDocs(query(notificationsRef, where('branchId', '==', user.branchId)))
          : await getDocs(query(notificationsRef, where('targetUserIds', 'array-contains', user.uid)));
      if (cancelled) return;
      const rows = snapshot.docs
        .map((row) => ({ ...(row.data() as Omit<ApprovalNotification, 'notificationId'>), notificationId: row.id }))
        .filter((row) => isRelevant(row, user))
        .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))
        .slice(0, 12);
      setNotifications(rows);
    }
    void loadNotifications().catch(() => {
      if (!cancelled) setNotifications([]);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

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
                <Link
                  key={notification.notificationId}
                  href={notificationHref(notification)}
                  onClick={() => {
                    setOpen(false);
                    void markRead(notification);
                  }}
                  className={`grid grid-cols-[2.25rem_1fr_auto] items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
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
                </Link>
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
    </div>
  );
}
