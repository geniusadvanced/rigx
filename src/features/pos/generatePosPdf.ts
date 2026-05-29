import { officialQuotationNo } from '@/components/documents/documentUtils';
import type { PosInvoice, PosLineItem, PosPayment, PosQuotation, PosRefund } from './types';

type PosPdfDocument = PosQuotation | PosInvoice;

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

function formatCurrency(value: number): string {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value: PosPdfDocument['createdAt'] | PosQuotation['validUntil'] | undefined): string {
  return value?.toDate?.().toLocaleDateString('en-MY') || '-';
}

function itemLines(items: PosLineItem[], startY: number): { lines: string[]; y: number } {
  const lines = [
    buildPdfLine('Item', 48, startY, 10),
    buildPdfLine('Qty', 278, startY, 10),
    buildPdfLine('Unit', 326, startY, 10),
    buildPdfLine('Disc', 408, startY, 10),
    buildPdfLine('Total', 472, startY, 10),
  ];
  let y = startY - 18;

  items.forEach((item) => {
    lines.push(buildPdfLine(item.name.slice(0, 36), 48, y, 9));
    lines.push(buildPdfLine(String(item.quantity), 278, y, 9));
    lines.push(buildPdfLine(formatCurrency(item.unitPrice), 326, y, 9));
    lines.push(buildPdfLine(formatCurrency(Number(item.discount || 0)), 408, y, 9));
    lines.push(buildPdfLine(formatCurrency(item.total), 472, y, 9));
    y -= 14;
    if (item.warrantyDurationDays && item.warrantyDurationDays > 0) {
      lines.push(buildPdfLine(`Warranty: ${item.warrantyDurationDays} days`, 64, y, 8));
      y -= 12;
    }
  });

  return { lines, y };
}

function downloadPdf(fileName: string, lines: string[]): string {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('PDF export is only available in the browser');
  }
  const blob = buildPdfBlob(lines);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return fileName;
}

export function downloadQuotationPdf(quotation: PosQuotation): string {
  const { lines: rows, y } = itemLines(quotation.items, 616);
  const quotationNo = officialQuotationNo(quotation);
  const jobReference = quotation.jobNumber || (/^RIGX-\d{6}$/.test(quotation.jobId || '') ? quotation.jobId : 'Not linked');
  const lines = [
    buildPdfLine('Genius Advanced / RIGX', 48, 802, 17),
    buildPdfLine('Quotation', 48, 778, 22),
    buildPdfLine(`Quotation No: ${quotationNo}`, 48, 748, 10),
    buildPdfLine(`Branch: ${quotation.branchId}`, 48, 732, 10),
    buildPdfLine(`Date: ${formatDate(quotation.createdAt)}`, 48, 716, 10),
    buildPdfLine(`Valid Until: ${formatDate(quotation.validUntil)}`, 48, 700, 10),
    buildPdfLine(`Customer: ${quotation.customerName}`, 48, 676, 10),
    buildPdfLine(`Phone: ${quotation.customerPhone}`, 48, 660, 10),
    buildPdfLine(`Job: ${jobReference}`, 48, 644, 10),
    ...rows,
    buildPdfLine(`Subtotal: ${formatCurrency(quotation.subtotal)}`, 370, y - 14, 10),
    buildPdfLine(`Discount: ${formatCurrency(quotation.discountAmount)}`, 370, y - 30, 10),
    buildPdfLine(`Total: ${formatCurrency(quotation.total)}`, 370, y - 50, 13),
    buildPdfLine('Terms: This quotation is valid until the stated date and is subject to parts availability.', 48, 72, 8),
  ];
  return downloadPdf(`quotation_${quotationNo}.pdf`, lines);
}

