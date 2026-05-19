'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageSearch,
  Plus,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { AttendanceCard } from '@/components/dashboard/AttendanceCard';
import { AttendanceHistory } from '@/components/dashboard/AttendanceHistory';
import { AttendanceOverview } from '@/components/dashboard/AttendanceOverview';
import { TodayFocusCard } from '@/components/dashboard/TodayFocusCard';
import { getTechnicianNotices } from '@/features/notices/services/noticeService';
import type { Notice } from '@/features/notices/types';
import { TechnicianPayslipCard } from '@/features/payroll/components/TechnicianPayslipCard';
import { TodayScheduleCard } from '@/features/schedules/components/TodayScheduleCard';
import { getDashboardSchedules } from '@/features/schedules/services/scheduleService';
import type { ScheduleItem } from '@/features/schedules/types';
import { BranchChatWidget } from '@/features/chat/components/BranchChatWidget';
import { getPartsOrdersForUser } from '@/features/parts-orders/services/partsOrderService';
import type { PartsOrder } from '@/features/parts-orders/types';
import { calculateJobSla, type SlaResult } from '@/features/sla/slaService';
import { db } from '@/lib/firebase/init';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';
import { can, isTechnician } from '@/lib/rbac/can';
import { getAttendanceDateKey } from '@/lib/utils/attendanceDate';
import type { Job, UserData } from '@/types';

interface TechnicianJobSla {
  job: Job;
  sla: SlaResult;
}

interface TechnicianAttendanceSummary {
  status: string;
  branchId?: string;
}

interface SalesPoint {
  label: string;
  bangi: number;
  cyberjaya: number;
}

interface TechnicianPerformancePoint {
  key: string;
  label: string;
  completed: number;
  diagnosis: number;
  ready: number;
}

function getTodayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function timestampToDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  return typeof toDate === 'function' ? toDate.call(value) : null;
}

function getCompletedDate(job: Job): Date | null {
  const completedHistory = (job.statusHistory || [])
    .filter((item) => item.status === 'completed' || item.status === 'collected')
    .at(-1);
  return timestampToDate(completedHistory?.changedAt)
    || timestampToDate((job as Job & { updatedAt?: unknown }).updatedAt)
    || timestampToDate((job as Job & { createdAt?: unknown }).createdAt);
}

function getSalesValue(job: Job): number {
  return Number(job.quotationAmount || job.totalSale || 0);
}

function getSalesBranch(job: Job): 'bangi' | 'cyberjaya' | null {
  const branch = String(job.branchId || '').toLowerCase();
  if (branch.includes('bangi')) return 'bangi';
  if (branch.includes('cyberjaya')) return 'cyberjaya';
  return null;
}

function buildSalesGraphs(jobs: Job[]) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dailySales: SalesPoint[] = Array.from({ length: daysInMonth }, (_, index) => ({
    label: String(index + 1),
    bangi: 0,
    cyberjaya: 0,
  }));
  const monthlySales: SalesPoint[] = Array.from({ length: 12 }, (_, index) => ({
    label: new Intl.DateTimeFormat('en-MY', { month: 'short' }).format(new Date(currentYear, index, 1)),
    bangi: 0,
    cyberjaya: 0,
  }));

  jobs.forEach((job) => {
    if (job.status !== 'completed' && job.status !== 'collected') return;
    const branch = getSalesBranch(job);
    if (!branch) return;
    const date = getCompletedDate(job);
    if (!date || date.getFullYear() !== currentYear) return;
    const value = getSalesValue(job);
    monthlySales[date.getMonth()][branch] += value;
    if (date.getMonth() === currentMonth) {
      dailySales[date.getDate() - 1][branch] += value;
    }
  });

  return { dailySales, monthlySales };
}

function formatJobTitle(job: Job): string {
  return job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber || job.docId;
}

function formatDevice(job: Job): string {
  return job.device || [job.deviceBrand, job.deviceModel].filter(Boolean).join(' ') || 'Device not specified';
}

function formatStatus(status?: string): string {
  return (status || 'pending').replaceAll('_', ' ');
}

function isActiveTechnicianJob(job: Job): boolean {
  return !['done', 'completed', 'collected', 'cancelled', 'rejected'].includes(String(job.status));
}

function isActiveRepair(job: Job): boolean {
  const status = String(job.lifecycleStatus || job.status || '');
  return ['customer_approved', 'repair_in_progress', 'repair_completed', 'in_repair', 'completed'].includes(status);
}

function isReadyForPickup(job: Job): boolean {
  const status = String(job.lifecycleStatus || job.status || '');
  return status === 'ready_for_pickup' || status === 'ready_for_collection';
}

function isPendingDiagnosis(job: Job): boolean {
  const status = String(job.lifecycleStatus || job.status || '');
  return status === 'received' || status === 'diagnosis' || status === 'pending';
}

