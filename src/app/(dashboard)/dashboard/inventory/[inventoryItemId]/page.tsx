'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  createInventoryCorrection,
  getInventoryItemById,
  getInventoryStockLedger,
  receiveInventoryStock,
} from '@/features/pos/posService';
import type { InventoryItem, InventoryStockLedgerEntry } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function formatDate(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  return date ? date.toLocaleString() : '-';
}

function sourceHref(ledger: InventoryStockLedgerEntry): string | null {
  if (ledger.sourceType === 'invoice' && ledger.sourceId) return `/dashboard/pos/invoices/${ledger.sourceId}`;
  return null;
}

function displayCreatedBy(createdBy: string | undefined, profile: { uid?: string; displayName?: string; name?: string } | null): string {
  if (createdBy && profile?.uid === createdBy) return profile.displayName || profile.name || 'Unknown User';
  return 'Unknown User';
}

export default function InventoryItemDetailPage() {
  const params = useParams<{ inventoryItemId: string }>();
  const { profile, loading } = useUser();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [ledger, setLedger] = useState<InventoryStockLedgerEntry[]>([]);
  const [message, setMessage] = useState('');
  const [receiveForm, setReceiveForm] = useState({
    quantityReceived: '',
    unitCost: '',
    supplierName: '',
    referenceNo: '',
    reason: '',
    updateCostPrice: false,
  });
  const [correctionForm, setCorrectionForm] = useState({
    quantityChange: '',
    reason: '',
    sourceType: 'manual' as 'manual' | 'refund' | 'warranty_claim',
  });
  const [saving, setSaving] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  async function loadItem() {
    if (!profile || !canManage || !params.inventoryItemId) return;
    try {
      const [itemRow, ledgerRows] = await Promise.all([
      getInventoryItemById(params.inventoryItemId, profile),
      getInventoryStockLedger(params.inventoryItemId, profile),
      ]);
      setItem(itemRow);
      setLedger(ledgerRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load inventory item');
    }
  }

  useEffect(() => {
    void loadItem();
  }, [canManage, params.inventoryItemId, profile]);

  async function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !item) return;
    setSaving(true);
    setMessage('');
    try {
      await receiveInventoryStock({
        inventoryItemId: item.inventoryItemId,
        quantityReceived: Number(receiveForm.quantityReceived),
        unitCost: receiveForm.unitCost ? Number(receiveForm.unitCost) : undefined,
        supplierName: receiveForm.supplierName,
        referenceNo: receiveForm.referenceNo,
        reason: receiveForm.reason,
        updateCostPrice: receiveForm.updateCostPrice,
      }, profile);
      setReceiveForm({ quantityReceived: '', unitCost: '', supplierName: '', referenceNo: '', reason: '', updateCostPrice: false });
      setMessage('Stock received');
      await loadItem();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to receive stock');
    } finally {
      setSaving(false);
    }
  }

  async function handleCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !item) return;
    setSaving(true);
    setMessage('');
    try {
      await createInventoryCorrection({
        inventoryItemId: item.inventoryItemId,
        quantityChange: Number(correctionForm.quantityChange),
        reason: correctionForm.reason,
        sourceType: correctionForm.sourceType,
      }, profile);
      setCorrectionForm({ quantityChange: '', reason: '', sourceType: 'manual' });
      setMessage('Inventory correction saved');
      await loadItem();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save correction');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading inventory item</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <Link href="/dashboard/inventory" className="text-sm text-orange-200">Back to Inventory</Link>
        <h1 className="mt-3 text-2xl font-semibold text-white">{item?.name || 'Inventory Item'}</h1>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      {item ? (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-[#151515] p-4">
            <div className="text-xs uppercase text-zinc-500">Current Quantity</div>
            <div className="mt-2 text-2xl font-semibold text-white">{item.quantity}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#151515] p-4">
            <div className="text-xs uppercase text-zinc-500">Branch</div>
            <div className="mt-2 text-2xl font-semibold text-white">{item.branchId}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#151515] p-4">
            <div className="text-xs uppercase text-zinc-500">Reorder Level</div>
            <div className="mt-2 text-2xl font-semibold text-white">{item.reorderLevel || 0}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#151515] p-4">
            <div className="text-xs uppercase text-zinc-500">Status</div>
            <div className="mt-2 text-2xl font-semibold text-white">{item.active ? 'Active' : 'Inactive'}</div>
          </div>
        </div>
      ) : null}

      {item ? (
        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Item Details</h2>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">SKU</span><div className="mt-1 text-white">{item.sku || '-'}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">Category</span><div className="mt-1 text-white">{item.category || '-'}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">Cost Price</span><div className="mt-1 text-white">{formatCurrency(item.costPrice)}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">Selling Price</span><div className="mt-1 text-white">{formatCurrency(item.sellingPrice)}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">Created At</span><div className="mt-1 text-white">{formatDate(item.createdAt)}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#151515] p-3"><span className="text-zinc-500">Updated At</span><div className="mt-1 text-white">{formatDate(item.updatedAt)}</div></div>
          </div>
        </div>
      ) : null}

      {item ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={handleReceive} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Receive Stock</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input type="number" min="1" required value={receiveForm.quantityReceived} onChange={(event) => setReceiveForm((current) => ({ ...current, quantityReceived: event.target.value }))} placeholder="Quantity received" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input type="number" min="0" step="0.01" value={receiveForm.unitCost} onChange={(event) => setReceiveForm((current) => ({ ...current, unitCost: event.target.value }))} placeholder="Unit cost" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input value={receiveForm.supplierName} onChange={(event) => setReceiveForm((current) => ({ ...current, supplierName: event.target.value }))} placeholder="Supplier name" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input value={receiveForm.referenceNo} onChange={(event) => setReceiveForm((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="Reference no" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input value={receiveForm.reason} onChange={(event) => setReceiveForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2" />
              <label className="flex items-center gap-2 text-sm text-zinc-300 md:col-span-2">
                <input type="checkbox" checked={receiveForm.updateCostPrice} onChange={(event) => setReceiveForm((current) => ({ ...current, updateCostPrice: event.target.checked }))} />
                Update cost price from unit cost
              </label>
              <button disabled={saving} className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">Receive Stock</button>
            </div>
          </form>

          <form onSubmit={handleCorrection} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Stock Correction</h2>
            <div className="mt-4 grid gap-3">
              <input type="number" step="1" required value={correctionForm.quantityChange} onChange={(event) => setCorrectionForm((current) => ({ ...current, quantityChange: event.target.value }))} placeholder="Quantity change, e.g. -1 or 2" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <select value={correctionForm.sourceType} onChange={(event) => setCorrectionForm((current) => ({ ...current, sourceType: event.target.value as 'manual' | 'refund' | 'warranty_claim' }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                <option value="manual">manual</option>
                <option value="refund">refund</option>
                <option value="warranty_claim">warranty claim</option>
              </select>
              <input required value={correctionForm.reason} onChange={(event) => setCorrectionForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Correction reason" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <button disabled={saving} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-semibold text-orange-200 hover:bg-[#1F160E] disabled:opacity-60">Save Correction</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-lg font-semibold text-white">Stock Ledger History</h2>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Movement Type</th>
              <th className="px-4 py-3">Quantity Change</th>
              <th className="px-4 py-3">Quantity Before</th>
              <th className="px-4 py-3">Quantity After</th>
              <th className="px-4 py-3">Source Type</th>
              <th className="px-4 py-3">Source Link</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Created By</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => {
              const href = sourceHref(row);
              return (
                <tr key={row.ledgerId} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3 text-zinc-300">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.movementType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 font-semibold text-white">{row.quantityChange}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.quantityBefore}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.quantityAfter}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.sourceType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">{href ? <Link href={href} className="text-orange-200">Open</Link> : <span className="text-zinc-500">-</span>}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.reason || '-'}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.referenceNo || row.supplierName || '-'}</td>
                  <td className="px-4 py-3 text-zinc-300">{displayCreatedBy(row.createdBy, profile)}</td>
                </tr>
              );
            })}
            {ledger.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-zinc-500">No stock ledger entries</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
