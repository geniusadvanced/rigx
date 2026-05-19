import type { Timestamp } from 'firebase/firestore';
import type { UserData } from '@/types';
import type { Payroll } from '../types';

type PayslipActor = Pick<UserData, 'uid' | 'role'>;

interface CompanyDetails {
  name: string;
  tradingName: string;
  logoText?: string;
  addressLines?: string[];
}

interface GeneratePayslipPdfOptions {
  company?: CompanyDetails;
  generatedOn?: Date;
}

const FOOTER_TEXT = 'This payslip is system-generated based on approved payroll records.';
const DEFAULT_COMPANY_DETAILS: CompanyDetails = {
  name: 'RIGX',
  tradingName: 'Genius Advanced',
  logoText: 'RIGX',
  addressLines: ['Repair Intelligence & Genius eXecution'],
};

function isLockedPayroll(payroll: Payroll): boolean {
  return payroll.status === 'approved' || payroll.status === 'paid';
}

export function canGeneratePayslip(payroll: Payroll, actor: PayslipActor | null): boolean {
  if (!actor || !isLockedPayroll(payroll)) return false;
  if (actor.role === 'admin' || actor.role === 'manager') return true;
  return actor.role === 'technician' && payroll.technicianId === actor.uid;
}

function formatCurrency(value?: number): string {
  return `RM ${new Intl.NumberFormat('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)}`;
}

function formatTimestamp(value?: Timestamp | Date | string | null): string {
  if (!value) return '-';

  if (value instanceof Date) {
    return value.toLocaleString('en-MY');
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.toDate().toLocaleString('en-MY');
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapePdfText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdfLine(text: string, x: number, y: number, size = 10): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function buildPdfBlob(lines: string[]): Blob {
  const objects: string[] = [];
  const contentStream = lines.join('\n');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

export function getPayslipFileName(payroll: Payroll): string {
  const staffId = sanitizeFilePart(payroll.staffId || 'unknown');
  return `payslip_${staffId}_${payroll.month}.pdf`;
}

export function generatePayslipPdf(
  payroll: Payroll,
  actor: PayslipActor | null,
  options: GeneratePayslipPdfOptions = {},
): string {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Payslip PDF download is only available in the browser');
  }

  if (!canGeneratePayslip(payroll, actor)) {
    throw new Error('Payslip can only be generated for approved or paid payroll records you are allowed to access');
  }

  const company = options.company || DEFAULT_COMPANY_DETAILS;
  const generatedOn = options.generatedOn || new Date();
  const attendance = payroll.breakdown?.attendance;
  const deductions = payroll.breakdown?.deductions;
  const adjustmentBonus = payroll.breakdown?.adjustments?.bonuses ?? payroll.deductions.adjustmentBonus ?? 0;
  const baseSalary = payroll.breakdown?.baseSalary ?? payroll.baseSalary;
  const approvedCommission = payroll.breakdown?.approvedCommission ?? payroll.approvedCommission;
  const generatedAt = payroll.generatedAt || payroll.createdAt;

  const rows = [
    ['Month', payroll.month],
    ['Technician', payroll.displayName || 'Unknown User'],
    ['Staff ID', payroll.staffId || '-'],
    ['Branch', payroll.branchId || '-'],
    ['Payroll Status', payroll.status],
    ['Generated Date', formatTimestamp(generatedAt)],
    ['Generated On', formatTimestamp(generatedOn)],
    ['Approved At', formatTimestamp(payroll.approvedAt)],
    ['Paid At', formatTimestamp(payroll.paidAt)],
    ['', ''],
    ['Earnings', ''],
    ['Base Salary', formatCurrency(baseSalary)],
    ['Approved Commission', formatCurrency(approvedCommission)],
    ['Adjustment Bonus', formatCurrency(adjustmentBonus)],
    ['', ''],
    ['Deductions', ''],
    ['Absent Deduction', formatCurrency(deductions?.absentDeduction ?? payroll.deductions.absentDeduction)],
    ['Half-day Deduction', formatCurrency(deductions?.halfDayDeduction ?? payroll.deductions.halfDayDeduction)],
    ['Manual Deduction', formatCurrency(deductions?.manualDeduction ?? payroll.deductions.manualDeduction)],
    ['', ''],
    ['Attendance Summary', ''],
    ['Working Days', String(attendance?.workingDaysInMonth ?? payroll.attendanceSummary.workingDays)],
    ['Present Days', String(attendance?.presentDays ?? payroll.attendanceSummary.presentDays)],
    ['Absent Days', String(attendance?.absentDays ?? payroll.attendanceSummary.absentDays)],
    ['Half Days', String(attendance?.halfDays ?? payroll.attendanceSummary.halfDays)],
    ['Approved Leave Days', String(attendance?.approvedLeaveDays ?? payroll.attendanceSummary.approvedLeaveDays)],
    ['Late Minutes', String(attendance?.lateMinutes ?? payroll.attendanceSummary.lateMinutes ?? 0)],
    ['', ''],
    ['Net Salary', formatCurrency(payroll.netSalary)],
  ];

  const lines = [
    buildPdfLine(company.logoText || company.name, 48, 812, 16),
    buildPdfLine(`${company.name} / ${company.tradingName}`, 48, 792, 16),
    ...(company.addressLines || []).map((line, index) => buildPdfLine(line, 48, 776 - index * 12, 9)),
    buildPdfLine('Payslip', 48, 766, 20),
    buildPdfLine(`Payroll ID: ${payroll.payrollId}`, 48, 742, 9),
  ];

  let y = company.addressLines?.length ? 726 - company.addressLines.length * 4 : 710;
  rows.forEach(([label, value]) => {
    if (!label && !value) {
      y -= 14;
      return;
    }

    if (!value) {
      lines.push(buildPdfLine(label, 48, y, 12));
      y -= 18;
      return;
    }

    lines.push(buildPdfLine(label, 64, y, 10));
    lines.push(buildPdfLine(value, 250, y, 10));
    y -= 16;
  });

  lines.push(buildPdfLine(FOOTER_TEXT, 48, 54, 9));

  const blob = buildPdfBlob(lines);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const fileName = getPayslipFileName(payroll);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return fileName;
}