export function downloadInvoicePdf(invoice: PosInvoice): string {
  const { lines: rows, y } = itemLines(invoice.items, 616);
  const lines = [
    buildPdfLine('Genius Advanced / RIGX', 48, 802, 17),
    buildPdfLine('Invoice', 48, 778, 22),
    buildPdfLine(`Invoice No: ${invoice.invoiceNo}`, 48, 748, 10),
    buildPdfLine(`Branch: ${invoice.branchId}`, 48, 732, 10),
    buildPdfLine(`Date: ${formatDate(invoice.createdAt)}`, 48, 716, 10),
    buildPdfLine(`Customer: ${invoice.customerName}`, 48, 692, 10),
    buildPdfLine(`Phone: ${invoice.customerPhone}`, 48, 676, 10),
    buildPdfLine(`Job: ${/^RIGX-\d{6}$/.test(invoice.jobId || '') ? invoice.jobId : 'Not linked'}`, 48, 660, 10),
    buildPdfLine(`Payment Status: ${invoice.paymentStatus}`, 48, 644, 10),
    ...rows,
    buildPdfLine(`Subtotal: ${formatCurrency(invoice.subtotal)}`, 370, y - 14, 10),
    buildPdfLine(`Discount: ${formatCurrency(invoice.discountAmount)}`, 370, y - 30, 10),
    buildPdfLine(`Total: ${formatCurrency(invoice.total)}`, 370, y - 50, 12),
    buildPdfLine(`Amount Paid: ${formatCurrency(invoice.amountPaid)}`, 370, y - 68, 10),
    buildPdfLine(`Balance: ${formatCurrency(invoice.balance)}`, 370, y - 86, 12),
    buildPdfLine('Terms: Warranty applies only to eligible repaired or replaced items stated above.', 48, 72, 8),
  ];
  return downloadPdf(`invoice_${invoice.invoiceNo}.pdf`, lines);
}

export function downloadReceiptPdf(invoice: PosInvoice, payment: PosPayment): string {
  const receiptNo = `RCPT-${payment.paymentId}`;
  const lines = [
    buildPdfLine('Genius Advanced / RIGX', 48, 802, 17),
    buildPdfLine('Payment Receipt', 48, 778, 22),
    buildPdfLine(`Receipt No: ${receiptNo}`, 48, 748, 10),
    buildPdfLine(`Invoice No: ${invoice.invoiceNo}`, 48, 732, 10),
    buildPdfLine(`Payment Date: ${formatDate(payment.receivedAt)}`, 48, 716, 10),
    buildPdfLine(`Customer: ${invoice.customerName}`, 48, 692, 10),
    buildPdfLine(`Phone: ${invoice.customerPhone}`, 48, 676, 10),
    buildPdfLine(`Branch: ${invoice.branchId}`, 48, 660, 10),
    buildPdfLine(`Payment Method: ${payment.method}`, 48, 636, 10),
    buildPdfLine(`Reference No: ${payment.referenceNo || '-'}`, 48, 620, 10),
    buildPdfLine(`Received By: ${payment.receivedBy || '-'}`, 48, 604, 10),
    buildPdfLine(`Amount Paid: ${formatCurrency(payment.amount)}`, 48, 568, 16),
    buildPdfLine(`Balance After Payment: ${formatCurrency(payment.balanceAfterPayment ?? invoice.balance)}`, 48, 542, 12),
    buildPdfLine('Thank you. This receipt confirms payment received for the invoice above.', 48, 96, 9),
  ];
  return downloadPdf(`receipt_${invoice.invoiceNo}_${payment.paymentId}.pdf`, lines);
}

export function downloadRefundPdf(invoice: PosInvoice, refund: PosRefund): string {
  const lines = [
    buildPdfLine('Genius Advanced / RIGX', 48, 802, 17),
    buildPdfLine('Refund Confirmation', 48, 778, 22),
    buildPdfLine(`Refund No: ${refund.refundNo}`, 48, 748, 10),
    buildPdfLine(`Invoice No: ${invoice.invoiceNo}`, 48, 732, 10),
    buildPdfLine(`Customer: ${refund.customerName}`, 48, 708, 10),
    buildPdfLine(`Phone: ${refund.customerPhone}`, 48, 692, 10),
    buildPdfLine(`Branch: ${refund.branchId}`, 48, 676, 10),
    buildPdfLine(`Refund Method: ${refund.method}`, 48, 652, 10),
    buildPdfLine(`Refund Reason: ${refund.reason}`, 48, 636, 10),
    buildPdfLine(`Approved By: ${refund.approvedBy}`, 48, 620, 10),
    buildPdfLine(`Refunded By: ${refund.refundedBy}`, 48, 604, 10),
    buildPdfLine(`Refunded At: ${formatDate(refund.refundedAt)}`, 48, 588, 10),
    buildPdfLine(`Refund Amount: ${formatCurrency(refund.amount)}`, 48, 548, 16),
    buildPdfLine('This document confirms the refund recorded for the invoice above.', 48, 96, 9),
  ];
  return downloadPdf(`refund_${refund.refundNo}.pdf`, lines);
}
