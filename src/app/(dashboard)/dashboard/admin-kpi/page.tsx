'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';
import type { Payroll } from '@/features/payroll/types';

interface KpiJob {
  docId: string;
  month?: string;
  status?: string;
  paymentStatus?: string;
  paidStatus?: string;
  customerPaymentStatus?: string;
  paymentConfirmed?: boolean;
  isPaid?: boolean;
  totalSale?: number;
  totalAmount?: number;
  amount?: number;
  commissionAmount?: number;
  technicianId?: string;
  technicianName?: string;
  branchId?: string;
  completedAt?: { toDate?: () => Date };
  paidAt?: { toDate?: () => Date };
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
}

interface TechnicianKpi {
  technicianId: string;
  technicianName: string;
  revenue: number;
  commission: number;
  jobCount: number;
}

interface BranchKpi {
  branchId: string;
  revenue: number;
  payrollCost: number;
  estimatedProfit: number;
}

interface MonthMetrics {
  revenue: number;
  payrollCost: number;
  profit: number;
}

function getCurrentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function getPreviousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(value || 0);
}

function getTimestampMonth(timestamp?: { toDate?: () => Date }): string {
  const date = timestamp?.toDate?.();
  if (!date) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function getJobMonth(job: KpiJob): string {
  return (
    job.month ||
    getTimestampMonth(job.completedAt) ||
    getTimestampMonth(job.paidAt) ||
    getTimestampMonth(job.updatedAt) ||
    getTimestampMonth(job.createdAt)
  );
}

function isCompletedPaidJob(job: KpiJob): boolean {
  const status = String(job.status || '').toLowerCase();
  const paymentStatus = String(job.paymentStatus || job.paidStatus || job.customerPaymentStatus || '').toLowerCase();
  const isCompleted = status === 'done' || status === 'completed';
  const isPaid =
    job.paymentConfirmed === true ||
    job.isPaid === true ||
    paymentStatus === 'paid' ||
    paymentStatus === 'confirmed' ||
    paymentStatus === 'payment_confirmed';

  return isCompleted && isPaid;
}

function getJobRevenue(job: KpiJob): number {
  return Number(job.totalSale ?? job.totalAmount ?? job.amount ?? 0);
}

function getChangePercent(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export default function AdminKpiPage() {
  const { profile, loading } = useUser();
  const [month, setMonth] = useState(getCurrentMonth);
  const [jobs, setJobs] = useState<KpiJob[]>([]);
  const [payrollRows, setPayrollRows] = useState<Payroll[]>([]);
  const [previousPayrollRows, setPreviousPayrollRows] = useState<Payroll[]>([]);
  const [technicianNames, setTechnicianNames] = useState<Record<string, string>>({});
  const [pageLoading, setPageLoading] = useState(false);
  const [message, setMessage] = useState('');

  const canAccess = can(profile?.role, 'adminKpi.view');

  const loadKpis = useCallback(async () => {
    if (!canAccess || !profile?.role) return;

    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadAdminKpi');
      const previousMonth = getPreviousMonth(month);
      const [jobsSnapshot, payrollSnapshot, previousPayrollSnapshot] = await Promise.all([
        getDocs(collection(db, 'jobs')),
        getDocs(query(collection(db, 'payroll'), where('month', '==', month))),
        getDocs(query(collection(db, 'payroll'), where('month', '==', previousMonth))),
      ]);

      const jobRows = jobsSnapshot.docs.map((jobDoc) => ({
          docId: jobDoc.id,
          ...(jobDoc.data() as Omit<KpiJob, 'docId'>),
        }));
      const technicianIds = Array.from(
        new Set(jobRows.map((job) => job.technicianId).filter((technicianId): technicianId is string => Boolean(technicianId))),
      );
      const technicianNameEntries = await Promise.all(
        technicianIds.map(async (technicianId) => {
          const userSnapshot = await getDoc(doc(db, 'users', technicianId));
          const userData = userSnapshot.exists() ? userSnapshot.data() : {};
          return [
            technicianId,
            typeof userData.displayName === 'string' && userData.displayName ? userData.displayName : 'Unknown User',
          ] as const;
        }),
      );
      setJobs(jobRows);
      setTechnicianNames(Object.fromEntries(technicianNameEntries));
      setPayrollRows(
        payrollSnapshot.docs.map((payrollDoc) => ({
          ...(payrollDoc.data() as Payroll),
          payrollId: payrollDoc.id,
        })),
      );
      setPreviousPayrollRows(
        previousPayrollSnapshot.docs.map((payrollDoc) => ({
          ...(payrollDoc.data() as Payroll),
          payrollId: payrollDoc.id,
        })),
      );
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadAdminKpi');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadAdminKpi');
      setMessage(error instanceof Error ? error.message : 'Unable to load KPI data');
    } finally {
      setPageLoading(false);
    }
  }, [canAccess, month, profile?.role]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  const paidCompletedJobs = useMemo(() => {
    return jobs.filter((job) => getJobMonth(job) === month && isCompletedPaidJob(job));
  }, [jobs, month]);

  const previousMonth = useMemo(() => getPreviousMonth(month), [month]);
  const previousPaidCompletedJobs = useMemo(() => {
    return jobs.filter((job) => getJobMonth(job) === previousMonth && isCompletedPaidJob(job));
  }, [jobs, previousMonth]);

  const totalRevenue = useMemo(() => {
    return paidCompletedJobs.reduce((sum, job) => sum + getJobRevenue(job), 0);
  }, [paidCompletedJobs]);

  const totalPayrollCost = useMemo(() => {
    return payrollRows.reduce((sum, payroll) => sum + Number(payroll.netSalary || 0), 0);
  }, [payrollRows]);

  const previousMetrics = useMemo<MonthMetrics>(() => {
    const revenue = previousPaidCompletedJobs.reduce((sum, job) => sum + getJobRevenue(job), 0);
    const payrollCost = previousPayrollRows.reduce((sum, payroll) => sum + Number(payroll.netSalary || 0), 0);
    return {
      revenue,
      payrollCost,
      profit: revenue - payrollCost,
    };
  }, [previousPaidCompletedJobs, previousPayrollRows]);

  const currentMetrics = useMemo<MonthMetrics>(() => {
    return {
      revenue: totalRevenue,
      payrollCost: totalPayrollCost,
      profit: totalRevenue - totalPayrollCost,
    };
  }, [totalPayrollCost, totalRevenue]);

  const changes = useMemo(() => {
    return {
      revenue: getChangePercent(currentMetrics.revenue, previousMetrics.revenue),
      payrollCost: getChangePercent(currentMetrics.payrollCost, previousMetrics.payrollCost),
      profit: getChangePercent(currentMetrics.profit, previousMetrics.profit),
    };
  }, [currentMetrics, previousMetrics]);

  const technicianRanking = useMemo<TechnicianKpi[]>(() => {
    const rows = new Map<string, TechnicianKpi>();

    paidCompletedJobs.forEach((job) => {
      const technicianId = job.technicianId || 'unassigned';
      const current = rows.get(technicianId) || {
        technicianId,
        technicianName: technicianId === 'unassigned' ? 'Unknown User' : technicianNames[technicianId] || job.technicianName || 'Unknown User',
        revenue: 0,
        commission: 0,
        jobCount: 0,
      };
      const revenue = getJobRevenue(job);
      rows.set(technicianId, {
        ...current,
        revenue: current.revenue + revenue,
        commission: current.commission + Number(job.commissionAmount || 0),
        jobCount: current.jobCount + 1,
      });
    });

    return Array.from(rows.values()).sort((left, right) => right.revenue - left.revenue);
  }, [paidCompletedJobs, technicianNames]);

  const previousTechnicianRanking = useMemo<TechnicianKpi[]>(() => {
    const rows = new Map<string, TechnicianKpi>();

    previousPaidCompletedJobs.forEach((job) => {
      const technicianId = job.technicianId || 'unassigned';
      const current = rows.get(technicianId) || {
        technicianId,
        technicianName: technicianId === 'unassigned' ? 'Unknown User' : technicianNames[technicianId] || job.technicianName || 'Unknown User',
        revenue: 0,
        commission: 0,
        jobCount: 0,
      };
      const revenue = getJobRevenue(job);
      rows.set(technicianId, {
        ...current,
        revenue: current.revenue + revenue,
        commission: current.commission + Number(job.commissionAmount || 0),
        jobCount: current.jobCount + 1,
      });
    });

    return Array.from(rows.values()).sort((left, right) => right.revenue - left.revenue);
  }, [previousPaidCompletedJobs, technicianNames]);

  const branchComparison = useMemo<BranchKpi[]>(() => {
    const rows = new Map<string, BranchKpi>();

    paidCompletedJobs.forEach((job) => {
      const branchId = job.branchId || 'unassigned';
      const current = rows.get(branchId) || {
        branchId,
        revenue: 0,
        payrollCost: 0,
        estimatedProfit: 0,
      };
      rows.set(branchId, {
        ...current,
        revenue: current.revenue + getJobRevenue(job),
      });
    });

    payrollRows.forEach((payroll) => {
      const branchId = payroll.branchId || 'unassigned';
      const current = rows.get(branchId) || {
        branchId,
        revenue: 0,
        payrollCost: 0,
        estimatedProfit: 0,
      };
      rows.set(branchId, {
        ...current,
        payrollCost: current.payrollCost + Number(payroll.netSalary || 0),
      });
    });

    return Array.from(rows.values())
      .map((row) => ({
        ...row,
        estimatedProfit: row.revenue - row.payrollCost,
      }))
      .sort((left, right) => right.revenue - left.revenue);
  }, [paidCompletedJobs, payrollRows]);

  const insightCards = useMemo(() => {
    const cards: Array<{ title: string; detail: string; tone: 'good' | 'warn' | 'neutral' }> = [];
    const topTechnician = technicianRanking[0];
    const lowestTechnician = technicianRanking[technicianRanking.length - 1];
    const previousTechnicianRevenue = new Map(previousTechnicianRanking.map((row) => [row.technicianId, row.revenue]));
    const currentTechnicianRevenue = new Map(technicianRanking.map((row) => [row.technicianId, row]));
    const technicianIds = Array.from(
      new Set([...technicianRanking.map((row) => row.technicianId), ...previousTechnicianRanking.map((row) => row.technicianId)]),
    );
    const biggestDrop = technicianIds
      .map((technicianId) => {
        const current = currentTechnicianRevenue.get(technicianId);
        const previous = previousTechnicianRanking.find((row) => row.technicianId === technicianId);
        const revenue = current?.revenue || 0;
        return {
          technicianId,
          technicianName: current?.technicianName || previous?.technicianName || 'Unknown User',
          revenue,
          commission: current?.commission || 0,
          jobCount: current?.jobCount || 0,
          drop: (previousTechnicianRevenue.get(technicianId) || 0) - revenue,
        };
      })
      .filter((row) => row.drop > 0)
      .sort((left, right) => right.drop - left.drop)[0];
    const bestBranch = [...branchComparison].sort((left, right) => right.estimatedProfit - left.estimatedProfit)[0];
    const weakestBranch = [...branchComparison].sort((left, right) => left.estimatedProfit - right.estimatedProfit)[0];
    const highestCostRatioBranch = [...branchComparison]
      .filter((branch) => branch.revenue > 0)
      .sort((left, right) => right.payrollCost / right.revenue - left.payrollCost / left.revenue)[0];

    if (changes.profit !== null && changes.profit < -10) {
      cards.push({
        title: 'Profit Drop Warning',
        detail: `Estimated profit changed ${formatPercent(changes.profit)} vs ${previousMonth}.`,
        tone: 'warn',
      });
    }

    if (changes.revenue !== null && changes.revenue > 10) {
      cards.push({
        title: 'Revenue Growth',
        detail: `Revenue increased ${formatPercent(changes.revenue)} vs ${previousMonth}.`,
        tone: 'good',
      });
    }

    if (
      changes.payrollCost !== null &&
      changes.revenue !== null &&
      changes.payrollCost > changes.revenue &&
      changes.payrollCost > 0
    ) {
      cards.push({
        title: 'Payroll Cost Anomaly',
        detail: `Payroll cost grew ${formatPercent(changes.payrollCost)}, faster than revenue at ${formatPercent(changes.revenue)}.`,
        tone: 'warn',
      });
    }

    if (topTechnician) {
      cards.push({
        title: 'Top Performer',
        detail: `${topTechnician.technicianName} generated ${formatCurrency(topTechnician.revenue)} revenue.`,
        tone: 'good',
      });
    }

    if (biggestDrop) {
      cards.push({
        title: 'Biggest Technician Drop',
        detail: `${biggestDrop.technicianName} dropped ${formatCurrency(biggestDrop.drop)} vs ${previousMonth}.`,
        tone: 'warn',
      });
    }

    if (lowestTechnician && technicianRanking.length > 1) {
      cards.push({
        title: 'Lowest Performer',
        detail: `${lowestTechnician.technicianName} generated ${formatCurrency(lowestTechnician.revenue)} revenue.`,
        tone: 'neutral',
      });
    }

    if (bestBranch) {
      cards.push({
        title: 'Best Branch',
        detail: `${bestBranch.branchId} estimated profit is ${formatCurrency(bestBranch.estimatedProfit)}.`,
        tone: 'good',
      });
    }

    if (weakestBranch && branchComparison.length > 1) {
      cards.push({
        title: 'Weakest Branch',
        detail: `${weakestBranch.branchId} estimated profit is ${formatCurrency(weakestBranch.estimatedProfit)}.`,
        tone: 'warn',
      });
    }

    if (highestCostRatioBranch) {
      const ratio = (highestCostRatioBranch.payrollCost / highestCostRatioBranch.revenue) * 100;
      cards.push({
        title: 'Highest Cost Ratio',
        detail: `${highestCostRatioBranch.branchId} payroll cost is ${ratio.toFixed(1)}% of revenue.`,
        tone: ratio > 60 ? 'warn' : 'neutral',
      });
    }

    return cards.length
      ? cards
      : [
          {
            title: 'No Insight Triggered',
            detail: 'There is not enough current and previous month activity to generate automated insights.',
            tone: 'neutral' as const,
          },
        ];
  }, [branchComparison, changes, previousMonth, previousTechnicianRanking, technicianRanking]);

  if (loading) {
    return <div className="text-sm text-slate-400">Loading KPI dashboard</div>;
  }

  if (!canAccess) {
    return <div className="text-sm text-red-300">Admin access required</div>;
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Admin KPI</h1>
          <p className="mt-1 text-sm text-slate-400">Monthly revenue, payroll cost, and profitability overview.</p>
        </div>
        <label className="block text-sm text-slate-300">
          Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-2 rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
          />
        </label>
      </div>

      {message ? <div className="mb-4 text-sm text-red-300">{message}</div> : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {insightCards.map((card) => (
          <div
            key={`${card.title}-${card.detail}`}
            className={`rounded-lg border p-4 ${
              card.tone === 'good'
                ? 'border-emerald-500/30 bg-emerald-950/20'
                : card.tone === 'warn'
                  ? 'border-amber-500/30 bg-amber-950/20'
                  : 'border-white/10 bg-[#151515]'
            }`}
          >
            <div
              className={`text-xs uppercase ${
                card.tone === 'good' ? 'text-emerald-200' : card.tone === 'warn' ? 'text-amber-200' : 'text-slate-500'
              }`}
            >
              {card.title}
            </div>
            <div className="mt-2 text-sm text-slate-200">{pageLoading ? 'Loading insight' : card.detail}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="text-xs uppercase text-slate-500">Completed Paid Revenue</div>
          <div className="mt-2 text-2xl font-semibold text-white">{pageLoading ? '...' : formatCurrency(totalRevenue)}</div>
          <div className="mt-1 text-xs text-slate-500">vs {previousMonth}: {formatPercent(changes.revenue)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="text-xs uppercase text-slate-500">Payroll Cost</div>
          <div className="mt-2 text-2xl font-semibold text-white">{pageLoading ? '...' : formatCurrency(totalPayrollCost)}</div>
          <div className="mt-1 text-xs text-slate-500">vs {previousMonth}: {formatPercent(changes.payrollCost)}</div>
        </div>
        <div className="rounded-lg border border-orange-500/25 bg-[#1F160E] p-4">
          <div className="text-xs uppercase text-orange-200">Estimated Profit</div>
          <div className="mt-2 text-2xl font-semibold text-orange-100">
            {pageLoading ? '...' : formatCurrency(totalRevenue - totalPayrollCost)}
          </div>
          <div className="mt-1 text-xs text-orange-200">vs {previousMonth}: {formatPercent(changes.profit)}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Technician Ranking</h2>
            <div className="mt-1 text-sm text-slate-400">Revenue and approved net-profit commission</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Technician</th>
                  <th className="px-3 py-2">Jobs</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Commission</th>
                </tr>
              </thead>
              <tbody>
                {technicianRanking.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      No completed paid jobs found
                    </td>
                  </tr>
                ) : null}
                {technicianRanking.map((row) => (
                  <tr key={row.technicianId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-3 py-3 text-slate-200">{row.technicianName}</td>
                    <td className="px-3 py-3 text-slate-300">{row.jobCount}</td>
                    <td className="px-3 py-3 text-slate-300">{formatCurrency(row.revenue)}</td>
                    <td className="px-3 py-3 text-orange-200">{formatCurrency(row.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Branch Comparison</h2>
            <div className="mt-1 text-sm text-slate-400">Revenue, payroll cost, estimated profit</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Payroll Cost</th>
                  <th className="px-3 py-2">Estimated Profit</th>
                </tr>
              </thead>
              <tbody>
                {branchComparison.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      No branch data found
                    </td>
                  </tr>
                ) : null}
                {branchComparison.map((row) => (
                  <tr key={row.branchId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-3 py-3 text-slate-200">{row.branchId}</td>
                    <td className="px-3 py-3 text-slate-300">{formatCurrency(row.revenue)}</td>
                    <td className="px-3 py-3 text-slate-300">{formatCurrency(row.payrollCost)}</td>
                    <td className={`px-3 py-3 ${row.estimatedProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatCurrency(row.estimatedProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
