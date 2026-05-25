'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  BriefcaseBusiness,
  Handshake,
  LayoutDashboard,
  LogOut,
  Users,
  WalletCards,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  Wrench,
  ShieldCheck,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ApprovalNotificationBell } from '@/features/notifications/ApprovalNotificationBell';
import type { Role, UserData } from '@/types';
import { signOutUser } from '@/lib/firebase/auth';
import { isAdmin, isManager } from '@/lib/rbac/can';

type SidebarItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

type SidebarSection = {
  title: string | null;
  items: SidebarItem[];
};

const technicianNavSections: SidebarSection[] = [
  {
    title: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dashboard/jobs', label: 'Jobs', icon: BriefcaseBusiness },
      { href: '/dashboard/genius-partners', label: 'Genius Partners', icon: Handshake },
    ],
  },
  {
    title: 'Human Resource',
    items: [{ href: '/dashboard/leaves', label: 'HRMS', icon: CalendarDays }],
  },
  {
    title: 'Admin',
    items: [{ href: '/dashboard/notices', label: 'Notices', icon: Bell }],
  },
];

const managerNavSections: SidebarSection[] = [
  {
    title: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dashboard/jobs', label: 'Jobs', icon: BriefcaseBusiness },
      { href: '/dashboard/customers', label: 'Customers', icon: Users },
      { href: '/dashboard/parts-orders', label: 'Parts Orders', icon: Wrench },
      { href: '/dashboard/inventory', label: 'Inventory', icon: Wrench },
      { href: '/dashboard/pos/inventory-movements', label: 'POS Inventory Movements', icon: Wrench },
      { href: '/dashboard/genius-partners', label: 'Genius Partners', icon: Handshake },
      { href: '/dashboard/warranty-claims', label: 'Warranty Claims', icon: ShieldCheck },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard/pos', label: 'POS', icon: WalletCards },
      { href: '/dashboard/pos/pricelist', label: 'Pricelist', icon: WalletCards },
      { href: '/dashboard/pos/ai-import', label: 'AI Import Pricelist', icon: WalletCards },
      { href: '/dashboard/pos/payment-submissions', label: 'Payment Submissions', icon: WalletCards },
      { href: '/dashboard/pos/commissions', label: 'POS Commissions', icon: WalletCards },
      { href: '/dashboard/pos/commission-rules', label: 'Commission Rules', icon: WalletCards },
      { href: '/dashboard/account', label: 'Finance & Accounts', icon: WalletCards },
    ],
  },
  {
    title: 'Human Resource',
    items: [{ href: '/dashboard/hrms', label: 'HRMS', icon: CalendarDays }],
  },
  {
    title: 'Admin',
    items: [
      { href: '/dashboard/notices', label: 'Notices', icon: Bell },
      { href: '/dashboard/reports', label: 'Reports', icon: ChartNoAxesCombined },
      { href: '/dashboard/audit-logs', label: 'Audit Logs', icon: ClipboardList },
    ],
  },
];

const adminNavSections: SidebarSection[] = [
  ...managerNavSections.map((section) => ({
    ...section,
    items: [...section.items],
  })),
];

adminNavSections.splice(3, 1, {
  title: 'Human Resource',
  items: [
    { href: '/dashboard/hrms', label: 'HRMS', icon: CalendarDays },
    { href: '/dashboard/admin-kpi', label: 'Admin KPI', icon: ChartNoAxesCombined },
  ],
});

adminNavSections.splice(4, 1, {
  title: 'Admin',
  items: [
    { href: '/dashboard/notices', label: 'Notices', icon: Bell },
    { href: '/dashboard/reports', label: 'Reports', icon: ChartNoAxesCombined },
    { href: '/dashboard/audit-logs', label: 'Audit Logs', icon: ClipboardList },
    { href: '/dashboard/message-templates', label: 'Message Templates', icon: ClipboardList },
  ],
});

function getNavSections(role?: Role) {
  if (isAdmin(role)) return adminNavSections;
  if (isManager(role)) return managerNavSections;
  return technicianNavSections;
}

interface DashboardShellProps {
  user: UserData | null;
  children: ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOutUser();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.08),transparent_32%),linear-gradient(135deg,#050505_0%,#080808_48%,#050505_100%)] text-zinc-100">
      <aside className="fixed inset-y-0 left-0 hidden w-[280px] p-3 md:block">
        <div className="h-full rounded-2xl border border-white/10 bg-[#0B0B0B]/95 p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-4 rounded-2xl border border-orange-500/15 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.14),transparent_45%),#151515] p-3.5 shadow-[0_0_30px_rgba(249,115,22,0.08)]">
          <div className="text-3xl font-semibold tracking-[0.18em] text-white">
            RIG<span className="bg-gradient-to-br from-[#F97316] via-[#FB923C] to-[#E11D48] bg-clip-text text-transparent">X</span>
          </div>
          <div className="mt-1.5 max-w-[190px] text-[11px] leading-4 text-zinc-400">
            Repair Intelligence & Genius experience
          </div>
        </div>

        <nav className="max-h-[calc(100vh-145px)] space-y-4 overflow-y-auto pr-1">
          {getNavSections(user?.role).map((section, sectionIndex) => (
            <div key={section.title || `primary-${sectionIndex}`} className="space-y-1">
              {section.title ? (
                <div className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                  {section.title}
                </div>
              ) : null}
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                      active
                        ? 'border border-orange-500/30 bg-gradient-to-r from-[#24140A] to-[#111111] text-orange-100 shadow-[0_0_20px_rgba(249,115,22,0.12)]'
                        : 'text-zinc-400 hover:bg-[#1F160E] hover:text-orange-100'
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        </div>
      </aside>

      <div className="md:pl-[280px]">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#080808]/90 px-4 py-3 backdrop-blur-xl md:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-xl flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
              <input
                type="search"
                placeholder="Search jobs, customers, technicians..."
                className="w-full rounded-2xl border border-white/10 bg-[#101010] py-2.5 pl-10 pr-4 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-orange-500/35 focus:shadow-[0_0_24px_rgba(249,115,22,0.10)]"
              />
            </div>
            <div className="flex items-center justify-between gap-3 lg:justify-end">
              <ApprovalNotificationBell user={user} />
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#151515]/85 px-3 py-2">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#C96A2B] to-[#7C3A14] text-sm font-semibold text-white">
                  {(user?.displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{user?.displayName || 'Unknown User'}</div>
                  <div className="text-xs uppercase text-[#D88A32]">{user?.role || 'pending profile'}</div>
                </div>
                <ChevronDown size={15} className="text-zinc-500" />
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[#151515]/85 px-3 py-2.5 text-sm text-zinc-200 hover:border-orange-500/30 hover:bg-[#1F160E]"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="p-3 md:p-5">{children}</main>
      </div>
    </div>
  );
}
