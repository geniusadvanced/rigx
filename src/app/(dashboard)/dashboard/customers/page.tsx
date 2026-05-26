'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCustomer,
  createDevice,
  getCustomers,
  getDevices,
  getJobsByIds,
  getJobsByCustomer,
  importCustomerRows,
  normalizeCustomerPhone,
  softDeleteCustomer,
  updateCustomer,
  updateDevice,
} from '@/features/customers/services/customerService';
import type { Customer, CustomerBranch, CustomerFormInput, Device, DeviceFormInput } from '@/features/customers/types';
import { findJobByReference, getReadableJobReference } from '@/features/jobs/utils/jobReference';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';
import type { Job } from '@/types';

interface ImportPreviewRow {
  fullName: string;
  phone: string;
  secondaryPhone: string;
  email: string;
  address: string;
  notes: string;
  branch: string;
  duplicateCustomerId?: string;
  invalidReason?: string;
}

const emptyCustomerForm: CustomerFormInput = {
  fullName: '',
  phone: '',
  email: '',
  address: '',
  branch: 'unknown',
};

const emptyDeviceForm: DeviceFormInput = {
  customerId: '',
  customerName: '',
  deviceType: '',
  brand: '',
  model: '',
  serialNumber: '',
  imei: '',
  notes: '',
};

