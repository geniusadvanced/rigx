'use client';

import { useUser } from '@/lib/hooks/useUser';
import { isAdmin } from '@/lib/rbac/can';

export default function MessageTemplatesPage() {
  const { profile, loading } = useUser();

  if (loading) return <div className="text-sm text-zinc-400">Loading message templates</div>;

  if (!isAdmin(profile?.role)) {
    return (
      <section className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">
        Access denied
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Admin</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Message Templates</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Central template management will live here. Current customer messages are sent from each document page through
          manual WhatsApp app links, so WhatsApp Business API setup is not required for this workflow.
        </p>
      </div>
      <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5 text-sm text-zinc-400">
        No editable templates are configured yet.
      </div>
    </section>
  );
}
