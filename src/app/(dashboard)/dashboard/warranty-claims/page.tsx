'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getJobDocumentRecords } from '@/features/job-documents/services/jobDocumentRecordService';
import type { JobDocumentRecord } from '@/features/job-documents/types';
import { getStaffList } from '@/features/hr/services/hrService';
import type { StaffProfile } from '@/features/hr/types';
import {
  canUpdateWarrantyClaim,
  getWarrantyClaimsForUser,
  updateWarrantyClaimStatus,
} from '@/features/warranty-claims/services/warrantyClaimService';
import type { WarrantyClaim, WarrantyClaimStatus } from '@/features/warranty-claims/types';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdminOrManager } from '@/lib/rbac/can';

const statusLabels: Record<WarrantyClaimStatus, string> = {
  created: 'Created',
  inspection: 'Inspection',
  approved: 'Approved',
  rejected: 'Rejected',
  in_repair: 'In Repair',
  completed: 'Completed',
};

const nextStatusLabels: Partial<Record<WarrantyClaimStatus, string>> = {
  inspection: 'Move to Inspection',
  approved: 'Approve Claim',
  rejected: 'Reject Claim',
  in_repair: 'Start Repair',
  completed: 'Mark Completed',
};

function statusClass(status: WarrantyClaimStatus): string {
  if (status === 'approved' || status === 'completed') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'rejected') return 'border-red-500/40 text-red-300';
  if (status === 'inspection' || status === 'in_repair') return 'border-orange-500/30 text-orange-200';
  return 'border-white/15 text-slate-300';
}

