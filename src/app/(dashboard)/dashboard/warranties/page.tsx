'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getWarranties } from '@/features/pos/posService';
import type { PosWarranty } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleDateString('en-MY') || '-';
}

function warrantyStatus(warranty: PosWarranty): 'active' | 'expired' {
  return warranty.endDate?.toMillis?.() >= Date.now() ? 'active' : 'expired';
}

export default function WarrantiesPage() {
  const { profile, loading } = useUser();
  const [warranties, setWarranties] = useState<PosWarranty[]>([]);
  const [message, setMessage] = useState('');
  const canOperate = can(profile?.role, 'pos.operate');

  useEffect(() => {
    if (!profile || !canOperate) return;
    getWarranties(profile).then(setWarranties).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load warranties'));
  }, [canOperate, profile]);

  const sorted = useMemo(() => warranties.slice().sort((left, right) => (right.endDate?.toMillis?.() || 0) - (left.endDate?.toMillis?.() || 0)), [warranties]);

  if (loading) return <div className="text-sm text-zinc-400">Loading warranties</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Warranties</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">End Date</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>{sorted.map((warranty) => <tr key={warranty.warrantyId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white"><Link href={`/dashboard/warranties/${warranty.warrantyId}`} className="text-orange-200">{warranty.customerName}</Link></td><td className="px-4 py-3 text-zinc-300">{warranty.customerPhone}</td><td className="px-4 py-3 text-zinc-300">{warranty.itemName}</td><td className="px-4 py-3"><Link href={`/dashboard/pos/invoices/${warranty.invoiceId}`} className="text-orange-200">{warranty.invoiceId}</Link></td><td className="px-4 py-3 text-zinc-300">{formatDate(warranty.endDate)}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs ${warrantyStatus(warranty) === 'active' ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>{warrantyStatus(warranty)}</span></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
