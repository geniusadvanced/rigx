'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { downloadReceiptPdf } from '@/features/pos/generatePosPdf';
import {
  buildInvoiceWhatsAppLink,
  buildQuotationWhatsAppLink,
  createInvoice,
  createInvoiceFromQuotation,
  createQuotation,
  ensureInvoicePaymentToken,
  ensureQuotationPublicToken,
  getInvoices,
  getPaymentSubmissions,
  getPayments,
  getPaymentsByInvoice,
  getPriceItems,
  priceItemMatchesSearch,
  recordInvoicePayment,
  type PosDocumentInput,
} from '@/features/pos/posService';
import { buildReceiptWhatsAppLink } from '@/features/pos/whatsappService';
import { getCustomers, getDevices } from '@/features/customers/services/customerService';
import type { Customer, Device } from '@/features/customers/types';
import type {
  PaymentSubmission,
  PosBranch,
  PosInvoice,
  PosLineItem,
  PosPayment,
  PosPaymentMethod,
  PosQuotation,
  PriceItem,
  PriceItemType,
} from '@/features/pos/types';
import { useJobs } from '@/lib/hooks/useJobs';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

type MainTab = 'quick-payment' | 'create-sale' | 'records';
type QuickPaymentMethod = PosPaymentMethod | 'split' | 'deposit' | 'warranty_no_charge';

const mainTabs: Array<{ id: MainTab; label: string }> = [
  { id: 'quick-payment', label: 'Quick Payment' },
  { id: 'create-sale', label: 'Create Sale' },
  { id: 'records', label: 'Records' },
];

const paymentMethods: Array<{ value: QuickPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Online Transfer' },
  { value: 'duitnow', label: 'DuitNow QR' },
  { value: 'card', label: 'Card' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'split', label: 'Split Payment' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'warranty_no_charge', label: 'Warranty / No Charge' },
];

const warrantyDurationOptions = [
  { value: 0, label: 'No warranty' },
  { value: 7, label: '7 days' },
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '12 months' },
];

const recordsLinks = [
  { href: '/dashboard/pos/pricelist', label: 'Pricelist', description: 'Add, edit, and activate POS price items.', manageOnly: true },
  { href: '/dashboard/pos/ai-import', label: 'AI Import Pricelist', description: 'Upload or paste pricelist rows for review before saving.', manageOnly: true },
  { href: '/dashboard/pos/quotations', label: 'Quotations', description: 'Review and manage quotation records.' },
  { href: '/dashboard/pos/invoices', label: 'Invoices', description: 'Open invoices, receipts, refunds, and warranty hooks.' },
  { href: '/dashboard/pos/payments', label: 'Payments', description: 'Check recorded POS payments.' },
  { href: '/dashboard/pos/payment-submissions', label: 'Payment Submissions', description: 'Review customer payment proof submissions.', manageOnly: true },
  { href: '/dashboard/pos/reports', label: 'Reports', description: 'Open POS financial and customer reports.', manageOnly: true },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function defaultValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(date);
}

function formatDateTime(value?: { toDate?: () => Date } | null): string {
  const date = value?.toDate?.();
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
}

function recalculateItem(item: Omit<PosLineItem, 'total'>): PosLineItem {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const discount = Number(item.discount || 0);
  return { ...item, quantity, unitPrice, discount, total: Math.max(0, quantity * unitPrice - discount) };
}

function itemSummary(invoice: PosInvoice): string {
  const firstItem = invoice.items?.[0]?.name;
  const extraCount = Math.max(0, (invoice.items?.length || 0) - 1);
  if (firstItem && extraCount > 0) return `${firstItem} + ${extraCount} more`;
  return firstItem || invoice.deviceId || invoice.jobId || 'Service invoice';
}

function paymentStatusClass(status: PosInvoice['paymentStatus']): string {
  if (status === 'paid') return 'border-emerald-500/40 text-emerald-300';
  if (status === 'partial') return 'border-amber-500/40 text-amber-300';
  if (status === 'void' || status === 'refunded') return 'border-red-500/40 text-red-300';
  return 'border-orange-500/30 text-orange-200';
}

function mapPaymentMethod(method: QuickPaymentMethod): PosPaymentMethod {
  if (method === 'split' || method === 'deposit' || method === 'warranty_no_charge') return 'other';
  return method;
}

function methodLabel(method: QuickPaymentMethod): string {
  return paymentMethods.find((option) => option.value === method)?.label || method;
}

function normalizePosBranch(value?: string | null): PosBranch | null {
  const branch = String(value || '').trim().toLowerCase();
  return branch === 'bangi' || branch === 'cyberjaya' ? branch : null;
}

function warrantyDurationLabel(days?: number): string {
  const value = Number(days || 0);
  return warrantyDurationOptions.find((option) => option.value === value)?.label || `${value} days`;
}

function cleanDeviceText(value: unknown): string {
  return String(value || '').trim();
}

