import type { PosBranch, PosInvoice, PosPayment, PosQuotation, PosWarranty } from './types';

export type PosWhatsAppMessageType =
  | 'quotation'
  | 'invoice'
  | 'payment_request'
  | 'warranty'
  | 'payment_submission'
  | 'custom';

export type PosWhatsAppMessageStatus = 'draft' | 'sent' | 'failed';
export type PosWhatsAppRelatedEntityType = 'quotation' | 'invoice' | 'paymentSubmission' | 'warranty' | 'job' | 'customer';

export interface PosWhatsAppTemplateConfig {
  templateName: string;
  languageCode: string;
  variables: string[];
}

export interface SendPosWhatsAppInput {
  branchId?: string;
  recipientPhone: string;
  message: string;
  messageType: PosWhatsAppMessageType;
  relatedEntityType?: PosWhatsAppRelatedEntityType;
  relatedEntityId?: string;
  retryOfMessageId?: string;
}

export interface SendPosWhatsAppResult {
  ok: boolean;
  provider: 'whatsapp_business_api';
  senderPhone: string;
  messageLogId?: string;
  messageId?: string;
  error?: string;
}

export interface WarrantyWhatsAppData {
  customerName?: string;
  customerPhone?: string;
  branchId?: string;
  itemName?: string;
  deviceId?: string;
  jobId?: string;
  jobNumber?: string;
  invoiceId?: string;
  warrantyDurationDays?: number | null;
  endDate?: { toDate?: () => Date } | Date | string | null;
  publicWarrantyToken?: string;
}

const defaultBranchWhatsAppNumbers: Record<Extract<PosBranch, 'bangi' | 'cyberjaya'>, string> = {
  bangi: '601114888499',
  cyberjaya: '60199933371',
};

function envBranchWhatsAppNumber(branch: 'bangi' | 'cyberjaya'): string {
  const configured = branch === 'bangi'
    ? process.env.NEXT_PUBLIC_WHATSAPP_BANGI || process.env.WHATSAPP_BANGI
    : process.env.NEXT_PUBLIC_WHATSAPP_CYBERJAYA || process.env.WHATSAPP_CYBERJAYA;
  return normalizeWhatsAppPhoneNumber(configured || defaultBranchWhatsAppNumbers[branch]);
}

export function normalizeBranchForWhatsApp(branch?: string): 'bangi' | 'cyberjaya' {
  const normalized = String(branch || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('bangi')) return 'bangi';
  if (normalized.includes('cyberjaya')) return 'cyberjaya';
  // TODO: make unknown branch WhatsApp fallback configurable when more branches go live.
  return 'cyberjaya';
}

export function getBranchWhatsAppNumber(branch?: string): string {
  return envBranchWhatsAppNumber(normalizeBranchForWhatsApp(branch));
}

export function getWhatsAppSenderForBranch(branchId?: string): string {
  return getBranchWhatsAppNumber(branchId);
}

export function buildWaMeLink(input: { branch?: string; message?: string; recipientPhone?: string }): string {
  const phone = normalizeMalaysiaPhoneNumber(input.recipientPhone || getBranchWhatsAppNumber(input.branch));
  const text = input.message ? `?text=${encodeURIComponent(input.message)}` : '';
  return `https://wa.me/${phone}${text}`;
}

export function normalizeWhatsAppPhoneNumber(phone: string): string {
  return normalizeMalaysiaPhoneNumber(phone);
}

export function normalizeMalaysiaPhoneNumber(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `6${digits}`;
  return digits;
}

function formatAmount(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(2);
}

function deviceInfoFromParts(parts: Array<string | undefined | null>): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ') || 'your device';
}

function documentUrl(path: string, token?: string): string {
  if (!token) return '';
  const origin = process.env.NEXT_PUBLIC_APP_URL || globalThis.location?.origin || '';
  return origin ? `${origin}${path}${token}` : '';
}

function publicJobReference(value?: string, fallback = 'Not linked'): string {
  return /^RIGX-\d{6}$/.test(String(value || '')) ? String(value) : fallback;
}

