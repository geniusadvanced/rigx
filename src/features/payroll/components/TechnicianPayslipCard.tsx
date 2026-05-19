'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import type { UserData } from '@/types';
import { logPayslipGenerated } from '../services/payrollService';
import type { Payroll } from '../types';
import { canGeneratePayslip, generatePayslipPdf } from '../utils/generatePayslipPdf';
import { PayslipPreviewModal } from './PayslipPreviewModal';

interface TechnicianPayslipCardProps {
  userData: UserData | null;
}

function getCurrentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(value || 0);
}

function normalizePayrollLoadError(error: unknown): { code: string; message: string } {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'unknown';

  if (code === 'unavailable') {
    return {
      code,
      message: 'Unable to load payslip because Firestore is currently offline. Please check your connection and try again.',
    };
  }

  if (code === 'permission-denied') {
    return {
      code,
      message: 'You do not have permission to view this payslip.',
    };
  }

  if (code === 'not-found') {
    return {
      code,
      message: 'No approved payslip for this month',
    };
  }

  return {
    code,
    message: 'Unable to load payslip. Please try again.',
  };
}

export function TechnicianPayslipCard({ userData }: TechnicianPayslipCardProps) {
  const [month, setMonth] = useState(getCurrentMonth);
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [previewPayroll, setPreviewPayroll] = useState<Payroll | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPayroll() {
      if (!userData?.uid || !userData.role || userData.role !== 'technician') return;

      setLoading(true);
      setMessage('');
      setLoadError(null);

      try {
        const payrollId = `${userData.uid}_${month}`;
        console.log('[DEBUG READ]', 'TechnicianPayslipCard.loadPayroll', `payroll/${payrollId}`, {
          uid: userData.uid,
          role: userData.role,
          month,
          expectedPayrollId: payrollId,
        });
        const snapshot = await getDoc(doc(db, 'payroll', payrollId));

        if (cancelled) return;

        if (!snapshot.exists()) {
          setPayroll(null);
          setMessage('No approved payslip for this month');
          return;
        }

        const nextPayroll = {
          ...(snapshot.data() as Payroll),
          payrollId: snapshot.id,
        };
        setPayroll(nextPayroll);
        setMessage(
          canGeneratePayslip(nextPayroll, userData)
            ? ''
            : 'Payslip is available only after payroll is approved or paid',
        );
      } catch (error) {
        const normalizedError = normalizePayrollLoadError(error);
        console.warn('[PAYSLIP LOAD WARNING]', 'TechnicianPayslipCard.loadPayroll', {
          code: normalizedError.code,
          message: error instanceof Error ? error.message : String(error),
          payrollId: `${userData.uid}_${month}`,
          uid: userData.uid,
          role: userData.role,
          month,
        });
        if (!cancelled) {
          setPayroll(null);
          setLoadError(normalizedError.message);
          setMessage(normalizedError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPayroll();

    return () => {
      cancelled = true;
    };
  }, [month, retryNonce, userData?.role, userData?.uid]);

  if (userData?.role !== 'technician') {
    return null;
  }

  const canDownload = payroll ? canGeneratePayslip(payroll, userData) : false;

  async function handleDownloadPayslip(generatedOn: Date) {
    if (!previewPayroll || !userData?.uid) return;

    try {
      const fileName = generatePayslipPdf(previewPayroll, userData, { generatedOn });
      await logPayslipGenerated({
        userId: userData.uid,
        payrollId: previewPayroll.payrollId,
        fileName,
      });
      setMessage('Payslip downloaded');
      setPreviewPayroll(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate payslip');
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-white">Payslip</h2>
          <p className="mt-1 text-sm text-slate-400">Approved monthly payroll records</p>
        </div>

        <label className="block text-sm text-slate-300">
          Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-[#101010] px-3 py-2 text-white outline-none focus:border-orange-500/35"
          />
        </label>

        <div className="mt-3 rounded-2xl border border-white/10 bg-[#1A1A1A]/80 p-3 text-sm">
          <div className="flex justify-between gap-3 text-slate-300">
            <span>Status</span>
            <span className="rounded-full border border-orange-400/20 px-2 py-0.5 text-xs capitalize text-orange-200">
              {payroll?.status || '-'}
            </span>
          </div>
          <div className="mt-2 flex justify-between gap-3 text-slate-300">
            <span>Net Salary</span>
            <span className="text-[#D88A32]">{payroll ? formatCurrency(payroll.netSalary) : '-'}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={!canDownload || loading}
          onClick={() => payroll && setPreviewPayroll(payroll)}
          className="mt-3 w-full rounded-xl border border-orange-500/40 bg-[#1F160E] px-3 py-2 text-sm font-medium text-orange-100 shadow-[0_0_18px_rgba(249,115,22,0.10)] hover:bg-[#1F160E] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Loading' : 'Generate Payslip'}
        </button>

        {message ? (
          <div className="mt-3 text-sm text-slate-400">
            <div>{message}</div>
            {loadError ? (
              <button
                type="button"
                onClick={() => setRetryNonce((current) => current + 1)}
                className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-orange-200 hover:border-orange-500/35"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {previewPayroll ? (
        <PayslipPreviewModal
          payroll={previewPayroll}
          onClose={() => setPreviewPayroll(null)}
          onDownload={handleDownloadPayslip}
        />
      ) : null}
    </>
  );
}
