'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import {
  createNotice,
  getNoticeReadsForUser,
  getSentNotices,
  getTechnicianNotices,
  markNoticeRead,
  softDeleteNotice,
} from '@/features/notices/services/noticeService';
import type { Notice, NoticePriority, NoticeTargetType, NoticeType } from '@/features/notices/types';
import { can, isTechnician as isTechnicianRole } from '@/lib/rbac/can';

interface TechnicianOption {
  uid: string;
  displayName: string;
  staffId?: string;
  branchId?: string;
}

const noticeTypes: NoticeType[] = ['warning', 'reminder', 'meeting', 'announcement'];
const priorities: NoticePriority[] = ['low', 'normal', 'high'];

function formatTimestamp(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return date.toLocaleString('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getTypeClass(type: NoticeType): string {
  if (type === 'warning') return 'border-red-500/40 text-red-300';
  if (type === 'meeting') return 'border-amber-500/35 text-amber-300';
  if (type === 'reminder') return 'border-amber-500/40 text-amber-300';
  return 'border-orange-500/30 text-orange-200';
}

function getPriorityClass(priority: NoticePriority): string {
  if (priority === 'high') return 'border-red-500/40 text-red-300';
  if (priority === 'low') return 'border-white/15 text-slate-400';
  return 'border-amber-500/40 text-amber-300';
}

export default function NoticesPage() {
  const { profile, loading } = useUser();
  const [title, setTitle] = useState('');
  const [messageText, setMessageText] = useState('');
  const [type, setType] = useState<NoticeType>('announcement');
  const [priority, setPriority] = useState<NoticePriority>('normal');
  const [targetType, setTargetType] = useState<NoticeTargetType>('broadcast');
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [readNoticeIds, setReadNoticeIds] = useState<Set<string>>(new Set());
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteModalError, setDeleteModalError] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');

  const canManage = can(profile?.role, 'notices.manage');
  const isTechnician = isTechnicianRole(profile?.role);
  const technicianNameById = useMemo(() => {
    return new Map(technicians.map((technician) => [technician.uid, technician.displayName]));
  }, [technicians]);
  const unreadCount = useMemo(() => {
    if (!isTechnician) return 0;
    return notices.filter((notice) => !readNoticeIds.has(notice.noticeId)).length;
  }, [isTechnician, notices, readNoticeIds]);

  const loadTechnicians = useCallback(async () => {
    if (!canManage) return;

    const techniciansQuery = query(
      collection(db, 'users'),
      where('role', '==', 'technician'),
      where('isActive', '==', true),
    );
    const snapshot = await getDocs(techniciansQuery);

    setTechnicians(
      snapshot.docs.map((technicianDoc) => {
        const data = technicianDoc.data();
        const displayName =
          typeof data.displayName === 'string' && data.displayName
            ? data.displayName
            : typeof data.name === 'string' && data.name
              ? data.name
              : 'Unknown User';

        return {
          uid: technicianDoc.id,
          displayName,
          staffId: typeof data.staffId === 'string' ? data.staffId : undefined,
          branchId: typeof data.branchId === 'string' ? data.branchId : undefined,
        };
      }),
    );
  }, [canManage]);

  const loadNotices = useCallback(async () => {
    if (!profile?.uid || !profile.role) return;

    setPageLoading(true);
    setNoticeMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadNotices');
      if (canManage) {
        await loadTechnicians();
        setNotices(await getSentNotices());
        setReadNoticeIds(new Set());
      } else if (isTechnician) {
        const [nextNotices, reads] = await Promise.all([
          getTechnicianNotices(profile.uid),
          getNoticeReadsForUser(profile.uid),
        ]);
        setNotices(nextNotices);
        setReadNoticeIds(new Set(reads.map((read) => read.noticeId)));
      }
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadNotices');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadNotices');
      setNoticeMessage(error instanceof Error ? error.message : 'Unable to load notices');
    } finally {
      setPageLoading(false);
    }
  }, [canManage, isTechnician, loadTechnicians, profile?.role, profile?.uid]);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  async function handleCreateNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile?.uid || !profile?.role || !canManage) {
      setNoticeMessage('Admin or manager access required');
      return;
    }

    setActionId('create');
    setNoticeMessage('');

    try {
      await createNotice({
        title,
        message: messageText,
        type,
        priority,
        targetType,
        targetUserIds,
        createdBy: profile.uid,
        createdByRole: profile.role,
        createdByDisplayName: profile.displayName || 'Unknown User',
      });
      setTitle('');
      setMessageText('');
      setType('announcement');
      setPriority('normal');
      setTargetType('broadcast');
      setTargetUserIds([]);
      setNoticeMessage('Notice sent');
      await loadNotices();
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : 'Unable to send notice');
    } finally {
      setActionId('');
    }
  }

  async function handleOpenNotice(notice: Notice) {
    setSelectedNotice(notice);

    if (!profile?.uid || !isTechnician || readNoticeIds.has(notice.noticeId)) return;

    setActionId(`read-${notice.noticeId}`);
    try {
      await markNoticeRead(notice.noticeId, profile.uid);
      setReadNoticeIds((current) => new Set([...current, notice.noticeId]));
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : 'Unable to mark notice as read');
    } finally {
      setActionId('');
    }
  }

  function openDeleteNotice(notice: Notice) {
    if (!profile || !canManage) {
      setNoticeMessage('Admin or manager access required');
      return;
    }
    setDeleteTarget(notice);
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteModalError('');
    setNoticeMessage('');
  }

  function closeDeleteNotice() {
    setDeleteTarget(null);
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteModalError('');
  }

  async function handleDeleteNotice() {
    if (!profile || !canManage) {
      setDeleteModalError('Admin or manager access required');
      return;
    }
    if (!deleteTarget) {
      setDeleteModalError('No notice selected for deletion.');
      return;
    }
    if (deleteConfirmation !== 'DELETE') {
      setDeleteModalError('Type DELETE to confirm notice deletion.');
      return;
    }

    setActionId(`delete-${deleteTarget.noticeId}`);
    setDeleteModalError('');
    setNoticeMessage('');
    try {
      await softDeleteNotice(deleteTarget.noticeId, deleteReason, profile);
      setNoticeMessage('Notice deleted from active lists');
      if (selectedNotice?.noticeId === deleteTarget.noticeId) setSelectedNotice(null);
      closeDeleteNotice();
      await loadNotices();
    } catch (error) {
      console.error('[NOTICE DELETE ERROR]', error);
      setDeleteModalError('Failed to delete notice. Please check your permission or try again.');
    } finally {
      setActionId('');
    }
  }

  function getTargetLabel(notice: Notice): string {
    if (notice.targetType === 'broadcast') return 'All technicians';
    const names = notice.targetUserIds.map((userId) => technicianNameById.get(userId) || 'Unknown User');
    return names.length ? names.join(', ') : 'Unknown User';
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading notices</div>;
  }

  if (!canManage && !isTechnician) {
    return <div className="text-sm text-red-300">Notice access requires an active dashboard profile</div>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">{canManage ? 'Notice Management' : 'Notifications'}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {canManage
            ? 'Send warning letters, reminders, meeting notices, and announcements.'
            : `${unreadCount} unread notice${unreadCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {noticeMessage ? <div className="mb-4 text-sm text-slate-300">{noticeMessage}</div> : null}

      {canManage ? (
        <form onSubmit={handleCreateNotice} className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Create Notice</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as NoticeType)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {noticeTypes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Priority
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as NoticePriority)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {priorities.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Target
              <select
                value={targetType}
                onChange={(event) => {
                  const nextTargetType = event.target.value as NoticeTargetType;
                  setTargetType(nextTargetType);
                  if (nextTargetType === 'broadcast') setTargetUserIds([]);
                }}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                <option value="broadcast">Broadcast</option>
                <option value="individual">Individual</option>
              </select>
            </label>
          </div>

          {targetType === 'individual' ? (
            <label className="mt-4 block text-sm text-slate-300">
              Technicians
              <select
                multiple
                value={targetUserIds}
                onChange={(event) =>
                  setTargetUserIds(Array.from(event.target.selectedOptions).map((option) => option.value))
                }
                required
                className="mt-2 h-36 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {technicians.map((technician) => (
                  <option key={technician.uid} value={technician.uid}>
                    {technician.displayName}
                    {technician.branchId ? ` (${technician.branchId})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="mt-4 block text-sm text-slate-300">
            Message
            <textarea
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              required
              rows={5}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>

          <button
            type="submit"
            disabled={actionId === 'create'}
            className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionId === 'create' ? 'Sending' : 'Send Notice'}
          </button>
        </form>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{canManage ? 'Sent Notices' : 'My Notices'}</h2>
          <div className="mt-1 text-sm text-slate-400">{pageLoading ? 'Loading notices' : `${notices.length} notices`}</div>
        </div>

        <div className="space-y-3">
          {notices.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No notices found</div> : null}
          {notices.map((notice) => {
            const isRead = readNoticeIds.has(notice.noticeId);
            return (
              <div
                key={notice.noticeId}
                className="block w-full rounded-md border border-white/10 bg-[#050505] p-4 text-left hover:border-white/10"
              >
                <button type="button" onClick={() => handleOpenNotice(notice)} className="block w-full text-left">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{notice.title}</h3>
                        {!canManage && !isRead ? (
                          <span className="rounded-full border border-orange-500/30 px-2 py-1 text-xs text-orange-200">Unread</span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm text-slate-400">
                        {canManage ? getTargetLabel(notice) : `From ${notice.createdByDisplayName || 'Unknown User'}`}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-2 py-1 text-xs ${getTypeClass(notice.type)}`}>{notice.type}</span>
                      <span className={`rounded-full border px-2 py-1 text-xs ${getPriorityClass(notice.priority)}`}>
                        {notice.priority}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 line-clamp-2 text-sm text-slate-300">{notice.message}</div>
                  <div className="mt-3 text-xs text-slate-500">{formatTimestamp(notice.createdAt)}</div>
                </button>
                {canManage ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => openDeleteNotice(notice)}
                      className="rounded-md border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10"
                    >
                      Delete Notice
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {selectedNotice ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{selectedNotice.title}</h2>
              <div className="mt-1 text-sm text-slate-400">
                {canManage ? getTargetLabel(selectedNotice) : `From ${selectedNotice.createdByDisplayName || 'Unknown User'}`} ·{' '}
                {formatTimestamp(selectedNotice.createdAt)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <button
                  type="button"
                  onClick={() => openDeleteNotice(selectedNotice)}
                  className="rounded-md border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10"
                >
                  Delete Notice
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
              >
                Close
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`rounded-full border px-2 py-1 text-xs ${getTypeClass(selectedNotice.type)}`}>
              {selectedNotice.type}
            </span>
            <span className={`rounded-full border px-2 py-1 text-xs ${getPriorityClass(selectedNotice.priority)}`}>
              {selectedNotice.priority}
            </span>
            {!canManage ? (
              <span className="rounded-full border border-white/15 px-2 py-1 text-xs text-slate-300">
                {readNoticeIds.has(selectedNotice.noticeId) ? 'Read' : 'Unread'}
              </span>
            ) : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-200">{selectedNotice.message}</p>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151515] p-5 shadow-2xl">
            <h2 className="text-xl font-semibold text-white">Delete Notice?</h2>
            <p className="mt-3 text-sm text-slate-300">
              This notice will be removed from active notice lists. Existing audit records will remain.
            </p>
            {deleteTarget.status === 'active' ? (
              <div className="mt-3 rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-100">
                This notice is currently active. Deleting it will immediately remove it from staff dashboards.
              </div>
            ) : null}
            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300">
              <div className="font-medium text-white">{deleteTarget.title}</div>
              <div className="mt-1 text-xs text-slate-500">{deleteTarget.type} · {deleteTarget.priority}</div>
            </div>
            {deleteModalError ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {deleteModalError}
              </div>
            ) : null}
            <label className="mt-4 block text-sm text-slate-300">
              Reason for deletion
              <textarea
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Reason for deletion"
                className="mt-2 min-h-20 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="mt-4 block text-sm text-slate-300">
              Type DELETE to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteNotice}
                disabled={actionId === `delete-${deleteTarget.noticeId}`}
                className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteNotice}
                disabled={actionId === `delete-${deleteTarget.noticeId}` || deleteConfirmation !== 'DELETE'}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
              >
                {actionId === `delete-${deleteTarget.noticeId}` ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