function isReadyOrCompletedToday(job: Job, todayKey: string): boolean {
  const status = String(job.lifecycleStatus || job.status || '');
  if (!['repair_completed', 'ready_for_pickup', 'done', 'completed'].includes(status)) return false;
  const completedDate = getCompletedDate(job);
  if (!completedDate) return false;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(completedDate) === todayKey;
}

function isTechnicianOwnedJob(job: Job, profile: UserData | null): boolean {
  if (!profile?.uid) return false;
  return job.technicianId === profile.uid;
}

function getHistoryStatusDate(job: Job, statuses: string[]): Date | null {
  const lifecycleMatch = (job.lifecycleHistory || [])
    .filter((item) => statuses.includes(String(item.status)))
    .at(-1);
  const legacyMatch = (job.statusHistory || [])
    .filter((item) => statuses.includes(String(item.status)))
    .at(-1);

  return timestampToDate(lifecycleMatch?.changedAt) || timestampToDate(legacyMatch?.changedAt);
}

function getTechnicianCompletedDate(job: Job): Date | null {
  return timestampToDate(job.repairCompletedAt)
    || getHistoryStatusDate(job, ['repair_completed', 'done', 'completed', 'collected', 'delivered'])
    || (['repair_completed', 'done', 'completed', 'collected', 'delivered'].includes(String(job.lifecycleStatus || job.status))
      ? getCompletedDate(job)
      : null);
}

function getTechnicianDiagnosisCompletedDate(job: Job): Date | null {
  return timestampToDate(job.diagnosisCompletedAt)
    || getHistoryStatusDate(job, ['quotation_pending', 'quotation_sent']);
}

function getTechnicianReadyDate(job: Job): Date | null {
  return timestampToDate(job.readyForPickupAt)
    || getHistoryStatusDate(job, ['ready_for_pickup', 'ready_for_collection', 'done', 'completed'])
    || (['ready_for_pickup', 'ready_for_collection', 'done', 'completed'].includes(String(job.lifecycleStatus || job.status))
      ? getCompletedDate(job)
      : null);
}

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatMonthKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function buildTechnicianPerformanceData(jobs: Job[], profile: UserData | null) {
  const technicianJobs = jobs.filter((job) => isTechnicianOwnedJob(job, profile));
  const today = new Date();
  const daily: TechnicianPerformancePoint[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return {
      key: formatDateKey(date),
      label: new Intl.DateTimeFormat('en-MY', { day: '2-digit', month: 'short' }).format(date),
      completed: 0,
      diagnosis: 0,
      ready: 0,
    };
  });
  const monthly: TechnicianPerformancePoint[] = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (5 - index), 1);
    return {
      key: formatMonthKey(date),
      label: new Intl.DateTimeFormat('en-MY', { month: 'short' }).format(date),
      completed: 0,
      diagnosis: 0,
      ready: 0,
    };
  });
  const dailyByKey = new Map(daily.map((point) => [point.key, point]));
  const monthlyByKey = new Map(monthly.map((point) => [point.key, point]));

  function addMetric(date: Date | null, metric: 'completed' | 'diagnosis' | 'ready') {
    if (!date) return;
    const dailyPoint = dailyByKey.get(formatDateKey(date));
    if (dailyPoint) dailyPoint[metric] += 1;
    const monthlyPoint = monthlyByKey.get(formatMonthKey(date));
    if (monthlyPoint) monthlyPoint[metric] += 1;
  }

  technicianJobs.forEach((job) => {
    addMetric(getTechnicianCompletedDate(job), 'completed');
    addMetric(getTechnicianDiagnosisCompletedDate(job), 'diagnosis');
    addMetric(getTechnicianReadyDate(job), 'ready');
  });

  return { daily, monthly };
}

function getUrgencyLabel(sla: SlaResult): string {
  if (sla.status === 'overdue') return 'High';
  if (sla.status === 'warning') return 'Watch';
  return 'Normal';
}

