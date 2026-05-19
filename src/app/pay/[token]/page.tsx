'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { buildWaMeLink } from '@/features/pos/whatsappService';

interface PublicInvoice {
  invoiceNo: string;
  branchId: string;
  customerName: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
}

interface PublicSubmissionStatus {
  submissionReference: string;
  amountClaimed: number;
  method: string;
  status: string;
  createdAt?: string | null;
  rejectionReason?: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

export default function PublicInvoicePaymentPage() {
  const params = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [submissions, setSubmissions] = useState<PublicSubmissionStatus[]>([]);
  const [form, setForm] = useState({ amountClaimed: '', method: 'bank_transfer', referenceNo: '', note: '', proofImage: null as File | null });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadInvoice() {
    setLoading(true);
    try {
      const response = await fetch(`/api/public/invoice/${params.token}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load invoice');
      setInvoice(payload.invoice);
      setSubmissions(payload.submissions || []);
      setForm((current) => ({ ...current, amountClaimed: String(payload.invoice.balance || '') }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load invoice');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoice();
  }, [params.token]);

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.set('amountClaimed', form.amountClaimed);
      formData.set('method', form.method);
      formData.set('referenceNo', form.referenceNo);
      formData.set('note', form.note);
      if (form.proofImage) formData.set('proofImage', form.proofImage);
      const response = await fetch(`/api/public/invoice/${params.token}/submissions`, { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to submit payment proof');
      setMessage(`Payment proof received and pending verification. Reference: ${payload.submissionReference}`);
      setForm({ amountClaimed: '', method: 'bank_transfer', referenceNo: '', note: '', proofImage: null });
      await loadInvoice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit payment proof');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-[#050505] p-6 text-zinc-300">Loading invoice</main>;
  if (!invoice) return <main className="min-h-screen bg-[#050505] p-6 text-zinc-300">{message || 'Invoice not found'}</main>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.10),transparent_34%),#050505] px-4 py-8 text-zinc-100">
      <section className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-3xl border border-white/10 bg-[#151515]/95 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <div className="text-xs uppercase tracking-[0.28em] text-[#D88A32]">Genius Advanced</div>
          <h1 className="mt-3 text-2xl font-semibold text-white">{invoice.invoiceNo}</h1>
          <p className="mt-1 text-sm text-zinc-400">{invoice.customerName} · {invoice.branchId}</p>
          <div className="mt-3 rounded-full border border-orange-500/25 px-3 py-1 text-xs capitalize text-orange-200 inline-flex">{invoice.paymentStatus}</div>
        </div>

        {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

        <div className="rounded-3xl border border-white/10 bg-[#151515]/95 p-5">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-zinc-300"><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
            <div className="flex justify-between text-zinc-300"><span>Amount paid</span><span>{formatCurrency(invoice.amountPaid)}</span></div>
            <div className="flex justify-between text-xl font-semibold text-white"><span>Balance</span><span>{formatCurrency(invoice.balance)}</span></div>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Please upload your transfer or DuitNow proof. Payment will be confirmed after admin review.</p>
          <a href={buildWaMeLink({ branch: invoice.branchId })} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl border border-orange-500/20 px-3 py-2 text-sm text-orange-200">WhatsApp contact</a>
        </div>

        {submissions.length > 0 ? (
          <div className="rounded-3xl border border-white/10 bg-[#151515]/95 p-5">
            <h2 className="text-lg font-semibold text-white">Recent Submission Status</h2>
            <div className="mt-3 space-y-2">
              {submissions.map((submission, index) => (
                <div key={submission.submissionReference || index} className="rounded-2xl border border-white/10 bg-[#101010] p-3 text-sm">
                  <div className="flex justify-between gap-3 text-zinc-300"><span>{formatCurrency(submission.amountClaimed)} · {submission.method}</span><span className="capitalize text-orange-200">{submission.status}</span></div>
                  {submission.rejectionReason ? <div className="mt-1 text-xs text-red-300">{submission.rejectionReason}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#111111]/95">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Total</th></tr></thead>
            <tbody>{invoice.items.map((item, index) => <tr key={`${item.name}-${index}`} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white">{item.name}</td><td className="px-4 py-3 text-zinc-300">{item.quantity}</td><td className="px-4 py-3 text-zinc-300">{formatCurrency(item.total)}</td></tr>)}</tbody>
          </table>
        </div>

        {invoice.paymentStatus !== 'void' && invoice.balance > 0 ? (
          <form onSubmit={submitPayment} className="rounded-3xl border border-white/10 bg-[#151515]/95 p-5">
            <h2 className="text-lg font-semibold text-white">Submit Payment Proof</h2>
            <div className="mt-4 grid gap-3">
              <input required type="number" min="0.01" step="0.01" value={form.amountClaimed} onChange={(event) => setForm((current) => ({ ...current, amountClaimed: event.target.value }))} placeholder="Amount paid" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <select value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><option value="bank_transfer">Bank transfer</option><option value="duitnow">DuitNow</option><option value="ewallet">E-wallet</option><option value="other">Other</option></select>
              <input value={form.referenceNo} onChange={(event) => setForm((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="Reference no" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setForm((current) => ({ ...current, proofImage: event.target.files?.[0] || null }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Note" className="min-h-20 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <button disabled={submitting} className="rounded-2xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Submit Payment Proof</button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
