'use client';

import { FormEvent, useState } from 'react';
import { buildWaMeLink } from '@/features/pos/whatsappService';

interface TrackingResult {
  repairId: string;
  jobNo: string;
  branchId: string;
  branchName: string;
  deviceBrand: string;
  deviceModel: string;
  publicStatusLabel: string;
  publicStatus: string;
  progressPercentage: number;
  receivedAt: string | null;
  lastUpdatedAt?: string | null;
  estimatedCompletionAt?: string | null;
  diagnosisSummaryPublic?: string;
  repairSummaryPublic?: string;
  branchWhatsAppNumber: string;
}

interface TrackingPayload {
  result?: TrackingResult;
  results?: TrackingResult[];
}

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-MY') : '-';
}

function deviceLabel(result: TrackingResult): string {
  const words = [result.deviceBrand, result.deviceModel]
    .join(' ')
    .replace(/\bappel\b/gi, 'Apple')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const cleaned = words.filter((word, index) => (
    index === 0 || word.toLowerCase() !== words[index - 1]?.toLowerCase()
  )).join(' ');
  return cleaned || 'Device';
}

const timelineSteps = [
  { key: 'received', label: 'Device Received', minProgress: 10, statuses: ['received'] },
  { key: 'inspection', label: 'Under Inspection', minProgress: 25, statuses: ['diagnosis', 'quotation_required'] },
  { key: 'quotation', label: 'Quotation Ready', minProgress: 45, statuses: ['quotation_sent', 'quotation_approved', 'customer_rejected'] },
  { key: 'repair', label: 'Repair in Progress', minProgress: 70, statuses: ['repair_in_progress'] },
  { key: 'repaired', label: 'Repair Completed', minProgress: 85, statuses: ['repair_completed'] },
  { key: 'pickup', label: 'Ready for Pickup', minProgress: 90, statuses: ['ready_for_collection', 'invoice_sent', 'paid'] },
  { key: 'completed', label: 'Completed', minProgress: 100, statuses: ['closed', 'warranty_active', 'warranty_expired'] },
];

function currentTimelineIndex(result: TrackingResult): number {
  const exactIndex = timelineSteps.findIndex((step) => step.statuses.includes(result.publicStatus));
  if (exactIndex >= 0) return exactIndex;
  return timelineSteps.reduce((activeIndex, step, index) => (
    result.progressPercentage >= step.minProgress ? index : activeIndex
  ), 0);
}

function buildShareMessage(result: TrackingResult): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return [
    'I used Genius Advanced for my device repair and the tracking experience was smooth.',
    '',
    `Repair status: ${result.publicStatusLabel}`,
    `Device: ${deviceLabel(result)}`,
    '',
    origin ? `Check them out: ${origin}/track` : 'Check them out: Genius Advanced',
  ].join('\n');
}

async function copyTrackingLink() {
  if (typeof window === 'undefined' || !navigator.clipboard) return;
  const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  await navigator.clipboard.writeText(`${origin}/track`);
}

