'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as QRCode from 'qrcode';
import { doc, getDoc } from 'firebase/firestore';
import { getGeniusBranchDetails } from '@/components/documents/documentConfig';
import { formatDocumentDate } from '@/components/documents/documentUtils';
import { db } from '@/lib/firebase/init';
import { useUser } from '@/lib/hooks/useUser';
import type { Job } from '@/types';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function jobNumber(job: Job): string {
  return text(job.jobNo) || text(job.jobNumber) || text(job.jobSheetNo) || text(job.agnJobNumber) || job.docId;
}

function deviceName(job: Job): string {
  return [job.deviceBrand, job.deviceModel || job.device].map(text).filter(Boolean).join(' ') || text(job.deviceType) || 'Device';
}

function statusLabel(job: Job): string {
  return text(job.lifecycleStatus) || text(job.status) || 'received';
}

export default function JobLabelPrintPage() {
  const params = useParams<{ jobId: string }>();
  const { profile, loading } = useUser();
  const [job, setJob] = useState<Job | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!profile || !params.jobId) return;
    getDoc(doc(db, 'jobs', params.jobId))
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          setMessage('Job not found or you do not have permission to view this job.');
          return;
        }
        setJob({ docId: snapshot.id, ...snapshot.data() } as Job);
      })
      .catch(() => {
        if (!cancelled) setMessage('Job not found or you do not have permission to view this job.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.jobId, profile]);

  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined' || !job) return '';
    return `${window.location.origin}/dashboard/jobs?jobId=${encodeURIComponent(job.docId)}`;
  }, [job]);

  useEffect(() => {
    let cancelled = false;
    if (!qrUrl) return;
    QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 420,
      color: { dark: '#050505', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMessage('Unable to generate QR code.');
      });
    return () => {
      cancelled = true;
    };
  }, [qrUrl]);

  if (loading || !profile) return <div className="p-6 text-sm text-zinc-400">Loading job label</div>;
  if (!job) return <div className="rounded-lg border border-white/10 bg-[#151515] p-6 text-sm text-zinc-300">{message || 'Loading job label'}</div>;

  const branch = getGeniusBranchDetails(job.branchId || profile.branchId || '');
  const displayJobNo = jobNumber(job);

  return (
    <main className="job-label-screen min-h-screen bg-[#101010] p-4 text-zinc-100">
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => window.print()} className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-black">
          Print Job Label
        </button>
        <Link href={`/dashboard/jobs?jobId=${encodeURIComponent(job.docId)}`} className="rounded-md border border-white/10 px-4 py-2 text-sm text-zinc-200">
          Back to Job
        </Link>
      </div>

      <section className="job-label-print-root">
        <div className="label-card">
          <header className="label-header">
            <img src="/branding/genius-logo-transparent.png" alt="Genius Advanced" />
            <div>
              <div className="brand">GENIUS ADVANCED</div>
              <div className="branch">{branch.branchName}</div>
            </div>
          </header>

          <div className="label-title">REPAIR JOB TAG</div>
          <div className="job-no">JOB ID: {displayJobNo}</div>

          <div className="label-fields">
            <div><span>CUSTOMER</span><strong>{job.customerName || '-'}</strong></div>
            <div><span>PHONE</span><strong>{job.customerPhone || '-'}</strong></div>
            <div><span>DEVICE</span><strong>{deviceName(job)}</strong></div>
            {job.serialNumber ? <div><span>SERIAL/IMEI</span><strong>{job.serialNumber}</strong></div> : null}
            <div><span>BRANCH</span><strong>{branch.branchName.replace('Genius Advanced ', '')}</strong></div>
            <div><span>DATE IN</span><strong>{formatDocumentDate(job.receivedAt || (job as Job & { createdAt?: { toDate?: () => Date } }).createdAt)}</strong></div>
            {job.issueDescription ? <div className="wide"><span>ISSUE</span><strong>{job.issueDescription}</strong></div> : null}
            <div><span>STATUS</span><strong>{statusLabel(job).replaceAll('_', ' ')}</strong></div>
          </div>

          <div className="qr-wrap">
            {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${displayJobNo}`} /> : <div className="qr-placeholder">QR</div>}
          </div>
          <p className="qr-instruction">Scan QR to view job progress & device details</p>
        </div>
      </section>

      <style jsx global>{`
        @page {
          size: 100mm 150mm;
          margin: 0;
        }

        .job-label-print-root {
          width: 100mm;
          height: 150mm;
          margin: 0 auto;
          background: white;
          color: #050505;
        }

        .label-card {
          box-sizing: border-box;
          width: 100mm;
          height: 150mm;
          padding: 5mm;
          overflow: hidden;
          font-family: Arial, Helvetica, sans-serif;
          background: #fff;
          color: #050505;
          border: 1px solid #d4d4d8;
        }

        .label-header {
          display: flex;
          align-items: center;
          gap: 3mm;
          border-bottom: 1px solid #111;
          padding-bottom: 3mm;
        }

        .label-header img {
          width: 15mm;
          height: 15mm;
          object-fit: contain;
        }

        .brand {
          font-size: 13pt;
          font-weight: 900;
          line-height: 1.1;
        }

        .branch {
          margin-top: 1mm;
          font-size: 8pt;
          font-weight: 700;
        }

        .label-title {
          margin-top: 3mm;
          text-align: center;
          font-size: 13pt;
          font-weight: 900;
          letter-spacing: 0.6px;
        }

        .job-no {
          margin-top: 2mm;
          border: 2px solid #050505;
          padding: 2mm;
          text-align: center;
          font-size: 15pt;
          font-weight: 900;
        }

        .label-fields {
          margin-top: 3mm;
          display: grid;
          gap: 1.6mm;
          font-size: 8.5pt;
        }

        .label-fields div {
          display: grid;
          grid-template-columns: 24mm 1fr;
          gap: 2mm;
          border-bottom: 1px solid #ddd;
          padding-bottom: 1.2mm;
        }

        .label-fields .wide {
          display: block;
        }

        .label-fields span {
          font-size: 7pt;
          font-weight: 800;
          color: #444;
        }

        .label-fields strong {
          font-size: 8.8pt;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .label-fields .wide strong {
          display: block;
          margin-top: 1mm;
          line-height: 1.25;
          max-height: 11mm;
          overflow: hidden;
        }

        .qr-wrap {
          margin: 4mm auto 0;
          width: 42mm;
          height: 42mm;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .qr-wrap img,
        .qr-placeholder {
          width: 42mm;
          height: 42mm;
        }

        .qr-placeholder {
          border: 1px solid #111;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
        }

        .qr-instruction {
          margin: 2mm 0 0;
          text-align: center;
          font-size: 7.5pt;
          font-weight: 800;
        }

        @media print {
          html,
          body {
            width: 100mm;
            height: 150mm;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          body * {
            visibility: hidden !important;
          }

          .job-label-print-root,
          .job-label-print-root * {
            visibility: visible !important;
          }

          .job-label-print-root {
            position: fixed;
            inset: 0;
            margin: 0;
            border: 0;
          }

          .no-print,
          .document-actions,
          aside,
          nav,
          header {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}
