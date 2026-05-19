'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createStaffProfile,
  deactivateStaff,
  getStaffList,
  updateStaffProfile,
  updateStaffSalary,
} from '@/features/hr/services/hrService';
import type { EmploymentType, StaffProfile, StaffProfileCreate, StaffProfileUpdate } from '@/features/hr/types';
import type { Role } from '@/types';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdmin } from '@/lib/rbac/can';

const roleOptions: Role[] = ['admin', 'manager', 'technician'];
const preferredEmailDomain = 'geniusadvanced.com';
const employmentTypeOptions: Array<{ value: EmploymentType | ''; label: string }> = [
  { value: '', label: 'Not set' },
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'intern', label: 'Intern' },
  { value: 'contract', label: 'Contract' },
];

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(value || 0);
}

function toProfileUpdate(staff: StaffProfile): StaffProfileUpdate {
  return {
    staffId: staff.staffId || '',
    name: staff.name || staff.displayName || '',
    email: staff.email || '',
    role: staff.role,
    branchId: staff.branchId || '',
    isActive: Boolean(staff.isActive),
    phone: staff.phone || '',
    icNumber: staff.icNumber || '',
    employmentType: staff.employmentType,
  };
}

function createEmptyStaffForm(): StaffProfileCreate {
  return {
    staffId: '',
    name: '',
    email: '',
    role: 'technician',
    branchId: '',
    isActive: true,
    baseSalary: 0,
    phone: '',
    icNumber: '',
    employmentType: undefined,
    joinedAt: '',
  };
}

function isCompanyEmail(email?: string): boolean {
  return (email || '').trim().toLowerCase().endsWith(`@${preferredEmailDomain}`);
}

function getInviteStatusClass(status?: string): string {
  if (status === 'sent') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'failed') return 'border-red-500/40 text-red-300';
  if (status === 'pending') return 'border-amber-500/40 text-amber-300';
  return 'border-white/15 text-slate-400';
}

function getInviteStatusLabel(staff: StaffProfile): string {
  if (!staff.hasLogin) return 'No Login';
  if (staff.inviteEmailStatus === 'sent') return 'Invite Sent';
  if (staff.inviteEmailStatus === 'failed') return 'Failed';
  return 'Not Sent';
}