function DashboardKpiRow({
  overdue,
  warnings,
  activeRepairs,
  readyForPickup,
}: {
  overdue: number | string;
  warnings: number | string;
  activeRepairs: number | string;
  readyForPickup: number | string;
}) {
  const cards = [
    {
      label: 'Overdue Jobs',
      value: overdue,
      tone: 'text-red-200',
      border: 'border-red-500/20 hover:border-red-400/35',
      glow: 'bg-red-500/10 text-red-300 shadow-[0_0_24px_rgba(239,68,68,0.16)]',
      trend: 'Needs review',
      trendIcon: ArrowUpRight,
      trendTone: 'text-red-300',
      icon: AlertTriangle,
    },
    {
      label: 'SLA Warnings',
      value: warnings,
      tone: 'text-amber-200',
      border: 'border-amber-500/20 hover:border-amber-400/35',
      glow: 'bg-amber-500/10 text-amber-300 shadow-[0_0_24px_rgba(245,158,11,0.16)]',
      trend: 'Monitor today',
      trendIcon: ArrowDownRight,
      trendTone: 'text-amber-300',
      icon: CalendarClock,
    },
    {
      label: 'Active Repairs',
      value: activeRepairs,
      tone: 'text-sky-200',
      border: 'border-sky-500/20 hover:border-sky-400/35',
      glow: 'bg-sky-500/10 text-sky-300 shadow-[0_0_24px_rgba(56,189,248,0.16)]',
      trend: 'In workflow',
      trendIcon: ArrowUpRight,
      trendTone: 'text-sky-300',
      icon: Wrench,
    },
    {
      label: 'Ready for Pickup',
      value: readyForPickup,
      tone: 'text-emerald-200',
      border: 'border-emerald-500/20 hover:border-emerald-400/35',
      glow: 'bg-emerald-500/10 text-emerald-300 shadow-[0_0_24px_rgba(34,197,94,0.16)]',
      trend: 'Collection queue',
      trendIcon: ArrowUpRight,
      trendTone: 'text-emerald-300',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const TrendIcon = card.trendIcon;
        return (
        <div key={card.label} className={`rounded-2xl border ${card.border} bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(9,9,9,0.96))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)] transition`}>
          <div className="flex items-start gap-2.5">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 ${card.glow}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{card.label}</div>
              <div className={`mt-1.5 text-2xl font-semibold leading-none ${card.tone}`}>{card.value}</div>
              <div className={`mt-2 inline-flex items-center gap-1 text-xs ${card.trendTone}`}>
                <TrendIcon size={13} />
                {card.trend}
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function QuickActionsCard() {
  const actions = [
    { href: '/dashboard/jobs', label: 'Create New Job', icon: Plus },
    { href: '/dashboard/customers', label: 'Add Customer', icon: UserPlus },
    { href: '/dashboard/parts-orders', label: 'Parts Order', icon: Wrench },
    { href: '/dashboard/inventory', label: 'Stock Check / Inventory', icon: PackageSearch },
    { href: '/dashboard/reports', label: 'Reports', icon: FileText },
    { href: '/dashboard/notices', label: 'Notices', icon: ClipboardList },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.96),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Quick Actions</h2>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-[#101010]/90 px-2.5 py-2.5 text-center text-xs font-medium text-zinc-200 transition hover:border-orange-500/35 hover:bg-[#1F160E] hover:text-orange-100 hover:shadow-[0_0_24px_rgba(249,115,22,0.10)]"
            >
              <Icon size={20} className="text-[#F97316]" />
              {action.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function RepairQueueCard({ jobs, partsOrders, loading }: { jobs: Job[]; partsOrders: PartsOrder[]; loading: boolean }) {
  const queue = useMemo(() => {
    return jobs
      .map((job) => ({
        job,
        sla: calculateJobSla(job, partsOrders.filter((order) => order.jobId === job.docId)),
      }))
      .sort((left, right) => {
        const score = (sla: SlaResult) => (sla.status === 'overdue' ? 0 : sla.status === 'warning' ? 1 : 2);
        return score(left.sla) - score(right.sla);
      })
      .slice(0, 7);
  }, [jobs, partsOrders]);

  return (
    <section className="h-full rounded-2xl border border-white/10 bg-[#151515]/90 p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Recent Jobs / Repair Queue</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Sorted by SLA urgency for fast review.</p>
        </div>
        <Link href="/dashboard/jobs" className="rounded-xl border border-orange-500/20 bg-[#141414] px-2.5 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#1F160E]">
          Open Jobs
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#101010] text-xs uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              <th className="px-2.5 py-2.5">Job No</th>
              <th className="px-2.5 py-2.5">Customer</th>
              <th className="px-2.5 py-2.5">Device</th>
              <th className="px-2.5 py-2.5">Issue</th>
              <th className="px-2.5 py-2.5">Lifecycle Status</th>
              <th className="px-2.5 py-2.5">SLA</th>
              <th className="px-2.5 py-2.5">Branch / Urgency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-[#151515]/70">
            {loading ? (
              <tr><td colSpan={7} className="px-2.5 py-5 text-center text-zinc-500">Loading repair queue</td></tr>
            ) : null}
            {!loading && queue.length === 0 ? (
              <tr><td colSpan={7} className="px-2.5 py-5 text-center text-zinc-500">No jobs found</td></tr>
            ) : null}
            {!loading && queue.map(({ job, sla }) => (
              <tr key={job.docId} className="hover:bg-[#1A1A1A]">
                <td className="px-2.5 py-2.5 font-medium text-white">{formatJobTitle(job)}</td>
                <td className="px-2.5 py-2.5 text-zinc-300">{job.customerName || '-'}</td>
                <td className="px-2.5 py-2.5 text-zinc-300">{formatDevice(job)}</td>
                <td className="px-2.5 py-2.5 text-zinc-400">{job.issueDescription || '-'}</td>
                <td className="px-2.5 py-2.5 capitalize text-zinc-300">{formatStatus(String(job.lifecycleStatus || job.status))}</td>
                <td className="px-2.5 py-2.5">
                  <span className={`rounded-full border px-2 py-1 text-xs ${sla.status === 'overdue' ? 'border-red-500/30 text-red-300' : sla.status === 'warning' ? 'border-amber-500/30 text-amber-300' : 'border-white/10 text-zinc-400'}`}>
                    {sla.status}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-zinc-300">{job.branchId || '-'} · {getUrgencyLabel(sla)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(value);
}

function SalesOverviewCard({ title, data, variant }: { title: string; data: SalesPoint[]; variant: 'line' | 'bar' }) {
  const maxValue = Math.max(...data.flatMap((point) => [point.bangi, point.cyberjaya]), 0);
  const chartWidth = 420;
  const chartHeight = 150;
  const paddingX = 22;
  const paddingY = 18;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;
  const hasData = maxValue > 0;
  const bangiTotal = data.reduce((total, point) => total + point.bangi, 0);
  const cyberjayaTotal = data.reduce((total, point) => total + point.cyberjaya, 0);
  const getX = (index: number) => paddingX + (data.length <= 1 ? 0 : (index / (data.length - 1)) * innerWidth);
  const getY = (value: number) => paddingY + innerHeight - (hasData ? (value / maxValue) * innerHeight : 0);
  const toPoints = (key: 'bangi' | 'cyberjaya') => data.map((point, index) => `${getX(index)},${getY(point[key])}`).join(' ');
  const labelIndexes = data.length > 12
    ? [0, Math.floor(data.length / 2), data.length - 1]
    : data.map((_, index) => index);

  return (
    <section className="flex h-full min-h-[460px] min-w-0 flex-col rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F97316]" />Bangi</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Cyberjaya</span>
        </div>
      </div>
      <div className="min-h-[360px] flex-1 rounded-2xl border border-white/10 bg-[#0D0D0D] p-2.5">
        {hasData ? (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-full w-full overflow-visible">
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={paddingX}
                x2={chartWidth - paddingX}
                y1={paddingY + innerHeight * ratio}
                y2={paddingY + innerHeight * ratio}
                stroke="rgba(255,255,255,0.08)"
              />
            ))}
            {variant === 'line' ? (
              <>
                <polyline points={toPoints('bangi')} fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={toPoints('cyberjaya')} fill="none" stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {data.map((point, index) => (
                  <g key={`${point.label}-${index}`}>
                    {point.bangi > 0 ? <circle cx={getX(index)} cy={getY(point.bangi)} r="3" fill="#F97316" /> : null}
                    {point.cyberjaya > 0 ? <circle cx={getX(index)} cy={getY(point.cyberjaya)} r="3" fill="#94A3B8" /> : null}
                  </g>
                ))}
              </>
            ) : (
              data.map((point, index) => {
                const groupWidth = innerWidth / Math.max(data.length, 1);
                const x = paddingX + index * groupWidth + groupWidth * 0.18;
                const barWidth = Math.max(groupWidth * 0.24, 4);
                const bangiHeight = hasData ? (point.bangi / maxValue) * innerHeight : 0;
                const cyberjayaHeight = hasData ? (point.cyberjaya / maxValue) * innerHeight : 0;
                return (
                  <g key={`${point.label}-${index}`}>
                    <rect x={x} y={paddingY + innerHeight - bangiHeight} width={barWidth} height={bangiHeight} rx="2" fill="#F97316" />
                    <rect x={x + barWidth + 3} y={paddingY + innerHeight - cyberjayaHeight} width={barWidth} height={cyberjayaHeight} rx="2" fill="#94A3B8" />
                  </g>
                );
              })
            )}
            {labelIndexes.map((index) => (
              <text key={data[index].label} x={getX(index)} y={chartHeight - 2} textAnchor="middle" fontSize="10" fill="rgba(161,161,170,0.72)">
                {data[index].label}
              </text>
            ))}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
            No sales data
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Bangi</div>
          <div className="mt-1 font-semibold text-white">{formatCurrency(bangiTotal)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Cyberjaya</div>
          <div className="mt-1 font-semibold text-white">{formatCurrency(cyberjayaTotal)}</div>
        </div>
      </div>
    </section>
  );
}

function SalesOverviewGrid({ jobs }: { jobs: Job[] }) {
  const { dailySales, monthlySales } = useMemo(() => buildSalesGraphs(jobs), [jobs]);

  return (
    <div className="grid h-full items-stretch gap-2.5 lg:grid-cols-2">
      <SalesOverviewCard title="Daily Sales Overview" data={dailySales} variant="line" />
      <SalesOverviewCard title="Monthly Sales Overview" data={monthlySales} variant="bar" />
    </div>
  );
}

function TechnicianSummaryStrip({
  assignedJobs,
  activeRepairs,
  pendingDiagnosis,
  readyToday,
}: {
  assignedJobs: number | string;
  activeRepairs: number | string;
  pendingDiagnosis: number | string;
  readyToday: number | string;
}) {
  const items = [
    { label: 'Assigned Jobs', value: assignedJobs, tone: 'text-orange-100', icon: ClipboardList, glow: 'bg-orange-500/10 text-orange-300' },
    { label: 'Active Repairs', value: activeRepairs, tone: 'text-sky-200', icon: Wrench, glow: 'bg-sky-500/10 text-sky-300' },
    { label: 'Pending Diagnosis', value: pendingDiagnosis, tone: 'text-amber-200', icon: CalendarClock, glow: 'bg-amber-500/10 text-amber-300' },
    { label: 'Ready / Done Today', value: readyToday, tone: 'text-emerald-200', icon: CheckCircle2, glow: 'bg-emerald-500/10 text-emerald-300' },
  ];

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(9,9,9,0.96))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
            <div className="flex items-start gap-2.5">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 ${item.glow}`}>
                <Icon size={18} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{item.label}</div>
                <div className={`mt-1.5 text-2xl font-semibold leading-none ${item.tone}`}>{item.value}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionRequiredSection({ urgentJobs }: { urgentJobs: TechnicianJobSla[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Action Required</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Urgent job items appear here first.</p>
        </div>
        <AlertTriangle size={18} className="text-[#D88A32]" />
      </div>

      {urgentJobs.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 px-3 py-2 text-sm text-zinc-400">
          No urgent action required.
        </div>
      ) : (
        <div className="space-y-2">
          {urgentJobs.slice(0, 5).map(({ job, sla }) => {
            const overdue = sla.status === 'overdue';
            return (
              <div key={job.docId} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${overdue ? 'border-red-500/30 text-red-300' : 'border-amber-500/30 text-amber-300'}`}>
                      {overdue ? 'Overdue' : 'Warning'}
                    </span>
                    <span className="text-sm font-semibold text-white">{formatJobTitle(job)}</span>
                  </div>
                  <div className="mt-1 line-clamp-1 text-sm text-zinc-400">{job.customerName || 'Unknown customer'} · {sla.reason}</div>
                </div>
                <Link href="/dashboard/jobs" className="shrink-0 rounded-xl border border-orange-500/20 bg-[#141414] px-2.5 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#1F160E]">
                  View Job
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MyActiveJobsSection({ jobs, jobSlaRows, loading }: { jobs: Job[]; jobSlaRows: TechnicianJobSla[]; loading: boolean }) {
  const activeJobs = jobs.filter(isActiveTechnicianJob);
  const slaByJobId = new Map(jobSlaRows.map((row) => [row.job.docId, row.sla]));

  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">My Active Jobs</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Current assigned work, ordered for quick action.</p>
        </div>
        <Link href="/dashboard/jobs" className="rounded-xl border border-orange-500/20 bg-[#141414] px-2.5 py-1.5 text-xs font-medium text-orange-200 hover:bg-[#1F160E]">
          Open Jobs
        </Link>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading jobs</div> : null}
      {!loading && activeJobs.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 px-3 py-2 text-sm text-zinc-400">
          No active jobs assigned.
        </div>
      ) : null}
      {!loading && activeJobs.length > 0 ? (
        <div className="space-y-2">
          {activeJobs.slice(0, 8).map((job) => {
            const sla = slaByJobId.get(job.docId);
            return (
              <div key={job.docId} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{formatJobTitle(job)}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs capitalize text-zinc-300">
                      {formatStatus(String(job.status))}
                    </span>
                    {sla && sla.status !== 'normal' ? (
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${sla.status === 'overdue' ? 'border-red-500/30 text-red-300' : 'border-amber-500/30 text-amber-300'}`}>
                        {sla.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-1 text-sm text-zinc-400">
                    {job.customerName || 'Unknown customer'} · {formatDevice(job)}
                  </div>
                </div>
                <Link href="/dashboard/jobs" className="shrink-0 rounded-xl border border-orange-500/20 bg-[#141414] px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#1F160E]">
                  View Job
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function TechnicianScheduleSection({ schedules }: { schedules: ScheduleItem[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center gap-2">
        <CalendarClock size={17} className="text-[#D88A32]" />
        <h2 className="text-base font-semibold text-white">Today Schedule</h2>
      </div>

      {schedules.length === 0 ? (
        <div className="text-sm text-zinc-400">No schedule items today.</div>
      ) : (
        <div className="space-y-2">
          {schedules.slice(0, 4).map((schedule) => (
            <div key={schedule.scheduleId} className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 px-3 py-2">
              <div className="text-sm font-medium text-white">{schedule.time ? `${schedule.time} · ` : ''}{schedule.title}</div>
              {schedule.description ? <div className="mt-1 line-clamp-1 text-xs text-zinc-500">{schedule.description}</div> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TechnicianNotificationsMini({ notices }: { notices: Notice[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Latest Notifications</h2>
        <Link href="/dashboard/notices" className="text-xs font-medium text-orange-200 hover:text-orange-100">View all</Link>
      </div>
      {notices.length === 0 ? (
        <div className="text-sm text-zinc-400">No latest notices.</div>
      ) : (
        <div className="space-y-2">
          {notices.slice(0, 2).map((notice) => (
            <div key={notice.noticeId} className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 px-3 py-2">
              <div className="line-clamp-1 text-sm font-medium text-white">{notice.title}</div>
              <div className="mt-1 line-clamp-1 text-xs text-zinc-500">{notice.message}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TechnicianPerformanceChartCard({
  title,
  subtitle,
  data,
  variant,
}: {
  title: string;
  subtitle: string;
  data: TechnicianPerformancePoint[];
  variant: 'line' | 'bar';
}) {
  const chartWidth = 420;
  const chartHeight = 150;
  const paddingX = 24;
  const paddingY = 18;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;
  const maxValue = Math.max(...data.flatMap((point) => [point.completed, point.diagnosis, point.ready]), 0);
  const hasData = maxValue > 0;
  const getX = (index: number) => paddingX + (data.length <= 1 ? 0 : (index / (data.length - 1)) * innerWidth);
  const getY = (value: number) => paddingY + innerHeight - (hasData ? (value / maxValue) * innerHeight : 0);
  const series = [
    { key: 'completed' as const, label: 'Completed Jobs', color: '#F97316' },
    { key: 'diagnosis' as const, label: 'Diagnosis Completed', color: '#F59E0B' },
    { key: 'ready' as const, label: 'Ready / Done', color: '#22C55E' },
  ];

  return (
    <section className="flex min-h-[320px] min-w-0 flex-col rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(20,20,20,0.98),rgba(8,8,8,0.98))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.34)]">
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-[230px] flex-1 rounded-2xl border border-white/10 bg-[#0D0D0D] p-2.5">
        {hasData ? (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-full w-full overflow-visible">
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={paddingX}
                x2={chartWidth - paddingX}
                y1={paddingY + innerHeight * ratio}
                y2={paddingY + innerHeight * ratio}
                stroke="rgba(255,255,255,0.08)"
              />
            ))}
            {variant === 'line' ? (
              series.map((item) => (
                <polyline
                  key={item.key}
                  points={data.map((point, index) => `${getX(index)},${getY(point[item.key])}`).join(' ')}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            ) : (
              data.map((point, index) => {
                const groupWidth = innerWidth / Math.max(data.length, 1);
                const barWidth = Math.max(groupWidth * 0.17, 4);
                const x = paddingX + index * groupWidth + groupWidth * 0.18;
                return (
                  <g key={point.key}>
                    {series.map((item, seriesIndex) => {
                      const value = point[item.key];
                      const barHeight = hasData ? (value / maxValue) * innerHeight : 0;
                      return (
                        <rect
                          key={item.key}
                          x={x + seriesIndex * (barWidth + 2)}
                          y={paddingY + innerHeight - barHeight}
                          width={barWidth}
                          height={barHeight}
                          rx="2"
                          fill={item.color}
                        />
                      );
                    })}
                  </g>
                );
              })
            )}
            {data.map((point, index) => (
              <text key={point.key} x={getX(index)} y={chartHeight - 2} textAnchor="middle" fontSize="10" fill="rgba(161,161,170,0.72)">
                {point.label}
              </text>
            ))}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
            No performance data available yet.
          </div>
        )}
      </div>
    </section>
  );
}

function TechnicianPerformanceCharts({ jobs, profile }: { jobs: Job[]; profile: UserData | null }) {
  const { daily, monthly } = useMemo(() => buildTechnicianPerformanceData(jobs, profile), [jobs, profile]);

  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-2">
      <TechnicianPerformanceChartCard
        title="Daily Performance KPI"
        subtitle="Your last 7 days performance"
        data={daily}
        variant="line"
      />
      <TechnicianPerformanceChartCard
        title="Monthly Performance KPI"
        subtitle="Your last 6 months performance"
        data={monthly}
        variant="bar"
      />
    </div>
  );
}

function TechnicianDashboard({
  profile,
  jobs,
  loading,
  partsOrders,
  todayLabel,
}: {
  profile: UserData | null;
  jobs: Job[];
  loading: boolean;
  partsOrders: PartsOrder[];
  todayLabel: string;
}) {
  const [todaySchedules, setTodaySchedules] = useState<ScheduleItem[]>([]);
  const [latestNotices, setLatestNotices] = useState<Notice[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<TechnicianAttendanceSummary>({ status: 'Loading' });
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const attendanceDateKey = useMemo(() => getAttendanceDateKey(), []);
  const jobSlaRows = useMemo<TechnicianJobSla[]>(() => {
    return jobs.map((job) => ({
      job,
      sla: calculateJobSla(job, partsOrders.filter((order) => order.jobId === job.docId)),
    }));
  }, [jobs, partsOrders]);
  const overdueJobs = jobSlaRows.filter((row) => row.sla.status === 'overdue');
  const warningJobs = jobSlaRows.filter((row) => row.sla.status === 'warning');
  const urgentJobs = [...overdueJobs, ...warningJobs];
  const activeRepairs = jobs.filter(isActiveRepair);
  const pendingDiagnosisJobs = jobs.filter(isPendingDiagnosis);
  const readyOrCompletedToday = jobs.filter((job) => isReadyOrCompletedToday(job, todayKey));

  useEffect(() => {
    let cancelled = false;
    if (!profile?.uid || !profile.role) return;

    getDashboardSchedules({ userId: profile.uid, role: profile.role, branch: profile.branchId })
      .then((schedules) => {
        if (!cancelled) setTodaySchedules(schedules.filter((schedule) => schedule.scheduleDate === todayKey));
      })
      .catch(() => {
        if (!cancelled) setTodaySchedules([]);
      });

    getTechnicianNotices(profile.uid)
      .then((notices) => {
        if (!cancelled) setLatestNotices(notices.slice(0, 2));
      })
      .catch(() => {
        if (!cancelled) setLatestNotices([]);
      });

    getDoc(doc(db, 'attendance', `${profile.uid}_${attendanceDateKey}`))
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          setAttendanceSummary({ status: 'Not clocked in', branchId: profile.branchId });
          return;
        }
        const data = snapshot.data() as {
          status?: string;
          branchId?: string;
          clockIn?: { timestamp?: unknown };
          clockOut?: { timestamp?: unknown };
        };
        setAttendanceSummary({
          status: data.clockOut?.timestamp ? 'Clocked out' : data.clockIn?.timestamp ? 'Clocked in' : data.status || 'Not clocked in',
          branchId: data.branchId || profile.branchId,
        });
      })
      .catch(() => {
        if (!cancelled) setAttendanceSummary({ status: 'Unavailable', branchId: profile.branchId });
      });

    return () => {
      cancelled = true;
    };
  }, [attendanceDateKey, profile, todayKey]);

  return (
    <section className="grid gap-3 xl:grid-cols-12">
      <div className="grid items-start gap-3 xl:col-span-12 xl:grid-cols-12">
        <div className="min-w-0 space-y-3 xl:col-span-8 2xl:col-span-9">
          <div className="flex min-h-[112px] flex-col justify-between gap-3 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.12),transparent_34%),linear-gradient(145deg,rgba(22,22,22,0.98),rgba(8,8,8,0.98))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.40)] backdrop-blur-xl lg:flex-row lg:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[#F97316]">Technician Desk</div>
              <h1 className="mt-1.5 text-2xl font-semibold text-white sm:text-3xl">Welcome back, {profile?.displayName || 'Unknown User'}</h1>
              <p className="mt-0.5 text-sm text-slate-400">Technician workspace for today&apos;s repair operations.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-orange-400/20 bg-[#1F160E] px-3 py-1.5 text-xs uppercase text-orange-200">
                {profile?.role || 'Technician'}
              </span>
              <span className="rounded-full border border-white/10 bg-[#151515]/85 px-3 py-1.5 text-xs capitalize text-slate-300">
                {attendanceSummary.status}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#151515]/85 px-3 py-1.5 text-sm text-slate-300">
                <CalendarDays size={15} />
                Today · {todayLabel}
              </span>
            </div>
          </div>

          <TechnicianSummaryStrip
            assignedJobs={loading ? '...' : jobs.length}
            activeRepairs={loading ? '...' : activeRepairs.length}
            pendingDiagnosis={loading ? '...' : pendingDiagnosisJobs.length}
            readyToday={loading ? '...' : readyOrCompletedToday.length}
          />

          <div className="grid gap-3 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <ActionRequiredSection urgentJobs={urgentJobs} />
            <MyActiveJobsSection jobs={jobs} jobSlaRows={jobSlaRows} loading={loading} />
          </div>

          <TechnicianPerformanceCharts jobs={jobs} profile={profile} />
        </div>

        <aside className="space-y-3 xl:col-span-4 2xl:col-span-3">
          <AttendanceCard userData={profile} />
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-1">
            <TechnicianScheduleSection schedules={todaySchedules} />
            <TechnicianNotificationsMini notices={latestNotices} />
          </div>
        </aside>
      </div>

      <div className="grid gap-3 xl:col-span-12 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-6 2xl:col-span-6">
          <AttendanceHistory userData={profile} />
        </div>

        <div className="min-w-0 xl:col-span-6 2xl:col-span-6">
          <TechnicianPayslipCard userData={profile} />
        </div>
      </div>

      <BranchChatWidget userData={profile} />
    </section>
  );
}

export default function DashboardPage() {
  const { profile } = useUser();
  const { jobs, loading } = useJobs(profile?.role ? profile : null);
  const [partsOrders, setPartsOrders] = useState<PartsOrder[]>([]);
  const canViewAttendanceOverview = can(profile?.role, 'attendance.view.all');
  const slaSummary = useMemo(() => {
    return jobs.reduce(
      (summary, job) => {
        const jobSla = calculateJobSla(job, partsOrders.filter((order) => order.jobId === job.docId));
        if (jobSla.status === 'overdue') summary.overdue += 1;
        if (jobSla.status === 'warning') summary.warning += 1;
        return summary;
      },
      { overdue: 0, warning: 0 },
    );
  }, [jobs, partsOrders]);
  const activeRepairCount = useMemo(
    () => jobs.filter(isActiveRepair).length,
    [jobs],
  );
  const readyForPickupCount = useMemo(
    () => jobs.filter(isReadyForPickup).length,
    [jobs],
  );

  useEffect(() => {
    let cancelled = false;
    if (!profile?.role) return;

    getPartsOrdersForUser(profile)
      .then((orders) => {
        if (!cancelled) setPartsOrders(orders);
      })
      .catch((error) => {
        console.error('Unable to load parts orders for SLA dashboard', error);
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const todayLabel = new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  if (isTechnician(profile?.role)) {
    return (
      <TechnicianDashboard
        profile={profile}
        jobs={jobs}
        loading={loading}
        partsOrders={partsOrders}
        todayLabel={todayLabel}
      />
    );
  }

  return (
    <section className="grid gap-3 xl:grid-cols-12">
      <div className="grid items-stretch gap-3 xl:col-span-12 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 xl:col-span-8 2xl:col-span-9">
          <div className="flex min-h-[112px] flex-col justify-between gap-3 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.12),transparent_34%),linear-gradient(145deg,rgba(22,22,22,0.98),rgba(8,8,8,0.98))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.40)] backdrop-blur-xl lg:flex-row lg:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[#F97316]">Command Center</div>
              <h1 className="mt-1.5 text-2xl font-semibold text-white sm:text-3xl">Welcome back, {profile?.displayName || 'Unknown User'}</h1>
              <p className="mt-0.5 text-sm text-slate-400">Role-based Genius Advanced workspace.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-orange-400/20 bg-[#1F160E] px-3 py-1.5 text-xs uppercase text-orange-200">
                {profile?.role || 'Pending profile'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#151515]/85 px-3 py-1.5 text-sm text-slate-300">
                <CalendarDays size={15} />
                Today · {todayLabel}
              </span>
            </div>
          </div>

          <DashboardKpiRow
            overdue={loading ? '...' : slaSummary.overdue}
            warnings={loading ? '...' : slaSummary.warning}
            activeRepairs={loading ? '...' : activeRepairCount}
            readyForPickup={loading ? '...' : readyForPickupCount}
          />

          <div className="min-h-[520px] flex-1">
            <SalesOverviewGrid jobs={jobs} />
          </div>
        </div>

        <aside className="space-y-3 xl:col-span-4 2xl:col-span-3">
          <TodayScheduleCard userData={profile} />
          <AttendanceCard userData={profile} />
          <QuickActionsCard />
        </aside>
      </div>

      <div className="grid gap-3 xl:col-span-12 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-6 2xl:col-span-6">
          <RepairQueueCard jobs={jobs} partsOrders={partsOrders} loading={loading} />
        </div>

        <div className="min-w-0 xl:col-span-3 2xl:col-span-3">
          <AttendanceHistory userData={profile} />
        </div>

        {canViewAttendanceOverview ? (
          <div className="min-w-0 xl:col-span-3 2xl:col-span-3">
            <AttendanceOverview />
          </div>
        ) : null}
      </div>

      <div className="xl:col-span-12">
        <TodayFocusCard
          userData={profile}
          overdueJobs={loading ? '...' : slaSummary.overdue}
          slaWarnings={loading ? '...' : slaSummary.warning}
        />
      </div>

      <BranchChatWidget userData={profile} />
    </section>
  );
}