function TrackingCard({ result }: { result: TrackingResult }) {
  const activeIndex = currentTimelineIndex(result);
  const shareLink = buildWaMeLink({ message: buildShareMessage(result) });
  const supportLink = buildWaMeLink({
    recipientPhone: result.branchWhatsAppNumber,
    message: `Hi Genius Advanced, I would like to ask about my repair job ${result.jobNo || ''}.`,
  });

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[28px] border border-orange-500/25 bg-[#080808] shadow-[0_0_38px_rgba(249,115,22,0.16)]">
        <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(249,115,22,0.20),rgba(12,12,12,0.96)_42%,rgba(34,197,94,0.08))] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase text-orange-200">Current Repair Status</div>
              <h2 className="mt-2 text-3xl font-semibold text-white md:text-4xl">{result.publicStatusLabel}</h2>
              <p className="mt-2 text-sm text-zinc-400">{result.jobNo || 'Repair job'} · {deviceLabel(result)}</p>
            </div>
            <div className="rounded-2xl border border-orange-400/30 bg-orange-500/10 px-4 py-3 text-right shadow-[0_0_24px_rgba(249,115,22,0.16)]">
              <div className="text-xs text-orange-200">Progress</div>
              <div className="mt-1 text-2xl font-semibold text-white">{result.progressPercentage}%</div>
            </div>
          </div>
          <div className="mt-6 h-3 overflow-hidden rounded-full bg-black/50">
            <div className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-300 to-emerald-400 shadow-[0_0_22px_rgba(249,115,22,0.70)]" style={{ width: `${result.progressPercentage}%` }} />
          </div>
        </div>

        <div className="p-6">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">Branch<div className="mt-1 font-medium text-white">{result.branchName}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">Received<div className="mt-1 font-medium text-white">{formatDate(result.receivedAt)}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">Last Updated<div className="mt-1 font-medium text-white">{formatDate(result.lastUpdatedAt)}</div></div>
            <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">Device<div className="mt-1 font-medium text-white">{deviceLabel(result)}</div></div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-[#0D0D0D] p-4">
            <div className="mb-4 text-sm font-semibold text-white">Repair Journey</div>
            <div className="grid gap-4 md:grid-cols-7">
              {timelineSteps.map((step, index) => {
                const completed = index < activeIndex;
                const current = index === activeIndex;
                return (
                  <div key={step.key} className="relative flex gap-3 md:block">
                    <div className={`h-9 w-9 shrink-0 rounded-full border md:mx-auto ${
                      completed
                        ? 'border-orange-300 bg-orange-500 shadow-[0_0_18px_rgba(249,115,22,0.75)]'
                        : current
                          ? 'animate-pulse border-amber-200 bg-gradient-to-br from-orange-500 via-amber-300 to-emerald-300 shadow-[0_0_28px_rgba(249,115,22,0.95)]'
                          : 'border-white/10 bg-[#191919]'
                    }`} />
                    <div className={`text-sm md:mt-3 md:text-center ${current ? 'font-semibold text-orange-100' : completed ? 'text-zinc-100' : 'text-zinc-500'}`}>
                      {step.label}
                    </div>
                    {index < timelineSteps.length - 1 ? (
                      <div className={`absolute left-4 top-10 h-4 w-px md:left-[calc(50%+18px)] md:top-4 md:h-px md:w-[calc(100%-18px)] ${index < activeIndex ? 'bg-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.8)]' : 'bg-white/10'}`} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {result.diagnosisSummaryPublic || result.repairSummaryPublic ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {result.diagnosisSummaryPublic ? (
                <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">
                  <div className="text-xs font-semibold uppercase text-orange-200">Diagnosis Summary</div>
                  <div className="mt-2 text-white">{result.diagnosisSummaryPublic}</div>
                </div>
              ) : null}
              {result.repairSummaryPublic ? (
                <div className="rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm text-zinc-300">
                  <div className="text-xs font-semibold uppercase text-orange-200">Repair Summary</div>
                  <div className="mt-2 text-white">{result.repairSummaryPublic}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <a href={supportLink} target="_blank" rel="noreferrer" className="rounded-xl border border-orange-500/30 px-4 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-500/10">Contact Branch</a>
            <a href={supportLink} target="_blank" rel="noreferrer" className="rounded-xl border border-emerald-500/25 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/10">WhatsApp Support</a>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-orange-500/20 bg-[#111111]/90 p-5 shadow-[0_0_24px_rgba(249,115,22,0.10)]">
        <h3 className="text-xl font-semibold text-white">Like our repair experience?</h3>
        <p className="mt-1 text-sm text-zinc-400">Share Genius Advanced with your friends.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={shareLink} target="_blank" rel="noreferrer" className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white">Share on WhatsApp</a>
          <button type="button" onClick={() => void copyTrackingLink()} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/5">Copy Link</button>
        </div>
      </div>
    </div>
  );
}

export default function PublicRepairTrackingPage() {
  const [phone, setPhone] = useState('');
  const [repairId, setRepairId] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [results, setResults] = useState<TrackingResult[]>([]);
  const [showJobFallback, setShowJobFallback] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setResult(null);
    setResults([]);
    try {
      const response = await fetch('/api/public/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(showJobFallback ? { repairId, trackingCode } : { phone }),
      });
      const payload = await response.json() as TrackingPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to find repair record');
      if (payload.result) setResult(payload.result);
      else setResults(payload.results || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No repair record found for this phone number. Please check the number or contact Genius Advanced.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-white">
      <section className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-3xl border border-orange-500/20 bg-[#151515]/90 p-6 shadow-[0_0_24px_rgba(249,115,22,0.10)]">
          <div className="text-sm uppercase tracking-[0.22em] text-orange-200">Genius Advanced</div>
          <h1 className="mt-3 text-3xl font-semibold">Repair Tracking</h1>
          <p className="mt-2 text-sm text-zinc-400">Enter the phone number used for your repair job.</p>

          <form onSubmit={submit} className="mt-6 grid gap-3">
            {!showJobFallback ? (
              <label className="grid gap-2 text-xs text-zinc-400">
                Phone Number
                <input
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Example: 01114888499"
                  className="rounded-2xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-orange-500/40 focus:outline-none"
                />
              </label>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs text-zinc-400">
                  Repair ID / RIGX Job Number
                  <input required value={repairId} onChange={(event) => setRepairId(event.target.value)} placeholder="Example: RIGX-260001" className="rounded-2xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-orange-500/40 focus:outline-none" />
                </label>
                <label className="grid gap-2 text-xs text-zinc-400">
                  Tracking Code
                  <input required value={trackingCode} onChange={(event) => setTrackingCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="6-digit tracking code" className="rounded-2xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-orange-500/40 focus:outline-none" />
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button disabled={loading} className="rounded-2xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {loading ? 'Checking...' : 'Track Repair'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowJobFallback((current) => !current);
                  setMessage('');
                  setResult(null);
                  setResults([]);
                }}
                className="text-sm text-orange-200"
              >
                {showJobFallback ? 'Track using phone number' : 'Track using job number instead'}
              </button>
            </div>
          </form>
          {message ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{message}</div> : null}
        </div>

        {results.length > 1 ? (
          <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold">Select Repair Job</h2>
            <div className="mt-3 grid gap-3">
              {results.map((item) => (
                <button
                  key={`${item.jobNo}-${item.lastUpdatedAt || item.receivedAt || item.publicStatus}`}
                  type="button"
                  onClick={() => {
                    setResult(item);
                    setResults([]);
                  }}
                  className="rounded-2xl border border-white/10 bg-[#151515] p-4 text-left hover:border-orange-500/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{item.jobNo || 'Repair job'}</div>
                      <div className="mt-1 text-sm text-zinc-400">{deviceLabel(item)}</div>
                    </div>
                    <div className="rounded-full border border-orange-500/25 px-3 py-1 text-xs text-orange-200">{item.publicStatusLabel}</div>
                  </div>
                  <div className="mt-3 text-xs text-zinc-500">{item.branchName} · Updated {formatDate(item.lastUpdatedAt)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {result ? <TrackingCard result={result} /> : null}
      </section>
    </main>
  );
}
