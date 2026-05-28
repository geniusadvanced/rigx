'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  deactivateBranchSettings,
  getBranchSettings,
  isCoreBranchId,
  saveBranchSettings,
} from '@/features/settings/services/settingsService';
import type { BranchSettings } from '@/features/settings/types';
import { useUser } from '@/lib/hooks/useUser';
import { isAdmin } from '@/lib/rbac/can';

const emptyBranchForm: BranchSettings = {
  branchId: '',
  name: '',
  displayName: '',
  address: '',
  phone: '',
  whatsapp: '',
  email: '',
  operatingHours: '',
  latitude: null,
  longitude: null,
  radiusInMeters: 500,
  isActive: true,
  managerId: '',
};

function numberValue(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NaN;
}

export default function BranchSettingsPage() {
  const { profile, loading } = useUser();
  const [branches, setBranches] = useState<BranchSettings[]>([]);
  const [form, setForm] = useState<BranchSettings>(emptyBranchForm);
  const [editingBranchId, setEditingBranchId] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function loadBranches() {
    setPageLoading(true);
    setMessage('');
    try {
      setBranches(await getBranchSettings());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load branches');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  function editBranch(branch: BranchSettings) {
    setEditingBranchId(branch.branchId);
    setForm({ ...emptyBranchForm, ...branch });
    setMessage('');
  }

  function resetForm() {
    setEditingBranchId('');
    setForm(emptyBranchForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !isAdmin(profile.role)) return;
    setSaving(true);
    setMessage('');
    try {
      await saveBranchSettings(form, profile);
      setMessage('Branch saved');
      resetForm();
      await loadBranches();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save branch');
    } finally {
      setSaving(false);
    }
  }

  async function deactivateBranch(branch: BranchSettings) {
    if (!profile || !isAdmin(profile.role)) return;
    if (isCoreBranchId(branch.branchId)) {
      setMessage('Bangi and Cyberjaya cannot be deactivated in Phase 1 because attendance fallback depends on them.');
      return;
    }
    const confirmed = window.confirm(`Deactivate branch ${branch.branchId}? Existing records will remain linked to this branch.`);
    if (!confirmed) return;
    setSaving(true);
    setMessage('');
    try {
      await deactivateBranchSettings(branch.branchId, profile);
      setMessage('Branch deactivated');
      await loadBranches();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to deactivate branch');
    } finally {
      setSaving(false);
    }
  }

  if (loading || pageLoading) return <div className="text-sm text-zinc-400">Loading branches</div>;
  if (!isAdmin(profile?.role)) return <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Branch Settings</h2>
        <p className="mt-2 text-sm text-zinc-400">Create and maintain branch records. Core branch IDs are protected for compatibility.</p>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#111111] p-3 text-sm text-zinc-300">{message}</div> : null}

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-2xl border border-white/10 bg-[#151515]/90 p-5 md:grid-cols-2">
        <label className="block text-sm text-zinc-300">
          Branch ID
          <input
            value={form.branchId}
            onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))}
            disabled={Boolean(editingBranchId)}
            required
            placeholder="cyberjaya"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-60"
          />
        </label>
        <label className="block text-sm text-zinc-300">
          Branch Name
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Genius Advanced Cyberjaya" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Display Name
          <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Cyberjaya" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Operating Hours
          <input value={form.operatingHours} onChange={(event) => setForm((current) => ({ ...current, operatingHours: event.target.value }))} placeholder="10:00 AM - 7:00 PM" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
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
          WhatsApp
          <input value={form.whatsapp} onChange={(event) => setForm((current) => ({ ...current, whatsapp: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Email
          <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Manager ID
          <input value={form.managerId || ''} onChange={(event) => setForm((current) => ({ ...current, managerId: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Latitude
          <input type="number" step="any" value={numberValue(form.latitude)} onChange={(event) => setForm((current) => ({ ...current, latitude: parseOptionalNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Longitude
          <input type="number" step="any" value={numberValue(form.longitude)} onChange={(event) => setForm((current) => ({ ...current, longitude: parseOptionalNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Radius In Meters
          <input type="number" min="1" value={numberValue(form.radiusInMeters)} onChange={(event) => setForm((current) => ({ ...current, radiusInMeters: parseOptionalNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="flex items-center gap-2 pt-8 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={isCoreBranchId(form.branchId)}
            onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
          Active
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button disabled={saving} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving...' : editingBranchId ? 'Save Branch' : 'Create Branch'}
          </button>
          {editingBranchId ? <button type="button" onClick={resetForm} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-200">Cancel</button> : null}
        </div>
      </form>

      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5">
        <h3 className="font-semibold text-white">Branches</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">GPS</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.branchId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-zinc-300"><span className="text-white">{branch.name || branch.branchId}</span><div className="text-xs text-zinc-500">{branch.branchId}</div></td>
                  <td className="px-3 py-3 text-zinc-300">{branch.phone || branch.whatsapp || '-'}</td>
                  <td className="px-3 py-3 text-zinc-300">{branch.latitude !== null && branch.longitude !== null ? `${branch.latitude}, ${branch.longitude}` : <span className="text-amber-300">Missing GPS</span>}</td>
                  <td className="px-3 py-3 text-zinc-300">{branch.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => editBranch(branch)} className="text-orange-200">Edit</button>
                      <button type="button" onClick={() => deactivateBranch(branch)} disabled={saving || isCoreBranchId(branch.branchId) || !branch.isActive} className="text-red-300 disabled:text-zinc-600">Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
              {branches.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-500">No branch documents configured yet</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
