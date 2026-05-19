import type { ReactNode } from 'react';
import Link from 'next/link';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  helper?: string;
  href?: string;
  actionLabel?: string;
}

export function StatCard({ label, value, icon, helper, href, actionLabel }: StatCardProps) {
  const content = (
    <div className="group rounded-2xl border border-white/10 bg-[#151515]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-orange-500/30">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
          <div className="mt-2 text-xs text-[#D88A32]">{helper || 'Live workspace metric'}</div>
          {actionLabel ? (
            <div className="mt-3 text-xs font-medium text-orange-200 group-hover:text-orange-100">{actionLabel}</div>
          ) : null}
        </div>
        {icon ? (
          <div className="rounded-2xl border border-orange-500/15 bg-[#1F160E] p-3 text-[#D88A32] shadow-[0_0_18px_rgba(249,115,22,0.10)]">
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:ring-offset-2 focus:ring-offset-slate-950">
        {content}
      </Link>
    );
  }

  return content;
}
