'use client';

import { useEffect, useMemo, useState } from 'react';
import { getInvoices, getPayments, getPosOperationalReportCounts, getQuotations, getRefunds } from '@/features/pos/posService';
import type { PosInvoice, PosPayment, PosQuotation, PosRefund } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function PosReportsPage() {
  const { profile, loading } = useUser();
  const [invoices, setInvoices] = useState<PosInvoice[]>([]);
  const [payments, setPayments] = useState<PosPayment[]>([]);
  const [quotations, setQuotations] = useState<PosQuotation[]>([]);
  const [refunds, setRefunds] = useState<PosRefund[]>([]);
  const [operationalCounts, setOperationalCounts] = useState({
    activeWarranties: 0,
    openWarrantyClaims: 0,
    pendingCommissionEntries: 0,
    pendingCommissionAmount: 0,
    approvedCommissionAmount: 0,
    rejectedCommissionCount: 0,
    payrollLinkedCommissionAmount: 0,
    paidCommissionAmount: 0,
    activeCommissionRules: 0,
    pendingInventoryMovements: 0,
    appliedInventoryMovements: 0,
    inventoryLedgerMovementCount: 0,
    manualStockAdjustmentCount: 0,
    lowStockCount: 0,
    lowStockByBranch: {} as Record<string, number>,
    inventoryReceivedCount: 0,
    inventoryReceivedQuantity: 0,
    grossProfitEstimate: 0,
    topLowStockItems: [] as Array<{ inventoryItemId: string; name: string; branchId: string; quantity: number; reorderLevel: number }>,
  });
  const [message, setMessage] = useState('');
  const canOperate = can(profile?.role, 'pos.operate');

  useEffect(() => {
    if (!profile || !canOperate) return;
    Promise.all([getInvoices(profile), getPayments(profile), getQuotations(profile), getRefunds(profile), getPosOperationalReportCounts(profile)])
      .then(([invoiceRows, paymentRows, quotationRows, refundRows, counts]) => { setInvoices(invoiceRows); setPayments(paymentRows); setQuotations(quotationRows); setRefunds(refundRows); setOperationalCounts(counts); })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load POS reports'));
  }, [canOperate, profile]);

  const summary = useMemo(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    const isToday = (value?: { toDate?: () => Date }) => {
      const date = value?.toDate?.();
      return date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(date) === today : false;
    };
    const activeInvoices = invoices.filter((invoice) => invoice.paymentStatus !== 'void');
    const totalSales = activeInvoices.reduce((total, invoice) => total + Number(invoice.total || 0), 0);
    const paid = payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const balance = activeInvoices.reduce((total, invoice) => total + Number(invoice.balance || 0), 0);
    const totalSalesToday = activeInvoices.filter((invoice) => isToday(invoice.createdAt)).reduce((total, invoice) => total + Number(invoice.total || 0), 0);
    const totalPaidToday = payments.filter((payment) => isToday(payment.receivedAt)).reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const voidInvoices = invoices.filter((invoice) => invoice.paymentStatus === 'void').length;
    const totalRefunds = refunds.reduce((total, refund) => total + Number(refund.amount || 0), 0);
    const reversedPayments = payments.filter((payment) => payment.status === 'reversed').length;
    const salesByBranch = activeInvoices.reduce<Record<string, number>>((rows, invoice) => {
      rows[invoice.branchId] = (rows[invoice.branchId] || 0) + Number(invoice.total || 0);
      return rows;
    }, {});
    const salesByCategory = activeInvoices.flatMap((invoice) => invoice.items).reduce<Record<string, number>>((rows, item) => {
      const category = item.category || 'uncategorized';
      rows[category] = (rows[category] || 0) + Number(item.total || 0);
      return rows;
    }, {});
    const paymentsByMethod = payments.reduce<Record<string, number>>((rows, payment) => {
      rows[payment.method] = (rows[payment.method] || 0) + Number(payment.amount || 0);
      return rows;
    }, {});
    const quotationsByStatus = quotations.reduce<Record<string, number>>((rows, quotation) => {
      rows[quotation.status] = (rows[quotation.status] || 0) + 1;
      return rows;
    }, {});
    return { totalSales, paid, balance, invoices: invoices.length, totalSalesToday, totalPaidToday, voidInvoices, totalRefunds, reversedPayments, salesByBranch, salesByCategory, paymentsByMethod, quotationsByStatus };
  }, [invoices, payments, quotations, refunds]);

  if (loading) return <div className="text-sm text-zinc-400">Loading POS reports</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">POS Reports</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Invoices</div><div className="mt-2 text-2xl font-semibold text-white">{summary.invoices}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Total Sales</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.totalSales)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Paid</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.paid)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Balance</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.balance)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Total Sales Today</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.totalSalesToday)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Total Paid Today</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.totalPaidToday)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Outstanding Invoice Balance</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.balance)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Void Invoice Count</div><div className="mt-2 text-2xl font-semibold text-white">{summary.voidInvoices}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Total Refunds</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(summary.totalRefunds)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Reversed Payments Count</div><div className="mt-2 text-2xl font-semibold text-white">{summary.reversedPayments}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Active Warranties From POS</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.activeWarranties}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Open Warranty Claims</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.openWarrantyClaims}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Pending Commission Entries</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.pendingCommissionEntries}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Pending Commission Amount</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(operationalCounts.pendingCommissionAmount)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Approved but Not Payroll-linked Commission Total</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(operationalCounts.approvedCommissionAmount)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Rejected Commission Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.rejectedCommissionCount}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Payroll-linked but Unpaid Commission Total</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(operationalCounts.payrollLinkedCommissionAmount)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Total Paid Commissions</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(operationalCounts.paidCommissionAmount)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Commission Rules Active Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.activeCommissionRules}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Pending Inventory Movements</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.pendingInventoryMovements}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Applied Inventory Movement Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.appliedInventoryMovements}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Inventory Ledger Movement Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.inventoryLedgerMovementCount}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Manual Stock Adjustment Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.manualStockAdjustmentCount}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Inventory Received Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.inventoryReceivedCount}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Inventory Received Quantity</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.inventoryReceivedQuantity}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Low Stock Count</div><div className="mt-2 text-2xl font-semibold text-white">{operationalCounts.lowStockCount}</div></div>
        <div className="rounded-2xl border border-white/10 bg-[#151515] p-4"><div className="text-xs uppercase text-zinc-500">Gross Profit Estimate</div><div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(operationalCounts.grossProfitEstimate)}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ['Sales by Branch', summary.salesByBranch, true],
          ['Sales by Category', summary.salesByCategory, true],
          ['Payment Method Breakdown', summary.paymentsByMethod, true],
          ['Quotation Conversion Count', summary.quotationsByStatus, false],
          ['Low Stock Items by Branch', operationalCounts.lowStockByBranch, false],
        ].map(([title, rows, currency]) => (
          <div key={String(title)} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">{String(title)}</h2>
            <div className="mt-4 space-y-2">
              {Object.entries(rows as Record<string, number>).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#151515] px-3 py-2 text-sm">
                  <span className="capitalize text-zinc-300">{label.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-white">{currency ? formatCurrency(value) : value}</span>
                </div>
              ))}
              {Object.keys(rows as Record<string, number>).length === 0 ? <div className="text-sm text-zinc-500">No data</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
        <h2 className="text-lg font-semibold text-white">Top Low-stock Items</h2>
        <div className="mt-4 space-y-2">
          {operationalCounts.topLowStockItems.map((item) => (
            <div key={item.inventoryItemId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#151515] px-3 py-2 text-sm">
              <span className="text-zinc-300">{item.name} · {item.branchId}</span>
              <span className="font-semibold text-white">{item.quantity} / {item.reorderLevel}</span>
            </div>
          ))}
          {operationalCounts.topLowStockItems.length === 0 ? <div className="text-sm text-zinc-500">No data</div> : null}
        </div>
      </div>
    </section>
  );
}