function deviceSnapshotFromJob(job: unknown) {
  const data = job as {
    device?: string | null;
    deviceName?: string | null;
    deviceBrand?: string | null;
    deviceModel?: string | null;
    serialNumber?: string | null;
    imei?: string | null;
    deviceSerialOrImei?: string | null;
  } | null;
  const deviceName = cleanDeviceText(data?.deviceName || data?.device);
  const deviceBrand = cleanDeviceText(data?.deviceBrand);
  const deviceModel = cleanDeviceText(data?.deviceModel);
  const serialNumber = cleanDeviceText(data?.serialNumber);
  const imei = cleanDeviceText(data?.imei || data?.deviceSerialOrImei);
  const label = [deviceBrand, deviceModel || deviceName].filter(Boolean).join(' ') || deviceName || serialNumber || imei;
  return { deviceName, deviceBrand, deviceModel, serialNumber, imei, deviceLabel: label };
}

function deviceSnapshotFromSavedDevice(device: Device | undefined) {
  const deviceName = cleanDeviceText(device?.model);
  const deviceBrand = cleanDeviceText(device?.brand);
  const deviceModel = cleanDeviceText(device?.model);
  const serialNumber = cleanDeviceText(device?.serialNumber);
  const imei = cleanDeviceText(device?.imei);
  const label = [deviceBrand, deviceModel || deviceName].filter(Boolean).join(' ') || deviceName || serialNumber || imei;
  return { deviceName, deviceBrand, deviceModel, serialNumber, imei, deviceLabel: label };
}

