'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  addAttendanceCorrectionNote,
  getAttendanceForReview,
  getMyAttendanceForReview,
  overrideAttendanceStatus,
} from '@/features/attendance/services/attendanceReviewService';
import type { AttendanceRecord, AttendanceStatus } from '@/features/attendance/types';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdmin } from '@/lib/rbac/can';
import { getAttendanceMonthKey } from '@/lib/utils/attendanceDate';

const statusOptions: Array<AttendanceStatus | 'all'> = ['all', 'present', 'late', 'half_day', 'absent', 'cancelled'];

interface UserDisplayProfile {
  displayName?: string;
  staffId?: string;
}

function getCurrentMonth(): string {
  return getAttendanceMonthKey();
}

function formatTime(value?: { toDate?: () => Date }): string {
  if (!value?.toDate) return '-';
  return value.toDate().toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusClass(status?: string): string {
  if (status === 'present') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'late') return 'border-amber-500/40 text-amber-300';
  if (status === 'half_day') return 'border-orange-500/40 text-orange-300';
  if (status === 'absent') return 'border-red-500/40 text-red-300';
  return 'border-white/15 text-slate-300';
}

export default function AttendanceReviewPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [month, setMonth] = useState(getCurrentMonth);
  const [branchFilter, setBranchFilter] = useState('');
  const [technicianFilter, setTechnicianFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | 'all'>('all');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');
  const [overrideStatus, setOverrideStatus] = useState<AttendanceStatus>('present');
  const [overrideReason, setOverrideReason] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');
  const [userProfiles, setUserProfiles] = useState<Record<string, UserDisplayProfile>>({});

  const canManage = can(profile?.role, 'attendance.view.all');
  const canOverride = isAdmin(profile?.role);

  const branchOptions = useMemo(() => {
    return Array.from(new Set(records.map((record) => record.branchId).filter(Boolean))).sort();
  }, [records]);

  const technicianOptions = useMemo(() => {
    return Array.from(new Set(records.map((record) => record.userId).filter(Boolean))).sort();
  }, [records]);

  function getUserDisplayName(userId?: string): string {
    if (!userId) return 'Unknown User';
    return userProfiles[userId]?.displayName || 'Unknown User';
  }

  function getUserStaffId(userId?: string): string {
    if (!userId) return '';
    return userProfiles[userId]?.staffId || '';
  }

  const loadAttendance = useCallback(async () => {
    if (!profile?.uid || !profile.role) return;

    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadAttendanceReview');
      const nextRecords = canManage
        ? await getAttendanceForReview({
            month,
            role: profile.role,
            branchId: branchFilter || undefined,
            technicianId: technicianFilter || undefined,
            status: statusFilter,
          })
        : await getMyAttendanceForReview(profile.uid, month);
      setRecords(nextRecords);
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadAttendanceReview');

      const userIds = Array.from(
        new Set(nextRecords.map((record) => record.userId).filter((userId): userId is string => Boolean(userId))),
      );
      const profiles = await Promise.all(
        userIds.map(async (userId) => {
          const userSnapshot = await getDoc(doc(db, 'users', userId));
          const userData = userSnapshot.exists() ? userSnapshot.data() : {};
          return [
            userId,
            {
              displayName: typeof userData.displayName === 'string' ? userData.displayName : undefined,
              staffId: typeof userData.staffId === 'string' ? userData.staffId : undefined,
            },
          ] as const;
        }),
      );
      setUserProfiles(Object.fromEntries(profiles));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadAttendanceReview');
      setMessage(error instanceof Error ? error.message : 'Unable to load attendance records');
    } finally {
      setPageLoading(false);
    }
  }, [branchFilter, canManage, month, profile?.role, profile?.uid, statusFilter, technicianFilter]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  function openRecord(record: AttendanceRecord) {
    setSelectedRecord(record);
    setCorrectionNote(record.correctionNote || '');
    setOverrideStatus(record.status || 'present');
    setOverrideReason('');
    setMessage('');
  }

  async function handleSaveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !selectedRecord) return;

    setActionId('note');
    setMessage('');

    try {
      await addAttendanceCorrectionNote({
        attendanceId: selectedRecord.attendanceId,
        note: correctionNote,
        updatedBy: firebaseUser.uid,
        updatedByRole: profile.role,
      });
      setMessage('Correction note saved');
      await loadAttendance();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save correction note');
    } finally {
      setActionId('');
    }
  }

  async function handleOverrideStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !selectedRecord) return;

    setActionId('override');
    setMessage('');

    try {
      await overrideAttendanceStatus({
        attendanceId: selectedRecord.attendanceId,
        nextStatus: overrideStatus,
        reason: overrideReason,
        overriddenBy: firebaseUser.uid,
        overriddenByRole: profile.role,
      });
      setMessage('Attendance status overridden');
      setOverrideReason('');
      await loadAttendance();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to override attendance status');
    } finally {
      setActionId('');
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading attendance review</div>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Attendance Review</h1>
        <p className="mt-1 text-sm text-slate-400">Review attendance records before payroll generation.</p>
      </div>

      <div className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="grid gap-4 md:grid-cols-5">
          <label className="block text-sm text-slate-300">
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Branch
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              disabled={!canManage}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
            >
              <option value="">All</option>
              {branchOptions.map((branchId) => (
                <option key={branchId} value={branchId}>
                  {branchId}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Technician
            <select
              value={technicianFilter}
              onChange={(event) => setTechnicianFilter(event.target.value)}
              disabled={!canManage}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
            >
              <option value="">All</option>
              {technicianOptions.map((userId) => (
                <option key={userId} value={userId}>
                  {getUserDisplayName(userId)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as AttendanceStatus | 'all')}
              disabled={!canManage}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={loadAttendance}
              disabled={pageLoading}
              className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pageLoading ? 'Loading' : 'Apply Filters'}
            </button>
          </div>
        </div>
      </div>

      {message ? <div className="mb-4 text-sm text-slate-300">{message}</div> : null}

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Attendance Records</h2>
          <div className="mt-1 text-sm text-slate-400">
            {pageLoading ? 'Loading attendance records' : `${records.length} records`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Technician</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Clock In</th>
                <th className="px-3 py-2">Clock Out</th>
                <th className="px-3 py-2">Hours</th>
                <th className="px-3 py-2">Late</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    No attendance records found
                  </td>
                </tr>
              ) : null}
              {records.map((record) => (
                <tr key={record.attendanceId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-slate-300">{record.date}</td>
                  <td className="px-3 py-3 text-slate-300">
                    {getUserDisplayName(record.userId)}
                    {getUserStaffId(record.userId) ? (
                      <div className="mt-1 text-xs text-slate-500">{getUserStaffId(record.userId)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{record.branchId || '-'}</td>
                  <td className="px-3 py-3 text-slate-300">{formatTime(record.clockIn?.timestamp)}</td>
                  <td className="px-3 py-3 text-slate-300">{formatTime(record.clockOut?.timestamp)}</td>
                  <td className="px-3 py-3 text-slate-300">{record.totalHours ?? '-'}</td>
                  <td className="px-3 py-3 text-slate-300">{record.lateMinutes ?? '-'}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${getStatusClass(record.status)}`}>
                      {record.status || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => openRecord(record)}
                      className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A]"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRecord ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {canManage ? (
            <form onSubmit={handleSaveNote} className="rounded-lg border border-white/10 bg-[#151515] p-4">
              <h2 className="text-lg font-semibold text-white">Correction Note</h2>
              <p className="mt-1 text-sm text-slate-400">
                {getUserDisplayName(selectedRecord.userId)} · {selectedRecord.date}
              </p>
              <textarea
                value={correctionNote}
                onChange={(event) => setCorrectionNote(event.target.value)}
                rows={4}
                className="mt-4 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
              <button
                type="submit"
                disabled={Boolean(actionId)}
                className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === 'note' ? 'Saving Note' : 'Save Note'}
              </button>
            </form>
          ) : null}

          {canOverride ? (
            <form onSubmit={handleOverrideStatus} className="rounded-lg border border-white/10 bg-[#151515] p-4">
              <h2 className="text-lg font-semibold text-white">Status Override</h2>
              <p className="mt-1 text-sm text-slate-400">Admin-only correction with audit log.</p>
              <label className="mt-4 block text-sm text-slate-300">
                Status
                <select
                  value={overrideStatus}
                  onChange={(event) => setOverrideStatus(event.target.value as AttendanceStatus)}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                >
                  {statusOptions
                    .filter((status): status is AttendanceStatus => status !== 'all')
                    .map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                </select>
              </label>
              <label className="mt-4 block text-sm text-slate-300">
                Reason
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={3}
                  required
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                />
              </label>
              <button
                type="submit"
                disabled={Boolean(actionId)}
                className="mt-4 rounded-md border border-amber-700/60 px-4 py-2 text-sm text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === 'override' ? 'Saving Override' : 'Override Status'}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
