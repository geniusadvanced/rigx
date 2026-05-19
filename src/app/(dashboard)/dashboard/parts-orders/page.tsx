'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPartsOrder,
  deletePartsOrder,
  getPartsOrdersForUser,
  inputFromJob,
  updatePartsOrder,
} from '@/features/parts-orders/services/partsOrderService';
import type { PartCategory, PartsOrder, PartsOrderFormInput, PartsOrderStatus } from '@/features/parts-orders/types';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';
import { can, isAdminOrManager, isTechnician } from '@/lib/rbac/can';
import type { Job } from '@/types';

const partCategories: Array<{ value: PartCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All categories' },
  { value: 'screen', label: 'Screen' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'motherboard_component', label: 'Motherboard Component' },
  { value: 'charger', label: 'Charger' },
  { value: 'storage', label: 'Storage' },
  { value: 'ram', label: 'RAM' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'casing', label: 'Casing' },
  { value: 'other', label: 'Other' },
];

const statuses: Array<{ value: PartsOrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'arrived', label: 'Arrived' },
  { value: 'installed', label: 'Installed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function todayDateInput(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function emptyForm(): PartsOrderFormInput {
  return {
    jobId: '',
    branchId: '',
    jobSheetNo: '',
    technicianId: '',
    customerName: '',
    deviceBrand: '',
    deviceModel: '',
    partName: '',
    partCategory: 'other',
    partDescription: '',
    supplierName: '',
    supplierContact: '',
    costPrice: '0',
    sellingPrice: '0',
    orderedDate: todayDateInput(),
    etaDate: '',
    arrivedDate: '',
    installedDate: '',
    status: 'requested',
    remarks: '',
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function dateInput(value?: { toDate?: () => Date } | null): string {
  const date = value?.toDate?.();
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function statusClass(status: PartsOrderStatus): string {
  if (status === 'installed' || status === 'arrived') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'cancelled') return 'border-red-500/40 text-red-300';
  if (status === 'ordered') return 'border-amber-500/35 text-amber-300';
  if (status === 'approved') return 'border-orange-500/30 text-orange-200';
  return 'border-amber-500/40 text-amber-300';
}

function formFromOrder(order: PartsOrder): PartsOrderFormInput {
  return {
    jobId: order.jobId,
    branchId: order.branchId || '',
    jobSheetNo: order.jobSheetNo,
    technicianId: order.technicianId,
    customerName: order.customerName,
    deviceBrand: order.deviceBrand,
    deviceModel: order.deviceModel,
    partName: order.partName,
    partCategory: order.partCategory,
    partDescription: order.partDescription,
    supplierName: order.supplierName,
    supplierContact: order.supplierContact,
    costPrice: String(order.costPrice || 0),
    sellingPrice: String(order.sellingPrice || 0),
    orderedDate: dateInput(order.orderedDate),
    etaDate: dateInput(order.etaDate),
    arrivedDate: dateInput(order.arrivedDate),
    installedDate: dateInput(order.installedDate),
    status: order.status,
    remarks: order.remarks,
  };
}

export default function PartsOrdersPage() {
  const { profile, loading } = useUser();
  const { jobs } = useJobs(profile?.role ? profile : null);
  const [orders, setOrders] = useState<PartsOrder[]>([]);
  const [form, setForm] = useState<PartsOrderFormInput>(() => emptyForm());
  const [editingId, setEditingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PartsOrderStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<PartCategory | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [pageLoading, setPageLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const canManage = can(profile?.role, 'partsOrders.manage') && isAdminOrManager(profile?.role);
  const canAccess = can(profile?.role, 'partsOrders.view');

  const loadOrders = useCallback(async () => {
    if (!profile?.role) return;
    setPageLoading(true);
    setMessage('');

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadPartsOrders');
      setOrders(await getPartsOrdersForUser(profile));
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadPartsOrders');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadPartsOrders');
      setMessage(error instanceof Error ? error.message : 'Unable to load parts orders');
    } finally {
      setPageLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const supplierOptions = useMemo(() => {
    return Array.from(new Set(orders.map((order) => order.supplierName).filter(Boolean))).sort();
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch =
        !normalizedSearch ||
        [order.jobSheetNo, order.customerName, order.deviceModel, order.partName, order.supplierName].some((value) =>
          String(value || '').toLowerCase().includes(normalizedSearch),
        );
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || order.partCategory === categoryFilter;
      const matchesSupplier = supplierFilter === 'all' || order.supplierName === supplierFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesSupplier;
    });
  }, [categoryFilter, orders, search, statusFilter, supplierFilter]);

  function resetForm() {
    setForm(emptyForm());
    setEditingId('');
    setShowForm(false);
  }

  function applyJob(jobId: string) {
    const job = jobs.find((item) => item.docId === jobId);
    setForm((current) => ({
      ...current,
      ...(job ? inputFromJob(job as Job) : emptyForm()),
      partName: current.partName,
      partCategory: current.partCategory,
      partDescription: current.partDescription,
      supplierName: current.supplierName,
      supplierContact: current.supplierContact,
      costPrice: current.costPrice,
      sellingPrice: current.sellingPrice,
      orderedDate: current.orderedDate,
      etaDate: current.etaDate,
      arrivedDate: current.arrivedDate,
      installedDate: current.installedDate,
      status: current.status,
      remarks: current.remarks,
    }));
  }

  function startEdit(order: PartsOrder) {
    setForm(formFromOrder(order));
    setEditingId(order.partsOrderId);
    setShowForm(true);
    setMessage('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.role) return;

    setActionLoading(true);
    setMessage('');

    try {
      if (editingId) {
        const order = orders.find((item) => item.partsOrderId === editingId);
        if (!order) throw new Error('Parts order not found');
        await updatePartsOrder(order, form, profile);
        setMessage('Parts order updated');
      } else {
        await createPartsOrder(form, profile);
        setMessage('Parts order created');
      }
      resetForm();
      await loadOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save parts order');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(order: PartsOrder) {
    if (!canManage || !profile) return;
    const confirmed = window.confirm(`Delete parts order for ${order.partName}?`);
    if (!confirmed) return;

    setActionLoading(true);
    setMessage('');

    try {
      await deletePartsOrder(order, profile);
      setMessage('Parts order deleted');
      await loadOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete parts order');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-400">Loading parts orders</div>;

  if (!canAccess) {
    return (
      <section className="rounded-md border border-white/10 bg-[#151515] p-6">
        <h1 className="text-xl font-semibold text-white">Parts Orders</h1>
        <p className="mt-2 text-sm text-slate-400">Access denied.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Parts Orders</h1>
          <p className="mt-1 text-sm text-slate-400">Track ordered parts by customer job, not stock inventory.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm());
            setEditingId('');
            setShowForm((current) => !current);
          }}
          className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-semibold text-white"
        >
          {isTechnician(profile?.role) ? 'Request Part' : 'Add Parts Order'}
        </button>
      </div>

      {message ? <div className="mb-4 rounded-md border border-white/10 bg-[#151515] p-3 text-sm text-slate-300">{message}</div> : null}

      {showForm ? (
        <form onSubmit={handleSubmit} className="mb-6 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-3">
          <select required value={form.jobId} onChange={(event) => applyJob(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="">Select job</option>
            {jobs.map((job) => (
              <option key={job.docId} value={job.docId}>
                {job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber} - {job.customerName}
              </option>
            ))}
          </select>
          <input readOnly value={form.jobSheetNo} placeholder="Job sheet no" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400" />
          <input readOnly value={form.customerName} placeholder="Customer" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400" />
          <input readOnly value={form.deviceBrand} placeholder="Device brand" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400" />
          <input readOnly value={form.deviceModel} placeholder="Device model" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-slate-400" />
          <input required value={form.partName} onChange={(event) => setForm((current) => ({ ...current, partName: event.target.value }))} placeholder="Part name" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={form.partCategory} onChange={(event) => setForm((current) => ({ ...current, partCategory: event.target.value as PartCategory }))} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            {partCategories.filter((item) => item.value !== 'all').map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
          <input value={form.partDescription} onChange={(event) => setForm((current) => ({ ...current, partDescription: event.target.value }))} placeholder="Part description" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          {canManage ? (
            <>
              <input value={form.supplierName} onChange={(event) => setForm((current) => ({ ...current, supplierName: event.target.value }))} placeholder="Supplier name" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input value={form.supplierContact} onChange={(event) => setForm((current) => ({ ...current, supplierContact: event.target.value }))} placeholder="Supplier contact" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} placeholder="Cost price" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} placeholder="Selling price" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PartsOrderStatus }))} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                {statuses.filter((item) => item.value !== 'all').map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </>
          ) : null}
          <label className="grid gap-1 text-xs font-medium text-slate-400">
            Order Date
            <input
              type="date"
              required
              value={form.orderedDate}
              onChange={(event) => setForm((current) => ({ ...current, orderedDate: event.target.value }))}
              className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
          </label>
          <textarea value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} placeholder="Remarks" rows={2} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-3" />
          <div className="flex gap-2 md:col-span-3">
            <button type="submit" disabled={actionLoading} className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {editingId ? 'Save Parts Order' : isTechnician(profile?.role) ? 'Submit Request' : 'Create Parts Order'}
            </button>
            <button type="button" onClick={resetForm} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="mb-4 grid gap-3 rounded-md border border-white/10 bg-[#151515] p-4 md:grid-cols-4">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search job, customer, model, part, supplier" className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PartsOrderStatus | 'all')} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as PartCategory | 'all')} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          {partCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
        <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="rounded-md border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All suppliers</option>
          {supplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-md border border-white/10 bg-[#151515]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Part</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requested By</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {pageLoading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading parts orders</td></tr> : null}
            {!pageLoading && filteredOrders.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No parts orders found</td></tr> : null}
            {filteredOrders.map((order) => (
              <tr key={order.partsOrderId} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3 text-slate-300">
                  <div className="font-medium text-white">{order.jobSheetNo}</div>
                  <div className="text-xs text-slate-500">{order.customerName} · {order.deviceBrand} {order.deviceModel}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  <div>{order.partName}</div>
                  <div className="text-xs text-slate-500">{order.partCategory.replaceAll('_', ' ')}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{order.supplierName || '-'}</td>
                <td className="px-4 py-3 text-slate-300">
                  {canManage ? (
                    <>
                      <div>Cost {formatCurrency(order.costPrice)}</div>
                      <div className="text-xs text-slate-500">Sell {formatCurrency(order.sellingPrice)}</div>
                    </>
                  ) : '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(order.status)}`}>{order.status.replaceAll('_', ' ')}</span>
                </td>
                <td className="px-4 py-3 text-slate-300">{order.requestedByDisplayName || 'Unknown User'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {(canManage || order.status === 'requested') ? (
                      <button type="button" onClick={() => startEdit(order)} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200">Edit</button>
                    ) : null}
                    {canManage ? (
                      <button type="button" onClick={() => handleDelete(order)} className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300">Delete</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
