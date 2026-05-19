'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  cancelSchedule,
  createSchedule,
  getDashboardSchedules,
  markScheduleDone,
} from '@/features/schedules/services/scheduleService';
import type { ScheduleBranch, ScheduleItem, ScheduleTargetType } from '@/features/schedules/types';
import type { Role, UserData } from '@/types';

interface TodayScheduleCardProps {
  userData: UserData | null;
}

function getDateKey(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function branchLabel(branch?: string): string {
  if (branch === 'bangi') return 'Bangi';
  if (branch === 'cyberjaya') return 'Cyberjaya';
  return 'All branches';
}

function targetLabel(schedule: ScheduleItem): string {
  if (schedule.targetType === 'role') return `Target: ${schedule.targetRole || 'role'}`;
  if (schedule.targetType === 'user') return 'Target: specific user';
  return 'Target: all staff';
}

function statusClass(status: ScheduleItem['status']): string {
  if (status === 'done') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'cancelled') return 'border-red-500/40 text-red-300';
  return 'border-orange-500/40 text-[#D88A32]';
}

export function TodayScheduleCard({ userData }: TodayScheduleCardProps) {
  const today = useMemo(() => getDateKey(0), []);
  const tomorrow = useMemo(() => getDateKey(1), []);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleDate, setScheduleDate] = useState(today);
  const [time, setTime] = useState('');
  const [branch, setBranch] = useState<ScheduleBranch>('all');
  const [targetType, setTargetType] = useState<ScheduleTargetType>('all');
  const [targetRole, setTargetRole] = useState<Role>('technician');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');

  const todaySchedules = useMemo(
    () => schedules.filter((schedule) => schedule.scheduleDate === today),
    [schedules, today],
  );
  const tomorrowSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.scheduleDate === tomorrow),
    [schedules, tomorrow],
  );

  const loadSchedules = useCallback(async () => {
    if (!userData?.uid || !userData.role) return;

    setLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadDashboardSchedules');
      const nextSchedules = await getDashboardSchedules({
        userId: userData.uid,
        role: userData.role,
        branch: userData.branchId,
      });
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadDashboardSchedules');
      setSchedules(nextSchedules);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadDashboardSchedules');
      setMessage(error instanceof Error ? error.message : 'Unable to load schedules');
    } finally {
      setLoading(false);
    }
  }, [userData?.branchId, userData?.role, userData?.uid]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userData?.uid || !userData.role) {
      setMessage('User profile is still loading');
      return;
    }

    setActionId('create');
    setMessage('');

    try {
      await createSchedule({
        title,
        description,
        scheduleDate,
        time,
        branch,
        createdBy: userData.uid,
        createdByName: userData.displayName || userData.name || 'Unknown User',
        createdByRole: userData.role,
        targetType,
        targetRole: targetType === 'role' ? targetRole : undefined,
      });
      setTitle('');
      setDescription('');
      setTime('');
      setBranch('all');
      setTargetType('all');
      setTargetRole('technician');
      setMessage('Schedule added');
      await loadSchedules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create schedule');
    } finally {
      setActionId('');
    }
  }

  async function handleStatus(scheduleId: string, nextStatus: 'done' | 'cancelled') {
    if (!userData?.uid || !userData.role) return;

    setActionId(`${nextStatus}-${scheduleId}`);
    setMessage('');

    try {
      if (nextStatus === 'done') {
        await markScheduleDone({ scheduleId, userId: userData.uid, role: userData.role });
        setMessage('Schedule marked done');
      } else {
        await cancelSchedule({ scheduleId, userId: userData.uid, role: userData.role });
        setMessage('Schedule cancelled');
      }
      await loadSchedules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update schedule');
    } finally {
      setActionId('');
    }
  }

  function renderScheduleList(label: string, rows: ScheduleItem[]) {
    const isExpanded = Boolean(expandedGroups[label]);
    const visibleRows = isExpanded ? rows : rows.slice(0, 5);
    const hiddenCount = Math.max(rows.length - visibleRows.length, 0);

    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-200">{label}</div>
          <div className="text-xs text-slate-500">{rows.length} item{rows.length === 1 ? '' : 's'}</div>
        </div>
        <div className="space-y-2">
          {rows.length === 0 ? <div className="text-sm text-slate-500">No schedule items</div> : null}
          {visibleRows.map((schedule) => (
            <div key={schedule.scheduleId} className="rounded-xl border border-white/10 bg-[#151515]/90 p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {schedule.time ? `${schedule.time} · ` : ''}
                    {schedule.title}
                  </div>
                  {schedule.description ? <div className="mt-0.5 text-sm text-slate-400">{schedule.description}</div> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full border border-orange-400/15 px-2 py-0.5 text-orange-200">{branchLabel(schedule.branch)}</span>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-400">{schedule.createdByName || 'Unknown User'}</span>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-400">{targetLabel(schedule)}</span>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusClass(schedule.status)}`}>
                  {schedule.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleStatus(schedule.scheduleId, 'done')}
                  disabled={Boolean(actionId)}
                  className="rounded-xl border border-emerald-700/60 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-60"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => handleStatus(schedule.scheduleId, 'cancelled')}
                  disabled={Boolean(actionId)}
                  className="rounded-xl border border-red-700/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setExpandedGroups((current) => ({ ...current, [label]: true }))}
              className="w-full rounded-xl border border-slate-700/80 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
            >
              View More ({hiddenCount})
            </button>
          ) : null}
          {isExpanded && rows.length > 5 ? (
            <button
              type="button"
              onClick={() => setExpandedGroups((current) => ({ ...current, [label]: false }))}
              className="w-full rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:bg-[#1A1A1A]/70"
            >
              Show Less
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <CalendarClock size={18} />
            Today&apos;s Schedule
          </h2>
          <p className="mt-1 text-sm text-slate-400">Shared reminders for today and tomorrow</p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <div className="text-xs text-slate-500">Loading</div> : null}
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="rounded-xl border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
          >
            {showCreate ? 'Hide' : 'New'}
          </button>
        </div>
      </div>

      {showCreate ? (
      <form onSubmit={handleCreate} className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-[#1A1A1A]/70 p-3 md:grid-cols-2">
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
        />
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
          rows={2}
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35 md:col-span-2"
        />
        <select
          value={scheduleDate}
          onChange={(event) => setScheduleDate(event.target.value)}
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
        >
          <option value={today}>Today</option>
          <option value={tomorrow}>Tomorrow</option>
        </select>
        <select
          value={branch}
          onChange={(event) => setBranch(event.target.value as ScheduleBranch)}
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
        >
          <option value="all">All branches</option>
          <option value="bangi">Bangi</option>
          <option value="cyberjaya">Cyberjaya</option>
        </select>
        <select
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as ScheduleTargetType)}
          className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
        >
          <option value="all">All staff</option>
          <option value="role">By role</option>
        </select>
        {targetType === 'role' ? (
          <select
            value={targetRole}
            onChange={(event) => setTargetRole(event.target.value as Role)}
            className="rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/35"
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="technician">Technician</option>
          </select>
        ) : null}
        <button
          type="submit"
          disabled={actionId === 'create'}
          className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:from-[#D97706] hover:to-[#FB923C] disabled:opacity-60 md:col-span-2"
        >
          {actionId === 'create' ? 'Adding' : 'Add Schedule'}
        </button>
      </form>
      ) : null}

      {message ? <div className="mb-3 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300">{message}</div> : null}

      <div className="grid gap-3 2xl:grid-cols-2">
        {renderScheduleList('Today', todaySchedules)}
        {renderScheduleList('Tomorrow', tomorrowSchedules)}
      </div>
    </div>
  );
}
