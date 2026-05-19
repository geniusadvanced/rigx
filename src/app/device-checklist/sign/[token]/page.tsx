'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails } from '@/components/documents/documentConfig';
import { formatDocumentDate } from '@/components/documents/documentUtils';
import type { DeviceChecklistAccessory, DeviceChecklistInternalComponents, DeviceChecklistItem, DeviceChecklistTechnicianVerification } from '@/features/device-checklists/types';

type PublicTechnicianVerification = Omit<DeviceChecklistTechnicianVerification, 'checkedAt'> & { checkedAt?: unknown };

interface PublicDeviceChecklist {
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deviceCategory: string;
  deviceBrandModel: string;
  deviceSerialOrImei: string;
  reportedIssue: string;
  branchId: string;
  items: DeviceChecklistItem[];
  accessories: DeviceChecklistAccessory[];
  internalComponents: DeviceChecklistInternalComponents;
  technicianVerification?: PublicTechnicianVerification | null;
  externalConditionSummary: string;
  functionalChecklist: string;
  accessoriesReceived: string;
  internalComponentInventory: string;
  disclaimer: string;
  checklistStatus: string;
  signed: boolean;
  canSign: boolean;
  customerSignedAt?: string | null;
  customerSignedName?: string;
  customerSignedPhone?: string;
  customerSignatureDataUrl?: string;
  customerTypedSignature?: string;
  publicSignatureTokenUsed?: string;
}

const statusLabels: Record<string, string> = {
  good: 'Good',
  issue: 'Issue',
  not_tested: 'Not Tested',
  na: 'N/A',
  received: 'Received',
  not_received: 'Not Received',
  returned: 'Returned',
  not_returned: 'Not Returned',
  present: 'Present',
  missing: 'Missing',
  not_checked: 'Not Checked',
};

function labelForStatus(value?: string): string {
  return value ? statusLabels[value] || value : '-';
}

function formatVerificationDate(value?: unknown): string {
  if (!value) return '-';
  if (typeof value === 'string') return formatDocumentDate(value);
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    return formatDocumentDate(new Date(value.seconds * 1000));
  }
  return '-';
}

