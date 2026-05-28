'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  emptyCompanyProfileSettings,
  getCompanyProfileSettings,
  saveCompanyProfileSettings,
} from '@/features/settings/services/settingsService';
import type { CompanyProfileSettings } from '@/features/settings/types';
import { useUser } from '@/lib/hooks/useUser';
import { isAdmin } from '@/lib/rbac/can';

export default function CompanySettingsPage() {
  const { profile, loading } = useUser();
  const [form, setForm] = useState<CompanyProfileSettings>(emptyCompanyProfileSettings);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    getCompanyProfileSettings()
      .then((settings) => {
        if (!cancelled) setForm(settings);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load company profile');
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !isAdmin(profile.role)) return;
    setSaving(true);
    setMessage('');
    try {
      await saveCompanyProfileSettings(form, profile);
      setMessage('Company profile saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save company profile');
    } finally {
      setSaving(false);
    }
  }

  if (loading || pageLoading) return <div className="text-sm text-zinc-400">Loading company profile</div>;
  if (!isAdmin(profile?.role)) return <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Company Profile</h2>
        <p className="mt-2 text-sm text-zinc-400">Saved for future document/profile use. Existing documents keep their current fallback details.</p>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#111111] p-3 text-sm text-zinc-300">{message}</div> : null}

      <div className="grid gap-4 rounded-2xl border border-white/10 bg-[#151515]/90 p-5 md:grid-cols-2">
        <label className="block text-sm text-zinc-300">
          Company Name
          <input value={form.companyName} onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Registration Number
          <input value={form.registrationNumber} onChange={(event) => setForm((current) => ({ ...current, registrationNumber: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300 md:col-span-2">
          Address
          <textarea value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Phone
          <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Email
          <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Website
          <input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Logo URL
          <input value={form.logoUrl || ''} onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Bank Name
          <input value={form.bankName} onChange={(event) => setForm((current) => ({ ...current, bankName: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Bank Account Name
          <input value={form.bankAccountName} onChange={(event) => setForm((current) => ({ ...current, bankAccountName: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Bank Account Number
          <input value={form.bankAccountNumber} onChange={(event) => setForm((current) => ({ ...current, bankAccountNumber: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <div className="md:col-span-2">
          <button disabled={saving} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Company Profile'}
          </button>
        </div>
      </div>
    </form>
  );
}
