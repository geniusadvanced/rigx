import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import type { Job, UserData } from '@/types';
import type { Customer } from '../types';
import type {
  PaymentSubmission,
  PosInvoice,
  PosPayment,
  PosQuotation,
  PosRefund,
  PosWarranty,
  PosWarrantyClaim,
} from '@/features/pos/types';
import type {
  PosWhatsAppConversation,
  PosWhatsAppInboundMessage,
  PosWhatsAppMessageLog,
} from '@/features/pos/whatsappMessageService';

export interface CustomerFinancialSummary {
  totalQuoted: number;
  totalInvoiced: number;
  totalPaid: number;
  outstandingBalance: number;
  totalRefunded: number;
  activeWarrantyCount: number;
  openJobCount: number;
  completedJobCount: number;
  whatsappConversationCount: number;
  paymentSubmissionPendingCount: number;
}

export interface Customer360Data {
  customer: Customer;
  summary: CustomerFinancialSummary;
  jobs: Job[];
  quotations: PosQuotation[];
  invoices: PosInvoice[];
  payments: PosPayment[];
  refunds: PosRefund[];
  warranties: PosWarranty[];
  warrantyClaims: PosWarrantyClaim[];
  whatsAppConversations: PosWhatsAppConversation[];
  whatsAppMessages: PosWhatsAppMessageLog[];
  whatsAppInboundMessages: PosWhatsAppInboundMessage[];
  paymentSubmissions: PaymentSubmission[];
}

function mapDoc<T>(idField: string) {
  return (docSnapshot: { id: string; data: () => Record<string, unknown> }) => ({
    ...docSnapshot.data(),
    [idField]: docSnapshot.id,
  } as T);
}

async function getCustomer(customerId: string): Promise<Customer> {
  const customerDoc = await getDoc(doc(db, 'customers', customerId));
  if (!customerDoc.exists()) throw new Error('Customer not found');
  return { ...(customerDoc.data() as Omit<Customer, 'customerId'>), customerId: customerDoc.id };
}

function buildSummary(input: {
  jobs: Job[];
  quotations: PosQuotation[];
  invoices: PosInvoice[];
  refunds: PosRefund[];
  warranties: PosWarranty[];
  whatsAppConversations: PosWhatsAppConversation[];
  paymentSubmissions: PaymentSubmission[];
}): CustomerFinancialSummary {
  const validInvoices = input.invoices.filter((invoice) => invoice.paymentStatus !== 'void');
  return {
    totalQuoted: input.quotations.reduce((total, quotation) => total + Number(quotation.total || 0), 0),
    totalInvoiced: validInvoices.reduce((total, invoice) => total + Number(invoice.total || 0), 0),
    totalPaid: validInvoices.reduce((total, invoice) => total + Number(invoice.amountPaid || 0), 0),
    outstandingBalance: validInvoices.reduce((total, invoice) => total + Number(invoice.balance || 0), 0),
    totalRefunded: input.refunds.reduce((total, refund) => total + Number(refund.amount || 0), 0),
    activeWarrantyCount: input.warranties.filter((warranty) => warranty.status === 'active').length,
    openJobCount: input.jobs.filter((job) => !['completed', 'collected', 'cancelled'].includes(String(job.status || ''))).length,
    completedJobCount: input.jobs.filter((job) => ['completed', 'collected'].includes(String(job.status || ''))).length,
    whatsappConversationCount: input.whatsAppConversations.length,
    paymentSubmissionPendingCount: input.paymentSubmissions.filter((submission) => submission.status === 'pending_review').length,
  };
}

export async function getCustomerFinancialSummary(customerId: string, user: UserData): Promise<CustomerFinancialSummary> {
  const data = await getCustomer360Data(customerId, user);
  return data.summary;
}

export async function getCustomer360Data(customerId: string, user: UserData): Promise<Customer360Data> {
  assertCan(user.role, 'customers.view');
  const customer = await getCustomer(customerId);
  const [
    jobSnapshot,
    quotationSnapshot,
    invoiceSnapshot,
    refundSnapshot,
    warrantySnapshot,
    warrantyClaimSnapshot,
    conversationSnapshot,
    outboundSnapshot,
    inboundSnapshot,
    submissionSnapshot,
    paymentSnapshot,
  ] = await Promise.all([
    getDocs(query(collection(db, 'jobs'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'quotations'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'invoices'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'refunds'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'warranties'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'warrantyClaims'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'whatsAppConversations'), where('matchedCustomerId', '==', customerId))),
    getDocs(query(collection(db, 'whatsAppMessages'), where('relatedEntityType', '==', 'customer'), where('relatedEntityId', '==', customerId))),
    getDocs(query(collection(db, 'whatsAppInboundMessages'), where('matchedCustomerId', '==', customerId))),
    getDocs(query(collection(db, 'paymentSubmissions'), where('customerPhone', '==', customer.phone || ''))),
    getDocs(collection(db, 'payments')),
  ]);

  const jobs = jobSnapshot.docs.map((jobDoc) => ({ docId: jobDoc.id, ...(jobDoc.data() as Omit<Job, 'docId'>) }));
  const quotations = quotationSnapshot.docs.map(mapDoc<PosQuotation>('quotationId'));
  const invoices = invoiceSnapshot.docs.map(mapDoc<PosInvoice>('invoiceId'));
  const invoiceIds = new Set(invoices.map((invoice) => invoice.invoiceId));
  const payments = paymentSnapshot.docs
    .map(mapDoc<PosPayment>('paymentId'))
    .filter((payment) => invoiceIds.has(payment.invoiceId));
  const refunds = refundSnapshot.docs.map(mapDoc<PosRefund>('refundId'));
  const warranties = warrantySnapshot.docs.map(mapDoc<PosWarranty>('warrantyId'));
  const warrantyClaims = warrantyClaimSnapshot.docs.map(mapDoc<PosWarrantyClaim>('claimId'));
  const whatsAppConversations = conversationSnapshot.docs.map(mapDoc<PosWhatsAppConversation>('conversationId'));
  const whatsAppMessages = outboundSnapshot.docs.map(mapDoc<PosWhatsAppMessageLog>('messageId'));
  const whatsAppInboundMessages = inboundSnapshot.docs.map(mapDoc<PosWhatsAppInboundMessage>('inboundMessageId'));
  const paymentSubmissions = submissionSnapshot.docs.map(mapDoc<PaymentSubmission>('submissionId'));

  return {
    customer,
    summary: buildSummary({
      jobs,
      quotations,
      invoices,
      refunds,
      warranties,
      whatsAppConversations,
      paymentSubmissions,
    }),
    jobs,
    quotations,
    invoices,
    payments,
    refunds,
    warranties,
    warrantyClaims,
    whatsAppConversations,
    whatsAppMessages,
    whatsAppInboundMessages,
    paymentSubmissions,
  };
}