export default function PublicDeviceChecklistSignPage() {
  const params = useParams<{ token: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [checklist, setChecklist] = useState<PublicDeviceChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signatureReady, setSignatureReady] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    customerSignedName: '',
    customerSignedPhone: '',
    customerTypedSignature: '',
    customerAcknowledgedDisclaimer: false,
  });

  async function loadChecklist() {
    setLoading(true);
    try {
      const response = await fetch(`/api/public/device-checklists/${params.token}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Device Checklist link is invalid or expired.');
      setChecklist(payload.checklist);
      setForm((current) => ({
        ...current,
        customerSignedName: payload.checklist.customerName || '',
        customerSignedPhone: payload.checklist.customerPhone || '',
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Device Checklist link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChecklist();
  }, [params.token]);

  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    drawingRef.current = true;
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = canvasPoint(event);
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

  const canSubmit = Boolean(
    checklist?.canSign &&
      form.customerAcknowledgedDisclaimer &&
      form.customerSignedName.trim() &&
      form.customerSignedPhone.trim() &&
      (signatureReady || form.customerTypedSignature.trim()),
  );

  async function submitSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setMessage('Please confirm acknowledgement, enter your details, and sign digitally or type your signature.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const customerSignatureDataUrl = signatureReady ? canvasRef.current?.toDataURL('image/png') || '' : '';
      const response = await fetch(`/api/public/device-checklists/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, customerSignatureDataUrl }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to submit Device Checklist');
      setChecklist(payload.checklist);
      setMessage(payload.message || 'Device Checklist submitted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit Device Checklist');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-white p-6 text-gray-900">Loading Device Checklist</main>;
  if (!checklist) return <main className="min-h-screen bg-white p-6 text-gray-900">{message || 'Device Checklist link is invalid or expired.'}</main>;

  const branch = getGeniusBranchDetails(checklist.branchId);

  return (
    <GeniusDocumentLayout
      title="Device Inspection Checklist"
      documentNumber={`Job No: ${checklist.jobNumber}`}
      date={formatDocumentDate(checklist.customerSignedAt || new Date())}
      status={checklist.signed ? 'CUSTOMER SIGNED' : checklist.checklistStatus}
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
      {checklist.signed ? <div className="no-print mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">This Device Checklist has already been signed.</div> : null}

      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', checklist.customerName],
          ['Phone Number', checklist.customerPhone],
          ['Email', checklist.customerEmail || '-'],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>

      <DocumentSection title="Device Details">
        <DocumentFieldGrid rows={[
          ['Device Type / Category', checklist.deviceCategory || '-'],
          ['Brand / Model', checklist.deviceBrandModel || '-'],
          ['Serial Number / IMEI', checklist.deviceSerialOrImei || '-'],
          ['Reported Issue', checklist.reportedIssue || '-'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Device Inspection Checklist">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs text-gray-900">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2 text-left">Inspection Item</th>
                <th className="border border-gray-300 p-2 text-left">Before Repair</th>
                <th className="border border-gray-300 p-2 text-left">After Repair</th>
                <th className="border border-gray-300 p-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {checklist.items.map((item) => (
                <tr key={item.key}>
                  <td className="border border-gray-300 p-2 font-medium">{item.label}</td>
                  <td className="border border-gray-300 p-2">{labelForStatus(item.beforeStatus)}</td>
                  <td className="border border-gray-300 p-2">{labelForStatus(item.afterStatus)}</td>
                  <td className="border border-gray-300 p-2">{item.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocumentSection>

      <DocumentSection title="Accessories">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs text-gray-900">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2 text-left">Item</th>
                <th className="border border-gray-300 p-2 text-left">Before Repair</th>
                <th className="border border-gray-300 p-2 text-left">After Repair</th>
                <th className="border border-gray-300 p-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {checklist.accessories.map((item) => (
                <tr key={item.key}>
                  <td className="border border-gray-300 p-2 font-medium">{item.label}</td>
                  <td className="border border-gray-300 p-2">{labelForStatus(item.beforeStatus)}</td>
                  <td className="border border-gray-300 p-2">{labelForStatus(item.afterStatus)}</td>
                  <td className="border border-gray-300 p-2">{item.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocumentSection>

      <DocumentSection title="Internal Component Record">
        <DocumentFieldGrid rows={[
          ['RAM', `${labelForStatus(checklist.internalComponents.ram.status)} · ${checklist.internalComponents.ram.quantity || '-'} · ${checklist.internalComponents.ram.capacity || '-'}`],
          ['RAM Note', checklist.internalComponents.ram.note || '-'],
          ['SSD / HDD', `${labelForStatus(checklist.internalComponents.storage.status)} · ${checklist.internalComponents.storage.type || '-'} · ${checklist.internalComponents.storage.capacity || '-'}`],
          ['SSD / HDD Note', checklist.internalComponents.storage.note || '-'],
          ['WiFi Card', labelForStatus(checklist.internalComponents.wifiCard.status)],
          ['WiFi Card Note', checklist.internalComponents.wifiCard.note || '-'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Declaration">
        <p className="text-xs leading-5 text-gray-900">{checklist.disclaimer}</p>
      </DocumentSection>

      <DocumentSection title="Customer Acknowledgement">
        {checklist.signed ? (
          <div className="grid gap-3">
            <DocumentFieldGrid rows={[
              ['Signed Name', checklist.customerSignedName || '-'],
              ['Signed Phone', checklist.customerSignedPhone || '-'],
              ['Signed At', formatDocumentDate(checklist.customerSignedAt)],
            ]} />
            {checklist.customerSignatureDataUrl ? <img src={checklist.customerSignatureDataUrl} alt="Customer signature" className="h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
            {!checklist.customerSignatureDataUrl && checklist.customerTypedSignature ? <div className="text-lg font-semibold italic text-gray-900">{checklist.customerTypedSignature}</div> : null}
          </div>
        ) : (
          <form onSubmit={submitSignature} className="no-print grid gap-3">
            <label className="flex items-start gap-2 text-xs text-gray-900">
              <input
                type="checkbox"
                checked={form.customerAcknowledgedDisclaimer}
                onChange={(event) => setForm((current) => ({ ...current, customerAcknowledgedDisclaimer: event.target.checked }))}
                className="mt-0.5"
              />
              <span>I confirm that I have reviewed the device condition and understand the declaration above.</span>
            </label>
            <input required value={form.customerSignedName} onChange={(event) => setForm((current) => ({ ...current, customerSignedName: event.target.value }))} placeholder="Customer Name" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <input required value={form.customerSignedPhone} onChange={(event) => setForm((current) => ({ ...current, customerSignedPhone: event.target.value }))} placeholder="Phone Confirmation" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <input value={form.customerTypedSignature} onChange={(event) => setForm((current) => ({ ...current, customerTypedSignature: event.target.value }))} placeholder="Typed Signature (fallback)" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-gray-600">Digital Signature</div>
              <canvas ref={canvasRef} width={720} height={220} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} className="h-36 w-full touch-none rounded-md border border-gray-300 bg-white" />
              <button type="button" onClick={clearSignature} className="mt-2 rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700">Clear signature</button>
            </div>
            <button type="submit" disabled={submitting || !canSubmit} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit Device Checklist</button>
          </form>
        )}
      </DocumentSection>

      <DocumentSection title="Technician Verification">
        <DocumentFieldGrid rows={[
          ['Checked By', checklist.technicianVerification?.technicianName || '-'],
          ['Date & Time', formatVerificationDate(checklist.technicianVerification?.checkedAt)],
          ['Verification', checklist.technicianVerification?.verificationText || 'Auto verified by RIGX System'],
        ]} />
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
