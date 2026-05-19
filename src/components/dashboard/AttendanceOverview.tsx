'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { getAttendanceDateKey } from '@/lib/utils/attendanceDate';

interface AttendanceOverviewRecord {
  id: string;
  userId?: string;
  displayName?: string;
  staffId?: string;
  branchId?: string;
  status?: 'present' | 'half_day' | 'late';
  crossBranchAttendance?: boolean;
  clockIn?: {
    timestamp?: { toDate?: () => Date };
  };
  clockOut?: {
    timestamp?: { toDate?: () => Date };
  };
}

interface UserProfileSummary {
  displayName?: string;
  staffId?: string;
}

function formatTime(timestamp?: { toDate?: () => Date }): string {
  if (!timestamp?.toDate) return '-';

  return new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp.toDate());
}

export function AttendanceOverview() {
  const [records, setRecords] = useState<AttendanceOverviewRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAttendance() {
      setLoading(true);
      setError('');

      try {
        const today = getAttendanceDateKey();
        const attendanceQuery = query(collection(db, 'attendance'), where('date', '==', today));
        const snapshot = await getDocs(attendanceQuery);
        const attendanceRecords = snapshot.docs.map((recordDoc) => ({
          id: recordDoc.id,
          ...(recordDoc.data() as Omit<AttendanceOverviewRecord, 'id'>),
        }));
        const userIds = Array.from(
          new Set(attendanceRecords.map((record) => record.userId).filter((userId): userId is string => Boolean(userId))),
        );
        const userProfiles = new Map<string, UserProfileSummary>();

        await Promise.all(
          userIds.map(async (userId) => {
            const userSnapshot = await getDoc(doc(db, 'users', userId));
            if (!userSnapshot.exists()) return;

            const userData = userSnapshot.data() as UserProfileSummary;
            userProfiles.set(userId, {
              displayName: userData.displayName,
              staffId: userData.staffId,
            });
          }),
        );

        if (!cancelled) {
          setRecords(
            attendanceRecords.map((record) => ({
              ...record,
              displayName: record.userId ? userProfiles.get(record.userId)?.displayName : undefined,
              staffId: record.userId ? userProfiles.get(record.userId)?.staffId : undefined,
            })),
          );
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unable to load attendance overview');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAttendance();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
        <h2 className="text-lg font-semibold text-white">Today&apos;s Attendance</h2>
        <div className="mt-1 text-sm text-slate-400">Manager overview</div>
        </div>
        <span className="rounded-full border border-orange-400/15 bg-[#1F160E] px-3 py-1 text-xs text-orange-200">
          {records.length} staff
        </span>
      </div>

      {loading ? <div className="text-sm text-slate-400">Loading attendance overview</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error && records.length === 0 ? (
        <div className="text-sm text-slate-400">No attendance records for today</div>
      ) : null}

      {!loading && !error && records.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-orange-500/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2.5 py-2">User</th>
                <th className="px-2.5 py-2">Branch</th>
                <th className="px-2.5 py-2">Clock In</th>
                <th className="px-2.5 py-2">Clock Out</th>
                <th className="px-2.5 py-2">Status</th>
                <th className="px-2.5 py-2">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const missingClockOut = !record.clockOut?.timestamp;
                const isHalfDay = record.status === 'half_day';
                const isLate = record.status === 'late';

                return (
                  <tr key={record.id} className="border-b border-slate-800/70 transition-colors last:border-b-0 hover:bg-[#1A1A1A]/60">
                    <td className="px-2.5 py-2.5">
                      <div className="text-slate-200">{record.displayName || 'Unknown User'}</div>
                      {record.staffId ? <div className="mt-1 text-xs text-slate-500">{record.staffId}</div> : null}
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-300">{record.branchId || '-'}</td>
                    <td className="px-2.5 py-2.5 text-slate-300">{formatTime(record.clockIn?.timestamp)}</td>
                    <td className={`px-2.5 py-2.5 ${missingClockOut ? 'text-amber-300' : 'text-slate-300'}`}>
                      {missingClockOut ? 'No clock out' : formatTime(record.clockOut?.timestamp)}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs ${
                          isHalfDay || isLate
                            ? 'border-amber-500/40 text-amber-300'
                            : 'border-slate-700/80 text-slate-300'
                        }`}
                      >
                        {record.status || '-'}
                      </span>
                    </td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