export default function StaffPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [staffRows, setStaffRows] = useState<StaffProfile[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(null);
  const [profileForm, setProfileForm] = useState<StaffProfileUpdate | null>(null);
  const [createForm, setCreateForm] = useState<StaffProfileCreate | null>(null);
  const [staffPendingLogin, setStaffPendingLogin] = useState<StaffProfile | null>(null);
  const [salaryValue, setSalaryValue] = useState('');
  const [resetPasswordLink, setResetPasswordLink] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');

  const canManage = can(profile?.role, 'hr.view');
  const canEditProfile = can(profile?.role, 'hr.manage') && isAdmin(profile?.role);
  const canEditSalary = can(profile?.role, 'hr.manage') && isAdmin(profile?.role);

  const visibleStaff = useMemo(() => {
    return canManage ? staffRows : [];
  }, [canManage, staffRows]);

  const loadStaff = useCallback(async () => {
    if (!profile?.uid || !profile.role || !canManage) return;

    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadStaff');
      setStaffRows(await getStaffList());
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadStaff');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadStaff');
      setMessage(error instanceof Error ? error.message : 'Unable to load staff profiles');
    } finally {
      setPageLoading(false);
    }
  }, [canManage, profile?.role, profile?.uid]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  function openStaff(staff: StaffProfile) {
    setSelectedStaff(staff);
    setProfileForm(toProfileUpdate(staff));
    setSalaryValue(String(staff.baseSalary || 0));
    setResetPasswordLink('');
    setMessage('');
  }

  async function handleCreateStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !createForm) {
      setMessage('Current user is not loaded');
      return;
    }

    setActionId('create');
    setMessage('');

    try {
      await createStaffProfile({
        staff: {
          ...createForm,
          baseSalary: Number(createForm.baseSalary),
          isActive: createForm.isActive ?? true,
        },
        createdBy: firebaseUser.uid,
        createdByRole: profile.role,
      });
      setCreateForm(null);
      setMessage('Staff profile created. Firebase Auth user creation was not performed.');
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create staff profile');
    } finally {
      setActionId('');
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !selectedStaff || !profileForm) {
      setMessage('Current user is not loaded');
      return;
    }

    setActionId('profile');
    setMessage('');

    try {
      await updateStaffProfile({
        uid: selectedStaff.uid,
        update: profileForm,
        updatedBy: firebaseUser.uid,
        updatedByRole: profile.role,
      });
      setMessage('Staff profile updated');
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update staff profile');
    } finally {
      setActionId('');
    }
  }

  async function handleSalarySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !selectedStaff) {
      setMessage('Current user is not loaded');
      return;
    }

    setActionId('salary');
    setMessage('');

    try {
      await updateStaffSalary({
        uid: selectedStaff.uid,
        baseSalary: Number(salaryValue),
        updatedBy: firebaseUser.uid,
        updatedByRole: profile.role,
      });
      setMessage('Staff salary updated');
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update staff salary');
    } finally {
      setActionId('');
    }
  }

  async function handleDeactivate(uid: string) {
    if (!firebaseUser?.uid || !profile?.role) return;

    setActionId(`deactivate-${uid}`);
    setMessage('');

    try {
      await deactivateStaff({ uid, deactivatedBy: firebaseUser.uid, deactivatedByRole: profile.role });
      setMessage('Staff deactivated');
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to deactivate staff');
    } finally {
      setActionId('');
    }
  }

  async function handleCreateLoginAccount(staff: StaffProfile) {
    if (!firebaseUser?.uid) {
      setMessage('Current user is not loaded');
      return;
    }

    setActionId(`create-login-${staff.uid}`);
    setMessage('');
    setResetPasswordLink('');

    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/admin/create-staff-auth', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: staff.email,
          name: staff.name || staff.displayName || staff.staffId,
          staffId: staff.staffId,
        }),
      });
      const result = (await response.json()) as {
        uid?: string;
        resetPasswordLink?: string;
        inviteEmailSent?: boolean;
        inviteEmailStatus?: 'pending' | 'sent' | 'failed';
        inviteEmailError?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || 'Unable to create login account');
      }

      setResetPasswordLink(result.inviteEmailSent ? '' : result.resetPasswordLink || '');
      setMessage(
        result.inviteEmailSent
          ? 'Login account created and invite email sent.'
          : `Login account created. Email invite was not sent: ${result.inviteEmailError || 'unknown email error'}`,
      );
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create login account');
    } finally {
      setActionId('');
      setStaffPendingLogin(null);
    }
  }

  async function handleResendInvite(staff: StaffProfile) {
    if (!firebaseUser?.uid) {
      setMessage('Current user is not loaded');
      return;
    }

    setActionId(`resend-invite-${staff.uid}`);
    setMessage('');
    setResetPasswordLink('');

    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/admin/resend-staff-invite', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          staffUid: staff.uid,
        }),
      });
      const result = (await response.json()) as {
        resetPasswordLink?: string;
        inviteEmailSent?: boolean;
        inviteEmailStatus?: 'pending' | 'sent' | 'failed';
        inviteEmailError?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || 'Unable to resend invite');
      }

      setResetPasswordLink(result.inviteEmailSent ? '' : result.resetPasswordLink || '');
      setMessage(
        result.inviteEmailSent
          ? 'Invite email resent.'
          : `Invite email was not sent: ${result.inviteEmailError || 'unknown email error'}`,
      );
      await loadStaff();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to resend invite');
    } finally {
      setActionId('');
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading staff</div>;
  }

  if (!canManage) {
    return <div className="text-sm text-red-300">Admin or manager access required</div>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">HR Staff</h1>
        <p className="mt-1 text-sm text-slate-400">Staff profile and salary settings for payroll readiness.</p>
      </div>

      {message ? <div className="mb-4 text-sm text-slate-300">{message}</div> : null}
      {resetPasswordLink ? (
        <div className="mb-4 rounded-lg border border-red-700/50 bg-red-950/20 p-4">
          <div className="text-sm font-semibold text-red-100">Invite failed. Fallback reset password link</div>
          <div className="mt-2 break-all text-sm text-red-100">{resetPasswordLink}</div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(resetPasswordLink)}
            className="mt-3 rounded-md border border-red-700/60 px-3 py-2 text-xs text-red-200 hover:bg-red-950/40"
          >
            Copy Link
          </button>
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Staff Profiles</h2>
            <div className="mt-1 text-sm text-slate-400">
              {pageLoading ? 'Loading staff profiles' : `${visibleStaff.length} staff records`}
            </div>
          </div>
          {canEditProfile ? (
            <button
              type="button"
              onClick={() => {
                setCreateForm(createEmptyStaffForm());
                setSelectedStaff(null);
                setMessage('');
              }}
              className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C]"
            >
              Add Staff
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Staff ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Salary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Invite</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaff.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    No staff profiles found
                  </td>
                </tr>
              ) : null}

              {visibleStaff.map((staff) => (
                <tr key={staff.uid} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-slate-300">{staff.staffId || '-'}</td>
                  <td className="px-3 py-3 text-slate-200">{staff.displayName || staff.name || 'Unknown User'}</td>
                  <td className="px-3 py-3 text-slate-300">{staff.email || '-'}</td>
                  <td className="px-3 py-3 text-slate-300">{staff.role}</td>
                  <td className="px-3 py-3 text-slate-300">{staff.branchId || '-'}</td>
                  <td className="px-3 py-3 text-slate-300">{formatCurrency(staff.baseSalary)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs ${
                        staff.isActive ? 'border-emerald-500/40 text-emerald-300' : 'border-white/15 text-slate-400'
                      }`}
                    >
                      {staff.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${getInviteStatusClass(staff.inviteEmailStatus)}`}>
                      {getInviteStatusLabel(staff)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openStaff(staff)}
                        className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A]"
                      >
                        View Details
                      </button>
                      {canEditProfile && staff.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(staff.uid)}
                          disabled={Boolean(actionId)}
                          className="rounded-md border border-red-700/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionId === `deactivate-${staff.uid}` ? 'Deactivating' : 'Deactivate'}
                        </button>
                      ) : null}
                      {canEditProfile && !staff.hasLogin && !staff.authUid ? (
                        <button
                          type="button"
                          onClick={() => setStaffPendingLogin(staff)}
                          disabled={Boolean(actionId) || !staff.email || !staff.staffId}
                          className="rounded-md border border-orange-500/25 px-3 py-2 text-xs text-orange-200 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionId === `create-login-${staff.uid}` ? 'Creating Login' : 'Create Login Account'}
                        </button>
                      ) : null}
                      {canEditProfile && staff.hasLogin ? (
                        <button
                          type="button"
                          onClick={() => handleResendInvite(staff)}
                          disabled={Boolean(actionId) || !staff.email || !staff.authUid}
                          className="rounded-md border border-orange-500/25 px-3 py-2 text-xs text-orange-200 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionId === `resend-invite-${staff.uid}` ? 'Resending' : 'Resend Invite'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {staffPendingLogin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050505]/80 p-4">
          <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#151515] p-5 shadow-xl">
            <div className="text-lg font-semibold text-white">Confirm Staff Email</div>
            <div className="mt-2 text-sm text-slate-300">
              Confirm this email is correct: <span className="font-medium text-white">{staffPendingLogin.email}</span>
            </div>
            {!isCompanyEmail(staffPendingLogin.email) ? (
              <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                This email is not using the preferred company domain: {preferredEmailDomain}
              </div>
            ) : null}
            <div className="mt-4 text-sm text-slate-400">
              If this email is wrong, cancel and update the staff profile email before provisioning login access.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStaffPendingLogin(null)}
                className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-[#1A1A1A]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCreateLoginAccount(staffPendingLogin)}
                disabled={Boolean(actionId)}
                className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === `create-login-${staffPendingLogin.uid}` ? 'Creating Login' : 'Confirm and Create Login'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createForm ? (
        <form onSubmit={handleCreateStaff} className="mt-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Add Staff</h2>
              <div className="mt-1 text-sm text-slate-400">Creates staff profile data only.</div>
            </div>
            <button
              type="button"
              onClick={() => setCreateForm(null)}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Staff ID
              <input
                value={createForm.staffId}
                onChange={(event) => setCreateForm({ ...createForm, staffId: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Name
              <input
                value={createForm.name}
                onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Email
              <input
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Role
              <select
                value={createForm.role}
                onChange={(event) => setCreateForm({ ...createForm, role: event.target.value as Role })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Branch
              <input
                value={createForm.branchId}
                onChange={(event) => setCreateForm({ ...createForm, branchId: event.target.value })}
                required={createForm.role === 'technician' && createForm.isActive}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Base Salary
              <input
                type="number"
                min="0"
                step="0.01"
                value={createForm.baseSalary}
                onChange={(event) => setCreateForm({ ...createForm, baseSalary: Number(event.target.value) })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Phone
              <input
                value={createForm.phone || ''}
                onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              IC Number
              <input
                value={createForm.icNumber || ''}
                onChange={(event) => setCreateForm({ ...createForm, icNumber: event.target.value })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Employment
              <select
                value={createForm.employmentType || ''}
                onChange={(event) =>
                  setCreateForm({
                    ...createForm,
                    employmentType: event.target.value ? (event.target.value as EmploymentType) : undefined,
                  })
                }
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {employmentTypeOptions.map((option) => (
                  <option key={option.value || 'none'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Joined At
              <input
                type="date"
                value={createForm.joinedAt || ''}
                onChange={(event) => setCreateForm({ ...createForm, joinedAt: event.target.value })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={createForm.isActive}
              onChange={(event) => setCreateForm({ ...createForm, isActive: event.target.checked })}
            />
            Active
          </label>

          <button
            type="submit"
            disabled={actionId === 'create'}
            className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionId === 'create' ? 'Creating Staff' : 'Create Staff Profile'}
          </button>
        </form>
      ) : null}

      {selectedStaff && profileForm ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
          <form onSubmit={handleProfileSubmit} className="rounded-lg border border-white/10 bg-[#151515] p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Staff Details</h2>
                <div className="mt-1 text-sm text-slate-400">{selectedStaff.email || selectedStaff.staffId || 'Unknown User'}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaff(null)}
                className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Staff ID
                <input
                  value={profileForm.staffId}
                  onChange={(event) => setProfileForm({ ...profileForm, staffId: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Name
                <input
                  value={profileForm.name}
                  onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Email
                <input
                  value={profileForm.email}
                  onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Role
                <select
                  value={profileForm.role}
                  onChange={(event) => setProfileForm({ ...profileForm, role: event.target.value as Role })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Branch
                <input
                  value={profileForm.branchId}
                  onChange={(event) => setProfileForm({ ...profileForm, branchId: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Employment
                <select
                  value={profileForm.employmentType || ''}
                  onChange={(event) =>
                    setProfileForm({
                      ...profileForm,
                      employmentType: event.target.value ? (event.target.value as EmploymentType) : undefined,
                    })
                  }
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                >
                  {employmentTypeOptions.map((option) => (
                    <option key={option.value || 'none'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Phone
                <input
                  value={profileForm.phone || ''}
                  onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
              <label className="block text-sm text-slate-300">
                IC Number
                <input
                  value={profileForm.icNumber || ''}
                  onChange={(event) => setProfileForm({ ...profileForm, icNumber: event.target.value })}
                  disabled={!canEditProfile}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
                />
              </label>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={profileForm.isActive}
                onChange={(event) => setProfileForm({ ...profileForm, isActive: event.target.checked })}
                disabled={!canEditProfile}
              />
              Active
            </label>

            {canEditProfile ? (
              <button
                type="submit"
                disabled={Boolean(actionId)}
                className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === 'profile' ? 'Saving Profile' : 'Save Profile'}
              </button>
            ) : null}
          </form>

          <form onSubmit={handleSalarySubmit} className="rounded-lg border border-white/10 bg-[#151515] p-4">
            <h2 className="text-lg font-semibold text-white">Salary Settings</h2>
            <p className="mt-1 text-sm text-slate-400">Admin-only payroll salary source.</p>
            <label className="mt-4 block text-sm text-slate-300">
              Base Salary
              <input
                type="number"
                min="0"
                step="0.01"
                value={salaryValue}
                onChange={(event) => setSalaryValue(event.target.value)}
                disabled={!canEditSalary}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:opacity-60"
              />
            </label>
            {canEditSalary ? (
              <button
                type="submit"
                disabled={Boolean(actionId)}
                className="mt-4 rounded-md border border-orange-500/25 px-4 py-2 text-sm text-orange-200 hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === 'salary' ? 'Saving Salary' : 'Save Salary'}
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
