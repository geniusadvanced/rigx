'use client';

import { FormEvent, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useParams } from 'next/navigation';
import { DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails } from '@/components/documents/documentConfig';
import { formatDocumentDate } from '@/components/documents/documentUtils';
import type { WarrantyTermsSnapshot } from '@/features/pos/warrantyTerms';

interface PublicWarranty {
  warrantyId: string;
  warrantyNumber: string;
  jobNumber: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  branchId: string;
  deviceName: string;
  coveredItem: string;
  warrantyDurationDays: number;
  startDate: string | null;
  endDate: string | null;
  claimLimit: string;
  status: string;
  terms: WarrantyTermsSnapshot;
  signed: boolean;
  canSign: boolean;
  warrantySignedAt?: string | null;
  warrantySignedName?: string;
  warrantySignedPhone?: string;
  warrantySignatureDataUrl?: string;
  warrantyTypedSignature?: string;
  warrantyTermsVersion?: string;
}

function TermsList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <div className="font-bold">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function PublicWarrantyPage() {
  const params = useParams<{ token: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [warranty, setWarranty] = useState<PublicWarranty | null>(null);
  const [form, setForm] = useState({ signerName: '', signerPhone: '', typedSignature: '', acknowledged: false });
  const [signatureReady, setSignatureReady] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadWarranty() {
    setLoading(true);
    try {
      const response = await fetch(`/api/public/warranty/${params.token}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load warranty');
      setWarranty(payload.warranty);
      setForm((current) => ({
        ...current,
        signerName: payload.warranty.customerName || '',
        signerPhone: payload.warranty.customerPhone || '',
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Warranty link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWarranty();
  }, [params.token]);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    context.lineTo(point.x, point.y);
    context.stroke();
    setSignatureReady(true);
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureReady(false);
  }

  async function submitSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!warranty?.canSign) return;
    if (!form.acknowledged || !form.signerName.trim() || !form.signerPhone.trim() || (!signatureReady && !form.typedSignature.trim())) {
      setMessage('Please confirm acknowledgement, enter your details, and sign digitally or type your signature.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const signatureDataUrl = signatureReady ? canvasRef.current?.toDataURL('image/png') || '' : '';
      const response = await fetch(`/api/public/warranty/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, signatureDataUrl }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to submit warranty agreement');
      setWarranty(payload.warranty);
      setMessage(payload.message || 'Warranty agreement signed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit warranty agreement');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-white p-6 text-gray-900">Loading warranty</main>;
  if (!warranty) return <main className="min-h-screen bg-white p-6 text-gray-900">{message || 'Warranty link is invalid or expired.'}</main>;

  const branch = getGeniusBranchDetails(warranty.branchId);
  const signed = warranty.signed;

  return (
    <GeniusDocumentLayout
      title="WARRANTY AGREEMENT"
      documentNumber={`Warranty No: ${warranty.warrantyNumber}`}
      date={formatDocumentDate(warranty.startDate || new Date())}
      status={signed ? 'signed' : warranty.status}
      branchName={branch.branchName}
      companyName={branch.companyName}
      branchAddress={branch.address}
      branchPhone={branch.whatsapp}
      email={branch.email}
      website={branch.website}
      legalFooter
      actions={<button type="button" onClick={() => window.print()}>Print</button>}
    >
      {message ? <div className="no-print mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{message}</div> : null}
      {signed ? <div className="no-print mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">SIGNED</div> : null}

      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', warranty.customerName],
          ['Phone Number', warranty.customerPhone],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>

      <DocumentSection title="Warranty Details">
        <DocumentFieldGrid rows={[
          ['Job No', warranty.jobNumber],
          ['Invoice No', warranty.invoiceNo],
          ['Device', warranty.deviceName],
          ['Covered Service / Part', warranty.coveredItem],
          ['Warranty Period', `${warranty.warrantyDurationDays} days`],
          ['Warranty Start Date', formatDocumentDate(warranty.startDate)],
          ['Warranty End Date', formatDocumentDate(warranty.endDate)],
          ['Claim Limit', warranty.claimLimit],
        ]} />
      </DocumentSection>

      <DocumentSection title="Warranty Terms & Conditions">
        <div className="document-terms">
          <TermsList title="Coverage" items={warranty.terms.coverage} />
          <TermsList title="Exclusions" items={warranty.terms.exclusions} />
          <TermsList title="Claim Process" items={warranty.terms.claimProcess} />
          <div className="mt-3"><div className="font-bold">Claim Limit</div><p className="mt-1">{warranty.terms.claimLimit}</p></div>
          <TermsList title="Void Conditions" items={warranty.terms.voidConditions} />
          <div className="mt-3"><div className="font-bold">Customer Acknowledgement</div><p className="mt-1">{warranty.terms.acknowledgement}</p></div>
        </div>
      </DocumentSection>

      <DocumentSection title="Customer Signature">
        {signed ? (
          <div className="grid gap-3">
            <DocumentFieldGrid rows={[
              ['Signed Name', warranty.warrantySignedName || '-'],
              ['Signed Phone', warranty.warrantySignedPhone || '-'],
              ['Signed At', formatDocumentDate(warranty.warrantySignedAt)],
              ['Terms Version', warranty.warrantyTermsVersion || warranty.terms.version],
            ]} />
            {warranty.warrantySignatureDataUrl ? <img src={warranty.warrantySignatureDataUrl} alt="Customer signature" className="h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
            {!warranty.warrantySignatureDataUrl && warranty.warrantyTypedSignature ? <div className="text-lg font-semibold italic text-gray-900">{warranty.warrantyTypedSignature}</div> : null}
          </div>
        ) : warranty.canSign ? (
          <form onSubmit={submitSignature} className="no-print grid gap-3">
            <label className="flex gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm((current) => ({ ...current, acknowledged: event.target.checked }))} />
              <span>{warranty.terms.acknowledgement}</span>
            </label>
            <input required value={form.signerName} onChange={(event) => setForm((current) => ({ ...current, signerName: event.target.value }))} placeholder="Customer Name" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <input required value={form.signerPhone} onChange={(event) => setForm((current) => ({ ...current, signerPhone: event.target.value }))} placeholder="Phone Confirmation" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <input value={form.typedSignature} onChange={(event) => setForm((current) => ({ ...current, typedSignature: event.target.value }))} placeholder="Typed Signature (fallback)" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-gray-600">Digital Signature</div>
              <canvas ref={canvasRef} width={640} height={180} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerLeave={stopDrawing} className="h-36 w-full touch-none rounded-md border border-gray-300 bg-white" />
              <button type="button" onClick={clearSignature} className="mt-2 rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700">Clear signature</button>
            </div>
            <button disabled={submitting || !form.acknowledged} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Submit Warranty Signature'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-700">This warranty agreement can no longer be signed.</p>
        )}
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
