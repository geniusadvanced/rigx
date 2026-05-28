'use client';

import Link from 'next/link';
import { useUser } from '@/lib/hooks/useUser';
import { isAdmin } from '@/lib/rbac/can';

const phaseOneCards = [
  {
    href: '/dashboard/settings/company',
    title: 'Company Profile',
    description: 'Store company identity, contact, and bank details for future use.',
  },
  {
    href: '/dashboard/settings/branches',
    title: 'Branch Settings',
    description: 'Manage branch records, contact details, operating hours, and active status.',
  },
  {
    href: '/dashboard/settings/attendance',
    title: 'Attendance / Clock-In Location',
    description: 'Capture branch GPS coordinates and radius settings without forcing attendance changes.',
  },
];

export default function SettingsPage() {
  const { profile, loading } = useUser();

  if (loading) return <div className="text-sm text-zinc-400">Loading settings</div>;

  if (!isAdmin(profile?.role)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">
        Access denied. Settings are admin-only.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Phase 1 Settings</h2>
        <p className="mt-2 text-sm text-zinc-400">
          These settings are stored independently and do not replace existing job, POS, payroll, leave, warranty, commission, partner, or role logic.
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {phaseOneCards.map((card) => (
          <Link key={card.href} href={card.href} className="block rounded-2xl border border-white/10 bg-[#111111]/90 p-5 hover:border-orange-500/30">
            <h3 className="font-semibold text-white">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{card.description}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
        Existing RIGX modules continue using their current fallback values if settings are empty or missing.
      </div>
    </div>
  );
}
