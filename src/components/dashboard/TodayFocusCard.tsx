'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AlertTriangle, CalendarClock, Clock3 } from 'lucide-react';
import { db } from '@/lib/firebase/init';
import { getAttendanceDateKey } from '@/lib/utils/attendanceDate';
import { getDashboardSchedules, markScheduleDone } from '@/features/schedules/services/scheduleService';
import type { ScheduleItem } from '@/features/schedules/types';
import type { UserData } from '@/types';

interface TodayFocusCardProps {
  userData: UserData | null;
  overdueJobs: number | string;
  slaWarnings: number | string;
}

interface AttendanceFocusData {
  hasClockIn: boolean;
  hasClockOut: boolean;
  status?: string;
  branchId?: string;
}

function getTodayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function priorityText(value: number | string, fallback: string): string {
  if (typeof value === 'string') return value;
  return value > 0 ? String(value) : fallback;
}

export function TodayFocusCard({ userData, overdueJobs, slaWarnings }: TodayFocusCardProps) {
  const todayKey = useMemo(() => getTodayKey(), []);
  const attendanceDocKey = useMemo(() => getAttendanceDateKey(), []);
  const [todaySchedules, setTodaySchedules] = useState<ScheduleItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceFocusData>({
    hasClockIn: false,
    hasClockOut: false,
  });
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');

  const attendanceActionLabel = attendance.hasClockOut
    ? 'Completed'
    : attendance.hasClockIn
      ? 'Clock Out'
      : 'Clock In';

  const attendanceStatus = attendance.hasClockOut
    ? 'Clocked out today'
    : attendance.hasClockIn
      ? 'Clocked in today'
      : 'Not clocked in';

  const loadFocusData = useCallback(async () => {
    if (!userData?.uid || !userData.role) return;

    setLoading(true);
    setMessage('');

    try {
      const [scheduleRows, attendanceSnapshot] = await Promise.all([
        getDashboardSchedules({
          userId: userData.uid,
          role: userData.role,
          branch: userData.branchId,
        }),
        getDoc(doc(db, 'attendance', `${userData.uid}_${attendanceDocKey}`)),
      ]);

      const attendanceData = attendanceSnapshot.exists()
        ? (attendanceSnapshot.data() as {
            status?: string;
            branchId?: string;
            clockIn?: { timestamp?: unknown };
            clockOut?: { timestamp?: unknown };
          })
        : null;

      setTodaySchedules(scheduleRows.filter((schedule) => schedule.scheduleDate === todayKey).slice(0, 3));
      setAttendance({
        hasClockIn: Boolean(attendanceData?.clockIn?.timestamp),
        hasClockOut: Boolean(attendanceData?.clockOut?.timestamp),
        status: attendanceData?.status,
        branchId: attendanceData?.branchId,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load today focus');
    } finally {
      setLoading(false);
    }
  }, [attendanceDocKey, todayKey, userData?.branchId, userData?.role, userData?.uid]);

  useEffect(() => {
    void loadFocusData();
  }, [loadFocusData]);

  async function handleMarkDone(scheduleId: string) {
    if (!userData?.uid || !userData.role) return;

    setActionId(scheduleId);
    setMessage('');

    try {
      await markScheduleDone({ scheduleId, userId: userData.uid, role: userData.role });
      await loadFocusData();
      setMessage('Schedule marked done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update schedule');
    } finally {
      setActionId('');
    }
  }

  return (
    <div className="rounded-3xl border border-orange-500/15 bg-[linear-gradient(135deg,rgba(40,20,10,0.55),rgba(17,17,17,0.9)_46%,rgba(249,115,22,0.06))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-red-200/80">Today Focus</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Act first on what can block operations.</h2>
        </div>
        {loading ? <span className="text-xs text-slate-500">Syncing focus</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[0.85fr_1.35fr_0.8fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-2xl border border-red-500/25 bg-red-950/20 p-3">
            <div className="flex items-center gap-2 text-xs uppercase text-red-200/80">
              <AlertTriangle size={14} />
              Overdue Jobs
            </div>
            <div className="mt-2 text-3xl font-semibold text-red-100">{priorityText(overdueJobs, '0')}</div>
            <Link href="/dashboard/jobs" className="mt-3 inline-flex rounded-xl border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-900/30">
              View Jobs
            </Link>
          </div>
          <div className="rounded-2xl border border-amber-500/25 bg-amber-950/20 p-3">
            <div className="text-xs uppercase text-amber-200/80">SLA Warnings</div>
            <div className="mt-2 text-3xl font-semibold text-amber-100">{priorityText(slaWarnings, '0')}</div>
            <Link href="/dashboard/jobs" className="mt-3 inline-flex rounded-xl border border-amber-400/30 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/30">
              View Jobs
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock size={16} className="text-[#D88A32]" />
            Today&apos;s Schedule
          </div>
          <div className="space-y-2">
            {todaySchedules.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 p-3 text-sm text-slate-500">
                No critical schedule items.
              </div>
            ) : null}
            {todaySchedules.map((schedule) => (
              <div key={schedule.scheduleId} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">
                    {schedule.time ? `${schedule.time} · ` : ''}
                    {schedule.title}
                  </div>
                  {schedule.description ? <div className="mt-1 line-clamp-1 text-xs text-slate-400">{schedule.description}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleMarkDone(schedule.scheduleId)}
                  disabled={Boolean(actionId)}
                  className="shrink-0 rounded-xl border border-emerald-500/35 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-950/40 disabled:opacity-60"
                >
                  {actionId === schedule.scheduleId ? 'Saving' : 'Mark Done'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-orange-500/15 bg-[#151515]/90 p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-orange-200/80">
            <Clock3 size={14} />
            Attendance
          </div>
          <div className="mt-3 text-lg font-semibold text-white">{attendanceStatus}</div>
          <div className="mt-1 text-sm text-slate-400">
            {attendance.branchId || userData?.branchId || 'Branch pending'}
            {attendance.status ? ` · ${attendance.status}` : ''}
          </div>
          <a href="#attendance-card" className="mt-4 inline-flex rounded-xl border border-orange-400/30 px-3 py-1.5 text-xs font-medium text-orange-100 hover:bg-[#1F160E]">
            {attendanceActionLabel}
          </a>
        </div>
      </div>

      {message ? <div className="mt-3 rounded-xl border border-slate-700/70 bg-[#101010] px-3 py-2 text-sm text-slate-300">{message}</div> : null}
    </div>
  );
}