function formatTimestamp(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return date.toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function customerFormFromCustomer(customer: Customer): CustomerFormInput {
  return {
    fullName: customer.fullName || '',
    phone: customer.phone || '',
    email: customer.email || '',
    address: customer.address || '',
    branch: customer.branch || 'unknown',
  };
}

function deviceFormFromDevice(device: Device): DeviceFormInput {
  return {
    customerId: device.customerId || '',
    customerName: device.customerName || '',
    deviceType: device.deviceType || '',
    brand: device.brand || '',
    model: device.model || '',
    serialNumber: device.serialNumber || '',
    imei: device.imei || '',
    notes: device.notes || '',
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rowValue(row: Record<string, string>, keys: string[]): string {
  return keys.map((key) => row[key]).find((value) => value !== undefined && value !== '') || '';
}

function getStoredReadableJobReference(customer?: Customer | null): string {
  return customer?.lastJobNo || customer?.lastJobNumber || customer?.lastJobReference || '';
}

export default function CustomersPage() {
  const { profile, loading } = useUser();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerJobs, setCustomerJobs] = useState<Job[]>([]);
  const [linkedJobsById, setLinkedJobsById] = useState<Record<string, Job>>({});
  const [customerForm, setCustomerForm] = useState<CustomerFormInput>(emptyCustomerForm);
  const [deviceForm, setDeviceForm] = useState<DeviceFormInput>(emptyDeviceForm);
  const [editingCustomerId, setEditingCustomerId] = useState('');
  const [editingDeviceId, setEditingDeviceId] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<CustomerBranch | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteTargetJobs, setDeleteTargetJobs] = useState<Job[]>([]);
  const [deleteJobsLoading, setDeleteJobsLoading] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState('');
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importMode, setImportMode] = useState<'add_new_only' | 'update_missing' | 'overwrite_existing'>('add_new_only');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const canManage = can(profile?.role, 'customers.manage');

  const loadData = useCallback(async () => {
    if (!canManage || !profile?.role) return;
    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadCustomers');
      const [nextCustomers, nextDevices] = await Promise.all([getCustomers(profile), getDevices(profile.role)]);
      const linkedJobs = await getJobsByIds(nextCustomers.map((customer) => customer.lastJobId || ''), profile);
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadCustomers');
      setCustomers(nextCustomers);
      setDevices(nextDevices);
      setLinkedJobsById(Object.fromEntries(linkedJobs.map((job) => [job.docId, job])));
      setSelectedCustomer((current) => {
        if (!current) return nextCustomers[0] || null;
        return nextCustomers.find((customer) => customer.customerId === current.customerId) || nextCustomers[0] || null;
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadCustomers');
      setMessage(error instanceof Error ? error.message : 'Unable to load customers');
    } finally {
      setPageLoading(false);
    }
  }, [canManage, profile]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCustomer) {
      setCustomerJobs([]);
      return;
    }

    if (!profile?.role) return;

    getJobsByCustomer(selectedCustomer.customerId, profile.role)
      .then((jobs) => {
        if (!cancelled) setCustomerJobs(jobs);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load job history');
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.role, selectedCustomer]);

  const selectedLatestJob = useMemo(() => {
    return findJobByReference(customerJobs, selectedCustomer?.lastJobId) || linkedJobsById[selectedCustomer?.lastJobId || ''] || customerJobs[0];
  }, [customerJobs, linkedJobsById, selectedCustomer?.lastJobId]);

  const selectedLatestJobReference = useMemo(() => {
    return getReadableJobReference(selectedLatestJob) || getStoredReadableJobReference(selectedCustomer) || '-';
  }, [selectedCustomer, selectedLatestJob]);

  const selectedCustomerJobReferences = useMemo(() => {
    return customerJobs.map((job) => getReadableJobReference(job)).filter(Boolean).join(' ');
  }, [customerJobs]);

  function customerActivityLabel(customer: Customer): string {
    if (customer.customerId === selectedCustomer?.customerId) {
      const linkedJob = findJobByReference(customerJobs, customer.lastJobId) || linkedJobsById[customer.lastJobId || ''];
      const readableReference = getReadableJobReference(linkedJob) || getStoredReadableJobReference(customer);
      if (readableReference) return readableReference;
    }

    const linkedJob = linkedJobsById[customer.lastJobId || ''];
    return getReadableJobReference(linkedJob) || getStoredReadableJobReference(customer) || customer.lastInvoiceId || 'No recent activity';
  }

  const filteredCustomers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    return customers.filter((customer) => {
      if (branchFilter !== 'all' && customer.branch !== branchFilter) return false;
      if (sourceFilter !== 'all' && customer.source !== sourceFilter && !(customer.sources || []).includes(sourceFilter)) return false;
      const haystack = [
        customer.customerNumber,
        customer.fullName,
        customer.phone,
        customer.normalizedPhone,
        customer.email,
        customer.notes,
        customer.source,
        ...(customer.sources || []),
        customer.lastJobId,
        getStoredReadableJobReference(customer),
        getReadableJobReference(linkedJobsById[customer.lastJobId || '']),
        customer.customerId === selectedCustomer?.customerId ? selectedCustomerJobReferences : '',
        customer.lastInvoiceId,
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
      return (
        !normalized ||
        haystack.includes(normalized) ||
        (compact && compactHaystack.includes(compact))
      );
    });
  }, [branchFilter, customers, linkedJobsById, search, selectedCustomer?.customerId, selectedCustomerJobReferences, sourceFilter]);

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(customers.flatMap((customer) => [customer.source, ...(customer.sources || [])]).filter(Boolean) as string[])).sort();
  }, [customers]);

  const importSummary = useMemo(() => ({
    totalRows: importRows.length,
    newCustomers: importRows.filter((row) => !row.invalidReason && !row.duplicateCustomerId).length,
    duplicates: importRows.filter((row) => row.duplicateCustomerId).length,
    invalid: importRows.filter((row) => row.invalidReason).length,
  }), [importRows]);

  const selectedCustomerDevices = useMemo(() => {
    return devices.filter((device) => device.customerId === selectedCustomer?.customerId);
  }, [devices, selectedCustomer?.customerId]);

  const filteredDevices = useMemo(() => {
    const normalized = deviceSearch.trim().toLowerCase();
    return selectedCustomerDevices.filter((device) => {
      return (
        !normalized ||
        [device.brand, device.model, device.serialNumber, device.imei].some((value) =>
          String(value || '').toLowerCase().includes(normalized),
        )
      );
    });
  }, [deviceSearch, selectedCustomerDevices]);

  function resetCustomerForm() {
    setCustomerForm(emptyCustomerForm);
    setEditingCustomerId('');
    setShowCustomerForm(false);
  }

  function resetDeviceForm() {
    setDeviceForm(emptyDeviceForm);
    setEditingDeviceId('');
    setShowDeviceForm(false);
  }

  function startEditCustomer(customer: Customer) {
    setCustomerForm(customerFormFromCustomer(customer));
    setEditingCustomerId(customer.customerId);
    setShowCustomerForm(true);
    setMessage('');
  }

  function startAddDevice(customer: Customer) {
    setDeviceForm({
      ...emptyDeviceForm,
      customerId: customer.customerId,
      customerName: customer.fullName,
    });
    setEditingDeviceId('');
    setShowDeviceForm(true);
    setMessage('');
  }

  function startEditDevice(device: Device) {
    setDeviceForm(deviceFormFromDevice(device));
    setEditingDeviceId(device.deviceId);
    setShowDeviceForm(true);
    setMessage('');
  }

  async function openDeleteCustomer(customer: Customer) {
    if (!profile || !canManage) {
      setMessage('Only admin and manager can delete customers.');
      return;
    }
    setDeleteTarget(customer);
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteTargetJobs([]);
    setDeleteModalError('');
    setMessage('');
    setDeleteJobsLoading(true);
    try {
      const jobs = await getJobsByCustomer(customer.customerId, profile.role);
      setDeleteTargetJobs(jobs);
    } catch (error) {
      console.error('[CUSTOMER DELETE ERROR]', error);
      setDeleteTargetJobs([]);
      setDeleteModalError('Unable to check linked jobs. You can still continue with soft delete.');
    } finally {
      setDeleteJobsLoading(false);
    }
  }

  function closeDeleteCustomer() {
    setDeleteTarget(null);
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteTargetJobs([]);
    setDeleteJobsLoading(false);
    setDeleteModalError('');
  }

  async function handleDeleteCustomer() {
    if (!profile || !canManage) {
      setDeleteModalError('Only admin and manager can delete customers.');
      return;
    }
    if (!deleteTarget) {
      setDeleteModalError('No customer selected for deletion.');
      return;
    }
    if (deleteConfirmation !== 'DELETE') {
      setDeleteModalError('Type DELETE to confirm customer deletion.');
      return;
    }
    setActionLoading(true);
    setMessage('');
    setDeleteModalError('');
    try {
      await softDeleteCustomer(deleteTarget.customerId, deleteReason, profile);
      setMessage('Customer deleted from active list');
      closeDeleteCustomer();
      await loadData();
    } catch (error) {
      console.error('[CUSTOMER DELETE ERROR]', error);
      setDeleteModalError('Failed to delete customer. Please check your permission or try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canManage) return;

    setActionLoading(true);
    setMessage('');

    try {
      if (editingCustomerId) {
        const customer = customers.find((item) => item.customerId === editingCustomerId);
        if (!customer) throw new Error('Customer not found');
        await updateCustomer(customer, customerForm, profile);
        setMessage('Customer updated');
      } else {
        const customerId = await createCustomer(customerForm, profile);
        setMessage('Customer created');
        setSelectedCustomer({ customerId, ...customerForm, createdBy: profile.uid, createdByDisplayName: profile.displayName || profile.name || 'Unknown User' } as Customer);
      }
      resetCustomerForm();
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save customer');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canManage || !selectedCustomer) return;

    setActionLoading(true);
    setMessage('');

    try {
      const payload = {
        ...deviceForm,
        customerId: selectedCustomer.customerId,
        customerName: selectedCustomer.fullName,
      };
      if (editingDeviceId) {
        const device = devices.find((item) => item.deviceId === editingDeviceId);
        if (!device) throw new Error('Device not found');
        await updateDevice(device, payload, profile);
        setMessage('Device updated');
      } else {
        await createDevice(payload, profile);
        setMessage('Device added');
      }
      resetDeviceForm();
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save device');
    } finally {
      setActionLoading(false);
    }
  }

  function parseCustomerCsv(text: string): ImportPreviewRow[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map(normalizeHeader);
    const existingByPhone = new Map(customers.map((customer) => [normalizeCustomerPhone(customer.phone || customer.normalizedPhone || ''), customer]));
    const existingByEmail = new Map(customers.filter((customer) => customer.email).map((customer) => [customer.email.toLowerCase(), customer]));
    return lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      const rawRow = headers.reduce<Record<string, string>>((record, header, index) => {
        record[header] = cells[index] || '';
        return record;
      }, {});
      const fullName = rowValue(rawRow, ['name', 'fullname', 'customername']);
      const phone = rowValue(rawRow, ['phone', 'phonenumber', 'mobile', 'contact', 'customerphone']);
      const email = rowValue(rawRow, ['email', 'emailaddress']);
      const normalizedPhone = normalizeCustomerPhone(phone);
      const duplicate = (normalizedPhone && existingByPhone.get(normalizedPhone)) || (email && existingByEmail.get(email.toLowerCase())) || undefined;
      return {
        fullName,
        phone,
        secondaryPhone: rowValue(rawRow, ['secondaryphone', 'phone2', 'alternatephone']),
        email,
        address: rowValue(rawRow, ['address', 'customeraddress']),
        notes: rowValue(rawRow, ['notes', 'note', 'remark', 'remarks']),
        branch: rowValue(rawRow, ['branch', 'outlet']),
        duplicateCustomerId: duplicate?.customerId,
        invalidReason: !fullName && !phone ? 'Name or phone is required' : '',
      };
    });
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage('CSV import is supported in this phase. Please export Excel as CSV first.');
      return;
    }
    const text = await file.text();
    const rows = parseCustomerCsv(text);
    setImportRows(rows);
    setShowImportPanel(true);
    setMessage(`CSV loaded: ${rows.length} row(s) ready for preview.`);
  }

  async function handleConfirmImport() {
    if (!profile || !canManage) return;
    setActionLoading(true);
    setMessage('');
    try {
      const result = await importCustomerRows(importRows, profile, importMode);
      setMessage(`Import complete. Total: ${result.totalRows}, new: ${result.created}, updated: ${result.updated}, duplicates: ${result.duplicates}, invalid: ${result.skippedInvalid}.`);
      setImportRows([]);
      setShowImportPanel(false);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to import customers');
    } finally {
      setActionLoading(false);
    }
  }

  function exportCustomersCsv() {
    const headers = [
      'customerCode',
      'name',
      'phone',
      'secondaryPhone',
      'email',
      'address',
      'branch',
      'source',
      'notes',
      'createdAt',
      'updatedAt',
      'lastJobId',
      'lastInvoiceId',
      'lastVisitAt',
      'totalJobs',
      'totalSpent',
    ];
    const rows = customers.map((customer) => [
      customer.customerNumber || customer.customerId,
      customer.fullName,
      customer.phone,
      customer.secondaryPhone || '',
      customer.email,
      customer.address,
      customer.branch,
      customer.source || (customer.sources || []).join('|'),
      customer.notes || '',
      formatTimestamp(customer.createdAt),
      formatTimestamp(customer.updatedAt),
      customer.lastJobId || '',
      customer.lastInvoiceId || '',
      formatTimestamp(customer.lastVisitAt),
      customer.totalJobs || 0,
      customer.totalSpent || 0,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer_database_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="text-sm text-slate-400">Loading customers</div>;

  if (!canManage) {
    return (
      <section className="rounded-md border border-white/10 bg-[#151515] p-6">
        <h1 className="text-xl font-semibold text-white">Customer Master Database</h1>
        <p className="mt-2 text-sm text-slate-400">Admin or manager access is required.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Customer Master Database</h1>
          <p className="mt-1 text-sm text-slate-400">Centralized customer, device, and repair history database.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5">
            Import CSV
            <input type="file" accept=".csv,text/csv" onChange={handleImportFile} className="hidden" />
          </label>
          <button
            type="button"
            onClick={exportCustomersCsv}
            disabled={customers.length === 0}
            className="rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomerForm(emptyCustomerForm);
              setEditingCustomerId('');
              setShowCustomerForm((current) => !current);
            }}
            className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white"
          >
            Add Customer
          </button>
        </div>
      </div>

      {message ? <div className="mb-4 rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-300">{message}</div> : null}

      {showImportPanel ? (
        <div className="mb-6 rounded-md border border-white/10 bg-[#151515] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Import Preview</h2>
              <p className="mt-1 text-sm text-slate-400">
                Total {importSummary.totalRows} · New {importSummary.newCustomers} · Duplicates {importSummary.duplicates} · Invalid {importSummary.invalid}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={importMode}
                onChange={(event) => setImportMode(event.target.value as typeof importMode)}
                className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
              >
                <option value="add_new_only">Add new only</option>
                <option value="update_missing">Update missing fields</option>
                <option value="overwrite_existing">Overwrite existing fields</option>
              </select>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={actionLoading || importRows.length === 0}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {actionLoading ? 'Importing...' : 'Confirm Import'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImportPanel(false);
                  setImportRows([]);
                }}
                className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="mt-4 max-h-80 overflow-auto rounded-md border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-[#050505] text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {importRows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.phone}-${row.email}-${index}`} className="text-slate-300">
                    <td className="px-3 py-2">{row.fullName || '-'}</td>
                    <td className="px-3 py-2">{row.phone || '-'}</td>
                    <td className="px-3 py-2">{row.email || '-'}</td>
                    <td className="px-3 py-2">{row.branch || 'unknown'}</td>
                    <td className="px-3 py-2">
                      {row.invalidReason ? (
                        <span className="text-red-300">{row.invalidReason}</span>
                      ) : row.duplicateCustomerId ? (
                        <span className="text-amber-300">Duplicate match</span>
                      ) : (
                        <span className="text-emerald-300">New customer</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importRows.length > 100 ? <div className="border-t border-white/10 p-3 text-xs text-slate-500">Showing first 100 rows.</div> : null}
          </div>
        </div>
      ) : null}

      {showCustomerForm ? (
        <form onSubmit={handleSaveCustomer} className="mb-6 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-3">
          <input required value={customerForm.fullName} onChange={(event) => setCustomerForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Full name" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input required value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input value={customerForm.email} onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={customerForm.branch} onChange={(event) => setCustomerForm((current) => ({ ...current, branch: event.target.value as CustomerBranch }))} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="unknown">Unknown branch</option>
            <option value="cyberjaya">Cyberjaya</option>
            <option value="bangi">Bangi</option>
          </select>
          <input value={customerForm.address} onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))} placeholder="Address" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2" />
          <div className="flex gap-2 md:col-span-3">
            <button type="submit" disabled={actionLoading} className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {editingCustomerId ? 'Save Customer' : 'Create Customer'}
            </button>
            <button type="button" onClick={resetCustomerForm} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-md border border-white/10 bg-[#151515]">
          <div className="space-y-3 border-b border-white/10 p-4">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email, customer code, job ID, invoice ID" className="w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
            <div className="grid grid-cols-2 gap-2">
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value as CustomerBranch | 'all')} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                <option value="all">All branches</option>
                <option value="cyberjaya">Cyberjaya</option>
                <option value="bangi">Bangi</option>
                <option value="unknown">Unknown</option>
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                <option value="all">All sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="max-h-[680px] overflow-auto">
            {pageLoading ? <div className="p-4 text-sm text-slate-400">Loading customers</div> : null}
            {filteredCustomers.map((customer) => (
              <div
                key={customer.customerId}
                className={`flex items-start gap-2 border-b border-white/10 p-4 hover:bg-[#1A1A1A]/70 ${selectedCustomer?.customerId === customer.customerId ? 'bg-[#1A1A1A]' : ''}`}
              >
                <button type="button" onClick={() => setSelectedCustomer(customer)} className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium text-white">{customer.fullName}</div>
                  <div className="mt-1 truncate text-xs text-orange-200">{customer.customerNumber || 'Pending ID'}</div>
                  <div className="mt-1 truncate text-xs text-slate-400">{customer.phone || '-'}</div>
                  <div className="mt-1 text-xs capitalize text-orange-200">{customer.branch} · {customer.source || 'manual'}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{customerActivityLabel(customer)}</div>
                </button>
                <button
                  type="button"
                  onClick={() => openDeleteCustomer(customer)}
                  className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            ))}
            {!pageLoading && filteredCustomers.length === 0 ? <div className="p-4 text-sm text-slate-500">No customers found</div> : null}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-[#151515] p-4">
          {selectedCustomer ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">{selectedCustomer.fullName}</h2>
                  <div className="mt-1 text-sm font-medium text-orange-200">{selectedCustomer.customerNumber || 'Pending ID'}</div>
                  <div className="mt-1 text-sm text-slate-400">{selectedCustomer.phone} · {selectedCustomer.email || 'No email'}</div>
                  <div className="mt-1 text-xs text-slate-500">Total jobs: {selectedCustomer.totalJobs ?? customerJobs.length} · Latest job: {selectedLatestJobReference}</div>
                  <div className="mt-1 text-xs text-slate-500">Last invoice: {selectedCustomer.lastInvoiceId || '-'} · Last visit: {formatTimestamp(selectedCustomer.lastVisitAt)}</div>
                  <div className="mt-1 text-xs text-slate-500">Total spent: RM {Number(selectedCustomer.totalSpent || 0).toFixed(2)} · Source: {selectedCustomer.source || 'manual'}</div>
                  {selectedCustomer.notes ? <div className="mt-2 text-sm text-slate-400">{selectedCustomer.notes}</div> : null}
                  <div className="mt-1 text-xs text-slate-500">Created by {selectedCustomer.createdByDisplayName || 'Unknown User'} · {formatTimestamp(selectedCustomer.createdAt)}</div>
                </div>
                <div className="flex gap-2">
	                  <Link href={`/dashboard/customers/${selectedCustomer.customerId}`} className="rounded-md border border-orange-500/30 px-3 py-2 text-sm text-orange-200">Customer 360</Link>
	                  <button type="button" onClick={() => startEditCustomer(selectedCustomer)} className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200">Edit</button>
	                  <button type="button" onClick={() => startAddDevice(selectedCustomer)} className="rounded-md border border-orange-500/30 px-3 py-2 text-sm text-orange-200">Add Device</button>
	                  <button type="button" onClick={() => openDeleteCustomer(selectedCustomer)} className="rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10">Delete Customer</button>
	                </div>
	              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-medium text-white">Devices</h3>
                    <input value={deviceSearch} onChange={(event) => setDeviceSearch(event.target.value)} placeholder="Search device" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                  </div>
                  <div className="space-y-3">
                    {filteredDevices.map((device) => (
                      <div key={device.deviceId} className="rounded-md border border-white/10 bg-[#050505] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-100">{device.brand || '-'} {device.model}</div>
                            <div className="mt-1 text-xs text-slate-500">SN: {device.serialNumber || '-'} · IMEI: {device.imei || '-'}</div>
                            {device.notes ? <div className="mt-2 text-sm text-slate-400">{device.notes}</div> : null}
                          </div>
                          <button type="button" onClick={() => startEditDevice(device)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">Edit</button>
                        </div>
                      </div>
                    ))}
                    {filteredDevices.length === 0 ? <div className="rounded-md border border-white/10 bg-[#050505] p-4 text-sm text-slate-500">No devices found</div> : null}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 font-medium text-white">Repair History</h3>
                  <div className="space-y-3">
                    {customerJobs.map((job) => (
                      <Link key={job.docId} href={`/dashboard/jobs?jobId=${encodeURIComponent(job.docId)}`} className="block rounded-md border border-white/10 bg-[#050505] p-3 hover:border-orange-500/30">
                        <div className="font-medium text-slate-100">{getReadableJobReference(job) || 'Pending ID'}</div>
                        <div className="mt-1 text-xs text-slate-500">{job.deviceModel || job.device} · {job.status}</div>
                      </Link>
                    ))}
                    {customerJobs.length === 0 ? <div className="rounded-md border border-white/10 bg-[#050505] p-4 text-sm text-slate-500">No linked jobs yet</div> : null}
                  </div>
                </div>
              </div>

              {showDeviceForm ? (
                <form onSubmit={handleSaveDevice} className="mt-4 grid gap-3 rounded-md border border-white/10 bg-[#050505] p-4 md:grid-cols-3">
                  <input value={deviceForm.deviceType} onChange={(event) => setDeviceForm((current) => ({ ...current, deviceType: event.target.value }))} placeholder="Device type" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <input value={deviceForm.brand} onChange={(event) => setDeviceForm((current) => ({ ...current, brand: event.target.value }))} placeholder="Brand" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <input required value={deviceForm.model} onChange={(event) => setDeviceForm((current) => ({ ...current, model: event.target.value }))} placeholder="Model" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <input value={deviceForm.serialNumber} onChange={(event) => setDeviceForm((current) => ({ ...current, serialNumber: event.target.value }))} placeholder="Serial number" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <input value={deviceForm.imei} onChange={(event) => setDeviceForm((current) => ({ ...current, imei: event.target.value }))} placeholder="IMEI" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <input value={deviceForm.notes} onChange={(event) => setDeviceForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-sm text-white" />
                  <div className="flex gap-2 md:col-span-3">
                    <button type="submit" disabled={actionLoading} className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {editingDeviceId ? 'Save Device' : 'Create Device'}
                    </button>
                    <button type="button" onClick={resetDeviceForm} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200">Cancel</button>
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="p-8 text-center text-sm text-slate-500">Select a customer</div>
          )}
	        </div>
	      </div>
	      {deleteTarget ? (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
	          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151515] p-5 shadow-2xl">
	            <h2 className="text-xl font-semibold text-white">Delete Customer?</h2>
	            <p className="mt-3 text-sm text-slate-300">
	              This customer will be removed from the active customer list. Existing jobs, quotations, invoices, warranties, and audit records linked to this customer will remain.
	            </p>
	            {deleteJobsLoading ? (
	              <div className="mt-3 rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300">
	                Checking linked job records...
	              </div>
	            ) : null}
	            {deleteTargetJobs.length > 0 ? (
	              <div className="mt-3 rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-100">
	                This customer has existing job records. The customer will be hidden from active lists, but job history and documents will remain.
	              </div>
	            ) : null}
	            {deleteModalError ? (
	              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
	                {deleteModalError}
	              </div>
	            ) : null}
	            <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3 text-sm text-slate-300">
	              <div className="font-medium text-white">{deleteTarget.fullName}</div>
	              <div className="mt-1 text-xs text-slate-500">{deleteTarget.phone || '-'} · {deleteTarget.email || 'No email'}</div>
	            </div>
	            <label className="mt-4 block text-sm text-slate-300">
	              Reason for deletion
	              <textarea
	                value={deleteReason}
	                onChange={(event) => setDeleteReason(event.target.value)}
	                placeholder="Reason for deletion"
	                className="mt-2 min-h-20 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
	              />
	            </label>
	            <label className="mt-4 block text-sm text-slate-300">
	              Type DELETE to confirm
	              <input
	                value={deleteConfirmation}
	                onChange={(event) => setDeleteConfirmation(event.target.value)}
	                className="mt-2 w-full rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
	              />
	            </label>
	            <div className="mt-5 flex flex-wrap justify-end gap-2">
		              <button type="button" onClick={closeDeleteCustomer} disabled={actionLoading} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">Cancel</button>
	              <button
	                type="button"
	                onClick={handleDeleteCustomer}
		                disabled={actionLoading || deleteConfirmation !== 'DELETE'}
		                className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
		              >
		                {actionLoading ? 'Deleting...' : 'Confirm Delete'}
		              </button>
	            </div>
	          </div>
	        </div>
	      ) : null}
	    </section>
	  );
	}
