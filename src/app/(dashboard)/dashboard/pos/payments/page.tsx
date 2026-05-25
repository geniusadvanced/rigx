'use client';

import { useEffect, useState } from 'react';
import { getInvoices, getPayments } from '@/features/pos/posService';
import type { PosInvoice, PosPayment } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function PosPaymentsPage() {
  const { profile, loading } = useUser();
  const [payments, setPayments] = useState<PosPayment[]>([]);
  const [invoices, setInvoices] = useState<PosInvoice[]>([]);
  const [message, setMessage] = useState('');
  const canOperate = can(profile?.role, 'pos.operate');

  useEffect(() => {
    if (!profile || !canOperate) return;
    Promise.all([getPayments(profile), getInvoices(profile)])
      .then(([paymentRows, invoiceRows]) => {
        setPayments(paymentRows);
        setInvoices(invoiceRows);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load payments'));
  }, [canOperate, profile]);

  const invoicesById = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));

  function paymentInvoiceReference(payment: PosPayment): string {
    const invoice = invoicesById.get(payment.invoiceId);
    return invoice?.invoiceNo
      || invoice?.officialInvoiceNo
      || invoice?.jobId
      || invoice?.quotationId
      || payment.referenceNo
      || payment.invoiceId
      || '-';
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading payments</div>;
  if (!canOperate) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5"><h1 className="text-2xl font-semibold text-white">Payments</h1></div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Proof</th></tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment.paymentId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white">{paymentInvoiceReference(payment)}</td><td className="px-4 py-3 text-zinc-300">{payment.branchId}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(payment.amount)}</td><td className="px-4 py-3 text-zinc-300">{payment.method}</td><td className="px-4 py-3 text-zinc-300">{payment.referenceNo || '-'}</td><td className="px-4 py-3">{payment.proofImageUrl ? <a href={payment.proofImageUrl} target="_blank" rel="noreferrer" className="text-orange-200">View</a> : <span className="text-zinc-500">-</span>}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
