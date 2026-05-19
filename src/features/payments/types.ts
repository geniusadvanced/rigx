import type { Timestamp } from 'firebase/firestore';

export type JobPaymentType = 'deposit' | 'partial' | 'full_payment' | 'refund' | 'discount';
export type JobPaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'ewallet' | 'other';

export interface JobPayment {
  paymentId: string;
  jobId: string;
  jobSheetNo: string;
  customerName: string;
  amount: number;
  type: JobPaymentType;
  method: JobPaymentMethod;
  referenceNo: string;
  receiptUrl: string | null;
  source?: 'manage_job' | 'legacy';
  invoiceId?: string;
  posPaymentId?: string;
  receivedBy: string;
  receivedByDisplayName: string;
  note: string;
  paidAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JobPaymentFormInput {
  amount: string;
  type: JobPaymentType;
  method: JobPaymentMethod;
  referenceNo: string;
  note: string;
  paidAt: string;
  receiptFile?: File | null;
}

export interface JobPaymentSummary {
  paymentStatus: 'unpaid' | 'deposit_paid' | 'partial_paid' | 'paid' | 'refunded';
  totalAmountDue: number;
  totalPaid: number;
  balanceDue: number;
  discountAmount: number;
  refundAmount: number;
  lastPaymentAt: Timestamp | null;
}
