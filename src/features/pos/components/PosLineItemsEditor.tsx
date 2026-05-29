'use client';

import type { PosLineItem, PriceItemType } from '@/features/pos/types';

type PosLineItemsEditorProps = {
  items: PosLineItem[];
  discountAmount: string;
  discountReason: string;
  onItemsChange: (items: PosLineItem[]) => void;
  onDiscountAmountChange: (value: string) => void;
  onDiscountReasonChange: (value: string) => void;
};

const blankItem: PosLineItem = {
  name: '',
  category: 'Service',
  type: 'service',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  total: 0,
};

function lineTotal(item: Pick<PosLineItem, 'quantity' | 'unitPrice' | 'discount'>): number {
  return Math.max(0, Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export function calculateLineItemEditorTotals(items: PosLineItem[], discountAmount: string | number) {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const documentDiscount = Math.max(0, Number(discountAmount || 0));
  return {
    subtotal,
    discount: items.reduce((sum, item) => sum + Math.max(0, Number(item.discount || 0)), 0) + documentDiscount,
    documentDiscount,
    total: Math.max(0, subtotal - documentDiscount),
  };
}

export function PosLineItemsEditor({
  items,
  discountAmount,
  discountReason,
  onItemsChange,
  onDiscountAmountChange,
  onDiscountReasonChange,
}: PosLineItemsEditorProps) {
  const totals = calculateLineItemEditorTotals(items, discountAmount);

  function updateItem(index: number, patch: Partial<PosLineItem>) {
    onItemsChange(items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      return { ...next, total: lineTotal(next) };
    }));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="hidden grid-cols-[minmax(0,1fr)_90px_120px_120px_120px_80px] gap-2 px-1 text-xs font-semibold uppercase text-zinc-500 md:grid">
          <div>Description</div>
          <div>Qty</div>
          <div>Unit Price</div>
          <div>Discount</div>
          <div>Total</div>
          <div />
        </div>
        {items.map((item, index) => (
          <div key={index} className="grid gap-2 rounded-xl border border-white/10 bg-[#101010] p-3 md:grid-cols-[minmax(0,1fr)_90px_120px_120px_120px_80px]">
            <input
              required
              value={item.name}
              onChange={(event) => updateItem(index, { name: event.target.value })}
              placeholder="Battery Replacement"
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
            <input
              required
              type="number"
              min="1"
              step="1"
              value={item.quantity}
              onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
              placeholder="1"
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={item.unitPrice}
              onChange={(event) => updateItem(index, { unitPrice: Number(event.target.value) })}
              placeholder="250"
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.discount || 0}
              onChange={(event) => updateItem(index, { discount: Number(event.target.value) })}
              placeholder="0"
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
            />
            <div className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm font-medium text-zinc-200">
              {formatCurrency(lineTotal(item))}
            </div>
            <button
              type="button"
              disabled={items.length === 1}
              onClick={() => onItemsChange(items.filter((_item, itemIndex) => itemIndex !== index))}
              className="rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-300 disabled:opacity-40"
            >
              Remove
            </button>
            <select
              value={item.type || 'service'}
              onChange={(event) => updateItem(index, { type: event.target.value as PriceItemType })}
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2"
            >
              <option value="service">service</option>
              <option value="part">part</option>
              <option value="package">package</option>
              <option value="diagnostic">diagnostic</option>
              <option value="labor">labor</option>
            </select>
            <input
              value={item.category || ''}
              onChange={(event) => updateItem(index, { category: event.target.value })}
              placeholder="Category"
              className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onItemsChange([...items, blankItem])}
        className="rounded-xl border border-orange-500/25 px-3 py-2 text-sm text-orange-200"
      >
        Add Item
      </button>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_260px]">
        <input
          type="number"
          min="0"
          step="0.01"
          value={discountAmount}
          onChange={(event) => onDiscountAmountChange(event.target.value)}
          placeholder="Document discount"
          className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
        />
        <input
          value={discountReason}
          onChange={(event) => onDiscountReasonChange(event.target.value)}
          placeholder="Discount reason / notes"
          className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"
        />
        <div className="rounded-xl border border-white/10 bg-[#101010] p-3 text-sm">
          <div className="flex justify-between text-zinc-300"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
          <div className="mt-1 flex justify-between text-zinc-300"><span>Total Discount</span><span>{formatCurrency(totals.discount)}</span></div>
          <div className="mt-2 flex justify-between border-t border-white/10 pt-2 font-semibold text-white"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
        </div>
      </div>
    </div>
  );
}
