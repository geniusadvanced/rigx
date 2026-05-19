'use client';

import { useMemo } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { Payroll } from '../types';
import { getPayslipFileName } from '../utils/generatePayslipPdf';

interface PayslipPreviewModalProps {
  payroll: Payroll;
  onClose: () => void;
  onDownload: (generatedOn: Date) => void;
}

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
  }).format(value || 0);
}

function formatTimestamp(value?: Timestamp | Date | string | null): string {
  if (!value) return '-';
  if (value instanceof Date) return value.toLocaleString('en-MY');
  if (typeof value === 'string') return value;
  return value.toDate().toLocaleString('en-MY');
}

export function PayslipPreviewModal({ payroll, onClose, onDownload }: PayslipPreviewModalProps) {
  const generatedOn = useMemo(() => new Date(), []);
  const attendance = payroll.breakdown?.attendance;
  const deductions = payroll.breakdown?.deductions;
  const adjustmentBonus = payroll.breakdown?.adjustments?.bonuses ?? payroll.deductions.adjustmentBonus ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050505]/80 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-white/10 bg-[#151515] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-orange-200">RIGX / Genius Advanced</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Payslip Preview</h2>
            <p className="mt-1 text-sm text-slate-400">{getPayslipFileName(payroll)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-[#1A1A1A]"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="text-xs uppercase text-slate-500">Technician</div>
            <div className="mt-1 text-sm font-medium text-white">{payroll.displayName || 'Unknown User'}</div>
            <div className="mt-1 text-xs text-slate-500">{payroll.staffId || '-'}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="text-xs uppercase text-slate-500">Month</div>
            <div className="mt-1 text-sm font-medium text-white">{payroll.month}</div>
            <div className="mt-1 text-xs text-slate-500">{payroll.branchId || '-'}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-[#050505] p-3">
            <div className="text-xs uppercase text-slate-500">Status</div>
            <div className="mt-1 text-sm font-medium text-white">{payroll.status}</div>
            <div className="mt-1 text-xs text-slate-500">Generated on {formatTimestamp(generatedOn)}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-white/10 bg-[#050505] p-3">
            <h3 className="mb-3 text-sm font-semibold text-white">Earnings</h3>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
              <div>Base salary</div>
              <div className="text-right">{formatCurrency(payroll.breakdown?.baseSalary ?? payroll.baseSalary)}</div>
              <div>Approved commission</div>
              <div className="text-right">
                {formatCurrency(payroll.breakdown?.approvedCommission ?? payroll.approvedCommission)}
              </div>
              <div>Adjustment bonus</div>
              <div className="text-right">{formatCurrency(adjustmentBonus)}</div>
              <div className="font-medium text-white">Net salary</div>
              <div className="text-right font-medium text-orange-200">{formatCurrency(payroll.netSalary)}</div>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-[#050505] p-3">
            <h3 className="mb-3 text-sm font-semibold text-white">Deductions</h3>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
              <div>Absent deduction</div>
              <div className="text-right">
                {formatCurrency(deductions?.absentDeduction ?? payroll.deductions.absentDeduction)}
              </div>
              <div>Half-day deduction</div>
              <div className="text-right">
                {formatCurrency(deductions?.halfDayDeduction ?? payroll.deductions.halfDayDeduction)}
              </div>
              <div>Manual deduction</div>
              <div className="text-right">
                {formatCurrency(deductions?.manualDeduction ?? payroll.deductions.manualDeduction)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-white/10 bg-[#050505] p-3">
          <h3 className="mb-3 text-sm font-semibold text-white">Attendance Summary</h3>
          <div className="grid grid-cols-2 gap-2 text-sm text-slate-300 md:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-slate-500">Working</div>
              <div>{attendance?.workingDaysInMonth ?? payroll.attendanceSummary.workingDays}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Present</div>
              <div>{attendance?.presentDays ?? payroll.attendanceSummary.presentDays}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Absent</div>
              <div>{attendance?.absentDays ?? payroll.attendanceSummary.absentDays}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Half</div>
              <div>{attendance?.halfDays ?? payroll.attendanceSummary.halfDays}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Leave</div>
              <div>{attendance?.approvedLeaveDays ?? payroll.attendanceSummary.approvedLeaveDays}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Late minutes</div>
              <div>{attendance?.lateMinutes ?? payroll.attendanceSummary.lateMinutes ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-slate-400 md:grid-cols-3">
          <div>Payroll generated: {formatTimestamp(payroll.generatedAt || payroll.createdAt)}</div>
          <div>Approved: {formatTimestamp(payroll.approvedAt)}</div>
          <div>Paid: {formatTimestamp(payroll.paidAt)}</div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-[#1A1A1A]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onDownload(generatedOn)}
            className="rounded-md bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#FB923C]"
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
