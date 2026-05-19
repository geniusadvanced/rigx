'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuditLogs } from '@/features/audit/services/auditLogService';
import type { AuditEntityType, AuditLog } from '@/features/audit/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

const entityTypeOptions: Array<{ value: AuditEntityType | 'all'; label: string }> = [
  { value: 'all', label: 'All entities' },
  { value: 'job', label: 'Jobs' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'leave', label: 'Leave' },
  { value: 'partner_job', label: 'Partner Jobs' },
  { value: 'customer', label: 'Customers' },
  { value: 'device', label: 'Devices' },
  { value: 'parts_order', label: 'Parts Orders' },
];

function formatTimestamp(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return date.toLocaleString('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function dateKey(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function humanize(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') {
      return formatTimestamp(value as { toDate?: () => Date });
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function badgeClass(entityType: AuditEntityType): string {
  if (entityType === 'payroll') return 'border-amber-500/35 text-amber-300';
  if (entityType === 'leave') return 'border-emerald-500/40 text-emerald-300';
  if (entityType === 'partner_job') return 'border-orange-500/30 text-orange-200';
  return 'border-orange-500/30 text-orange-200';
}

export default function AuditLogsPage() {
  const { profile, loading } = useUser();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<AuditEntityType | 'all'>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [userFilter, setUserFilter] = useState('all');

  const canReadAuditLogs = can(profile?.role, 'auditLogs.view');

  const loadLogs = useCallback(async () => {
    if (!canReadAuditLogs || !profile?.role) return;

    setPageLoading(true);
    setMessage('');

    try {
      setLogs(await getAuditLogs(profile.role));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load audit logs');
    } finally {
      setPageLoading(false);
    }
  }, [canReadAuditLogs, profile?.role]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const userOptions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.changedByDisplayName || 'Unknown User'))).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesEntity = entityTypeFilter === 'all' || log.entityType === entityTypeFilter;
      const matchesDate = !dateFilter || dateKey(log.createdAt) === dateFilter;
      const matchesUser = userFilter === 'all' || (log.changedByDisplayName || 'Unknown User') === userFilter;
      return matchesEntity && matchesDate && matchesUser;
    });
  }, [dateFilter, entityTypeFilter, logs, userFilter]);

  if (loading) {
    return <div className="text-sm text-slate-400">Loading audit logs</div>;
  }

  if (!canReadAuditLogs) {
    return (
      <section className="rounded-md border border-white/10 bg-[#151515] p-6">
        <h1 className="text-xl font-semibold text-white">Audit Logs</h1>
        <p className="mt-2 text-sm text-slate-400">Admin or manager access is required.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-400">Critical system actions with before and after changes.</p>
      </div>

      <div className="mb-4 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-4">
        <select
          value={entityTypeFilter}
          onChange={(event) => setEntityTypeFilter(event.target.value as AuditEntityType | 'all')}
          className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
        >
          {entityTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(event) => setDateFilter(event.target.value)}
          className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
        />
        <select
          value={userFilter}
          onChange={(event) => setUserFilter(event.target.value)}
          className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
        >
          <option value="all">All users</option>
          {userOptions.map((displayName) => (
            <option key={displayName} value={displayName}>
              {displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={loadLogs}
          disabled={pageLoading}
          className="rounded-md border border-orange-500/30 px-3 py-2 text-sm font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
        >
          {pageLoading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {message ? <div className="mb-4 rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-300">{message}</div> : null}

      <div className="overflow-hidden rounded-md border border-white/10 bg-[#151515]">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-[#101010] text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Changed By</th>
              <th className="px-4 py-3">Changes</th>
              <th className="px-4 py-3">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredLogs.map((log) => (
              <tr key={log.auditLogId}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatTimestamp(log.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-1 text-xs ${badgeClass(log.entityType)}`}>
                    {log.entityType.replace('_', ' ')}
                  </span>
                  <div className="mt-1 text-xs text-slate-500">{log.entityId}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{log.action.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-slate-300">{log.changedByDisplayName || 'Unknown User'}</td>
                <td className="px-4 py-3 text-slate-300">
                  <div className="space-y-1">
                    {(log.changes || []).map((change, index) => (
                      <div key={`${log.auditLogId}-${change.field}-${index}`} className="text-xs">
                        <span className="font-medium text-slate-200">{change.field}</span>
                        <span className="text-slate-500">: </span>
                        <span>{humanize(change.before)}</span>
                        <span className="px-1 text-slate-500">-&gt;</span>
                        <span>{humanize(change.after)}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{log.note || '-'}</td>
              </tr>
            ))}
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No audit logs found
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
