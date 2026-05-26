'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createPriceItem,
  deletePriceItem,
  duplicatePriceItem,
  getPriceItems,
  priceItemMatchesSearch,
  seedGeniusAdvancedPriceItems,
  updatePriceItem,
  type PriceItemInput,
} from '@/features/pos/posService';
import type { PosBranch, PriceItem, PriceItemPricingType, PriceItemType } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function displayPrice(item: PriceItem | PriceItemInput): string {
  if (item.pricingType === 'quote_required') return 'Quote required';
  if (item.pricingType === 'free_or_waived') return 'Waived if proceed';
  if (item.pricingType === 'starting_from') return `Starting ${formatCurrency(item.basePrice)}`;
  if (item.pricingType === 'range') return `${formatCurrency(item.minPrice || 0)} - ${formatCurrency(item.maxPrice || 0)}`;
  return formatCurrency(item.basePrice);
}

const emptyForm: PriceItemInput = {
  name: '',
  category: '',
  serviceGroup: '',
  packageName: '',
  pricingType: 'fixed',
  type: 'service',
  basePrice: 0,
  minPrice: 0,
  maxPrice: 0,
  unit: '',
  deviceType: '',
  model: '',
  variant: '',
  capacityTier: '',
  problemType: '',
  costPrice: 0,
  warrantyDays: 0,
  warrantyDurationDays: 0,
  customerNotes: '',
  internalNotes: '',
  branch: '',
  branchPrices: {},
  commissionEligible: false,
  active: true,
};

const pricingTypes: PriceItemPricingType[] = ['fixed', 'starting_from', 'range', 'quote_required', 'free_or_waived'];
const itemTypes: PriceItemType[] = ['service', 'part', 'package', 'diagnostic', 'labor'];
const branchOptions: Array<{ value: '' | PosBranch; label: string }> = [
  { value: '', label: 'All branches' },
  { value: 'bangi', label: 'Bangi' },
  { value: 'cyberjaya', label: 'Cyberjaya' },
];

function normalizeBranch(value?: string): '' | PosBranch {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'bangi') return 'bangi';
  if (normalized === 'cyberjaya') return 'cyberjaya';
  return '';
}

function numberInputValue(value?: number): string {
  const numeric = Number(value || 0);
  return numeric > 0 ? String(numeric) : '';
}

function numberFromInput(value: string): number {
  return value === '' ? 0 : Number(value);
}

