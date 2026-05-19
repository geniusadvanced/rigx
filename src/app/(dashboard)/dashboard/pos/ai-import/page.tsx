'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  approveAiPricelistDetectedItem,
  createAiPricelistImport,
  getAiPricelistImports,
  getPriceItems,
  rejectAiPricelistDetectedItem,
  type ReviewAiDetectedItemInput,
} from '@/features/pos/posService';
import type { AiDetectedPriceItem, AiPricelistImport, PosBranch, PriceItem, PriceItemType } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

const branchOptions: Array<{ value: '' | PosBranch; label: string }> = [
  { value: '', label: 'All branches' },
  { value: 'bangi', label: 'Bangi' },
  { value: 'cyberjaya', label: 'Cyberjaya' },
];

const typeOptions: PriceItemType[] = ['service', 'part', 'package', 'diagnostic', 'labor'];

type ItemEdit = ReviewAiDetectedItemInput & {
  rejectionReason: string;
};

function money(value: number): string {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function statusClass(status: string): string {
  if (status === 'approved' || status === 'parsed') return 'border-green-500/20 bg-green-500/10 text-green-300';
  if (status === 'rejected' || status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-300';
  if (status === 'needs_review' || status === 'partially_approved') return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
  return 'border-white/10 bg-white/5 text-zinc-300';
}

function editFromItem(item: AiDetectedPriceItem): ItemEdit {
  return {
    suggestedName: item.suggestedName || '',
    suggestedCategory: item.suggestedCategory || '',
    suggestedType: item.suggestedType || 'service',
    suggestedPrice: Number(item.suggestedPrice || 0),
    suggestedWarrantyDurationDays: Number(item.suggestedWarrantyDurationDays || 0),
    suggestedCostPrice: Number(item.suggestedCostPrice || 0),
    commissionEligible: false,
    active: true,
    updateExistingPriceItemId: item.matchedExistingPriceItemId || '',
    rejectionReason: '',
  };
}

export default function PosAiImportPage() {
  const { firebaseUser, profile, loading } = useUser();
  const [imports, setImports] = useState<AiPricelistImport[]>([]);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [selectedImportId, setSelectedImportId] = useState('');
  const [branchId, setBranchId] = useState<'' | PosBranch>('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [edits, setEdits] = useState<Record<string, ItemEdit>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = can(profile?.role, 'pos.manage');

  const selectedImport = useMemo(
    () => imports.find((importRecord) => importRecord.importId === selectedImportId) || imports[0] || null,
    [imports, selectedImportId],
  );

  async function loadData() {
    if (!profile || !canManage) return;
    const [nextImports, nextPriceItems] = await Promise.all([
      getAiPricelistImports(profile),
      getPriceItems(profile),
    ]);
    setImports(nextImports);
    setPriceItems(nextPriceItems);
    setSelectedImportId((current) => current || nextImports[0]?.importId || '');
  }

  useEffect(() => {
    void loadData().catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load AI imports'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  useEffect(() => {
    if (!selectedImport) return;
    const nextEdits: Record<string, ItemEdit> = {};
    selectedImport.detectedItems?.forEach((item) => {
      nextEdits[item.id] = edits[item.id] || editFromItem(item);
    });
    setEdits(nextEdits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImport?.importId, selectedImport?.detectedItems?.length]);

  async function refreshSelected(importId?: string) {
    if (!profile) return;
    const nextImports = await getAiPricelistImports(profile);
    setImports(nextImports);
    if (importId) setSelectedImportId(importId);
  }

  async function handleCreateImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canManage) return;
    try {
      setBusy(true);
      const importRecord = await createAiPricelistImport({ branchId: branchId || undefined, sourceFile, rawText }, profile);
      setSourceFile(null);
      setRawText('');
      setMessage('AI pricelist import created');
      await refreshSelected(importRecord.importId);
    } catch (error) {
      console.warn('[POS AI PRICELIST IMPORT WARNING]', JSON.stringify({
        action: 'createAiPricelistImport',
        storagePath: sourceFile ? 'ai-pricelist-imports/{importId}/{timestamp}_file' : undefined,
        userUid: profile.uid,
        userRole: profile.role,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode:
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined,
      }, null, 2));
      setMessage(error instanceof Error ? error.message : 'Unable to create import');
    } finally {
      setBusy(false);
    }
  }

  async function handleParse(importId: string) {
    if (!firebaseUser) return;
    try {
      setBusy(true);
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/pos/ai-pricelist-imports/${importId}/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to parse import');
      setMessage('AI pricelist import parsed');
      await refreshSelected(importId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to parse import');
      await refreshSelected(importId);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(item: AiDetectedPriceItem) {
    if (!profile || !selectedImport) return;
    try {
      setBusy(true);
      await approveAiPricelistDetectedItem(selectedImport, item.id, edits[item.id], profile);
      setMessage('Detected item approved');
      await refreshSelected(selectedImport.importId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to approve item');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(item: AiDetectedPriceItem) {
    if (!profile || !selectedImport) return;
    try {
      setBusy(true);
      await rejectAiPricelistDetectedItem(selectedImport, item.id, edits[item.id]?.rejectionReason || '', profile);
      setMessage('Detected item rejected');
      await refreshSelected(selectedImport.importId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reject item');
    } finally {
      setBusy(false);
    }
  }

  function updateEdit(itemId: string, patch: Partial<ItemEdit>) {
    setEdits((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || editFromItem(selectedImport?.detectedItems.find((item) => item.id === itemId) as AiDetectedPriceItem)),
        ...patch,
      },
    }));
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading AI import</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">AI Import</h1>
        <p className="mt-1 text-sm text-zinc-400">AI/OCR-assisted pricelist import with mandatory human review before price items are created.</p>
        <p className="mt-2 text-xs text-zinc-500">Upload or paste a pricelist, parse suggested rows, then approve each item before it is saved to POS.</p>
      </div>

      {message ? <div className="rounded-2xl border border-orange-500/20 bg-[#151515]/90 p-3 text-sm text-orange-100">{message}</div> : null}

      <form onSubmit={handleCreateImport} className="grid gap-4 rounded-3xl border border-white/10 bg-[#111111]/90 p-5 lg:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Upload image/PDF/screenshot</label>
          <input
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
            className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-500/15 file:px-3 file:py-1.5 file:text-orange-200"
          />
          <select value={branchId} onChange={(event) => setBranchId(event.target.value as '' | PosBranch)} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            {branchOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Manual raw text fallback</label>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="Paste pricelist rows here, e.g. Battery replacement RM 180"
            className="min-h-28 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm leading-6 text-white placeholder:text-zinc-600 focus:border-orange-500/40 focus:outline-none"
          />
        </div>

        <div className="flex items-end">
          <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Create Import
          </button>
        </div>
      </form>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          <h2 className="text-lg font-semibold text-white">Import History</h2>
          <div className="mt-4 space-y-2">
            {imports.length === 0 ? <div className="text-sm text-zinc-500">No imports yet.</div> : null}
            {imports.map((importRecord) => (
              <button
                key={importRecord.importId}
                type="button"
                onClick={() => setSelectedImportId(importRecord.importId)}
                className={`w-full rounded-2xl border p-3 text-left text-sm transition ${selectedImport?.importId === importRecord.importId ? 'border-orange-500/30 bg-[#1F160E]' : 'border-white/10 bg-[#151515] hover:border-orange-500/20'}`}
              >
                <div className="font-medium text-white">{importRecord.importNo}</div>
                <div className="mt-1 text-xs text-zinc-500">{importRecord.sourceFileName || 'Pasted text'} · {importRecord.branchId || 'all'}</div>
                <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs ${statusClass(importRecord.status)}`}>{importRecord.status}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
          {!selectedImport ? (
            <div className="text-sm text-zinc-500">Select an import to review detected items.</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedImport.importNo}</h2>
                  <div className="mt-1 text-sm text-zinc-500">{selectedImport.sourceFileName || 'Manual raw text'} · {selectedImport.detectedItems?.length || 0} detected items</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full border px-2 py-1 ${selectedImport.sourceFileUrl ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-white/10 bg-white/5 text-zinc-500'}`}>
                      {selectedImport.sourceFileUrl ? 'Uploaded file available' : 'No uploaded file'}
                    </span>
                    <span className={`rounded-full border px-2 py-1 ${selectedImport.rawExtractedText ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-white/10 bg-white/5 text-zinc-500'}`}>
                      {selectedImport.rawExtractedText ? 'Pasted/extracted text available' : 'No text fallback'}
                    </span>
                    <span className={`rounded-full border px-2 py-1 ${statusClass(selectedImport.status)}`}>
                      {selectedImport.status}
                    </span>
                    {selectedImport.aiModel ? <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-orange-200">{selectedImport.aiModel}</span> : null}
                  </div>
                  {selectedImport.errorMessage ? <div className="mt-2 text-sm text-red-300">{selectedImport.errorMessage}</div> : null}
                  {selectedImport.sourceMimeType === 'application/pdf' ? <div className="mt-2 text-xs text-zinc-500">Text-based PDFs can be parsed. Scanned PDFs need an image upload or manual pasted text.</div> : null}
                  {(selectedImport.sourceMimeType === 'image/jpeg' || selectedImport.sourceMimeType === 'image/png') && !selectedImport.rawExtractedText ? <div className="mt-2 text-xs text-zinc-500">Image OCR requires server-side OPENAI_API_KEY. Manual paste fallback remains available.</div> : null}
                </div>
                <button disabled={busy} onClick={() => void handleParse(selectedImport.importId)} className="rounded-xl border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200 disabled:opacity-50">
                  Parse Import
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr className="border-b border-white/10">
                      <th className="py-3 pr-3">Raw text</th>
                      <th className="py-3 pr-3">Suggested name</th>
                      <th className="py-3 pr-3">Category</th>
                      <th className="py-3 pr-3">Type</th>
                      <th className="py-3 pr-3">Price</th>
                      <th className="py-3 pr-3">Warranty</th>
                      <th className="py-3 pr-3">Match</th>
                      <th className="py-3 pr-3">Status</th>
                      <th className="py-3 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedImport.detectedItems?.length === 0 ? (
                      <tr><td colSpan={9} className="py-5 text-zinc-500">No detected items yet. Paste raw text or upload a file, then parse.</td></tr>
                    ) : null}
                    {selectedImport.detectedItems?.map((item) => {
                      const edit = edits[item.id] || editFromItem(item);
                      return (
                        <tr key={item.id} className="border-b border-white/10 align-top">
                          <td className="max-w-[220px] py-3 pr-3 text-xs leading-5 text-zinc-400">{item.rawText}</td>
                          <td className="py-3 pr-3">
                            <input value={edit.suggestedName} onChange={(event) => updateEdit(item.id, { suggestedName: event.target.value })} className="w-44 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white" />
                            {item.warnings?.length ? <div className="mt-2 text-xs text-amber-200">{item.warnings.join(', ')}</div> : null}
                          </td>
                          <td className="py-3 pr-3"><input value={edit.suggestedCategory || ''} onChange={(event) => updateEdit(item.id, { suggestedCategory: event.target.value })} className="w-32 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white" /></td>
                          <td className="py-3 pr-3">
                            <select value={edit.suggestedType} onChange={(event) => updateEdit(item.id, { suggestedType: event.target.value as PriceItemType })} className="w-32 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white">
                              {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                            </select>
                          </td>
                          <td className="py-3 pr-3">
                            <input type="number" min="0" step="0.01" value={edit.suggestedPrice} onChange={(event) => updateEdit(item.id, { suggestedPrice: Number(event.target.value) })} className="w-28 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white" />
                            <div className="mt-1 text-xs text-zinc-500">{money(edit.suggestedPrice)}</div>
                          </td>
                          <td className="py-3 pr-3"><input type="number" min="0" value={edit.suggestedWarrantyDurationDays || 0} onChange={(event) => updateEdit(item.id, { suggestedWarrantyDurationDays: Number(event.target.value) })} className="w-24 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white" /></td>
                          <td className="py-3 pr-3">
                            <select value={edit.updateExistingPriceItemId || ''} onChange={(event) => updateEdit(item.id, { updateExistingPriceItemId: event.target.value })} className="w-44 rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-white">
                              <option value="">Create new price item</option>
                              {priceItems.map((priceItem) => <option key={priceItem.priceItemId} value={priceItem.priceItemId}>{priceItem.name}</option>)}
                            </select>
                            {item.duplicateCandidate ? <div className="mt-1 text-xs text-amber-200">Possible duplicate existing price item</div> : null}
                          </td>
                          <td className="py-3 pr-3">
                            <div className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusClass(item.status)}`}>{item.status}</div>
                            <div className="mt-1 text-xs text-zinc-500">{item.confidenceScore}% confidence</div>
                          </td>
                          <td className="space-y-2 py-3 pr-3">
                            <button disabled={busy || item.status === 'approved'} onClick={() => void handleApprove(item)} className="block w-full rounded-lg bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                              {edit.updateExistingPriceItemId ? 'Update Existing' : 'Approve New'}
                            </button>
                            <input value={edit.rejectionReason} onChange={(event) => updateEdit(item.id, { rejectionReason: event.target.value })} placeholder="Reject reason" className="w-full rounded-lg border border-white/10 bg-[#050505] px-2 py-1.5 text-xs text-white placeholder:text-zinc-600" />
                            <button disabled={busy || item.status === 'approved'} onClick={() => void handleReject(item)} className="block w-full rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 disabled:opacity-40">Reject</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
