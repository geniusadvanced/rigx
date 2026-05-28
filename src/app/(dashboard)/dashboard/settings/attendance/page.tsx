'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  getAttendanceLocationSettings,
  getBranchSettings,
  saveAttendanceLocationSettings,
} from '@/features/settings/services/settingsService';
import type { AttendanceLocationSettings, BranchSettings } from '@/features/settings/types';
import { useUser } from '@/lib/hooks/useUser';
import { isAdmin } from '@/lib/rbac/can';

const emptyAttendanceSettings: AttendanceLocationSettings = {
  branchId: '',
  latitude: null,
  longitude: null,
  radiusInMeters: 500,
  clockInEnabled: true,
  allowOutsideRadiusWithReason: false,
  requireSelfie: false,
};

function numberValue(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseRequiredNumber(value: string): number | null {
  if (!value.trim()) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NaN;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

export default function AttendanceSettingsPage() {
  const { profile, loading } = useUser();
  const [branches, setBranches] = useState<BranchSettings[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [form, setForm] = useState<AttendanceLocationSettings>(emptyAttendanceSettings);
  const [pageLoading, setPageLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedBranch = useMemo(() => branches.find((branch) => branch.branchId === selectedBranchId), [branches, selectedBranchId]);

  useEffect(() => {
    let cancelled = false;
    getBranchSettings()
      .then((rows) => {
        if (cancelled) return;
        setBranches(rows);
        const firstBranch = rows[0]?.branchId || '';
        setSelectedBranchId(firstBranch);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load branches');
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedBranchId) {
      setForm(emptyAttendanceSettings);
      return;
    }

    getAttendanceLocationSettings(selectedBranchId)
      .then((settings) => {
        if (cancelled) return;
        setForm({
          ...emptyAttendanceSettings,
          ...settings,
          branchId: selectedBranchId,
          latitude: settings.latitude ?? selectedBranch?.latitude ?? null,
          longitude: settings.longitude ?? selectedBranch?.longitude ?? null,
          radiusInMeters: settings.radiusInMeters ?? selectedBranch?.radiusInMeters ?? 500,
        });
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load attendance settings');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBranch, selectedBranchId]);

  async function locateBranch() {
    setLocating(true);
    setMessage('');
    try {
      const position = await getCurrentPosition();
      setForm((current) => ({
        ...current,
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
      }));
      setMessage('Current GPS location captured. Review the values before saving.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to capture GPS location');
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !isAdmin(profile.role)) return;
    setSaving(true);
    setMessage('');
    try {
      await saveAttendanceLocationSettings(form, profile);
      setMessage('Attendance location settings saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save attendance settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading || pageLoading) return <div className="text-sm text-zinc-400">Loading attendance settings</div>;
  if (!isAdmin(profile?.role)) return <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Attendance / Clock-In Location</h2>
        <p className="mt-2 text-sm text-zinc-400">Store branch clock-in GPS settings. Existing attendance fallback behavior is not replaced in Phase 1.</p>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#111111] p-3 text-sm text-zinc-300">{message}</div> : null}

      {branches.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          No branch documents exist yet. Create a branch before saving attendance location settings.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-2xl border border-white/10 bg-[#151515]/90 p-5 md:grid-cols-2">
        <label className="block text-sm text-zinc-300 md:col-span-2">
          Branch
          <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            {branches.map((branch) => (
              <option key={branch.branchId} value={branch.branchId}>
                {branch.name || branch.displayName || branch.branchId}
              </option>
            ))}
          </select>
        </label>

        {selectedBranch && (selectedBranch.latitude === null || selectedBranch.longitude === null) ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100 md:col-span-2">
            This branch has no GPS saved in Branch Settings. You can capture and save it here without affecting existing attendance fallback logic.
          </div>
        ) : null}

        <label className="block text-sm text-zinc-300">
          Latitude
          <input required type="number" step="any" value={numberValue(form.latitude)} onChange={(event) => setForm((current) => ({ ...current, latitude: parseRequiredNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Longitude
          <input required type="number" step="any" value={numberValue(form.longitude)} onChange={(event) => setForm((current) => ({ ...current, longitude: parseRequiredNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <label className="block text-sm text-zinc-300">
          Radius In Meters
          <input required type="number" min="1" value={numberValue(form.radiusInMeters)} onChange={(event) => setForm((current) => ({ ...current, radiusInMeters: parseRequiredNumber(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={locateBranch} disabled={locating} className="rounded-xl border border-orange-500/30 px-4 py-2 text-sm font-semibold text-orange-200 disabled:opacity-60">
            {locating ? 'Locating...' : 'Locate Branch'}
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={form.clockInEnabled} onChange={(event) => setForm((current) => ({ ...current, clockInEnabled: event.target.checked }))} />
          Clock-In Enabled
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={form.allowOutsideRadiusWithReason} onChange={(event) => setForm((current) => ({ ...current, allowOutsideRadiusWithReason: event.target.checked }))} />
          Allow Outside Radius With Reason
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={form.requireSelfie} onChange={(event) => setForm((current) => ({ ...current, requireSelfie: event.target.checked }))} />
          Require Selfie
        </label>
        <div className="md:col-span-2">
          <button disabled={saving || !selectedBranchId} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Clock-In Location'}
          </button>
        </div>
      </form>
    </div>
  );
}