export default function PosPricelistPage() {
  const { profile, loading } = useUser();
  const [items, setItems] = useState<PriceItem[]>([]);
  const [form, setForm] = useState<PriceItemInput>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const canView = can(profile?.role, 'pos.view');
  const canManage = can(profile?.role, 'pos.manage');
  const canAdminAction = String(profile?.role || '').toLowerCase() === 'admin';
  const userBranch = normalizeBranch(profile?.branchId);
  const formBranchOptions = canAdminAction || !userBranch
    ? branchOptions
    : branchOptions.filter((option) => option.value === userBranch);

  const categories = useMemo(() => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort(), [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    if (!priceItemMatchesSearch(item, searchTerm)) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (branchFilter && item.branch !== branchFilter) return false;
    if (activeFilter === 'active' && !item.active) return false;
    if (activeFilter === 'inactive' && item.active) return false;
    return true;
  }), [activeFilter, branchFilter, categoryFilter, items, searchTerm]);

  async function loadItems() {
    if (!profile || !canView) return;
    setItems(await getPriceItems(profile));
  }

  useEffect(() => {
    void loadItems().catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load pricelist'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  useEffect(() => {
    if (!profile || canAdminAction || editingId) return;
    setForm((current) => ({ ...current, branch: userBranch }));
  }, [canAdminAction, editingId, profile, userBranch]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canManage) return;
    if (!form.name.trim()) {
      setMessage('Item / Service Name is required');
      return;
    }
    if (!form.category.trim()) {
      setMessage('Category is required');
      return;
    }
    if (!canAdminAction && !form.branch) {
      setMessage('Branch is required');
      return;
    }
    if ((form.pricingType || 'fixed') === 'fixed' && Number(form.basePrice || 0) <= 0) {
      setMessage('Price is required');
      return;
    }
    try {
      if (editingId) await updatePriceItem(editingId, form, profile);
      else await createPriceItem(form, profile);
      setForm({ ...emptyForm, branch: canAdminAction ? '' : userBranch });
      setAdvancedOpen(false);
      setEditingId('');
      setMessage(editingId ? 'Price item updated' : 'Price item created');
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save price item');
    }
  }

  async function handleDuplicate(item: PriceItem) {
    if (!profile || !canManage) return;
    try {
      await duplicatePriceItem(item, profile);
      setMessage('Price item duplicated');
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to duplicate price item');
    }
  }

  async function handleDelete(item: PriceItem) {
    if (!profile || !canAdminAction) return;
    if (!window.confirm(`Delete ${item.name}?`)) return;
    try {
      await deletePriceItem(item.priceItemId, profile);
      setMessage('Price item deleted');
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete price item');
    }
  }

  async function handleSeed() {
    if (!profile || !canAdminAction) return;
    try {
      const result = await seedGeniusAdvancedPriceItems(profile);
      setMessage(`Seed complete. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`);
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to seed Genius Advanced pricelist');
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading pricelist</div>;
  if (!canView) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">Pricelist</h1>
        <p className="mt-1 text-sm text-zinc-400">POS item pricing and branch rates.</p>
        {canAdminAction ? (
          <button type="button" onClick={handleSeed} className="mt-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200">
            Seed Genius Advanced Pricelist
          </button>
        ) : null}
      </div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      {canManage ? (
        <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{editingId ? 'Edit Pricelist Item' : 'Quick Add Pricelist Item'}</h2>
              <p className="mt-1 text-sm text-zinc-400">Add common products and repair services with the fields staff use most.</p>
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-200 hover:bg-[#1A1A1A]"
            >
              {advancedOpen ? 'Hide Advanced Fields' : 'Show Advanced Fields'}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm text-zinc-300 md:col-span-2">
              Item / Service Name
              <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="MacBook Battery Replacement" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300">
              Category
              <input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="MacBook Repair" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300">
              Price
              <input required type="number" min="0.01" step="0.01" value={numberInputValue(form.basePrice)} onChange={(event) => setForm((current) => ({ ...current, basePrice: numberFromInput(event.target.value) }))} placeholder="350" className="mt-2 w-full rounded-xl border border-orange-500/30 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300">
              Service Group
              <input value={form.serviceGroup || ''} onChange={(event) => setForm((current) => ({ ...current, serviceGroup: event.target.value }))} placeholder="Battery" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300">
              Type
              <select value={form.type || 'service'} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as PriceItemType }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                {itemTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="block text-sm text-zinc-300">
              Branch
              <select value={form.branch || ''} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value as '' | PosBranch }))} disabled={!canAdminAction && Boolean(userBranch)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white disabled:opacity-70">
                {formBranchOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-sm text-zinc-300">
              Warranty Days
              <input type="number" min="0" value={numberInputValue(form.warrantyDays)} onChange={(event) => setForm((current) => ({ ...current, warrantyDays: numberFromInput(event.target.value), warrantyDurationDays: numberFromInput(event.target.value) }))} placeholder="90" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300 md:col-span-2">
              Customer Display Notes
              <textarea value={form.customerNotes || ''} onChange={(event) => setForm((current) => ({ ...current, customerNotes: event.target.value }))} placeholder="Includes installation and testing" rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="block text-sm text-zinc-300 md:col-span-2">
              Internal Staff Notes
              <textarea value={form.internalNotes || ''} onChange={(event) => setForm((current) => ({ ...current, internalNotes: event.target.value }))} placeholder="Supplier, margin, or staff-only handling note" rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Active</label>
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={form.commissionEligible} onChange={(event) => setForm((current) => ({ ...current, commissionEligible: event.target.checked }))} /> Commission Eligible</label>
          </div>

          {advancedOpen ? (
            <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 md:grid-cols-4">
              <label className="block text-sm text-zinc-300">
                Pricing Type
                <select value={form.pricingType || 'fixed'} onChange={(event) => setForm((current) => ({ ...current, pricingType: event.target.value as PriceItemPricingType }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                  {pricingTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="block text-sm text-zinc-300">
                Min Price
                <input type="number" min="0" step="0.01" value={numberInputValue(form.minPrice)} onChange={(event) => setForm((current) => ({ ...current, minPrice: numberFromInput(event.target.value) }))} placeholder="300" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              </label>
              <label className="block text-sm text-zinc-300">
                Max Price
                <input type="number" min="0" step="0.01" value={numberInputValue(form.maxPrice)} onChange={(event) => setForm((current) => ({ ...current, maxPrice: numberFromInput(event.target.value) }))} placeholder="450" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              </label>
              <label className="block text-sm text-zinc-300">
                Cost
                <input type="number" min="0" step="0.01" value={numberInputValue(form.costPrice)} onChange={(event) => setForm((current) => ({ ...current, costPrice: numberFromInput(event.target.value) }))} placeholder="180" className="mt-2 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              </label>
              <input value={form.deviceType || ''} onChange={(event) => setForm((current) => ({ ...current, deviceType: event.target.value }))} placeholder="Device type" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.model || ''} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="Model" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.variant || ''} onChange={(event) => setForm((current) => ({ ...current, variant: event.target.value }))} placeholder="Variant" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.capacityTier || ''} onChange={(event) => setForm((current) => ({ ...current, capacityTier: event.target.value }))} placeholder="Capacity tier" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.problemType || ''} onChange={(event) => setForm((current) => ({ ...current, problemType: event.target.value }))} placeholder="Problem type" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.packageName || ''} onChange={(event) => setForm((current) => ({ ...current, packageName: event.target.value }))} placeholder="Package name" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              <input value={form.unit || ''} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Unit" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white">{editingId ? 'Update Item' : 'Create Item'}</button>
            {editingId ? (
              <button type="button" onClick={() => { setEditingId(''); setForm({ ...emptyForm, branch: canAdminAction ? '' : userBranch }); setAdvancedOpen(false); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-200">Cancel</button>
            ) : null}
          </div>
        </form>
      ) : null}
      <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#111111]/90 p-5 md:grid-cols-4">
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search name, model, category, e.g. 15.6 LCD, A1278, data recovery"
          className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600 md:col-span-4"
        />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          {branchOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
        </select>
        <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as 'all' | 'active' | 'inactive')} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Pricing</th><th className="px-4 py-3">Device</th><th className="px-4 py-3">Warranty</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Active</th>{canManage ? <th className="px-4 py-3">Action</th> : null}</tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.priceItemId} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3 text-white"><div>{item.name}</div><div className="text-xs text-zinc-500">{item.packageName || item.serviceGroup || item.type}</div></td>
                <td className="px-4 py-3 text-zinc-300">{item.category}</td>
                <td className="px-4 py-3 text-zinc-300">{displayPrice(item)}</td>
                <td className="px-4 py-3 text-zinc-300">{[item.deviceType, item.model, item.variant, item.capacityTier].filter(Boolean).join(' ') || '-'}</td>
                <td className="px-4 py-3 text-zinc-300">{item.warrantyDays ?? item.warrantyDurationDays ?? 0} days</td>
                <td className="px-4 py-3 text-zinc-300">{item.branch || 'All'}</td>
                <td className="px-4 py-3 text-zinc-300">{item.active ? 'Yes' : 'No'}</td>
                {canManage ? (
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          setEditingId(item.priceItemId);
                          setForm({ ...emptyForm, ...item, warrantyDays: item.warrantyDays ?? item.warrantyDurationDays ?? 0 });
                          setAdvancedOpen(Boolean(
                            item.pricingType && item.pricingType !== 'fixed'
                            || item.minPrice
                            || item.maxPrice
                            || item.costPrice
                            || item.deviceType
                            || item.model
                            || item.variant
                            || item.capacityTier
                            || item.problemType
                            || item.packageName
                            || item.unit,
                          ));
                        }}
                        className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200"
                      >
                        Edit
                      </button>
                      <button onClick={() => void handleDuplicate(item)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200">Duplicate</button>
                      {canAdminAction ? <button onClick={() => void handleDelete(item)} className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-200">Delete</button> : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {filteredItems.length === 0 ? <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-8 text-center text-zinc-500">No pricelist items found. Try another keyword or clear filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
