'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const settingsItems = [
  { href: '/dashboard/settings/company', label: 'Company Profile', enabled: true },
  { href: '/dashboard/settings/branches', label: 'Branch Settings', enabled: true },
  { href: '/dashboard/settings/attendance', label: 'Attendance / Clock-In', enabled: true },
  { href: '/dashboard/settings/working-hours', label: 'Working Hours', enabled: false },
  { href: '/dashboard/settings/roles', label: 'Roles & Permissions', enabled: false },
  { href: '/dashboard/settings/templates', label: 'Templates', enabled: false },
  { href: '/dashboard/settings/jobs', label: 'Job Settings', enabled: false },
  { href: '/dashboard/settings/pos', label: 'POS Settings', enabled: false },
  { href: '/dashboard/settings/commission', label: 'Commission Settings', enabled: false },
  { href: '/dashboard/settings/hr-leave', label: 'HR / Leave', enabled: false },
  { href: '/dashboard/settings/payroll', label: 'Payroll', enabled: false },
  { href: '/dashboard/settings/partners', label: 'Partner Settings', enabled: false },
  { href: '/dashboard/settings/notifications', label: 'Notification Settings', enabled: false },
  { href: '/dashboard/settings/system', label: 'System Settings', enabled: false },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <section className="space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Admin</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Central settings are being introduced safely. Phase 1 stores company, branch, and clock-in location settings without changing existing module behavior.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3">
          <nav className="space-y-1">
            <Link
              href="/dashboard/settings"
              className={`block rounded-xl px-3 py-2 text-sm ${
                pathname === '/dashboard/settings'
                  ? 'border border-orange-500/30 bg-[#24140A] text-orange-100'
                  : 'text-zinc-400 hover:bg-[#1F160E] hover:text-orange-100'
              }`}
            >
              Overview
            </Link>
            {settingsItems.map((item) => {
              const active = pathname === item.href;
              if (!item.enabled) {
                return (
                  <div key={item.href} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-zinc-600">
                    <span>{item.label}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase">Soon</span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-xl px-3 py-2 text-sm ${
                    active
                      ? 'border border-orange-500/30 bg-[#24140A] text-orange-100'
                      : 'text-zinc-400 hover:bg-[#1F160E] hover:text-orange-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
