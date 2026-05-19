'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyInventoryMovement,
  approveInventoryMovement,
  getInventoryItems,
  getInventoryMovements,
  getInvoiceById,
  mapInventoryMovementToItem,
  rejectInventoryMovement,
} from '@/features/pos/posService';
import type { InventoryItem, InventoryMovement, PosInvoice } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatDate(value?: { toDate?: () => Date } | null): string {
  return value?.toDate?.().toLocaleString('en-MY') || '-';
}

export default function PosInventoryMovementsPage() {
  const { profile, loading } = useUser();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [invoiceById, setInvoiceById] = useState<Record<string, PosInvoice>>({});
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  const loadRows = useCallback(async () => {
    if (!profile || !canManage) return;
    try {
      const [movementRows, inventoryRows] = await Promise.all([getInventoryMovements(profile), getInventoryItems(profile)]);
      const invoices: Record<string, PosInvoice> = {};
      await Promise.all(movementRows.map(async (movement) => {
        if (!invoices[movement.invoiceId]) invoices[movement.invoiceId] = await getInvoiceById(movement.invoiceId, profile).catch(() => null as unknown as PosInvoice);
      }));
      Object.keys(invoices).forEach((key) => { if (!invoices[key]) delete invoices[key]; });
      setMovements(movementRows);
      setItems(inventoryRows);
      setInvoiceById(invoices);
      setSelectedItems(Object.fromEntries(movementRows.map((movement) => [movement.movementId, movement.inventoryItemId || ''])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load inventory movements');
    }
  }, [canManage, profile]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const sorted = useMemo(() => movements.slice().sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0)), [movements]);

  async function mapItem(movement: InventoryMovement) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await mapInventoryMovementToItem(movement, selectedItems[movement.movementId], profile);
      setMessage('Inventory movement mapped');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to map inventory item');
    } finally {
      setActionLoading(false);
    }
  }

  async function approve(movement: InventoryMovement) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await approveInventoryMovement({ ...movement, inventoryItemId: selectedItems[movement.movementId] || movement.inventoryItemId }, invoiceById[movement.invoiceId], profile);
      setMessage('Inventory movement approved');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve inventory movement');
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(movement: InventoryMovement) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await rejectInventoryMovement(movement, reasons[movement.movementId] || '', profile);
      setMessage('Inventory movement rejected');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject inventory movement');
    } finally {
      setActionLoading(false);
    }
  }

  async function apply(movement: InventoryMovement) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await applyInventoryMovement(movement, invoiceById[movement.invoiceId], profile);
      setMessage('Inventory movement applied');
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to apply inventory movement');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading inventory movements</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">POS Inventory Movements</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-[1100px] w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Price Item</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Inventory Item</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>{sorted.map((movement) => <tr key={movement.movementId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3"><Link href={`/dashboard/pos/invoices/${movement.invoiceId}`} className="text-orange-200">{invoiceById[movement.invoiceId]?.invoiceNo || movement.invoiceId}</Link></td><td className="px-4 py-3 text-white">{movement.itemName}</td><td className="px-4 py-3 text-zinc-300">{movement.priceItemId || '-'}</td><td className="px-4 py-3 text-zinc-300">{movement.branchId}</td><td className="px-4 py-3 text-zinc-300">{movement.quantity}</td><td className="px-4 py-3 text-zinc-300">{movement.movementType}</td><td className="px-4 py-3 text-zinc-300">{movement.status}</td><td className="px-4 py-3"><select disabled={movement.status === 'applied'} value={selectedItems[movement.movementId] || ''} onChange={(event) => setSelectedItems((current) => ({ ...current, [movement.movementId]: event.target.value }))} className="w-44 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white"><option value="">Select item</option>{items.filter((item) => item.branchId === movement.branchId).map((item) => <option key={item.inventoryItemId} value={item.inventoryItemId}>{item.name} ({item.quantity})</option>)}</select></td><td className="px-4 py-3"><input value={reasons[movement.movementId] || ''} onChange={(event) => setReasons((current) => ({ ...current, [movement.movementId]: event.target.value }))} placeholder="Reason/note" className="w-36 rounded-xl border border-white/10 bg-[#050505] px-2 py-1 text-sm text-white" /></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button disabled={actionLoading || movement.status === 'applied'} onClick={() => mapItem(movement)} className="text-orange-200 disabled:text-zinc-600">Map</button><button disabled={actionLoading || !['pending', 'needs_inventory_mapping'].includes(movement.status)} onClick={() => approve(movement)} className="text-emerald-300 disabled:text-zinc-600">Approve</button><button disabled={actionLoading || movement.status !== 'approved'} onClick={() => apply(movement)} className="text-orange-200 disabled:text-zinc-600">Apply</button><button disabled={actionLoading || movement.status === 'applied'} onClick={() => reject(movement)} className="text-red-300 disabled:text-zinc-600">Reject</button></div></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
