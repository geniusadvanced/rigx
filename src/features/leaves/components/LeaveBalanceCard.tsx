'use client';

import { useEffect, useState } from 'react';
import type { UserData } from '@/types';
import type { LeaveBalance } from '../types';
import { entitlementTypes, getMyLeaveBalance } from '../services/leaveEntitlementService';

interface LeaveBalanceCardProps {
  userData: UserData | null;
}

const labels: Record<keyof LeaveBalance, string> = {
  annual: 'Annual Leave',
  medical: 'Medical Leave',
  emergency: 'Emergency Leave',
  others: 'Others',
};

export function LeaveBalanceCard({ userData }: LeaveBalanceCardProps) {
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (!userData?.uid || userData.role !== 'technician') return;

      setLoading(true);
      setMessage('');

      try {
        const nextBalance = await getMyLeaveBalance(userData.uid);
        if (!cancelled) setBalance(nextBalance);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load leave balance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBalance();

    return () => {
      cancelled = true;
    };
  }, [userData?.role, userData?.uid]);

  if (userData?.role !== 'technician') return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-white">Leave Balance</h2>
        <div className="mt-1 text-sm text-zinc-400">{loading ? 'Loading leave balance' : 'Approved leave usage'}</div>
      </div>

      {message ? <div className="mb-3 text-sm text-red-300">{message}</div> : null}

      <div className="space-y-2">
        {entitlementTypes.map((type) => {
          const item = balance?.[type] || { entitlement: 0, available: 0, used: 0, remaining: 0, overused: 0 };
          return (
            <div key={type} className="rounded-xl border border-white/10 bg-[#1A1A1A]/80 p-3">
              <div className="text-sm font-medium text-white">{labels[type]}</div>
              <div className="mt-1 text-sm text-zinc-400">
                {item.used} / {type === 'annual' ? item.available.toFixed(1) : item.entitlement} used,{' '}
                {item.remaining.toFixed(1)} remaining
              </div>
              {type === 'annual' ? (
                <div className="mt-1 text-xs text-zinc-500">Yearly entitlement: {item.entitlement}</div>
              ) : null}
              {item.overused > 0 ? <div className="mt-1 text-xs text-amber-300">{item.overused.toFixed(1)} overused</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
