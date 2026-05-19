'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveRequest,
  getAllLeaveRequests,
  getMyLeaveRequests,
  rejectLeaveRequest,
} from '@/features/leaves/services/leaveService';
import {
  calculateLeaveBalance,
  entitlementTypes,
  getAllLeaveEntitlements,
  saveLeaveEntitlement,
} from '@/features/leaves/services/leaveEntitlementService';
import type { LeaveBalance, LeaveEntitlement, LeaveRequest, LeaveType } from '@/features/leaves/types';
import { LeaveBalanceCard } from '@/features/leaves/components/LeaveBalanceCard';
import { TechnicianPayslipCard } from '@/features/payroll/components/TechnicianPayslipCard';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

const leaveTypeOptions: Array<{ value: LeaveType; label: string }> = [
  { value: 'annual', label: 'Annual' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'medical', label: 'Medical' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'other', label: 'Other' },
];

const acceptedMcFileTypes = ['application/pdf', 'image/jpeg', 'image/png'];
const maxMcFileSize = 5 * 1024 * 1024;
const mcFileErrorMessage = 'Please upload a PDF, JPG, or PNG file under 5MB.';

interface UserDisplayProfile {
  displayName?: string;
  staffId?: string;
}

interface TechnicianOption {
  uid: string;
  displayName: string;
  staffId?: string;
  branchId?: string;
}

interface EntitlementFormState {
  technicianId: string;
  annual: string;
  medical: string;
  emergency: string;
  others: string;
}

function getToday(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

function getStatusClass(status: LeaveRequest['status']): string {
  if (status === 'approved') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'rejected') return 'border-red-500/40 text-red-300';
  if (status === 'cancelled') return 'border-white/15 text-slate-400';
  return 'border-amber-500/40 text-amber-300';
}

function isValidMcFile(file: File): boolean {
  return acceptedMcFileTypes.includes(file.type) && file.size <= maxMcFileSize;
}

