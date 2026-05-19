import type { Job } from '@/types';
import type { PosInvoice, PosPayment, PosQuotation, PosWarranty } from '@/features/pos/types';

export function formatDocumentDate(value?: { toDate?: () => Date } | Date | string | null): string {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') date = value ? new Date(value) : null;
  else date = value?.toDate?.() || null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(date);
}

export function formatDocumentCurrency(value?: number | null): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function documentYear(value?: { toDate?: () => Date } | Date | string | null): string {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') date = value ? new Date(value) : null;
  else date = value?.toDate?.() || null;
  const source = date && !Number.isNaN(date.getTime()) ? date : new Date();
  return String(source.getFullYear()).slice(-2);
}

function stableSequence(input?: string): string {
  const source = String(input || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 10000;
  }
  return String(hash || 1).padStart(4, '0');
}

export function officialInvoiceNo(invoice: PosInvoice): string {
  const existingOfficial = String((invoice as PosInvoice & { officialInvoiceNo?: string }).officialInvoiceNo || '').trim();
  if (/^INV-\d{6}$/.test(existingOfficial)) return existingOfficial;
  if (/^INV-\d{6}$/.test(invoice.invoiceNo || '')) return invoice.invoiceNo;
  return `INV-${documentYear(invoice.createdAt)}${stableSequence(invoice.invoiceId || invoice.invoiceNo)}`;
}

export function officialCustomerNo(input: { customerNumber?: string; officialCustomerId?: string; customerId?: string; customerName?: string; createdAt?: { toDate?: () => Date } | Date | string | null }): string {
  const existingOfficial = String(input.customerNumber || input.officialCustomerId || input.customerId || '').trim();
  if (/^RIGX-\d{6}$/.test(existingOfficial)) return existingOfficial;
  return 'Pending ID';
}

export function jobNumber(job: Job): string {
  return job.jobNo || job.jobNumber || job.jobSheetNo || 'Pending ID';
}

export function officialQuotationNo(quotation: PosQuotation): string {
  if (/^QT-\d{6}$/.test(quotation.quotationNumber || '')) return quotation.quotationNumber || '';
  if (/^QT-\d{6}$/.test(quotation.quotationNo || '')) return quotation.quotationNo;
  return 'Pending ID';
}

export function jobDeviceInfo(job: Job): string {
  return [job.deviceBrand, job.deviceModel].filter(Boolean).join(' ') || job.device || job.deviceType || 'Device';
}

export function formatJobDeviceLabel(input: {
  jobNumber?: string | null;
  jobNo?: string | null;
  jobSheetNo?: string | null;
  repairJobNumber?: string | null;
  repairJobNo?: string | null;
  rigxJobNo?: string | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  deviceName?: string | null;
  device?: string | null;
  deviceType?: string | null;
  fallback?: string;
}): string {
  const jobLabel = [
    input.jobNumber,
    input.jobNo,
    input.jobSheetNo,
    input.repairJobNumber,
    input.repairJobNo,
    input.rigxJobNo,
  ].map((value) => String(value || '').trim()).find(Boolean);
  const deviceLabel = [
    [input.deviceBrand, input.deviceModel].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    input.deviceName,
    input.device,
    input.deviceType,
  ].map((value) => String(value || '').trim()).find(Boolean);
  return [jobLabel, deviceLabel].filter(Boolean).join(' · ') || input.fallback || 'Not linked';
}

export function invoiceDeviceInfo(invoice: PosInvoice): string {
  return invoice.items?.[0]?.name || 'Service';
}

export function quotationDeviceInfo(quotation: PosQuotation): string {
  return quotation.items?.[0]?.name || 'Service';
}

export function receiptNo(payment: PosPayment): string {
  return `RCPT-${payment.paymentId}`;
}

export function warrantyPeriod(warranty: PosWarranty): string {
  if (!warranty.warrantyDurationDays) return '-';
  if (warranty.warrantyDurationDays === 7) return '7 Days';
  if (warranty.warrantyDurationDays % 30 === 0) return `${warranty.warrantyDurationDays / 30} Month${warranty.warrantyDurationDays / 30 > 1 ? 's' : ''}`;
  return `${warranty.warrantyDurationDays} Days`;
}
