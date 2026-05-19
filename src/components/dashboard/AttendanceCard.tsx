'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { clockIn, clockOut } from '@/lib/firebase/attendance';
import { db } from '@/lib/firebase/init';
import { getAttendanceDateKey } from '@/lib/utils/attendanceDate';
import type { UserData } from '@/types';

interface AttendanceCardProps {
  userData: UserData | null;
}

interface AttendanceCardState {
  clockInTime?: Date;
  clockOutTime?: Date;
  status?: string;
  totalHours?: number;
  branchId?: string;
  crossBranchAttendance?: boolean;
}

interface AttendanceDocumentData {
  branchId?: string;
  status?: string;
  totalHours?: number;
  crossBranchAttendance?: boolean;
  clockIn?: {
    timestamp?: { toDate?: () => Date };
  };
  clockOut?: {
    timestamp?: { toDate?: () => Date };
  };
}

function formatTime(value?: Date): string {
  if (!value) return '-';

  return new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function AttendanceCard({ userData }: AttendanceCardProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [clockedInToday, setClockedInToday] = useState(false);
  const [clockedOutToday, setClockedOutToday] = useState(false);
  const [halfDayWarning, setHalfDayWarning] = useState(false);
  const [attendanceState, setAttendanceState] = useState<AttendanceCardState>({});
  const todayKey = useMemo(() => getAttendanceDateKey(), []);
  const profileBlockMessage = !userData?.uid
    ? 'User profile is still loading'
    : !userData.role
      ? 'User profile role is missing'
    : !userData.branchId
      ? 'User profile branch is missing'
      : '';

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('en-MY', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date()),
    [],
  );

  const loadTodayAttendance = useCallback(async () => {
    if (!userData?.uid || !userData.role) {
      setClockedInToday(false);
      setClockedOutToday(false);
      setAttendanceState({});
      return;
    }

    const todayAttendanceDocId = `${userData.uid}_${todayKey}`;
    console.log('Loading today attendance:', todayAttendanceDocId);
    const snapshot = await getDoc(doc(db, 'attendance', todayAttendanceDocId));
    const todayAttendanceData = snapshot.exists() ? (snapshot.data() as AttendanceDocumentData) : null;
    const hasClockIn = Boolean(todayAttendanceData?.clockIn?.timestamp);
    const hasClockOut = Boolean(todayAttendanceData?.clockOut?.timestamp);

    console.log('todayAttendanceDocId', todayAttendanceDocId);
    console.log('todayAttendanceData', todayAttendanceData);
    console.log('clockIn exists?', hasClockIn);
    console.log('clockOut exists?', hasClockOut);

    setClockedInToday(hasClockIn);
    setClockedOutToday(hasClockOut);
    setHalfDayWarning(todayAttendanceData?.status === 'half_day');
    setAttendanceState({
      clockInTime: todayAttendanceData?.clockIn?.timestamp?.toDate?.(),
      clockOutTime: todayAttendanceData?.clockOut?.timestamp?.toDate?.(),
      status: todayAttendanceData?.status,
      totalHours: todayAttendanceData?.totalHours,
      branchId: todayAttendanceData?.branchId,
      crossBranchAttendance: todayAttendanceData?.crossBranchAttendance,
    });

    if (hasClockOut) {
      setMessage('Clocked out today');
    } else if (hasClockIn) {
      setMessage('Clocked in today');
    } else {
      setMessage('');
    }
  }, [todayKey, userData?.role, userData?.uid]);

  useEffect(() => {
    loadTodayAttendance().catch((error) => {
      console.error('loadTodayAttendance failed', error);
      setMessage(error instanceof Error ? error.message : 'Unable to load today attendance');
    });
  }, [loadTodayAttendance]);

  async function handleClockIn() {
    console.log('Clock In button clicked');

    if (!userData?.uid || !userData.role) {
      setMessage('User profile not loaded');
      return;
    }

    if (!userData.branchId) {
      setMessage('User profile branch is missing');
      return;
    }

    setLoading(true);
    setMessage('');
    setHalfDayWarning(false);

    try {
      const result = await clockIn(userData);

      if (result.success) {
        await loadTodayAttendance();
      } else {
        console.error('clockIn returned failure', result.error);
        setMessage(result.error || 'Unable to clock in');
      }
    } catch (error) {
      console.error('Clock In handler failed', error);
      setMessage(error instanceof Error ? error.message : 'Unable to clock in');
    } finally {
      setLoading(false);
    }
  }

  async function handleClockOut() {
    console.log('Clock Out button clicked');

    if (!userData?.uid || !userData.role) {
      setMessage('User profile not loaded');
      return;
    }

    if (!userData.branchId) {
      setMessage('User profile branch is missing');
      return;
    }

    setLoading(true);
    setMessage('');
    setHalfDayWarning(false);

    try {
      const result = await clockOut(userData);

      if (result.success) {
        await loadTodayAttendance();
      } else {
        console.error('clockOut returned failure', result.error);
        setMessage(result.error || 'Unable to clock out');
      }
    } catch (error) {
      console.error('Clock Out handler failed', error);
      setMessage(error instanceof Error ? error.message : 'Unable to clock out');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="attendance-card" className="rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Attendance</h2>
          <div className="mt-1 text-sm text-slate-400">{today}</div>
          <div className="mt-2 inline-flex rounded-full border border-orange-400/15 bg-[#1F160E] px-3 py-1 text-xs uppercase text-orange-200">
            {userData?.branchId || 'Pending profile'}
          </div>
        </div>
        <div className="grid h-20 w-20 place-items-center rounded-full border border-orange-500/20 bg-[conic-gradient(from_180deg,#F97316,rgba(21,21,21,0.2),#D88A32)] p-1 shadow-[0_0_24px_rgba(249,115,22,0.10)]">
          <div className="grid h-full w-full place-items-center rounded-full bg-[#050505] text-center">
            <div className="text-xs uppercase text-slate-500">Hours</div>
            <div className="text-lg font-semibold text-white">{attendanceState.totalHours ?? '-'}</div>
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 text-sm">
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-2.5">
          <div className="text-xs uppercase text-slate-500">Clock In</div>
          <div className="mt-1 text-slate-200">{formatTime(attendanceState.clockInTime)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-2.5">
          <div className="text-xs uppercase text-slate-500">Clock Out</div>
          <div className="mt-1 text-slate-200">{formatTime(attendanceState.clockOutTime)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-2.5">
          <div className="text-xs uppercase text-slate-500">Status</div>
          <div className="mt-1 text-slate-200">{attendanceState.status || '-'}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-2.5">
          <div className="text-xs uppercase text-slate-500">Total Hours</div>
          <div className="mt-1 text-slate-200">{attendanceState.totalHours ?? '-'}</div>
        </div>
        <div className="col-span-2 rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-2.5">
          <div className="text-xs uppercase text-slate-500">Detected Branch</div>
          <div className="mt-1 flex items-center gap-2 text-slate-200">
            {attendanceState.branchId || '-'}
            {attendanceState.crossBranchAttendance ? (
              <span className="rounded-full border border-orange-500/40 px-2 py-0.5 text-xs text-[#D88A32]">
                Cross Branch
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleClockIn}
          disabled={loading || Boolean(profileBlockMessage) || clockedInToday}
          className="rounded-2xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(249,115,22,0.10)] hover:from-[#D97706] hover:to-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Clocking in' : 'Clock In'}
        </button>

        <button
          type="button"
          onClick={handleClockOut}
          disabled={loading || Boolean(profileBlockMessage) || !clockedInToday || clockedOutToday}
          className="rounded-2xl border border-red-500/25 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/70 disabled:text-slate-500"
        >
          {loading ? 'Clocking out' : 'Clock Out'}
        </button>
      </div>

      {profileBlockMessage ? <div className="mt-3 text-sm text-amber-300">{profileBlockMessage}</div> : null}
      {message ? <div className="mt-3 text-sm text-slate-300">{message}</div> : null}
      {halfDayWarning ? <div className="mt-2 text-sm text-amber-300">Half-day recorded: working duration is less than 5 hours.</div> : null}
    </div>
  );
}