export default function PosPage() {
  const { profile, loading } = useUser();
  const { jobs } = useJobs(profile?.role ? profile : null);
  const [activeTab, setActiveTab] = useState<MainTab>('quick-payment');
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [branchId, setBranchId] = useState<PosBranch>('bangi');
  const [cartItems, setCartItems] = useState<PosLineItem[]>([]);
  const [manualItem, setManualItem] = useState({
    name: '',
    category: '',
    type: 'service' as PriceItemType,
    quantity: '1',
    unitPrice: '',
    discount: '0',
    warrantyDurationDays: 0,
  });
  const [discountAmount, setDiscountAmount] = useState('0');
  const [discountReason, setDiscountReason] = useState('');
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [quotation, setQuotation] = useState<PosQuotation | null>(null);
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [payment, setPayment] = useState({ amount: '', method: 'cash' as PosPaymentMethod, referenceNo: '', proofFile: null as File | null });
  const [dashboardInvoices, setDashboardInvoices] = useState<PosInvoice[]>([]);
  const [dashboardPayments, setDashboardPayments] = useState<PosPayment[]>([]);
  const [dashboardSubmissions, setDashboardSubmissions] = useState<PaymentSubmission[]>([]);
  const [paymentSearch, setPaymentSearch] = useState('');
  const [priceItemSearch, setPriceItemSearch] = useState('');
  const [selectedPaymentInvoice, setSelectedPaymentInvoice] = useState<PosInvoice | null>(null);
  const [quickPayment, setQuickPayment] = useState({
    amount: '',
    method: 'cash' as QuickPaymentMethod,
    referenceNo: '',
    notes: '',
    proofFile: null as File | null,
  });
  const [splitPayments, setSplitPayments] = useState([
    { method: 'cash' as PosPaymentMethod, amount: '', referenceNo: '' },
    { method: 'bank_transfer' as PosPaymentMethod, amount: '', referenceNo: '' },
  ]);
  const [lastReceipt, setLastReceipt] = useState<{ invoice: PosInvoice; payment: PosPayment } | null>(null);
  const [message, setMessage] = useState('');
  const [createSaleError, setCreateSaleError] = useState('');
  const [jobLinkWarning, setJobLinkWarning] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const canOperate = can(profile?.role, 'pos.operate');
  const canManage = can(profile?.role, 'pos.manage');

  useEffect(() => {
    let cancelled = false;
    if (!profile?.role || !can(profile.role, 'pos.operate')) return;
    Promise.all([getPriceItems(profile), getCustomers(profile), getDevices(profile.role), getInvoices(profile), getPayments(profile)])
      .then(([items, customerRows, deviceRows, invoiceRows, paymentRows]) => {
        if (cancelled) return;
        setPriceItems(items.filter((item) => item.active));
        setCustomers(customerRows);
        setDevices(deviceRows);
        setDashboardInvoices(invoiceRows);
        setDashboardPayments(paymentRows);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load POS data');
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.role || !can(profile.role, 'pos.manage')) return;
    getPaymentSubmissions(profile)
      .then((submissionRows) => {
        if (!cancelled) setDashboardSubmissions(submissionRows);
      })
      .catch(() => {
        if (!cancelled) setDashboardSubmissions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const selectedCustomer = customers.find((customer) => customer.customerId === selectedCustomerId);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  const selectedJob = jobs.find((job) => job.docId === selectedJobId);
  const selectedJobDeviceSnapshot = deviceSnapshotFromJob(selectedJob);
  const selectedDeviceSnapshot = deviceSnapshotFromSavedDevice(selectedDevice);
  const effectiveDeviceSnapshot = selectedDevice
    ? selectedDeviceSnapshot
    : selectedJobDeviceSnapshot.deviceLabel
      ? selectedJobDeviceSnapshot
      : null;
  const customerDevices = devices.filter((device) => device.customerId === selectedCustomerId);
  const subtotal = cartItems.reduce((total, item) => total + item.total, 0);
  const total = Math.max(0, subtotal - Number(discountAmount || 0));

  const recentPayments = useMemo(() => [...dashboardPayments]
    .sort((left, right) => (right.receivedAt?.toMillis?.() || 0) - (left.receivedAt?.toMillis?.() || 0))
    .slice(0, 6), [dashboardPayments]);

  const outstandingInvoices = useMemo(() => {
    const term = paymentSearch.trim().toLowerCase();
    return dashboardInvoices
      .filter((row) => !['void', 'refunded', 'paid'].includes(row.paymentStatus) && Number(row.balance || 0) > 0)
      .filter((row) => {
        if (!term) return true;
        const haystack = [
          row.customerName,
          row.customerPhone,
          row.invoiceNo,
          row.invoiceId,
          row.quotationId,
          row.jobId,
          row.deviceId,
          itemSummary(row),
        ].join(' ').toLowerCase();
        return haystack.includes(term);
      })
      .sort((left, right) => Number(right.balance || 0) - Number(left.balance || 0))
      .slice(0, 12);
  }, [dashboardInvoices, paymentSearch]);

  const topCustomersByPaid = useMemo(() => {
    const totals = new Map<string, { customerId: string; customerName: string; paid: number }>();
    dashboardInvoices.filter((row) => row.paymentStatus !== 'void').forEach((invoiceRow) => {
      const key = invoiceRow.customerId || invoiceRow.customerPhone || invoiceRow.customerName;
      const current = totals.get(key) || { customerId: invoiceRow.customerId, customerName: invoiceRow.customerName, paid: 0 };
      current.paid += Number(invoiceRow.amountPaid || 0);
      totals.set(key, current);
    });
    return Array.from(totals.values()).sort((left, right) => right.paid - left.paid).slice(0, 3);
  }, [dashboardInvoices]);

  const customersWithOutstanding = useMemo(() => dashboardInvoices
    .filter((invoiceRow) => invoiceRow.paymentStatus !== 'void' && Number(invoiceRow.balance || 0) > 0)
    .sort((left, right) => Number(right.balance || 0) - Number(left.balance || 0))
    .slice(0, 3), [dashboardInvoices]);

  const pendingCustomerSubmissions = useMemo(() => dashboardSubmissions
    .filter((submission) => submission.status === 'pending_review')
    .slice(0, 3), [dashboardSubmissions]);

  const filteredPriceItems = useMemo(
    () => priceItems.filter((item) => priceItemMatchesSearch(item, priceItemSearch)),
    [priceItems, priceItemSearch],
  );

  function addPriceItem(item: PriceItem) {
    const unitPrice = Number(item.branchPrices?.[branchId] ?? item.basePrice ?? 0);
    setCreateSaleError('');
    setCartItems((current) => [
      ...current,
      recalculateItem({
        priceItemId: item.priceItemId,
        name: item.name,
        category: item.category,
        serviceGroup: item.serviceGroup,
        pricingType: item.pricingType,
        basePrice: item.basePrice,
        minPrice: item.minPrice,
        maxPrice: item.maxPrice,
        type: item.type,
        quantity: 1,
        unitPrice,
        discount: 0,
        commissionEligible: item.commissionEligible,
        costPrice: item.costPrice || 0,
        warrantyDurationDays: item.warrantyDurationDays || 0,
      }),
    ]);
  }

  function addManualItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateSaleError('');
    setCartItems((current) => [
      ...current,
      recalculateItem({
        name: manualItem.name,
        category: manualItem.category,
        type: manualItem.type,
        quantity: Number(manualItem.quantity),
        unitPrice: Number(manualItem.unitPrice),
        discount: Number(manualItem.discount),
        warrantyDurationDays: Number(manualItem.warrantyDurationDays || 0),
      }),
    ]);
    setManualItem({ name: '', category: '', type: 'service', quantity: '1', unitPrice: '', discount: '0', warrantyDurationDays: 0 });
  }

  function handleSelectCustomer(customerId: string) {
    setCreateSaleError('');
    setJobLinkWarning('');
    setSelectedCustomerId(customerId);
    setSelectedDeviceId('');
  }

  function handleSelectJob(jobId: string) {
    setCreateSaleError('');
    setJobLinkWarning('');
    setSelectedJobId(jobId);
    setSelectedCustomerId('');
    setSelectedDeviceId('');
    if (!jobId) return;

    const job = jobs.find((row) => row.docId === jobId);
    if (!job) return;

    const warnings: string[] = [];
    if (job.customerId) {
      setSelectedCustomerId(job.customerId);
    } else if (job.customerName || job.customerPhone) {
      warnings.push('This job has customer snapshot only but no linked customer record. Please select or create customer first.');
    }

    const snapshot = deviceSnapshotFromJob(job);
    if (job.deviceId) {
      setSelectedDeviceId(job.deviceId);
    } else if (snapshot.deviceLabel) {
      warnings.push('Using device details from the selected job because no saved device record is linked.');
    } else {
      warnings.push('No device linked to this job. Select a device or enter device details before generating document.');
    }

    const nextBranch = normalizePosBranch(job.branchId);
    if (nextBranch) setBranchId(nextBranch);
    setJobLinkWarning(warnings.join(' '));
  }

  function buildDocumentInput(): PosDocumentInput {
    if (!selectedCustomer) throw new Error('Customer is required');
    if (selectedJobId && !effectiveDeviceSnapshot?.deviceLabel) {
      throw new Error('No device linked to this job. Select a device or enter device details before generating document.');
    }
    return {
      customerId: selectedCustomer.customerId,
      customerName: selectedCustomer.fullName,
      customerPhone: selectedCustomer.phone,
      deviceId: selectedDevice?.deviceId,
      deviceLabel: effectiveDeviceSnapshot?.deviceLabel || '',
      deviceName: effectiveDeviceSnapshot?.deviceName || '',
      deviceBrand: effectiveDeviceSnapshot?.deviceBrand || '',
      deviceModel: effectiveDeviceSnapshot?.deviceModel || '',
      serialNumber: effectiveDeviceSnapshot?.serialNumber || '',
      imei: effectiveDeviceSnapshot?.imei || '',
      jobId: selectedJobId,
      branchId,
      items: cartItems,
      discountAmount: Number(discountAmount || 0),
      discountReason,
      validUntil,
    };
  }

  async function reloadPaymentData(nextSelectedInvoice?: PosInvoice | null) {
    if (!profile) return;
    const [invoiceRows, paymentRows] = await Promise.all([getInvoices(profile), getPayments(profile)]);
    setDashboardInvoices(invoiceRows);
    setDashboardPayments(paymentRows);
    if (nextSelectedInvoice) {
      setSelectedPaymentInvoice(invoiceRows.find((row) => row.invoiceId === nextSelectedInvoice.invoiceId) || nextSelectedInvoice);
    }
  }

  async function handleCreateQuotation() {
    if (!profile || !canOperate) return;
    setActionLoading(true);
    setMessage('');
    setCreateSaleError('');
    try {
      const nextQuotation = await createQuotation(buildDocumentInput(), profile);
      setQuotation(nextQuotation);
      setMessage('Quotation created');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to create quotation';
      setCreateSaleError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateInvoice() {
    if (!profile || !canOperate) return;
    setActionLoading(true);
    setMessage('');
    setCreateSaleError('');
    try {
      const nextInvoice = quotation?.status === 'approved'
        ? await createInvoiceFromQuotation(quotation, profile)
        : await createInvoice(buildDocumentInput(), profile);
      setInvoice(nextInvoice);
      setSelectedPaymentInvoice(nextInvoice);
      setMessage('Invoice created');
      await reloadPaymentData(nextInvoice);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to create invoice';
      setCreateSaleError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRecordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !invoice) return;
    setActionLoading(true);
    setMessage('');
    try {
      await recordInvoicePayment(invoice, { amount: Number(payment.amount), method: payment.method, referenceNo: payment.referenceNo, proofFile: payment.proofFile }, profile);
      const nextPaid = invoice.amountPaid + Number(payment.amount);
      const balance = Math.max(0, invoice.total - nextPaid);
      setInvoice({ ...invoice, amountPaid: nextPaid, balance, paymentStatus: balance <= 0 ? 'paid' : 'partial' });
      setPayment({ amount: '', method: 'cash', referenceNo: '', proofFile: null });
      setMessage('Payment recorded');
      await reloadPaymentData(invoice);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record payment');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleQuickPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedPaymentInvoice) return;
    setActionLoading(true);
    setMessage('');
    try {
      const amount = Number(quickPayment.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be valid');
      if (quickPayment.method === 'split') {
        const splitTotal = splitPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        if (Math.abs(splitTotal - amount) > 0.009) throw new Error('Split payment total must equal pay amount');
      }
      const referenceParts = [
        quickPayment.referenceNo.trim(),
        quickPayment.method !== mapPaymentMethod(quickPayment.method) ? `Method: ${methodLabel(quickPayment.method)}` : '',
        quickPayment.method === 'split'
          ? `Split: ${splitPayments
            .filter((row) => Number(row.amount || 0) > 0)
            .map((row) => `${row.method} ${formatCurrency(Number(row.amount || 0))}${row.referenceNo ? ` ref ${row.referenceNo}` : ''}`)
            .join('; ')}`
          : '',
        quickPayment.notes.trim() ? `Notes: ${quickPayment.notes.trim()}` : '',
      ].filter(Boolean).join(' | ');
      const paymentId = await recordInvoicePayment(selectedPaymentInvoice, {
        amount,
        method: mapPaymentMethod(quickPayment.method),
        referenceNo: referenceParts,
        proofFile: quickPayment.proofFile,
      }, profile);
      const updatedInvoice: PosInvoice = {
        ...selectedPaymentInvoice,
        amountPaid: selectedPaymentInvoice.amountPaid + amount,
        balance: Math.max(0, selectedPaymentInvoice.total - (selectedPaymentInvoice.amountPaid + amount)),
        paymentStatus: Math.max(0, selectedPaymentInvoice.total - (selectedPaymentInvoice.amountPaid + amount)) <= 0 ? 'paid' : 'partial',
      };
      const invoicePayments = await getPaymentsByInvoice(selectedPaymentInvoice.invoiceId, profile);
      const createdPayment = invoicePayments.find((row) => row.paymentId === paymentId) || invoicePayments[invoicePayments.length - 1];
      if (createdPayment) setLastReceipt({ invoice: updatedInvoice, payment: createdPayment });
      setSelectedPaymentInvoice(updatedInvoice);
      setQuickPayment({ amount: '', method: 'cash', referenceNo: '', notes: '', proofFile: null });
      setSplitPayments([
        { method: 'cash', amount: '', referenceNo: '' },
        { method: 'bank_transfer', amount: '', referenceNo: '' },
      ]);
      setMessage('Payment recorded');
      await reloadPaymentData(updatedInvoice);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record payment');
    } finally {
      setActionLoading(false);
    }
  }

  async function openQuotationWhatsApp() {
    if (!profile || !quotation) return;
    setActionLoading(true);
    try {
      const token = await ensureQuotationPublicToken(quotation.quotationId, profile);
      const nextQuotation = { ...quotation, publicToken: token };
      setQuotation(nextQuotation);
      window.open(buildQuotationWhatsAppLink(nextQuotation), '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp quotation link');
    } finally {
      setActionLoading(false);
    }
  }

  async function openInvoiceWhatsApp() {
    if (!profile || !invoice) return;
    setActionLoading(true);
    try {
      const token = await ensureInvoicePaymentToken(invoice.invoiceId, profile);
      const nextInvoice = { ...invoice, publicPaymentToken: token };
      setInvoice(nextInvoice);
      window.open(buildInvoiceWhatsAppLink(nextInvoice), '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to prepare WhatsApp invoice link');
    } finally {
      setActionLoading(false);
    }
  }

  function selectPaymentInvoice(invoiceRow: PosInvoice) {
    setSelectedPaymentInvoice(invoiceRow);
    setQuickPayment((current) => ({ ...current, amount: Number(invoiceRow.balance || 0).toFixed(2) }));
    setLastReceipt(null);
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading POS</div>;
  if (!can(profile?.role, 'pos.operate')) {
    return (
      <section className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6">
        <h1 className="text-xl font-semibold text-white">POS</h1>
        <p className="mt-2 text-sm text-zinc-400">Admin or manager access is required.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">POS</h1>
        <p className="mt-1 text-sm text-zinc-400">Fast billing, payment collection, quotation and invoice workspace.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {mainTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${activeTab === tab.id ? 'border-orange-500/40 bg-[#1F160E] text-orange-100' : 'border-white/10 bg-[#141414] text-zinc-300 hover:border-orange-500/25 hover:text-orange-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}

      {activeTab === 'quick-payment' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <h2 className="text-lg font-semibold text-white">Quick Payment</h2>
              <input
                value={paymentSearch}
                onChange={(event) => setPaymentSearch(event.target.value)}
                placeholder="Search customer, phone, job ID, invoice ID, quotation ID..."
                className="mt-4 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600"
              />
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Outstanding Items</h2>
                <span className="rounded-full border border-orange-500/20 px-3 py-1 text-xs text-orange-200">{outstandingInvoices.length} items</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {outstandingInvoices.map((invoiceRow) => (
                  <div key={invoiceRow.invoiceId} className="rounded-2xl border border-white/10 bg-[#151515] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{invoiceRow.customerName}</div>
                        <div className="mt-1 text-xs text-zinc-500">{invoiceRow.customerPhone || 'No phone'} · {invoiceRow.invoiceNo}</div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${paymentStatusClass(invoiceRow.paymentStatus)}`}>{invoiceRow.paymentStatus}</span>
                    </div>
                    <div className="mt-3 text-xs text-zinc-500">{invoiceRow.jobId || invoiceRow.quotationId || invoiceRow.invoiceId}</div>
                    <div className="mt-1 text-sm text-zinc-300">{itemSummary(invoiceRow)}</div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div><div className="text-zinc-500">Total</div><div className="mt-1 text-white">{formatCurrency(invoiceRow.total)}</div></div>
                      <div><div className="text-zinc-500">Paid</div><div className="mt-1 text-white">{formatCurrency(invoiceRow.amountPaid)}</div></div>
                      <div><div className="text-zinc-500">Outstanding</div><div className="mt-1 text-orange-200">{formatCurrency(invoiceRow.balance)}</div></div>
                    </div>
                    <button type="button" onClick={() => selectPaymentInvoice(invoiceRow)} className="mt-4 w-full rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-medium text-orange-200 hover:bg-[#1F160E]">
                      Select for Payment
                    </button>
                  </div>
                ))}
                {outstandingInvoices.length === 0 ? <div className="text-sm text-zinc-500">No outstanding invoices match this search.</div> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <h2 className="text-lg font-semibold text-white">Recent Payments</h2>
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#0B0B0B] text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Invoice / Job</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPayments.map((paymentRow) => {
                      const linkedInvoice = dashboardInvoices.find((row) => row.invoiceId === paymentRow.invoiceId);
                      return (
                        <tr key={paymentRow.paymentId} className="border-t border-white/10">
                          <td className="px-4 py-3 text-zinc-400">{formatDateTime(paymentRow.receivedAt)}</td>
                          <td className="px-4 py-3 text-white">{linkedInvoice?.customerName || '-'}</td>
                          <td className="px-4 py-3 text-zinc-300">{linkedInvoice?.invoiceNo || paymentRow.invoiceId}</td>
                          <td className="px-4 py-3 text-orange-200">{formatCurrency(paymentRow.amount)}</td>
                          <td className="px-4 py-3 text-zinc-300">{paymentRow.method}</td>
                          <td className="px-4 py-3 text-zinc-300">{paymentRow.status || 'completed'}</td>
                        </tr>
                      );
                    })}
                    {recentPayments.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-sm text-zinc-500">No payments recorded yet.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="sticky top-20 h-fit rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Payment Panel</h2>
            {!selectedPaymentInvoice ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-[#151515] p-4 text-sm text-zinc-500">
                Select an invoice, job, quotation, or customer to receive payment.
              </div>
            ) : (
              <form onSubmit={handleQuickPayment} className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-[#151515] p-4">
                  <div className="text-sm font-semibold text-white">{selectedPaymentInvoice.customerName}</div>
                  <div className="mt-1 text-xs text-zinc-500">{selectedPaymentInvoice.invoiceNo} {selectedPaymentInvoice.jobId ? `· ${selectedPaymentInvoice.jobId}` : ''}</div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Outstanding</span>
                    <span className="font-semibold text-orange-200">{formatCurrency(selectedPaymentInvoice.balance)}</span>
                  </div>
                </div>
                <input required type="number" min="0.01" step="0.01" value={quickPayment.amount} onChange={(event) => setQuickPayment((current) => ({ ...current, amount: event.target.value }))} placeholder="Pay amount" className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                <select value={quickPayment.method} onChange={(event) => setQuickPayment((current) => ({ ...current, method: event.target.value as QuickPaymentMethod }))} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                  {paymentMethods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {quickPayment.method === 'split' ? (
                  <div className="space-y-2 rounded-2xl border border-white/10 bg-[#151515] p-3">
                    {splitPayments.map((row, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-3">
                        <select value={row.method} onChange={(event) => setSplitPayments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, method: event.target.value as PosPaymentMethod } : item))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-xs text-white">
                          <option value="cash">Cash</option>
                          <option value="bank_transfer">Online Transfer</option>
                          <option value="duitnow">DuitNow QR</option>
                          <option value="card">Card</option>
                          <option value="ewallet">E-wallet</option>
                          <option value="other">Other</option>
                        </select>
                        <input type="number" min="0" step="0.01" value={row.amount} onChange={(event) => setSplitPayments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="Amount" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-xs text-white" />
                        <input value={row.referenceNo} onChange={(event) => setSplitPayments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, referenceNo: event.target.value } : item))} placeholder="Reference" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-xs text-white" />
                      </div>
                    ))}
                  </div>
                ) : null}
                <input value={quickPayment.referenceNo} onChange={(event) => setQuickPayment((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="Reference number" className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                {['bank_transfer', 'duitnow', 'ewallet', 'card', 'split', 'deposit'].includes(quickPayment.method) ? (
                  <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setQuickPayment((current) => ({ ...current, proofFile: event.target.files?.[0] || null }))} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                ) : null}
                <textarea value={quickPayment.notes} onChange={(event) => setQuickPayment((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="min-h-20 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                <button disabled={actionLoading || selectedPaymentInvoice.paymentStatus === 'void'} className="w-full rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Confirm Payment
                </button>
                {lastReceipt ? (
                  <div className="space-y-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="text-sm font-semibold text-emerald-200">Payment received</div>
                    <div className="grid gap-2">
                      <button type="button" onClick={() => window.print()} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-200">Print Receipt</button>
                      <button type="button" onClick={() => downloadReceiptPdf(lastReceipt.invoice, lastReceipt.payment)} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200">Download PDF Receipt</button>
                      <button type="button" disabled={!lastReceipt.invoice.customerPhone} onClick={() => window.open(buildReceiptWhatsAppLink(lastReceipt.invoice, lastReceipt.payment), '_blank', 'noopener,noreferrer')} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm text-orange-200 disabled:opacity-40">WhatsApp Receipt</button>
                      {!lastReceipt.invoice.customerPhone ? <div className="text-xs text-zinc-500">Customer phone number is missing.</div> : null}
                      <Link href={`/dashboard/pos/invoices/${lastReceipt.invoice.invoiceId}`} className="rounded-xl border border-white/10 px-4 py-2 text-center text-sm text-zinc-200">Open Invoice</Link>
                      {lastReceipt.invoice.jobId ? <Link href={`/dashboard/jobs/${lastReceipt.invoice.jobId}`} className="rounded-xl border border-white/10 px-4 py-2 text-center text-sm text-zinc-200">Open Job</Link> : null}
                    </div>
                  </div>
                ) : null}
              </form>
            )}
          </aside>
        </div>
      ) : null}

      {activeTab === 'create-sale' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <h2 className="text-lg font-semibold text-white">Customer</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs uppercase text-zinc-500">Customer</span>
                  <select value={selectedCustomerId} onChange={(event) => handleSelectCustomer(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="">Select customer</option>
                    {customers.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.fullName} · {customer.phone}</option>)}
                  </select>
                  <span className="mt-1 block text-xs text-zinc-500">Required for quotation and invoice.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase text-zinc-500">Device</span>
                  <select value={selectedDeviceId} onChange={(event) => { setCreateSaleError(''); setSelectedDeviceId(event.target.value); }} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="">Select device</option>
                    {customerDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.brand} {device.model}</option>)}
                  </select>
                  {!selectedDeviceId && selectedJobDeviceSnapshot.deviceLabel ? (
                    <span className="mt-1 block text-xs text-emerald-300">Device from job: {selectedJobDeviceSnapshot.deviceLabel}</span>
                  ) : null}
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase text-zinc-500">Branch</span>
                  <select value={branchId} onChange={(event) => { setCreateSaleError(''); setBranchId(event.target.value as PosBranch); }} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
	                    <option value="bangi">Bangi</option>
	                    <option value="cyberjaya">Cyberjaya</option>
	                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs uppercase text-zinc-500">Linked Job</span>
                  <select value={selectedJobId} onChange={(event) => handleSelectJob(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="">Link existing job</option>
                    {jobs.map((job) => <option key={job.docId} value={job.docId}>{job.jobNo || job.jobNumber || job.jobSheetNo || job.agnJobNumber} · {job.customerName}</option>)}
                  </select>
                  <span className="mt-1 block text-xs text-zinc-500">Selecting a linked job auto-fills customer, device, and branch when records are linked.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase text-zinc-500">Valid Until</span>
                  <input type="date" value={validUntil} onChange={(event) => { setCreateSaleError(''); setValidUntil(event.target.value); }} className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                </label>
                {jobLinkWarning ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 md:col-span-4">
                    {jobLinkWarning}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Pricelist</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href="/dashboard/pos/pricelist" className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-orange-500/30 hover:text-orange-200">
                    Manage Pricelist
                  </Link>
                  <Link href="/dashboard/pos/ai-import" className="rounded-xl border border-orange-500/25 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-200 hover:border-orange-500/40">
                    AI Import
                  </Link>
                </div>
              </div>
              <input
                value={priceItemSearch}
                onChange={(event) => setPriceItemSearch(event.target.value)}
                placeholder="Search name, model, category, e.g. 15.6 LCD, A1278, data recovery"
                className="mt-4 w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white placeholder:text-zinc-600"
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredPriceItems.slice(0, 12).map((item) => (
                  <button key={item.priceItemId} type="button" onClick={() => addPriceItem(item)} className="rounded-2xl border border-white/10 bg-[#151515] p-3 text-left hover:border-orange-500/30">
                    <div className="text-sm font-semibold text-white">{item.name}</div>
                    <div className="mt-1 text-xs capitalize text-zinc-500">{item.category} · {item.type}</div>
                    <div className="mt-2 text-sm text-orange-200">{formatCurrency(Number(item.branchPrices?.[branchId] ?? item.basePrice))}</div>
                  </button>
                ))}
                {priceItems.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-[#151515] p-4 text-sm text-zinc-300 md:col-span-2 xl:col-span-3">
                    <div className="font-medium text-white">No active price items found.</div>
                    <div className="mt-1 text-xs text-zinc-500">Create price items manually or import a pricelist with AI review.</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href="/dashboard/pos/pricelist" className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-orange-500/30 hover:text-orange-200">
                        Manage Pricelist
                      </Link>
                      <Link href="/dashboard/pos/ai-import" className="rounded-xl border border-orange-500/25 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-200 hover:border-orange-500/40">
                        Import Pricelist with AI
                      </Link>
                    </div>
                  </div>
                ) : null}
                {priceItems.length > 0 && filteredPriceItems.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-[#151515] p-4 text-sm text-zinc-400 md:col-span-2 xl:col-span-3">
                    No pricelist items found. Try another keyword or clear filters.
                  </div>
                ) : null}
              </div>
            </div>

            <form onSubmit={addManualItem} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
              <h2 className="text-lg font-semibold text-white">Manual Item</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-7">
                <input required value={manualItem.name} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, name: event.target.value })); }} placeholder="Name" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white md:col-span-2" />
                <input value={manualItem.category} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, category: event.target.value })); }} placeholder="Category" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                <select value={manualItem.type} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, type: event.target.value as PriceItemType })); }} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                  <option value="service">service</option>
                  <option value="part">part</option>
                  <option value="package">package</option>
                  <option value="diagnostic">diagnostic</option>
                  <option value="labor">labor</option>
                </select>
                <input required type="number" min="1" value={manualItem.quantity} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, quantity: event.target.value })); }} placeholder="Qty" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                <input required type="number" min="0" step="0.01" value={manualItem.unitPrice} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, unitPrice: event.target.value })); }} placeholder="Price" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                <select value={manualItem.warrantyDurationDays} onChange={(event) => { setCreateSaleError(''); setManualItem((current) => ({ ...current, warrantyDurationDays: Number(event.target.value) })); }} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                  {warrantyDurationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white">Add Item</button>
              </div>
            </form>
          </div>

          <aside className="sticky top-20 h-fit rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
            <h2 className="text-lg font-semibold text-white">Cart</h2>
            <div className="mt-4 space-y-3">
              {cartItems.map((item, index) => (
                <div key={`${item.name}-${index}`} className="rounded-2xl border border-white/10 bg-[#151515] p-3">
	                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{item.name}</div>
                      <div className="text-xs text-zinc-500">{item.quantity} x {formatCurrency(item.unitPrice)}</div>
                      {Number(item.warrantyDurationDays || 0) > 0 ? (
                        <div className="mt-1 text-xs text-emerald-300">Warranty: {warrantyDurationLabel(item.warrantyDurationDays)}</div>
                      ) : null}
                    </div>
	                    <div className="text-sm text-orange-200">{formatCurrency(item.total)}</div>
	                  </div>
                </div>
              ))}
              {cartItems.length === 0 ? <div className="text-sm text-zinc-500">No cart items</div> : null}
            </div>
            <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div className="flex justify-between text-sm text-zinc-300"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <input type="number" min="0" step="0.01" value={discountAmount} onChange={(event) => { setCreateSaleError(''); setDiscountAmount(event.target.value); }} placeholder="Discount" className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <input value={discountReason} onChange={(event) => { setCreateSaleError(''); setDiscountReason(event.target.value); }} placeholder="Discount reason" className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
              <div className="flex justify-between text-lg font-semibold text-white"><span>Total</span><span>{formatCurrency(total)}</span></div>
              {createSaleError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  {createSaleError}
                </div>
              ) : null}
              <button type="button" disabled={actionLoading || !canOperate || cartItems.length === 0} onClick={handleCreateQuotation} className="w-full rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-medium text-orange-200 disabled:opacity-50">Generate Quotation</button>
              <button type="button" disabled={actionLoading || !canOperate || cartItems.length === 0} onClick={handleCreateInvoice} className="w-full rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Generate Invoice</button>
            </div>

            {quotation ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-[#151515] p-3">
                <div className="text-sm font-semibold text-white">{quotation.quotationNo}</div>
                <button type="button" onClick={openQuotationWhatsApp} disabled={actionLoading} className="mt-2 inline-block text-sm text-orange-200 disabled:text-zinc-600">WhatsApp Quotation</button>
              </div>
            ) : null}
            {invoice ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-[#151515] p-3">
                <div className="text-sm font-semibold text-white">{invoice.invoiceNo}</div>
                {invoice.paymentStatus !== 'void' ? <button type="button" onClick={openInvoiceWhatsApp} disabled={actionLoading} className="mt-2 inline-block text-sm text-orange-200 disabled:text-zinc-600">WhatsApp Invoice</button> : null}
                <form onSubmit={handleRecordPayment} className="mt-3 grid gap-2">
                  <input required type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value }))} placeholder="Payment amount" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                  <select value={payment.method} onChange={(event) => setPayment((current) => ({ ...current, method: event.target.value as PosPaymentMethod }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
                    <option value="cash">cash</option>
                    <option value="bank_transfer">bank_transfer</option>
                    <option value="card">card</option>
                    <option value="ewallet">ewallet</option>
                    <option value="duitnow">duitnow</option>
                    <option value="other">other</option>
                  </select>
                  <input value={payment.referenceNo} onChange={(event) => setPayment((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="Reference no" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                  {['bank_transfer', 'duitnow', 'ewallet'].includes(payment.method) ? (
                    <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setPayment((current) => ({ ...current, proofFile: event.target.files?.[0] || null }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
                  ) : null}
                  <button disabled={actionLoading || invoice.paymentStatus === 'void'} className="rounded-xl border border-orange-500/20 bg-[#141414] px-4 py-2 text-sm font-medium text-orange-200 disabled:opacity-50">Record Payment</button>
                </form>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {activeTab === 'records' ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {recordsLinks
              .filter((link) => !link.manageOnly || canManage)
              .map((link) => (
                <Link key={link.href} href={link.href} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5 transition hover:border-orange-500/25 hover:bg-[#1F160E]">
                  <div className="text-lg font-semibold text-white">{link.label}</div>
                  <p className="mt-2 text-sm text-zinc-500">{link.description}</p>
                </Link>
              ))}
          </div>

          {canManage ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-4">
                <div className="text-sm font-semibold text-white">Top customers by total paid</div>
                <div className="mt-3 space-y-2">
                  {topCustomersByPaid.map((customer) => (
                    <Link key={customer.customerId || customer.customerName} href={customer.customerId ? `/dashboard/customers/${customer.customerId}` : '/dashboard/customers'} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                      <div className="font-medium text-white">{customer.customerName}</div>
                      <div className="mt-1 text-xs text-zinc-500">{formatCurrency(customer.paid)}</div>
                    </Link>
                  ))}
                  {topCustomersByPaid.length === 0 ? <div className="text-sm text-zinc-500">No paid customers yet</div> : null}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-4">
                <div className="text-sm font-semibold text-white">Customers with outstanding balance</div>
                <div className="mt-3 space-y-2">
                  {customersWithOutstanding.map((invoiceRow) => (
                    <Link key={invoiceRow.invoiceId} href={`/dashboard/pos/invoices/${invoiceRow.invoiceId}`} className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                      <div className="font-medium text-white">{invoiceRow.customerName}</div>
                      <div className="mt-1 text-xs text-zinc-500">{invoiceRow.invoiceNo} · {formatCurrency(invoiceRow.balance)}</div>
                    </Link>
                  ))}
                  {customersWithOutstanding.length === 0 ? <div className="text-sm text-zinc-500">No outstanding balances</div> : null}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-[#111111]/90 p-4">
                <div className="text-sm font-semibold text-white">Customers with pending payment submissions</div>
                <div className="mt-3 space-y-2">
                  {pendingCustomerSubmissions.map((submission) => (
                    <Link key={submission.submissionId} href="/dashboard/pos/payment-submissions" className="block rounded-2xl border border-white/10 bg-[#151515] p-3 text-sm hover:border-orange-500/30">
                      <div className="font-medium text-white">{submission.customerName}</div>
                      <div className="mt-1 text-xs text-zinc-500">{submission.invoiceNo} · {formatCurrency(submission.amountClaimed)}</div>
                    </Link>
                  ))}
                  {pendingCustomerSubmissions.length === 0 ? <div className="text-sm text-zinc-500">No pending payment submissions</div> : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