function buildMessage(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => line !== null && line !== undefined).join('\n').trim();
}

export function getQuotationDeviceInfo(quotation: Pick<PosQuotation, 'items' | 'deviceId' | 'jobId'>): string {
  return deviceInfoFromParts([
    quotation.items?.[0]?.name,
    quotation.items?.length > 1 ? `and ${quotation.items.length - 1} more item(s)` : '',
  ]);
}

export function getInvoiceDeviceInfo(invoice: Pick<PosInvoice, 'items' | 'deviceId' | 'jobId'>): string {
  return deviceInfoFromParts([
    invoice.items?.[0]?.name,
    invoice.items?.length > 1 ? `and ${invoice.items.length - 1} more item(s)` : '',
  ]);
}

export function buildQuotationWhatsAppMessage(quotation: PosQuotation): string {
  const amount = formatAmount(quotation.total);
  const link = documentUrl('/q/', quotation.publicToken);
  const jobReference = quotation.jobNumber || publicJobReference(quotation.jobId, quotation.quotationNo);

  return buildMessage([
    `Hi ${quotation.customerName || 'Customer'}, this is Genius Advanced.`,
    '',
    `Your quotation for ${getQuotationDeviceInfo(quotation)} is ready.`,
    '',
    `Job: ${jobReference}`,
    amount ? `Quotation Amount: RM${amount}` : null,
    '',
    'Please review the quotation and let us know if you would like to proceed with the repair.',
    '',
    'Thank you for choosing Genius Advanced.',
    '',
    link ? `Quotation Link: ${link}` : null,
  ]);
}

export function buildInvoiceWhatsAppMessage(invoice: PosInvoice): string {
  const amount = formatAmount(invoice.total);
  const link = documentUrl('/invoice/', invoice.publicPaymentToken);

  return buildMessage([
    `Hi ${invoice.customerName || 'Customer'}, this is Genius Advanced.`,
    '',
    `Your repair invoice for ${getInvoiceDeviceInfo(invoice)} is ready.`,
    '',
    `Job: ${publicJobReference(invoice.jobId, invoice.invoiceNo)}`,
    amount ? `Invoice Amount: RM${amount}` : null,
    '',
    'You may proceed with payment or contact us if you need any clarification.',
    '',
    'Thank you for trusting Genius Advanced.',
    '',
    link ? `Invoice Link: ${link}` : null,
  ]);
}

export function buildWarrantyWhatsAppMessage(warranty: WarrantyWhatsAppData): string {
  const warrantyPeriod = warranty.warrantyDurationDays ? `${warranty.warrantyDurationDays} days` : '';
  const endDate = warranty.endDate instanceof Date
    ? warranty.endDate
    : typeof warranty.endDate === 'string'
      ? new Date(warranty.endDate)
      : warranty.endDate?.toDate?.();
  const validUntil = endDate && !Number.isNaN(endDate.getTime())
    ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(endDate)
    : '';
  const link = documentUrl('/warranty/', warranty.publicWarrantyToken);

  return buildMessage([
    `Hi ${warranty.customerName || 'Customer'}, Genius Advanced here.`,
    '',
    'Your device warranty details are ready.',
    '',
    `Job No: ${warranty.jobNumber || warranty.jobId || warranty.invoiceId || '-'}`,
    `Device: ${deviceInfoFromParts([warranty.itemName, warranty.deviceId])}`,
    warrantyPeriod ? `Warranty Period: ${warrantyPeriod}` : null,
    validUntil ? `Valid Until: ${validUntil}` : null,
    '',
    link ? 'Please review and sign your warranty terms here:' : 'Please keep this message and document as your warranty reference.',
    link || null,
    '',
    'Thank you for choosing Genius Advanced.',
  ]);
}

