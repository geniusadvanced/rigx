'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { DocumentFieldGrid, DocumentSection, GeniusDocumentLayout } from '@/components/documents';
import { getGeniusBranchDetails, officialRepairTerms } from '@/components/documents/documentConfig';
import { formatDocumentDate } from '@/components/documents/documentUtils';

interface PublicJobSheet {
  jobId: string;
  dateReceived?: string | null;
  status: string;
  branchId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  officialCustomerId?: string;
  deviceType?: string;
  deviceModel?: string;
  serialNumber?: string;
  accessoriesReceived?: string;
  deviceCondition?: string;
  reportedProblem?: string;
  initialDiagnosis?: string;
  dataBackupRequired?: string;
  passwordProvided?: string;
  estimatedDiagnosisTime?: string;
  technicianName?: string;
  signed: boolean;
  signedAt?: string | null;
  signer?: { name?: string; icOrPassportNo?: string; phone?: string; signedDate?: string } | null;
  signatureData?: string;
  canSign: boolean;
}

const checklistItems = [
  ['inspectionDiagnosisAuthorised', 'I authorise Genius Advanced to inspect and diagnose my device.'],
  ['dataLossAcknowledged', 'I understand that Genius Advanced is not responsible for any data loss, corruption or damage.'],
  ['preExistingFaultAcknowledged', 'I understand that pre-existing faults, hidden defects, previous repair attempts or the overall condition of the device may affect the repair outcome.'],
  ['electronicApprovalAccepted', 'I agree that approval given through WhatsApp, SMS, phone call, email or any electronic communication is valid authorisation to proceed with repair.'],
  ['termsAccepted', 'I agree to the Repair Terms & Conditions stated in this document.'],
] as const;

function todayMalaysia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}

