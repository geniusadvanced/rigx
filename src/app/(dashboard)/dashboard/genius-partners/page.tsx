'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPartnerJob,
  deletePartnerJob,
  getPartnerJobs,
  updatePartnerJob,
} from '@/features/genius-partners/services/partnerJobService';
import { CUSTOM_GENIUS_PARTNER_VALUE, DEFAULT_GENIUS_PARTNERS } from '@/features/genius-partners/constants';
import { getDisplayJobNumber } from '@/features/jobs/services/jobService';
import type {
  PartnerHardwareChecklistInput,
  PartnerHardwareChecklistPart,
  PartnerHardwareChecklistPartInput,
  PartnerHardwareChecklistWifiCard,
  PartnerJob,
  PartnerJobFormInput,
  PartnerJobStatus,
  PartnerOutsourceType,
} from '@/features/genius-partners/types';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';
import type { Job } from '@/types';

const outsourceTypeOptions: Array<{ value: PartnerOutsourceType | 'all'; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'motherboard_repair', label: 'Motherboard Repair' },
  { value: 'data_recovery', label: 'Data Recovery' },
];

const statusOptions: Array<{ value: PartnerJobStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_parts', label: 'Waiting Parts' },
  { value: 'completed', label: 'Completed' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

const emptyHardwareChecklist: PartnerHardwareChecklistInput = {
  ram: { included: null, unitCount: null, capacity: '', type: '', notes: '' },
  ssd: { included: null, unitCount: null, capacity: '', type: '', notes: '' },
  hdd: { included: null, unitCount: null, capacity: '', type: '', notes: '' },
  wifiCard: { included: null, model: '', notes: '' },
  otherRemarks: '',
};

const emptyForm: PartnerJobFormInput = {
  sourceJobId: '',
  rigxJobNumber: '',
  geniusJobSheetNo: '',
  partnerName: DEFAULT_GENIUS_PARTNERS[0],
  partnerExternalJobId: '',
  partnerJobSheetNo: '',
  outsourceType: 'motherboard_repair',
  customerName: '',
  customerPhone: '',
  device: '',
  deviceBrand: '',
  deviceModel: '',
  deviceSerial: '',
  issueDescription: '',
  branchId: '',
  branch: '',
  assignedTechnicianId: '',
  assignedTechnicianName: '',
  sentDate: '',
  expectedReturnDate: '',
  status: 'sent',
  remarks: '',
  hardwareChecklist: emptyHardwareChecklist,
};

const ramCapacityOptions = ['4GB', '8GB', '16GB', '32GB', '64GB', 'Onboard', 'Custom'];
const ramTypeOptions = ['DDR3', 'DDR4', 'DDR5', 'LPDDR', 'Onboard', 'Unknown', 'Custom'];
const ssdCapacityOptions = ['128GB', '256GB', '512GB', '1TB', '2TB', 'Custom'];
const ssdTypeOptions = ['SATA 2.5', 'M.2 SATA', 'M.2 NVMe', 'Onboard', 'Unknown', 'Custom'];
const hddCapacityOptions = ['500GB', '1TB', '2TB', 'Custom'];
const hddTypeOptions = ['2.5 SATA', '3.5 SATA', 'Unknown', 'Custom'];

function formatTimestamp(value?: { toDate?: () => Date } | null): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return date.toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function dateInputFromTimestamp(value?: { toDate?: () => Date } | null): string {
  const date = value?.toDate?.();
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getStatusClass(status: PartnerJobStatus): string {
  if (status === 'completed' || status === 'returned') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'cancelled') return 'border-red-500/40 text-red-300';
  if (status === 'waiting_parts') return 'border-amber-500/40 text-amber-300';
  if (status === 'in_progress') return 'border-amber-500/35 text-amber-300';
  return 'border-white/15 text-slate-300';
}

function formatOutsourceType(type: PartnerOutsourceType): string {
  return type === 'motherboard_repair' ? 'Motherboard Repair' : 'Data Recovery';
}

function formatStatus(status: PartnerJobStatus): string {
  return status.replaceAll('_', ' ');
}

function isDefaultPartner(partnerName: string): boolean {
  return DEFAULT_GENIUS_PARTNERS.includes(partnerName as (typeof DEFAULT_GENIUS_PARTNERS)[number]);
}

function getJobDeviceLabel(job: Job): string {
  return job.deviceModel || job.device || '';
}

function getPartnerJobRigxNumber(job: PartnerJob): string {
  return job.rigxJobNumber || job.geniusJobSheetNo || job.partnerJobSheetNo || '-';
}

function isMotherboardPartnerJob(form: PartnerJobFormInput): boolean {
  return form.outsourceType === 'motherboard_repair' || form.partnerName.toLowerCase().includes('motherboard');
}

function searchableJobText(job: Job): string {
  return [
    getDisplayJobNumber(job),
    job.customerName,
    job.customerPhone,
    job.device,
    job.deviceBrand,
    job.deviceModel,
    job.serialNumber,
  ].filter(Boolean).join(' ').toLowerCase();
}

function formSnapshotFromJob(job: Job, current: PartnerJobFormInput): PartnerJobFormInput {
  const rigxJobNumber = getDisplayJobNumber(job);
  const deviceModel = getJobDeviceLabel(job);

  return {
    ...current,
    sourceJobId: job.docId,
    rigxJobNumber,
    geniusJobSheetNo: rigxJobNumber,
    partnerJobSheetNo: rigxJobNumber,
    customerName: job.customerName || '',
    customerPhone: job.customerPhone || '',
    device: job.device || deviceModel,
    deviceBrand: job.deviceBrand || '',
    deviceModel,
    deviceSerial: job.serialNumber || '',
    issueDescription: job.issueDescription || '',
    branchId: job.branchId || '',
    branch: job.branchId || '',
    assignedTechnicianId: job.technicianId || '',
    assignedTechnicianName: job.technicianName || '',
  };
}

function formFromPartnerJob(job: PartnerJob): PartnerJobFormInput {
  return {
    sourceJobId: job.sourceJobId || '',
    rigxJobNumber: job.rigxJobNumber || job.geniusJobSheetNo || '',
    geniusJobSheetNo: job.geniusJobSheetNo || '',
    partnerName: job.partnerName || '',
    partnerExternalJobId: job.partnerExternalJobId || '',
    partnerJobSheetNo: job.partnerJobSheetNo || '',
    outsourceType: job.outsourceType || 'motherboard_repair',
    customerName: job.customerName || '',
    customerPhone: job.customerPhone || '',
    device: job.device || job.deviceModel || '',
    deviceBrand: job.deviceBrand || '',
    deviceModel: job.deviceModel || '',
    deviceSerial: job.deviceSerial || '',
    issueDescription: job.issueDescription || '',
    branchId: job.branchId || '',
    branch: job.branch || job.branchId || '',
    assignedTechnicianId: job.assignedTechnicianId || '',
    assignedTechnicianName: job.assignedTechnicianName || '',
    sentDate: dateInputFromTimestamp(job.sentDate),
    expectedReturnDate: dateInputFromTimestamp(job.expectedReturnDate),
    status: job.status || 'sent',
    remarks: job.remarks || '',
    hardwareChecklist: job.hardwareChecklist ? {
      ram: { ...job.hardwareChecklist.ram },
      ssd: { ...job.hardwareChecklist.ssd },
      hdd: { ...job.hardwareChecklist.hdd },
      wifiCard: { ...job.hardwareChecklist.wifiCard },
      otherRemarks: job.hardwareChecklist.otherRemarks || '',
    } : emptyHardwareChecklist,
  };
}

function formatChecklistPart(label: string, part?: PartnerHardwareChecklistPart): string {
  if (!part) return `${label}: Pending`;
  if (!part.included) return `${label}: Not included`;
  const count = part.unitCount ? `${part.unitCount} unit${part.unitCount > 1 ? 's' : ''} x ` : '';
  return `${label}: ${count}${[part.capacity, part.type].filter(Boolean).join(' ')}`;
}

function formatWifiCard(part?: PartnerHardwareChecklistWifiCard): string {
  if (!part) return 'WiFi Card: Pending';
  if (!part.included) return 'WiFi Card: Not included';
  return `WiFi Card: Included${part.model ? ` (${part.model})` : ''}`;
}

export default function GeniusPartnersPage() {
  const { profile, loading } = useUser();
  const { jobs, loading: jobsLoading, error: jobsError } = useJobs(profile?.role ? profile : null);
  const [partnerJobs, setPartnerJobs] = useState<PartnerJob[]>([]);
  const [form, setForm] = useState<PartnerJobFormInput>(emptyForm);
  const [editingJobId, setEditingJobId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<PartnerOutsourceType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PartnerJobStatus | 'all'>('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');

  const canManage = profile?.role === 'admin' || profile?.role === 'manager';

  const partnerOptions = useMemo(() => {
    return Array.from(new Set([...DEFAULT_GENIUS_PARTNERS, ...partnerJobs.map((job) => job.partnerName).filter(Boolean)])).sort();
  }, [partnerJobs]);
  const partnerSelectValue = isDefaultPartner(form.partnerName) ? form.partnerName : CUSTOM_GENIUS_PARTNER_VALUE;
  const usingCustomPartner = partnerSelectValue === CUSTOM_GENIUS_PARTNER_VALUE;
  const needsHardwareChecklist = isMotherboardPartnerJob(form);
  const selectedSourceJob = useMemo(() => {
    if (!form.sourceJobId) return null;
    return jobs.find((job) => job.docId === form.sourceJobId) || null;
  }, [form.sourceJobId, jobs]);
  const filteredJobs = useMemo(() => {
    const normalizedSearch = jobSearch.trim().toLowerCase();
    const matchingJobs = normalizedSearch
      ? jobs.filter((job) => searchableJobText(job).includes(normalizedSearch))
      : jobs;

    return matchingJobs.slice(0, 50);
  }, [jobSearch, jobs]);

  const filteredPartnerJobs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return partnerJobs.filter((job) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          job.geniusJobSheetNo,
          job.rigxJobNumber,
          job.partnerExternalJobId,
          job.partnerJobSheetNo,
          job.customerName,
          job.customerPhone,
          job.deviceModel,
          job.deviceSerial,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
      const matchesType = typeFilter === 'all' || job.outsourceType === typeFilter;
      const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
      const matchesPartner = partnerFilter === 'all' || job.partnerName === partnerFilter;
      return matchesSearch && matchesType && matchesStatus && matchesPartner;
    });
  }, [partnerFilter, partnerJobs, search, statusFilter, typeFilter]);

  const loadPartnerJobs = useCallback(async () => {
    setPageLoading(true);
    setMessage('');

    try {
      setPartnerJobs(await getPartnerJobs());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load partner jobs');
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartnerJobs();
  }, [loadPartnerJobs]);

  function resetForm() {
    setForm(emptyForm);
    setEditingJobId('');
    setShowForm(false);
  }

  function updateHardwarePart(
    partKey: 'ram' | 'ssd' | 'hdd',
    patch: Partial<PartnerHardwareChecklistPartInput>,
  ) {
    setForm((current) => ({
      ...current,
      hardwareChecklist: {
        ...current.hardwareChecklist,
        [partKey]: {
          ...current.hardwareChecklist[partKey],
          ...patch,
        },
      },
    }));
  }

  function updateWifiCard(patch: Partial<PartnerHardwareChecklistInput['wifiCard']>) {
    setForm((current) => ({
      ...current,
      hardwareChecklist: {
        ...current.hardwareChecklist,
        wifiCard: {
          ...current.hardwareChecklist.wifiCard,
          ...patch,
        },
      },
    }));
  }

  function updateOtherHardwareRemarks(otherRemarks: string) {
    setForm((current) => ({
      ...current,
      hardwareChecklist: {
        ...current.hardwareChecklist,
        otherRemarks,
      },
    }));
  }

  function startEdit(job: PartnerJob) {
    setForm(formFromPartnerJob(job));
    setEditingJobId(job.partnerJobId);
    setShowForm(true);
    setMessage('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile || !canManage) {
      setMessage('Admin or manager access required');
      return;
    }

    setActionId('save');
    setMessage('');

    try {
      if (!editingJobId && !form.sourceJobId) {
        throw new Error('Select RIGX Job is required');
      }
      const partnerName = form.partnerName.trim();
      if (!partnerName) {
        throw new Error('Partner Name is required');
      }
      const payload = {
        ...form,
        partnerName,
        partnerExternalJobId: form.partnerExternalJobId.trim(),
      };

      if (editingJobId) {
        const editingJob = partnerJobs.find((job) => job.partnerJobId === editingJobId);
        if (!editingJob) throw new Error('Partner job not found');
        await updatePartnerJob(editingJob, payload, profile);
        setMessage('Partner job updated');
      } else {
        await createPartnerJob(payload, profile);
        setMessage('Partner job created');
      }
      resetForm();
      await loadPartnerJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save partner job');
    } finally {
      setActionId('');
    }
  }

  async function handleDelete(job: PartnerJob) {
    if (!canManage) return;
    const confirmed = window.confirm(`Delete partner job ${job.geniusJobSheetNo}?`);
    if (!confirmed) return;

    setActionId(`delete-${job.partnerJobId}`);
    setMessage('');

    try {
      await deletePartnerJob(job.partnerJobId);
      setMessage('Partner job deleted');
      await loadPartnerJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete partner job');
    } finally {
      setActionId('');
    }
  }

  function renderIncludedToggle(
    label: string,
    value: boolean | null,
    onChange: (included: boolean) => void,
  ) {
    return (
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onChange(true)}
            className={`rounded-md border px-3 py-2 text-xs ${value === true ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-white/10 text-slate-300 hover:bg-[#1A1A1A]'}`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange(false)}
            className={`rounded-md border px-3 py-2 text-xs ${value === false ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-white/10 text-slate-300 hover:bg-[#1A1A1A]'}`}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  function renderPartFields(
    partKey: 'ram' | 'ssd' | 'hdd',
    label: string,
    capacityOptions: string[],
    typeOptions: string[],
  ) {
    const part = form.hardwareChecklist[partKey];
    return (
      <div className="rounded-lg border border-white/10 bg-[#050505] p-4">
        {renderIncludedToggle(`Has ${label}?`, part.included, (included) => updateHardwarePart(partKey, {
          included,
          unitCount: included ? part.unitCount : null,
          capacity: included ? part.capacity : '',
          type: included ? part.type : '',
        }))}
        {part.included ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block text-sm text-slate-300">
              Unit Count
              <input
                type="number"
                min={1}
                value={part.unitCount || ''}
                onChange={(event) => updateHardwarePart(partKey, { unitCount: event.target.value ? Number(event.target.value) : null })}
                required={needsHardwareChecklist && part.included === true}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Capacity
              <input
                list={`${partKey}-capacity-options`}
                value={part.capacity}
                onChange={(event) => updateHardwarePart(partKey, { capacity: event.target.value })}
                required={needsHardwareChecklist && part.included === true}
                placeholder={label === 'RAM' ? 'Example: 8GB or onboard 8GB' : 'Example: 512GB'}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
              <datalist id={`${partKey}-capacity-options`}>
                {capacityOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </label>
            <label className="block text-sm text-slate-300">
              Type
              <input
                list={`${partKey}-type-options`}
                value={part.type}
                onChange={(event) => updateHardwarePart(partKey, { type: event.target.value })}
                required={needsHardwareChecklist && part.included === true}
                placeholder="Type or choose"
                className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
              <datalist id={`${partKey}-type-options`}>
                {typeOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </label>
          </div>
        ) : part.included === false ? (
          <div className="mt-4 rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-sm text-slate-300">Recorded as Not included.</div>
        ) : null}
        <label className="mt-4 block text-sm text-slate-300">
          {label} Notes
          <input
            value={part.notes}
            onChange={(event) => updateHardwarePart(partKey, { notes: event.target.value })}
            placeholder="Optional"
            className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
          />
        </label>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading Genius Partners</div>;
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Genius Partners</h1>
          <p className="mt-1 text-sm text-slate-400">Track outsourced motherboard repair and data recovery jobs.</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setShowForm((current) => !current);
              setEditingJobId('');
              setForm(emptyForm);
            }}
            className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C]"
          >
            {showForm ? 'Close Form' : 'Add Partner Job'}
          </button>
        ) : null}
      </div>

      {message ? <div className="mb-4 text-sm text-slate-300">{message}</div> : null}

      {canManage && showForm ? (
        <form onSubmit={handleSubmit} className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{editingJobId ? 'Edit Partner Job' : 'Create Partner Job'}</h2>
              <div className="mt-1 text-sm text-slate-400">Partner job sheet number is editable and not used as the database ID.</div>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>

          <div className="mb-4 rounded-lg border border-orange-500/20 bg-[#0B0D0F] p-4">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="space-y-3">
                <label className="block text-sm text-slate-300">
                  Select RIGX Job
                  <input
                    value={jobSearch}
                    onChange={(event) => setJobSearch(event.target.value)}
                    placeholder="Search or select existing job"
                    className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                  />
                </label>
                <select
                  value={form.sourceJobId}
                  onChange={(event) => {
                    const selectedJob = jobs.find((job) => job.docId === event.target.value);
                    setForm(selectedJob ? formSnapshotFromJob(selectedJob, form) : { ...form, sourceJobId: '' });
                  }}
                  required={!editingJobId}
                  disabled={jobsLoading || filteredJobs.length === 0}
                  className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{jobsLoading ? 'Loading jobs' : 'Search or select existing job'}</option>
                  {filteredJobs.map((job) => {
                    const jobNumber = getDisplayJobNumber(job);
                    const deviceLabel = getJobDeviceLabel(job);
                    return (
                      <option key={job.docId} value={job.docId}>
                        {jobNumber} - {job.customerName} - {deviceLabel}
                      </option>
                    );
                  })}
                </select>
                {jobsError ? <div className="text-xs text-red-300">{jobsError.message}</div> : null}
                {!editingJobId ? (
                  <div className="text-xs text-slate-500">
                    New partner jobs must be linked to an existing RIGX job. Job access follows your current dashboard permissions.
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-white/10 bg-[#050505] p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Selected Job Snapshot</div>
                <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                  <div>
                    <span className="text-slate-500">RIGX Job</span>
                    <div className="mt-1 font-medium text-white">{form.rigxJobNumber || form.geniusJobSheetNo || '-'}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Customer Phone</span>
                    <div className="mt-1 font-medium text-white">{form.customerPhone || '-'}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Branch</span>
                    <div className="mt-1 font-medium text-white">{form.branch || form.branchId || '-'}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Assigned Technician</span>
                    <div className="mt-1 font-medium text-white">{form.assignedTechnicianName || form.assignedTechnicianId || '-'}</div>
                  </div>
                </div>
                {selectedSourceJob ? (
                  <div className="mt-3 text-xs text-slate-500">Snapshot refreshed from the selected job.</div>
                ) : form.sourceJobId ? (
                  <div className="mt-3 text-xs text-slate-500">Linked job reference is saved, but the current job list did not include it.</div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">Select a job to auto-fill customer and device details.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm text-slate-300">
              RIGX Job Number
              <input
                value={form.geniusJobSheetNo}
                onChange={(event) => setForm({ ...form, geniusJobSheetNo: event.target.value, rigxJobNumber: event.target.value })}
                required
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Partner
              <select
                value={partnerSelectValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setForm({
                    ...form,
                    partnerName: nextValue === CUSTOM_GENIUS_PARTNER_VALUE ? '' : nextValue,
                  });
                }}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {DEFAULT_GENIUS_PARTNERS.map((partnerName) => (
                  <option key={partnerName} value={partnerName}>
                    {partnerName}
                  </option>
                ))}
                <option value={CUSTOM_GENIUS_PARTNER_VALUE}>Other / Custom Partner</option>
              </select>
            </label>
            {usingCustomPartner ? (
              <label className="block text-sm text-slate-300">
                Partner Name
                <input
                  value={form.partnerName}
                  onChange={(event) => setForm({ ...form, partnerName: event.target.value })}
                  required
                  placeholder="Enter partner name"
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                />
              </label>
            ) : null}
            <label className="block text-sm text-slate-300">
              Partner Job ID
              <input
                value={form.partnerExternalJobId}
                onChange={(event) => setForm({ ...form, partnerExternalJobId: event.target.value })}
                placeholder="Enter partner job ID / reference number"
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Partner Job Sheet No
              <input
                value={form.partnerJobSheetNo}
                onChange={(event) => setForm({ ...form, partnerJobSheetNo: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Outsource Type
              <select
                value={form.outsourceType}
                onChange={(event) => setForm({ ...form, outsourceType: event.target.value as PartnerOutsourceType })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {outsourceTypeOptions
                  .filter((option): option is { value: PartnerOutsourceType; label: string } => option.value !== 'all')
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Customer Name
              <input
                value={form.customerName}
                onChange={(event) => setForm({ ...form, customerName: event.target.value })}
                required
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Customer Phone
              <input
                value={form.customerPhone}
                onChange={(event) => setForm({ ...form, customerPhone: event.target.value })}
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Device
              <input
                value={form.device}
                onChange={(event) => setForm({ ...form, device: event.target.value })}
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Device Brand
              <input
                value={form.deviceBrand}
                onChange={(event) => setForm({ ...form, deviceBrand: event.target.value })}
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Device Model
              <input
                value={form.deviceModel}
                onChange={(event) => setForm({ ...form, deviceModel: event.target.value })}
                required
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Device Serial
              <input
                value={form.deviceSerial}
                onChange={(event) => setForm({ ...form, deviceSerial: event.target.value })}
                readOnly={Boolean(form.sourceJobId)}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Status
              <select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as PartnerJobStatus })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              >
                {statusOptions
                  .filter((option): option is { value: PartnerJobStatus; label: string } => option.value !== 'all')
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Sent Date
              <input
                type="date"
                value={form.sentDate}
                onChange={(event) => setForm({ ...form, sentDate: event.target.value })}
                required
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Expected Return Date
              <input
                type="date"
                value={form.expectedReturnDate}
                onChange={(event) => setForm({ ...form, expectedReturnDate: event.target.value })}
                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
              />
            </label>
          </div>

          <label className="mt-4 block text-sm text-slate-300">
            Issue Description
            <textarea
              value={form.issueDescription}
              onChange={(event) => setForm({ ...form, issueDescription: event.target.value })}
              required
              rows={3}
              readOnly={Boolean(form.sourceJobId)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35 read-only:text-slate-400"
            />
          </label>

          <label className="mt-4 block text-sm text-slate-300">
            Remarks
            <textarea
              value={form.remarks}
              onChange={(event) => setForm({ ...form, remarks: event.target.value })}
              rows={3}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>

          {needsHardwareChecklist ? (
            <div className="mt-4 rounded-lg border border-orange-500/25 bg-[#0B0D0F] p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">Internal Hardware Checklist</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Required for motherboard repair handover. Select Yes or No for every internal part before creating the partner job.
                  </p>
                </div>
                <span className="rounded-full border border-orange-500/30 px-3 py-1 text-xs font-medium text-orange-200">Mandatory</span>
              </div>
              <div className="grid gap-4">
                {renderPartFields('ram', 'RAM', ramCapacityOptions, ramTypeOptions)}
                {renderPartFields('ssd', 'SSD', ssdCapacityOptions, ssdTypeOptions)}
                {renderPartFields('hdd', 'HDD', hddCapacityOptions, hddTypeOptions)}
                <div className="rounded-lg border border-white/10 bg-[#050505] p-4">
                  {renderIncludedToggle('Has WiFi Card?', form.hardwareChecklist.wifiCard.included, (included) => updateWifiCard({
                    included,
                    model: included ? form.hardwareChecklist.wifiCard.model : '',
                  }))}
                  {form.hardwareChecklist.wifiCard.included ? (
                    <label className="mt-4 block text-sm text-slate-300">
                      WiFi Card Type / Model
                      <input
                        value={form.hardwareChecklist.wifiCard.model}
                        onChange={(event) => updateWifiCard({ model: event.target.value })}
                        placeholder="Example: Intel AX201, Realtek, unknown"
                        className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                      />
                    </label>
                  ) : form.hardwareChecklist.wifiCard.included === false ? (
                    <div className="mt-4 rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-sm text-slate-300">Recorded as Not included.</div>
                  ) : null}
                  <label className="mt-4 block text-sm text-slate-300">
                    WiFi Card Notes
                    <input
                      value={form.hardwareChecklist.wifiCard.notes}
                      onChange={(event) => updateWifiCard({ notes: event.target.value })}
                      placeholder="Optional"
                      className="mt-2 w-full rounded-md border border-white/10 bg-[#0B0D0F] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                    />
                  </label>
                </div>
                <label className="block text-sm text-slate-300">
                  Other parts / remarks
                  <textarea
                    value={form.hardwareChecklist.otherRemarks}
                    onChange={(event) => updateOtherHardwareRemarks(event.target.value)}
                    rows={3}
                    placeholder="Example: battery disconnected, screws missing, heatsink included"
                    className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
                  />
                </label>
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={actionId === 'save'}
            className="mt-4 rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionId === 'save' ? 'Saving' : editingJobId ? 'Save Changes' : 'Create Partner Job'}
          </button>
        </form>
      ) : null}

      <div className="mb-4 rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="block text-sm text-slate-300">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Job sheet, customer, model"
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as PartnerOutsourceType | 'all')}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              {outsourceTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PartnerJobStatus | 'all')}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Partner
            <select
              value={partnerFilter}
              onChange={(event) => setPartnerFilter(event.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-white outline-none focus:border-orange-500/35"
            >
              <option value="all">All partners</option>
              {partnerOptions.map((partnerName) => (
                <option key={partnerName} value={partnerName}>
                  {partnerName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#151515] p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Outsourced Jobs</h2>
          <div className="mt-1 text-sm text-slate-400">
            {pageLoading ? 'Loading partner jobs' : `${filteredPartnerJobs.length} records`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">RIGX Job Number</th>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Partner Job ID</th>
                <th className="px-3 py-2">Partner Sheet</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Hardware Checklist</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Sent</th>
                <th className="px-3 py-2">Expected</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created By</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartnerJobs.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-slate-400">
                    No partner jobs found
                  </td>
                </tr>
              ) : null}

              {filteredPartnerJobs.map((job) => (
                <tr key={job.partnerJobId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 text-slate-200">{getPartnerJobRigxNumber(job)}</td>
                  <td className="px-3 py-3 text-slate-300">{job.partnerName}</td>
                  <td className="px-3 py-3 text-slate-300">{job.partnerExternalJobId || '-'}</td>
                  <td className="px-3 py-3 text-slate-300">{job.partnerJobSheetNo}</td>
                  <td className="px-3 py-3 text-slate-300">{formatOutsourceType(job.outsourceType)}</td>
                  <td className="px-3 py-3 text-slate-300">
                    {job.outsourceType === 'motherboard_repair' ? (
                      <div className="max-w-[360px] space-y-1 text-xs">
                        <div className="font-medium text-slate-200">{job.hardwareChecklistSummary || 'Checklist pending'}</div>
                        {job.hardwareChecklist ? (
                          <>
                            <div className="text-slate-500">{formatChecklistPart('RAM', job.hardwareChecklist.ram)}</div>
                            <div className="text-slate-500">{formatChecklistPart('SSD', job.hardwareChecklist.ssd)}</div>
                            <div className="text-slate-500">{formatChecklistPart('HDD', job.hardwareChecklist.hdd)}</div>
                            <div className="text-slate-500">{formatWifiCard(job.hardwareChecklist.wifiCard)}</div>
                            {job.hardwareChecklist.otherRemarks ? <div className="text-slate-400">Remarks: {job.hardwareChecklist.otherRemarks}</div> : null}
                            <div className="text-slate-600">Checked by {job.hardwareChecklist.checkedBy || 'Unknown'} on {formatTimestamp(job.hardwareChecklist.checkedAt)}</div>
                          </>
                        ) : (
                          <div className="text-red-300">Required for motherboard repair.</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Not required</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-300">
                    {job.customerName}
                    {job.customerPhone ? <div className="mt-1 text-xs text-slate-500">{job.customerPhone}</div> : null}
                  </td>
                  <td className="px-3 py-3 text-slate-300">
                    {job.deviceBrand ? `${job.deviceBrand} ` : ''}{job.deviceModel || job.device}
                    {job.deviceSerial ? <div className="mt-1 text-xs text-slate-500">{job.deviceSerial}</div> : null}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{formatTimestamp(job.sentDate)}</td>
                  <td className="px-3 py-3 text-slate-300">{formatTimestamp(job.expectedReturnDate)}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs capitalize ${getStatusClass(job.status)}`}>
                      {formatStatus(job.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{job.createdByDisplayName || 'Unknown User'}</td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(job)}
                          className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-[#1A1A1A]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(job)}
                          disabled={actionId === `delete-${job.partnerJobId}`}
                          className="rounded-md border border-red-700/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionId === `delete-${job.partnerJobId}` ? 'Deleting' : 'Delete'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