function formatTimestamp(value?: { toDate?: () => Date } | null): string {
  if (!value?.toDate) return '-';
  return value.toDate().toLocaleString('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getAllowedClaimActions(claim: WarrantyClaim, role?: string): WarrantyClaimStatus[] {
  if (claim.status === 'created') return ['inspection'];
  if (claim.status === 'inspection' && isAdminOrManager(role)) return ['approved', 'rejected'];
  if (claim.status === 'approved') return ['in_repair'];
  if (claim.status === 'in_repair') return ['completed'];
  return [];
}

export default function WarrantyClaimsPage() {
  const { profile, loading } = useUser();
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaim | null>(null);
  const [selectedWarranty, setSelectedWarranty] = useState<JobDocumentRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<WarrantyClaimStatus | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [actionNote, setActionNote] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const canReadClaims = can(profile?.role, 'jobs.view.assigned') || can(profile?.role, 'jobs.manageWarranty');
  const canManageClaims = can(profile?.role, 'jobs.manageWarranty');

  const loadClaims = useCallback(async () => {
    if (!profile?.role) return;
    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadWarrantyClaims');
      const nextClaims = await getWarrantyClaimsForUser(profile);
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadWarrantyClaims');
      setClaims(nextClaims);
      setSelectedClaim((current) => {
        if (!current) return current;
        return nextClaims.find((claim) => claim.claimId === current.claimId) || current;
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadWarrantyClaims');
      setMessage(error instanceof Error ? error.message : 'Unable to load warranty claims');
    } finally {
      setPageLoading(false);
    }
  }, [profile?.role, profile?.uid]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  useEffect(() => {
    let cancelled = false;
    if (!canManageClaims) return;

    getStaffList()
      .then((nextStaff) => {
        if (!cancelled) setStaff(nextStaff.filter((member) => member.role === 'technician'));
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load technicians');
      });

    return () => {
      cancelled = true;
    };
  }, [canManageClaims]);

  useEffect(() => {
    let cancelled = false;
    setSelectedWarranty(null);
    if (!selectedClaim) return;

    getJobDocumentRecords(selectedClaim.originalJobId)
      .then((records) => {
        if (cancelled) return;
        setSelectedWarranty(records.find((record) => record.documentId === selectedClaim.warrantyDocumentId) || null);
      })
      .catch((error) => {
        if (!cancelled) console.error('Unable to load warranty document for claim', error);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClaim]);

  const technicianById = useMemo(
    () => new Map(staff.map((member) => [member.uid, member.displayName || member.name || 'Unknown User'])),
    [staff],
  );

  const branchOptions = useMemo(
    () => Array.from(new Set(claims.map((claim) => claim.branchId).filter(Boolean))).sort(),
    [claims],
  );

  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      const matchesStatus = statusFilter === 'all' || claim.status === statusFilter;
      const matchesBranch = branchFilter === 'all' || claim.branchId === branchFilter;
      const matchesTechnician = technicianFilter === 'all' || claim.technicianId === technicianFilter;
      return matchesStatus && matchesBranch && matchesTechnician;
    });
  }, [branchFilter, claims, statusFilter, technicianFilter]);

  async function handleClaimAction(nextStatus: WarrantyClaimStatus) {
    if (!profile || !selectedClaim) return;

    setActionLoading(true);
    setMessage('');

    try {
      await updateWarrantyClaimStatus(selectedClaim, nextStatus, actionNote, profile);
      setMessage(`Claim updated to ${statusLabels[nextStatus]}`);
      setActionNote('');
      await loadClaims();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update warranty claim');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-400">Loading warranty claims</div>;

  if (!canReadClaims) {
    return (
      <section className="rounded-md border border-white/10 bg-[#151515] p-6">
        <h1 className="text-xl font-semibold text-white">Warranty Claims</h1>
        <p className="mt-2 text-sm text-slate-400">Sign in to view warranty claims.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Warranty Claims</h1>
          <p className="mt-1 text-sm text-slate-400">Track warranty repairs linked to original RIGX jobs.</p>
        </div>
        <button
          type="button"
          onClick={loadClaims}
          disabled={pageLoading}
          className="rounded-md border border-orange-500/30 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
        >
          {pageLoading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {message ? <div className="mb-4 rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-300">{message}</div> : null}

      <div className="mb-4 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-3">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as WarrantyClaimStatus | 'all')} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All branches</option>
          {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select>
        {canManageClaims ? (
          <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="all">All technicians</option>
            {staff.map((member) => (
              <option key={member.uid} value={member.uid}>
                {member.displayName || member.name || 'Unknown User'}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#151515]">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Original Job</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Handled By</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading claims</td></tr>
              ) : null}
              {!pageLoading && filteredClaims.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No warranty claims found</td></tr>
              ) : null}
              {filteredClaims.map((claim) => (
                <tr key={claim.claimId} className={`border-b border-white/10 last:border-b-0 ${selectedClaim?.claimId === claim.claimId ? 'bg-[#1A1A1A]/70' : ''}`}>
                  <td className="px-4 py-3 font-medium text-white">{claim.originalJobSheetNo}</td>
                  <td className="px-4 py-3 text-slate-300">{claim.customerName}</td>
                  <td className="px-4 py-3 text-slate-300">{claim.deviceBrand} {claim.deviceModel}</td>
                  <td className="px-4 py-3 capitalize text-slate-300">{claim.claimType.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(claim.status)}`}>
                      {statusLabels[claim.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {claim.handledByDisplayName || technicianById.get(claim.technicianId) || 'Unknown User'}
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelectedClaim(claim)} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1A1A1A]">
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
          {!selectedClaim ? (
            <div className="text-sm text-slate-500">Select a warranty claim to view details.</div>
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedClaim.originalJobSheetNo}</h2>
                  <p className="mt-1 text-sm text-slate-400">{selectedClaim.customerName} · {selectedClaim.deviceModel}</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(selectedClaim.status)}`}>{statusLabels[selectedClaim.status]}</span>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                  <div className="text-xs uppercase text-slate-500">Warranty Period</div>
                  <div className="mt-1 text-slate-200">
                    {formatTimestamp(selectedWarranty?.warrantyStartDate || selectedClaim.warrantyStartDate)} - {formatTimestamp(selectedWarranty?.warrantyEndDate || selectedClaim.warrantyEndDate)}
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                  <div className="text-xs uppercase text-slate-500">Claim Reason</div>
                  <div className="mt-1 text-slate-200">{selectedClaim.claimReason}</div>
                </div>
                {selectedClaim.inspectionNote ? (
                  <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                    <div className="text-xs uppercase text-slate-500">Inspection Note</div>
                    <div className="mt-1 text-slate-200">{selectedClaim.inspectionNote}</div>
                  </div>
                ) : null}
                {selectedClaim.decisionNote ? (
                  <div className="rounded-md border border-white/10 bg-[#050505] p-3">
                    <div className="text-xs uppercase text-slate-500">Decision Note</div>
                    <div className="mt-1 text-slate-200">{selectedClaim.decisionNote}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5">
                <div className="text-sm font-medium text-white">Status Timeline</div>
                <div className="mt-3 space-y-3">
                  {(selectedClaim.statusHistory || []).map((item, index) => (
                    <div key={`${item.status}-${index}`} className="rounded-md border border-white/10 bg-[#050505] p-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="font-medium text-slate-200">{statusLabels[item.status]}</div>
                        <div className="text-xs text-slate-500">{formatTimestamp(item.changedAt)}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">By {item.changedByDisplayName || 'Unknown User'}</div>
                      {item.note ? <div className="mt-2 text-slate-300">{item.note}</div> : null}
                    </div>
                  ))}
                </div>
              </div>

              {canUpdateWarrantyClaim(profile, selectedClaim) ? (
                <div className="mt-5 rounded-md border border-white/10 bg-[#050505] p-3">
                  <label className="text-xs uppercase text-slate-500">
                    Action note
                    <textarea
                      value={actionNote}
                      onChange={(event) => setActionNote(event.target.value)}
                      rows={3}
                      className="mt-2 w-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm normal-case text-white"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {getAllowedClaimActions(selectedClaim, profile?.role).map((nextStatus) => (
                      <button
                        key={nextStatus}
                        type="button"
                        onClick={() => handleClaimAction(nextStatus)}
                        disabled={actionLoading || (nextStatus === 'rejected' && !actionNote.trim())}
                        className="rounded-md border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-[#F97316]/10 disabled:opacity-60"
                      >
                        {nextStatusLabels[nextStatus]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
