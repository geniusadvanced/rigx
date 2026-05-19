'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { UserData } from '@/types';
import { getTechnicianNotices, getUnreadNoticeCount } from '../services/noticeService';
import type { Notice } from '../types';

interface TechnicianNoticeCardProps {
  userData: UserData | null;
}

export function TechnicianNoticeCard({ userData }: TechnicianNoticeCardProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadUnreadCount() {
      if (!userData?.uid || !userData.role || userData.role !== 'technician') return;

      setLoading(true);
      try {
        const [count, latestNotices] = await Promise.all([
          getUnreadNoticeCount(userData.uid),
          getTechnicianNotices(userData.uid),
        ]);
        if (!cancelled) {
          setUnreadCount(count);
          setNotices(latestNotices.slice(0, 3));
        }
      } catch {
        if (!cancelled) {
          setUnreadCount(0);
          setNotices([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadUnreadCount();

    return () => {
      cancelled = true;
    };
  }, [userData?.role, userData?.uid]);

  if (userData?.role !== 'technician') return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Notifications</h2>
          <div className="mt-1 text-sm text-slate-400">
            {loading ? 'Checking notices' : `${unreadCount} unread notice${unreadCount === 1 ? '' : 's'}`}
          </div>
          <div className="mt-3 inline-flex items-center rounded-full border border-orange-400/15 bg-[#1F160E] px-3 py-1 text-xs text-orange-200">
            Technician notices
          </div>
        </div>
        <Link
          href="/dashboard/notices"
          className="rounded-xl border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#1F160E]"
        >
          Open
        </Link>
      </div>

      <div className="mt-4 space-y-2">
        {notices.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/70 px-3 py-2 text-sm text-slate-500">
            No latest notices.
          </div>
        ) : null}
        {notices.map((notice) => (
          <div key={notice.noticeId} className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-sm font-medium text-white">{notice.title}</div>
              <span className="shrink-0 rounded-full border border-orange-400/20 px-2 py-0.5 text-[11px] capitalize text-orange-200">
                {notice.priority}
              </span>
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-slate-400">{notice.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