export function buildRepairStatusWhatsAppMessage(input: {
  customerName?: string;
  jobNumber?: string;
  deviceInfo?: string;
  status?: string;
  documentLink?: string;
}): string {
  return buildMessage([
    `Hi ${input.customerName || 'Customer'}, this is Genius Advanced.`,
    '',
    `Here is the latest update for your ${input.deviceInfo || 'your device'}.`,
    '',
    `Job ID: ${input.jobNumber || '-'}`,
    input.status ? `Current Status: ${input.status}` : null,
    '',
    'We will update you again once there is further progress.',
    '',
    'Thank you for your patience.',
    '',
    input.documentLink ? `Tracking Link: ${input.documentLink}` : null,
  ]);
}

export function buildReadyForPickupWhatsAppMessage(input: {
  customerName?: string;
  jobNumber?: string;
  deviceInfo?: string;
  branchName?: string;
  amount?: number | null;
}): string {
  const amount = formatAmount(input.amount);
  return buildMessage([
    'Hi, Genius Advanced here.',
    '',
    'Good news, your device is now ready for pickup.',
    '',
    'You may collect it at our branch during our operating hours:',
    '10:00 AM - 7:30 PM',
    '',
    'Please bring your job reference number when collecting:',
    input.jobNumber || '-',
    '',
    input.branchName ? `Branch: ${input.branchName}` : null,
    amount ? `Outstanding balance: RM ${amount}` : null,
    '',
    'Thank you.',
  ]);
}

export function buildPaymentReminderWhatsAppMessage(input: {
  customerName?: string;
  jobNumber?: string;
  deviceInfo?: string;
  amount?: number | null;
}): string {
  const amount = formatAmount(input.amount);
  return buildMessage([
    `Hi ${input.customerName || 'Customer'}, this is Genius Advanced.`,
    '',
    `This is a gentle reminder regarding your payment for ${input.deviceInfo || 'your device'}.`,
    '',
    `Job ID: ${input.jobNumber || '-'}`,
    amount ? `Amount Due: RM${amount}` : null,
    '',
    'Kindly let us know once payment has been made.',
    '',
    'Thank you.',
  ]);
}

export function buildWarrantyWhatsAppLink(warranty: PosWarranty): string {
  return buildWaMeLink({
    branch: warranty.branchId,
    recipientPhone: warranty.customerPhone,
    message: buildWarrantyWhatsAppMessage(warranty),
  });
}

export function buildPaymentReminderWhatsAppLink(invoice: PosInvoice): string {
  return buildWaMeLink({
    branch: invoice.branchId,
    recipientPhone: invoice.customerPhone,
    message: buildPaymentReminderWhatsAppMessage({
      customerName: invoice.customerName,
      jobNumber: publicJobReference(invoice.jobId, invoice.invoiceNo),
      deviceInfo: getInvoiceDeviceInfo(invoice),
      amount: invoice.balance,
    }),
  });
}

export function buildReceiptWhatsAppMessage(invoice: PosInvoice, payment: PosPayment): string {
  const amount = formatAmount(payment.amount);
  const receiptNo = `RCPT-${payment.paymentId}`;

  return buildMessage([
    `Hi ${invoice.customerName || 'Customer'}, thank you for your payment of RM${amount} to Genius Advanced.`,
    '',
    'Payment received for:',
    invoice.invoiceNo || publicJobReference(invoice.jobId, invoice.invoiceId),
    '',
    `Receipt No: ${receiptNo}`,
    `Payment Method: ${payment.method}`,
    '',
    'You may keep this message as payment confirmation.',
    'Thank you for choosing Genius Advanced.',
  ]);
}

export function buildReceiptWhatsAppLink(invoice: PosInvoice, payment: PosPayment): string {
  return buildWaMeLink({
    branch: invoice.branchId,
    recipientPhone: invoice.customerPhone,
    message: buildReceiptWhatsAppMessage(invoice, payment),
  });
}

export async function sendPosWhatsAppBusinessMessage(
  input: SendPosWhatsAppInput,
  idToken: string,
): Promise<SendPosWhatsAppResult> {
  const response = await fetch('/api/pos/whatsapp/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to send WhatsApp message');
  }
  return payload as SendPosWhatsAppResult;
}
