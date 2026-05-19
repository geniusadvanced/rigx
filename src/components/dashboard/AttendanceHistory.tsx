'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import type { UserData } from '@/types';

interface AttendanceRecord {
  id: string;
  date?: string;
  branchId?: string;
  status?: 'present' | 'half_day' | 'late';
  attendanceType?: 'full' | 'half';
  totalHours?: number;
  crossBranchAttendance?: boolean;
  clockIn?: {
    timestamp?: { toDate?: () => Date };
  };
  clockOut?: {
    timestamp?: { toDate?: () => Date };
  };
}

interface AttendanceHistoryProps {
  userData: UserData | null;
}

function formatTime(timestamp?: { toDate?: () => Date }): string {
  if (!timestamp?.toDate) return '-';

  return new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp.toDate());
}

export function AttendanceHistory({ userData }: AttendanceHistoryProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const visibleRecords = expanded ? records : records.slice(0, 3);

  useEffect(() => {
    let cancelled = false;

    async function loadAttendance() {
      if (!userData?.uid) {
        setRecords([]);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const attendanceQuery = query(
          collection(db, 'attendance'),
          where('userId', '==', userData.uid),
          orderBy('date', 'desc'),
          limit(7),
        );
        const snapshot = await getDocs(attendanceQuery);

        if (!cancelled) {
          setRecords(
            snapshot.docs.map((recordDoc) => ({
              id: recordDoc.id,
              ...(recordDoc.data() as Omit<AttendanceRecord, 'id'>),
            })),
          );
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unable to load attendance history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAttendance();

    return () => {
      cancelled = true;
    };
  }, [userData?.uid]);

  return (
    <div className="h-full rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
        <h2 className="text-lg font-semibold text-white">Attendance History</h2>
        <div className="mt-1 text-sm text-slate-400">Last 7 records</div>
        </div>
        <span className="rounded-full border border-orange-400/15 bg-[#1F160E] px-3 py-1 text-xs text-orange-200">
          {records.length} records
        </span>
      </div>

      {loading ? <div className="text-sm text-slate-400">Loading attendance history</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error && records.length === 0 ? (
        <div className="text-sm text-slate-400">No attendance records found</div>
      ) : null}

      {!loading && !error && records.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-orange-500/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2.5 py-2">Date</th>
                <th className="px-2.5 py-2">Clock In</th>
                <th className="px-2.5 py-2">Clock Out</th>
                <th className="px-2.5 py-2">Total Hours</th>
                <th className="px-2.5 py-2">Status</th>
                <th className="px-2.5 py-2">Type</th>
                <th className="px-2.5 py-2">Branch</th>
                <th className="px-2.5 py-2">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id} className="border-b border-slate-800/70 transition-colors last:border-b-0 hover:bg-[#1A1A1A]/60">
                  <td className="px-2.5 py-2.5 text-slate-200">{record.date || '-'}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{formatTime(record.clockIn?.timestamp)}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">
                    {record.clockOut?.timestamp ? formatTime(record.clockOut.timestamp) : 'Not clocked out'}
                  </td>
                  <td className="px-2.5 py-2.5 text-slate-300">{record.totalHours ?? '-'}</td>
                  <td className="px-2.5 py-2.5">
                    <span className="rounded-full border border-slate-700/80 px-2 py-1 text-xs text-slate-300">
                      {record.status || '-'}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 text-slate-300">{record.attendanceType || '-'}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{record.branchId || '-'}</td>
                  <td className="px-2.5 py-2.5">
                    {record.crossBranchAttendance ? (
                      <span className="rounded-full border border-orange-500/40 px-2 py-1 text-xs text-[#D88A32]">
                        Cross Branch
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 3 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-3 rounded-xl border border-slate-700/80 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
            >
              {expanded ? 'Collapse History' : `View More (${records.length - 3})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