export default function PublicJobSheetPage() {
  const params = useParams<{ token: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [jobSheet, setJobSheet] = useState<PublicJobSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [signatureReady, setSignatureReady] = useState(false);
  const [form, setForm] = useState({
    signerName: '',
    icOrPassportNo: '',
    phone: '',
    signedDate: todayMalaysia(),
    checklist: {
      inspectionDiagnosisAuthorised: false,
      dataLossAcknowledged: false,
      preExistingFaultAcknowledged: false,
      electronicApprovalAccepted: false,
      termsAccepted: false,
    } as Record<string, boolean>,
  });

  async function loadJobSheet() {
    setLoading(true);
    try {
      const response = await fetch(`/api/public/job-sheets/${params.token}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Job Sheet link is invalid or expired.');
      setJobSheet(payload.jobSheet);
      setForm((current) => ({
        ...current,
        signerName: payload.jobSheet.customerName || '',
        phone: payload.jobSheet.customerPhone || '',
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Job Sheet link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadJobSheet();
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
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
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

  const allChecked = checklistItems.every(([key]) => form.checklist[key]);
  const canSubmit = Boolean(jobSheet?.canSign && allChecked && form.signerName.trim() && form.phone.trim() && signatureReady);

  async function submitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setMessage('Please tick all consent checklist items, enter required details, and sign digitally.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const signatureData = canvasRef.current?.toDataURL('image/png') || '';
      const response = await fetch(`/api/public/job-sheets/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, signatureData }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to submit Job Sheet');
      setJobSheet(payload.jobSheet);
      setMessage(payload.message || 'Job Sheet submitted. Genius Advanced has received your consent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit Job Sheet');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-white p-6 text-gray-900">Loading Job Sheet</main>;
  if (!jobSheet) return <main className="min-h-screen bg-white p-6 text-gray-900">{message || 'Job Sheet link is invalid or expired.'}</main>;

  const branch = getGeniusBranchDetails(jobSheet.branchId);

  return (
    <GeniusDocumentLayout
      title="REPAIR JOB SHEET"
      documentNumber={`Job ID: ${jobSheet.jobId}`}
      date={formatDocumentDate(jobSheet.dateReceived || new Date())}
      status={jobSheet.signed ? 'SIGNED' : jobSheet.status}
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
      {jobSheet.signed ? <div className="no-print mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">This Job Sheet has already been signed.</div> : null}
      {!jobSheet.canSign && !jobSheet.signed ? <div className="no-print mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This Job Sheet can no longer be signed.</div> : null}

      <DocumentSection title="Customer Details">
        <DocumentFieldGrid rows={[
          ['Customer Name', jobSheet.customerName],
          ['Phone Number', jobSheet.customerPhone],
          ['Email', jobSheet.customerEmail || '-'],
          ['Customer ID', jobSheet.officialCustomerId || '-'],
          ['Branch', branch.branchName],
        ]} />
      </DocumentSection>

      <DocumentSection title="Device Details">
        <DocumentFieldGrid rows={[
          ['Device Type', jobSheet.deviceType || '-'],
          ['Device Model', jobSheet.deviceModel || 'Not specified'],
          ['Serial Number / IMEI', jobSheet.serialNumber || '-'],
          ['Accessories Received', jobSheet.accessoriesReceived || '-'],
          ['Device Condition Upon Receiving', jobSheet.deviceCondition || '-'],
          ['Reported Problem', jobSheet.reportedProblem || '-'],
          ['Initial Diagnosis / Technician Notes', jobSheet.initialDiagnosis || '-'],
          ['Data Backup Required', jobSheet.dataBackupRequired || '-'],
          ['Password / PIN Provided', jobSheet.passwordProvided || '-'],
          ['Estimated Diagnosis Time', jobSheet.estimatedDiagnosisTime || '-'],
        ]} />
      </DocumentSection>

      <DocumentSection title="Customer Consent Checklist">
        <div className="space-y-2 text-xs text-gray-900">
          {checklistItems.map(([key, label]) => (
            jobSheet.signed ? (
              <div key={key} className="flex items-start gap-2">
                <span aria-hidden="true">☑</span>
                <span>{label}</span>
              </div>
            ) : (
              <label key={key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={form.checklist[key]}
                  disabled={!jobSheet.canSign}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    checklist: { ...current.checklist, [key]: event.target.checked },
                  }))}
                  className="mt-0.5"
                />
                <span>{label}</span>
              </label>
            )
          ))}
        </div>
      </DocumentSection>

      <DocumentSection title="Repair Terms & Conditions">
        <div className="document-terms">
          {officialRepairTerms.map((term) => (
            <div key={term.title} className="mt-2">
              <div className={term.body ? 'font-bold' : 'document-terms-title'}>{term.title}</div>
              {term.body.split('\n').filter(Boolean).map((line, index) => <p key={index} className="mt-1">{line}</p>)}
            </div>
          ))}
        </div>
      </DocumentSection>

      <DocumentSection title="Customer Signature">
        {jobSheet.signed ? (
          <div className="grid gap-3">
            <DocumentFieldGrid rows={[
              ['Customer / Representative Name', jobSheet.signer?.name || '-'],
              ['IC / Passport No.', jobSheet.signer?.icOrPassportNo || '-'],
              ['Phone Number', jobSheet.signer?.phone || '-'],
              ['Signed Date', formatDocumentDate(jobSheet.signer?.signedDate || jobSheet.signedAt)],
            ]} />
            {jobSheet.signatureData ? <img src={jobSheet.signatureData} alt="Customer signature" className="h-24 max-w-xs border border-gray-300 bg-white object-contain p-2" /> : null}
          </div>
        ) : (
          <form onSubmit={submitConsent} className="no-print grid gap-3">
            <input
              required
              value={form.signerName}
              onChange={(event) => setForm((current) => ({ ...current, signerName: event.target.value }))}
              placeholder="Customer / Representative Name"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
            <input
              value={form.icOrPassportNo}
              onChange={(event) => setForm((current) => ({ ...current, icOrPassportNo: event.target.value }))}
              placeholder="IC / Passport No (optional)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
            <input
              required
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Phone Number"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
            <input
              type="date"
              value={form.signedDate}
              readOnly
              className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900"
            />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-gray-600">Digital Signature</div>
              <canvas
                ref={canvasRef}
                width={720}
                height={220}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                className="h-36 w-full touch-none rounded-md border border-gray-300 bg-white"
              />
              <button type="button" onClick={clearSignature} className="mt-2 rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700">Clear signature</button>
            </div>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Submit Job Sheet
            </button>
          </form>
        )}
      </DocumentSection>
    </GeniusDocumentLayout>
  );
}