export default function LeavesPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState(getToday);
  const [endDate, setEndDate] = useState(getToday);
  const [reason, setReason] = useState('');
  const [mcFile, setMcFile] = useState<File | null>(null);
  const [mcFileError, setMcFileError] = useState('');
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [message, setMessage] = useState('');
  const [userProfiles, setUserProfiles] = useState<Record<string, UserDisplayProfile>>({});
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, LeaveEntitlement>>({});
  const [entitlementForm, setEntitlementForm] = useState<EntitlementFormState>({
    technicianId: '',
    annual: '0',
    medical: '0',
    emergency: '0',
    others: '0',
  });
  const mcFileInputRef = useRef<HTMLInputElement | null>(null);

  const canManage = can(profile?.role, 'leaves.view.all');
  const canSubmit = can(profile?.role, 'leaves.create');
  const isMedicalLeave = leaveType === 'medical';

  const visibleLeaves = useMemo(() => {
    if (canManage) return leaves;
    return leaves.filter((leave) => leave.userId === profile?.uid);
  }, [canManage, leaves, profile?.uid]);

  const entitlementByTechnician = useMemo(() => {
    return new Map(Object.entries(entitlements));
  }, [entitlements]);

  function getUserDisplayName(userId?: string): string {
    if (!userId) return 'Unknown User';
    return userProfiles[userId]?.displayName || 'Unknown User';
  }

  function getUserStaffId(userId?: string): string {
    if (!userId) return '';
    return userProfiles[userId]?.staffId || '';
  }

  function getTechnicianDisplayName(userId?: string): string {
    if (!userId) return 'Unknown User';
    return technicians.find((technician) => technician.uid === userId)?.displayName || getUserDisplayName(userId);
  }

  function getTechnicianBalance(technicianId: string): LeaveBalance {
    const entitlement = entitlementByTechnician.get(technicianId) || {
      technicianId,
      annual: 0,
      medical: 0,
      emergency: 0,
      others: 0,
    };
    return calculateLeaveBalance(
      entitlement,
      leaves.filter((leave) => (leave.technicianId || leave.userId) === technicianId && leave.status === 'approved'),
    );
  }

  const loadTechniciansAndEntitlements = useCallback(async () => {
    if (!canManage) return;

    const techniciansQuery = query(
      collection(db, 'users'),
      where('role', '==', 'technician'),
      where('isActive', '==', true),
    );
    const [technicianSnapshot, entitlementRows] = await Promise.all([
      getDocs(techniciansQuery),
      getAllLeaveEntitlements(),
    ]);

    setTechnicians(
      technicianSnapshot.docs.map((technicianDoc) => {
        const data = technicianDoc.data();
        const displayName =
          typeof data.displayName === 'string' && data.displayName
            ? data.displayName
            : typeof data.name === 'string' && data.name
              ? data.name
              : 'Unknown User';

        return {
          uid: technicianDoc.id,
          displayName,
          staffId: typeof data.staffId === 'string' ? data.staffId : undefined,
          branchId: typeof data.branchId === 'string' ? data.branchId : undefined,
        };
      }),
    );

    setEntitlements(Object.fromEntries(entitlementRows.map((entitlement) => [entitlement.technicianId, entitlement])));
  }, [canManage]);

  const loadLeaves = useCallback(async () => {
    if (!profile?.uid || !profile.role) return;

    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadLeaves');
      const nextLeaves = canManage ? await getAllLeaveRequests() : await getMyLeaveRequests(profile.uid);
      setLeaves(nextLeaves);

      const userIds = Array.from(
        new Set(nextLeaves.map((leave) => leave.userId).filter((userId): userId is string => Boolean(userId))),
      );
      const profiles = await Promise.all(
        userIds.map(async (userId) => {
          const userSnapshot = await getDoc(doc(db, 'users', userId));
          const userData = userSnapshot.exists() ? userSnapshot.data() : {};
          return [
            userId,
            {
              displayName: typeof userData.displayName === 'string' ? userData.displayName : undefined,
              staffId: typeof userData.staffId === 'string' ? userData.staffId : undefined,
            },
          ] as const;
        }),
      );
      setUserProfiles(Object.fromEntries(profiles));
      if (canManage) {
        await loadTechniciansAndEntitlements();
      }
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadLeaves');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadLeaves');
      setMessage(error instanceof Error ? error.message : 'Unable to load leave requests');
    } finally {
      setPageLoading(false);
    }
  }, [canManage, loadTechniciansAndEntitlements, profile?.role, profile?.uid]);

  useEffect(() => {
    loadLeaves();
  }, [loadLeaves]);

  useEffect(() => {
    if (isMedicalLeave) return;
    setMcFile(null);
    setMcFileError('');
    if (mcFileInputRef.current) {
      mcFileInputRef.current.value = '';
    }
  }, [isMedicalLeave]);

  function handleMcFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setMcFileError('');

    if (!file) {
      setMcFile(null);
      return;
    }

    if (!isValidMcFile(file)) {
      setMcFile(null);
      setMcFileError(mcFileErrorMessage);
      event.target.value = '';
      return;
    }

    setMcFile(file);
  }

  async function handleSubmitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.uid || !profile?.role) {
      setMessage('Current user is not loaded');
      return;
    }

    if (isMedicalLeave && mcFile && !isValidMcFile(mcFile)) {
      setMcFileError(mcFileErrorMessage);
      return;
    }

    setActionId('create');
    setMessage('');

    try {
      await createLeaveRequest({
        userId: profile.uid,
        branchId: profile.branchId,
        startDate,
        endDate,
        leaveType,
        reason,
        createdBy: firebaseUser.uid,
        createdByRole: profile.role,
        createdByDisplayName: profile.displayName || profile.name || firebaseUser.email || 'Unknown User',
        mcFile: isMedicalLeave ? mcFile : null,
      });
      setReason('');
      setMcFile(null);
      setMcFileError('');
      if (mcFileInputRef.current) {
        mcFileInputRef.current.value = '';
      }
      setMessage('Leave request submitted');
      await loadLeaves();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit leave request');
    } finally {
      setActionId('');
    }
  }

  async function handleApprove(leaveId: string) {
    if (!firebaseUser?.uid || !profile?.role) return;

    setActionId(leaveId);
    setMessage('');

    try {
      await approveLeaveRequest({
        leaveId,
        approvedBy: firebaseUser.uid,
        approvedByRole: profile.role,
        approvedByDisplayName: profile?.displayName || profile?.name || 'Unknown User',
      });
      setMessage('Leave approved');
      await loadLeaves();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve leave');
    } finally {
      setActionId('');
    }
  }

  async function handleReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !profile?.role || !rejectingId) return;

    setActionId(rejectingId);
    setMessage('');

    try {
      await rejectLeaveRequest({
        leaveId: rejectingId,
        rejectedBy: firebaseUser.uid,
        rejectedByRole: profile.role,
        rejectedByDisplayName: profile?.displayName || profile?.name || 'Unknown User',
        rejectionReason,
      });
      setMessage('Leave rejected');
      setRejectingId('');
      setRejectionReason('');
      await loadLeaves();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject leave');
    } finally {
      setActionId('');
    }
  }

  async function handleCancel(leaveId: string) {
    if (!profile?.uid) return;

    setActionId(leaveId);
    setMessage('');

    try {
      await cancelLeaveRequest({ leaveId, userId: profile.uid });
      setMessage('Leave request cancelled');
      await loadLeaves();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to cancel leave');
    } finally {
      setActionId('');
    }
  }

  function handleSelectEntitlementTechnician(technicianId: string) {
    const entitlement = entitlementByTechnician.get(technicianId);
    setEntitlementForm({
      technicianId,
      annual: String(entitlement?.annual ?? 0),
      medical: String(entitlement?.medical ?? 0),
      emergency: String(entitlement?.emergency ?? 0),
      others: String(entitlement?.others ?? 0),
    });
  }

  async function handleSaveEntitlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseUser?.uid || !canManage) {
      setMessage('Admin or manager access required');
      return;
    }

    setActionId('entitlement');
    setMessage('');

    try {
      await saveLeaveEntitlement({
        technicianId: entitlementForm.technicianId,
        annual: Number(entitlementForm.annual),
        medical: Number(entitlementForm.medical),
        emergency: Number(entitlementForm.emergency),
        others: Number(entitlementForm.others),
        updatedBy: firebaseUser.uid,
      });
      setMessage('Leave entitlement saved');
      await loadTechniciansAndEntitlements();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save leave entitlement');
    } finally {
      setActionId('');
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading leaves</div>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Leaves</h1>
        <p className="mt-1 text-sm text-slate-400">Submit, review, and approve staff leave requests.</p>
      </div>

      {canSubmit ? (
        <div className="mb-4">
          <TechnicianPayslipCard userData={profile} />
        </div>
      ) : null}

      {canSubmit ? (
        <div className="mb-4">
          <LeaveBalanceCard userData={profile} />
        </div>
      ) : null}

      {canSubmit ? (
        <form onSubmit={handleSubmitLeave} className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Submit Leave Request</h2>
          <div className="grid gap-4 md:grid-cols-[180px_180px_180px_1fr]">
            <label className="block text-sm text-slate-300">
              Type
              <select
                value={leaveType}
                onChange={(event) => setLeaveType(event.target.value as LeaveType)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {leaveTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-slate-300">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>

            <label className="block text-sm text-slate-300">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Reason
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
          </div>

          {isMedicalLeave ? (
            <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-3">
              <label className="block text-sm text-slate-300">
                Upload MC
                <input
                  ref={mcFileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={handleMcFileChange}
                  disabled={actionId === 'create'}
                  className="mt-2 block w-full cursor-pointer rounded-md border border-white/10 bg-[#050505] text-sm text-slate-300 file:mr-3 file:border-0 file:bg-[#F97316] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <div className="mt-2 text-xs text-slate-400">
                Upload your medical certificate if available. Accepted formats: PDF, JPG, PNG.
              </div>
              {mcFile ? <div className="mt-2 text-xs text-emerald-300">Selected: {mcFile.name}</div> : null}
              {mcFileError ? <div className="mt-2 text-xs text-red-300">{mcFileError}</div> : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={actionId === 'create'}
            className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionId === 'create' ? 'Submitting' : 'Submit Leave'}
          </button>
        </form>
      ) : null}

      {message ? <div className="mb-4 text-sm text-slate-300">{message}</div> : null}

      {canManage ? (
        <div className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Leave Entitlement</h2>
          <form onSubmit={handleSaveEntitlement} className="mb-4 grid gap-4 md:grid-cols-[1fr_120px_120px_120px_120px_auto]">
            <label className="block text-sm text-slate-300">
              Technician
              <select
                value={entitlementForm.technicianId}
                onChange={(event) => handleSelectEntitlementTechnician(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                <option value="">Select technician</option>
                {technicians.map((technician) => (
                  <option key={technician.uid} value={technician.uid}>
                    {technician.displayName}
                    {technician.branchId ? ` (${technician.branchId})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {entitlementTypes.map((type) => (
              <label key={type} className="block text-sm text-slate-300">
                {type}
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={entitlementForm[type]}
                  onChange={(event) => setEntitlementForm((current) => ({ ...current, [type]: event.target.value }))}
                  required
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                />
              </label>
            ))}
            <div className="flex items-end">
              <button
                type="submit"
                disabled={actionId === 'entitlement'}
                className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionId === 'entitlement' ? 'Saving' : 'Save'}
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Technician</th>
                  <th className="px-3 py-2">Annual</th>
                  <th className="px-3 py-2">Medical</th>
                  <th className="px-3 py-2">Emergency</th>
                  <th className="px-3 py-2">Others</th>
                </tr>
              </thead>
              <tbody>
                {technicians.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      No active technicians found
                    </td>
                  </tr>
                ) : null}
                {technicians.map((technician) => {
                  const balance = getTechnicianBalance(technician.uid);
                  return (
                    <tr key={technician.uid} className="border-b border-white/10 last:border-b-0">
                      <td className="px-3 py-3 text-slate-200">
                        {getTechnicianDisplayName(technician.uid)}
                        {technician.staffId ? <div className="mt-1 text-xs text-slate-500">{technician.staffId}</div> : null}
                      </td>
                      {entitlementTypes.map((type) => (
                        <td key={type} className="px-3 py-3 text-slate-300">
                          {balance[type].used} / {type === 'annual' ? balance[type].available.toFixed(1) : balance[type].entitlement} used
                          <div className="mt-1 text-xs text-slate-500">{balance[type].remaining.toFixed(1)} remaining</div>
                          {balance[type].overused > 0 ? (
                            <div className="mt-1 text-xs text-amber-300">{balance[type].overused.toFixed(1)} overused</div>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{canManage ? 'Leave Approval' : 'My Leave History'}</h2>
          <div className="mt-1 text-sm text-slate-400">
            {pageLoading ? 'Loading leave requests' : `${visibleLeaves.length} leave requests`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">MC</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeaves.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    No leave requests found
                  </td>
                </tr>
              ) : null}

              {visibleLeaves.map((leave) => (
                <tr key={leave.leaveId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-slate-300">
                    {getUserDisplayName(leave.userId)}
                    {getUserStaffId(leave.userId) ? (
                      <div className="mt-1 text-xs text-slate-500">{getUserStaffId(leave.userId)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{leave.leaveType}</td>
                  <td className="px-3 py-3 text-slate-300">{leave.startDate}</td>
                  <td className="px-3 py-3 text-slate-300">{leave.endDate}</td>
                  <td className="px-3 py-3 text-slate-400">{leave.reason}</td>
                  <td className="px-3 py-3 text-slate-300">
                    {leave.mcFileUrl ? (
                      <div className="space-y-1">
                        <a
                          href={leave.mcFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-orange-300 hover:text-orange-200"
                        >
                          View MC
                        </a>
                        <div className="max-w-[180px] truncate text-xs text-slate-500">
                          {leave.mcFileName || 'MC uploaded'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Not uploaded</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${getStatusClass(leave.status)}`}>
                      {leave.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canManage && leave.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApprove(leave.leaveId)}
                            disabled={Boolean(actionId)}
                            className="rounded-md border border-emerald-700/60 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionId === leave.leaveId ? 'Approving' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(leave.leaveId);
                              setRejectionReason('');
                            }}
                            disabled={Boolean(actionId)}
                            className="rounded-md border border-red-700/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}

                      {!canManage && leave.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(leave.leaveId)}
                          disabled={Boolean(actionId)}
                          className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionId === leave.leaveId ? 'Cancelling' : 'Cancel'}
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

      {rejectingId ? (
        <form onSubmit={handleReject} className="mt-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Reject Leave</h2>
              <p className="mt-1 text-sm text-slate-400">Add a clear reason for the rejection.</p>
            </div>
            <button
              type="button"
              onClick={() => setRejectingId('')}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>

          <textarea
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            required
            rows={3}
            className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
          />

          <button
            type="submit"
            disabled={Boolean(actionId)}
            className="mt-4 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionId === rejectingId ? 'Rejecting' : 'Reject Leave'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
