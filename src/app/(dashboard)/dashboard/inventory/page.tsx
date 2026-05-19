'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { adjustInventoryItemQuantity, createInventoryItem, getInventoryItems } from '@/features/pos/posService';
import type { InventoryItem } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function InventoryPage() {
  const { profile, loading } = useUser();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [quantityEdits, setQuantityEdits] = useState<Record<string, string>>({});
  const [adjustmentReasons, setAdjustmentReasons] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', sku: '', category: '', branchId: 'bangi', quantity: '0', reorderLevel: '0', costPrice: '0', sellingPrice: '0', active: true });
  const canManage = can(profile?.role, 'pos.manage');

  async function loadItems() {
    if (!profile || !canManage) return;
    try {
      const rows = await getInventoryItems(profile);
      setItems(rows);
      setQuantityEdits(Object.fromEntries(rows.map((item) => [item.inventoryItemId, String(item.quantity || 0)])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load inventory');
    }
  }

  useEffect(() => { void loadItems(); }, [profile?.uid, profile?.role, canManage]);

  const filtered = useMemo(() => items.filter((item) => {
    const matchesBranch = branchFilter === 'all' || item.branchId === branchFilter;
    const term = search.toLowerCase();
    const matchesSearch = !term || [item.name, item.sku, item.category].some((value) => String(value || '').toLowerCase().includes(term));
    return matchesBranch && matchesSearch;
  }), [branchFilter, items, search]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    try {
      await createInventoryItem({
        name: form.name,
        sku: form.sku,
        category: form.category,
        branchId: form.branchId,
        quantity: Number(form.quantity),
        reorderLevel: Number(form.reorderLevel),
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        active: form.active,
      }, profile);
      setForm({ name: '', sku: '', category: '', branchId: 'bangi', quantity: '0', reorderLevel: '0', costPrice: '0', sellingPrice: '0', active: true });
      setMessage('Inventory item created');
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create inventory item');
    }
  }

  async function saveQuantity(item: InventoryItem) {
    if (!profile) return;
    try {
      await adjustInventoryItemQuantity(item, Number(quantityEdits[item.inventoryItemId] || 0), adjustmentReasons[item.inventoryItemId] || '', profile);
      setMessage('Quantity updated');
      setAdjustmentReasons((current) => ({ ...current, [item.inventoryItemId]: '' }));
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update quantity');
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading inventory</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Inventory</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <form onSubmit={handleCreate} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Create Inventory Item</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="SKU" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="bangi">bangi</option><option value="cyberjaya">cyberjaya</option><option value="ampang">ampang</option></select>
          <input type="number" min="0" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="Quantity" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input type="number" min="0" value={form.reorderLevel} onChange={(event) => setForm((current) => ({ ...current, reorderLevel: event.target.value }))} placeholder="Reorder level" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} placeholder="Cost price" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} placeholder="Selling price" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <button className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white md:col-span-4">Create item</button>
        </div>
      </form>
      <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="all">All branches</option><option value="bangi">bangi</option><option value="cyberjaya">cyberjaya</option><option value="ampang">ampang</option></select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Reorder</th><th className="px-4 py-3">Cost</th><th className="px-4 py-3">Selling</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody>{filtered.map((item) => <tr key={item.inventoryItemId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white"><Link href={`/dashboard/inventory/${item.inventoryItemId}`} className="text-orange-200">{item.name}</Link>{Number(item.quantity || 0) <= Number(item.reorderLevel || 0) ? <span className="ml-2 rounded-full border border-red-500/40 px-2 py-0.5 text-xs text-red-300">Low stock</span> : null}</td><td className="px-4 py-3 text-zinc-300">{item.sku || '-'}</td><td className="px-4 py-3 text-zinc-300">{item.branchId}</td><td className="px-4 py-3"><input type="number" min="0" value={quantityEdits[item.inventoryItemId] || '0'} onChange={(event) => setQuantityEdits((current) => ({ ...current, [item.inventoryItemId]: event.target.value }))} className="w-24 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white" /></td><td className="px-4 py-3"><input value={adjustmentReasons[item.inventoryItemId] || ''} onChange={(event) => setAdjustmentReasons((current) => ({ ...current, [item.inventoryItemId]: event.target.value }))} placeholder="Adjustment reason" className="w-44 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white" /></td><td className="px-4 py-3 text-zinc-300">{item.reorderLevel || 0}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.costPrice)}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.sellingPrice)}</td><td className="px-4 py-3"><button onClick={() => saveQuantity(item)} className="text-orange-200">Save</button></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
