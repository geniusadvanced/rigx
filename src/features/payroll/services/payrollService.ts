import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import type { Role } from '@/types';
import { calculatePayroll } from '../utils/calculatePayroll';
import {
  assertCanRegeneratePayroll,
  assertPayrollStatusTransition,
  assertValidMonth,
  assertValidPayrollGenerationInput,
  assertValidWorkingDays,
  getLockedPayrollMessage,
} from '../utils/payrollLifecycle';
import type {
  Payroll,
  PayrollAdjustment,
  PayrollAttendance,
  PayrollAttendanceSyncCheck,
  PayrollBreakdown,
  PayrollCommission,
  PayrollLeave,
  PayrollChecklistIssue,
  PayrollPreRunChecklist,
  PayrollStatus,
  PayrollUser,
} from '../types';

type PayrollAdjustmentInput = Pick<
  PayrollAdjustment,
  'technicianId' | 'month' | 'type' | 'category' | 'amount' | 'reason'
>;

interface GeneratePayrollForTechnicianParams {
  technicianId: string;
  month: string;
  generatedBy: string;
  generatedByRole: Role;
  workingDaysInMonth: string[];
}

interface ApprovePayrollParams {
  payrollId: string;
  approvedBy: string;
  approvedByRole: Role;
}

interface MarkPayrollPaidParams {
  payrollId: string;
  paidBy: string;
  paidByRole: Role;
}

interface LogPayslipGeneratedParams {
  userId: string;
  payrollId: string;
  fileName: string;
}

interface CreatePayrollAdjustmentParams extends PayrollAdjustmentInput {
  createdBy: string;
  createdByRole: Role;
}

interface ClosePayrollMonthParams {
  month: string;
  closedBy: string;
  closedByRole: Role;
}

interface ReopenPayrollMonthParams {
  month: string;
  reopenedBy: string;
  reopenedByRole: Role;
  reason: string;
}

interface ChecklistTechnician {
  uid: string;
  staffId?: string;
  displayName?: string;
  branchId?: string;
  baseSalary?: unknown;
}

interface PayrollPreRunChecklistParams {
  workingDaysInMonth?: string[];
}

function getMonthEndDate(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function mapDocument<T>(id: string, data: Record<string, unknown>): T {
  return { id, ...data } as T;
}

function createAuditRef() {
  return doc(collection(db, 'audit_logs'));
}

function assertFinitePayrollNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a valid number`);
  }
}

function isApprovedCommission(commission: PayrollCommission): boolean {
  return commission.status === 'approved';
}

function getPayrollId(technicianId: string, month: string): string {
  return `${technicianId}_${month}`;
}

function getPayrollMonthRef(month: string) {
  return doc(db, 'payroll_months', month);
}

async function assertPayrollMonthOpen(month: string): Promise<void> {
  const monthSnapshot = await getDoc(getPayrollMonthRef(month));

  if (monthSnapshot.exists() && monthSnapshot.data().status === 'closed') {
    throw new Error(`Payroll month ${month} is closed`);
  }
}

function getTechnicianLabel(technician?: ChecklistTechnician): string {
  return technician?.displayName || 'Unknown User';
}

async function getActorDisplayName(uid: string): Promise<string> {
  const actorSnapshot = await getDoc(doc(db, 'users', uid));
  if (!actorSnapshot.exists()) return 'Unknown User';
  const actor = actorSnapshot.data();
  return String(actor.displayName || actor.name || 'Unknown User');
}

function leaveOverlapsMonth(leave: Pick<PayrollLeave, 'startDate' | 'endDate'>, monthStartDate: string, monthEndDate: string): boolean {
  return leave.startDate <= monthEndDate && leave.endDate >= monthStartDate;
}

function getCalendarDaysInMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function leaveCoversDate(leave: Pick<PayrollLeave, 'startDate' | 'endDate'>, date: string): boolean {
  return leave.startDate <= date && leave.endDate >= date;
}

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('toMillis' in value)) {
    return null;
  }

  const toMillis = (value as { toMillis?: unknown }).toMillis;
  return typeof toMillis === 'function' ? toMillis.call(value) : null;
}

function isAdjustmentPendingPayroll(adjustment: PayrollAdjustment, payroll?: Payroll): boolean {
  if (!payroll) {
    return true;
  }

  if (payroll.status !== 'draft') {
    return false;
  }

  const adjustmentCreatedAt = timestampToMillis(adjustment.createdAt);
  const payrollGeneratedAt = timestampToMillis(payroll.generatedAt);

  if (adjustmentCreatedAt === null || payrollGeneratedAt === null) {
    return true;
  }

  return adjustmentCreatedAt > payrollGeneratedAt;
}

function validatePayrollAdjustmentInput(input: PayrollAdjustmentInput): void {
  assertValidMonth(input.month);

  if (!input.technicianId.trim()) {
    throw new Error('Technician is required');
  }

  if (input.type !== 'bonus' && input.type !== 'deduction') {
    throw new Error('Adjustment type must be bonus or deduction');
  }

  if (!input.category.trim()) {
    throw new Error('Adjustment category is required');
  }

  if (!input.reason.trim()) {
    throw new Error('Adjustment reason is required');
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Adjustment amount must be greater than 0');
  }
}

async function validatePayrollMonthCanClose(month: string): Promise<void> {
  const monthStartDate = `${month}-01`;
  const monthEndDate = getMonthEndDate(month);
  const [technicianSnapshot, payrollSnapshot, attendanceSnapshot] = await Promise.all([
    getDocs(
      query(
        collection(db, 'users'),
        where('role', '==', 'technician'),
        where('isActive', '==', true),
      ),
    ),
    getDocs(query(collection(db, 'payroll'), where('month', '==', month))),
    getDocs(
      query(
        collection(db, 'attendance'),
        where('date', '>=', monthStartDate),
        where('date', '<=', monthEndDate),
      ),
    ),
  ]);

  const activeTechnicians = technicianSnapshot.docs.map((technicianDoc) => {
    const data = technicianDoc.data();
    return {
      uid: String(data.uid || technicianDoc.id),
      staffId: String(data.staffId || ''),
      displayName: String(data.displayName || data.name || ''),
      branchId: String(data.branchId || ''),
      baseSalary: data.baseSalary,
    };
  });
  const payrollByTechnician = new Map(
    payrollSnapshot.docs.map((payrollDoc) => {
      const payroll = payrollDoc.data() as Payroll;
      return [payroll.technicianId, payroll];
    }),
  );

  const missingProfile = activeTechnicians.find((technician) => {
    return (
      !technician.staffId.trim() ||
      !technician.branchId.trim() ||
      technician.baseSalary === undefined ||
      technician.baseSalary === null ||
      technician.baseSalary === '' ||
      !Number.isFinite(Number(technician.baseSalary))
    );
  });

  if (missingProfile) {
    throw new Error(`Cannot close month: ${getTechnicianLabel(missingProfile)} has blocked payroll profile data`);
  }

  const missingPayroll = activeTechnicians.find((technician) => !payrollByTechnician.has(technician.uid));
  if (missingPayroll) {
    throw new Error(`Cannot close month: ${getTechnicianLabel(missingPayroll)} has no payroll generated`);
  }

  const invalidPayroll = payrollSnapshot.docs.find((payrollDoc) => {
    const status = payrollDoc.data().status;
    return status !== 'approved' && status !== 'paid';
  });

  if (invalidPayroll) {
    throw new Error('Cannot close month: all payroll records must be approved or paid');
  }

  const missingClockOut = attendanceSnapshot.docs.find((attendanceDoc) => {
    const attendance = attendanceDoc.data();
    return attendance.clockIn?.timestamp && !attendance.clockOut?.timestamp;
  });

  if (missingClockOut) {
    throw new Error(`Cannot close month: attendance ${missingClockOut.id} is missing clock-out`);
  }
}

export async function getPayrollPreRunChecklist(
  month: string,
  params: PayrollPreRunChecklistParams = {},
): Promise<PayrollPreRunChecklist> {
  assertValidMonth(month);

  const monthStartDate = `${month}-01`;
  const monthEndDate = getMonthEndDate(month);
  const expectedWorkingDays = params.workingDaysInMonth?.length ? params.workingDaysInMonth : getCalendarDaysInMonth(month);

  const [
    technicianSnapshot,
    pendingLeaveSnapshot,
    approvedLeaveSnapshot,
    attendanceSnapshot,
    payrollSnapshot,
    adjustmentSnapshot,
  ] =
    await Promise.all([
      getDocs(
        query(
          collection(db, 'users'),
          where('role', '==', 'technician'),
          where('isActive', '==', true),
        ),
      ),
      getDocs(query(collection(db, 'leaves'), where('status', '==', 'pending'))),
      getDocs(query(collection(db, 'leaves'), where('status', '==', 'approved'))),
      getDocs(
        query(
          collection(db, 'attendance'),
          where('date', '>=', monthStartDate),
          where('date', '<=', monthEndDate),
        ),
      ),
      getDocs(query(collection(db, 'payroll'), where('month', '==', month))),
      getDocs(query(collection(db, 'payroll_adjustments'), where('month', '==', month))),
    ]);

  const technicians = new Map<string, ChecklistTechnician>();
  const criticalIssues: PayrollChecklistIssue[] = [];
  const warnings: PayrollChecklistIssue[] = [];
  const attendanceByTechnician = new Map<string, Array<PayrollAttendance & {
    clockIn?: unknown;
    clockOut?: unknown;
    correctionNote?: string;
    correctionNotes?: string;
  }>>();
  const approvedLeavesByTechnician = new Map<string, PayrollLeave[]>();

  function addIssue(
    technicianId: string,
    severity: PayrollChecklistIssue['severity'],
    code: PayrollChecklistIssue['code'],
    message: string,
  ) {
    const technician = technicians.get(technicianId);
    const issue: PayrollChecklistIssue = {
      technicianId,
      staffId: technician?.staffId,
      displayName: technician?.displayName,
      branchId: technician?.branchId,
      severity,
      code,
      message,
    };

    if (severity === 'critical') {
      criticalIssues.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  technicianSnapshot.docs.forEach((technicianDoc) => {
    const data = technicianDoc.data();
    const technician: ChecklistTechnician = {
      uid: data.uid || technicianDoc.id,
      staffId: data.staffId,
      displayName: data.displayName || data.name,
      branchId: data.branchId,
      baseSalary: data.baseSalary,
    };

    technicians.set(technician.uid, technician);
  });

  technicians.forEach((technician) => {
    if (technician.baseSalary === undefined || technician.baseSalary === null || technician.baseSalary === '') {
      addIssue(
        technician.uid,
        'critical',
        'missing_base_salary',
        `${getTechnicianLabel(technician)} is missing base salary`,
      );
    } else if (!Number.isFinite(Number(technician.baseSalary))) {
      addIssue(
        technician.uid,
        'critical',
        'missing_base_salary',
        `${getTechnicianLabel(technician)} has invalid base salary`,
      );
    }

    if (!technician.staffId?.trim()) {
      addIssue(technician.uid, 'critical', 'missing_staff_id', `${getTechnicianLabel(technician)} is missing staff ID`);
    }

    if (!technician.branchId?.trim()) {
      addIssue(technician.uid, 'critical', 'missing_branch_id', `${getTechnicianLabel(technician)} is missing branch`);
    }
  });

  pendingLeaveSnapshot.docs.forEach((leaveDoc) => {
    const leave = mapDocument<PayrollLeave>(leaveDoc.id, leaveDoc.data());

    if (!technicians.has(leave.userId) || !leaveOverlapsMonth(leave, monthStartDate, monthEndDate)) {
      return;
    }

    addIssue(
      leave.userId,
      'warning',
      'pending_leave',
      `${getTechnicianLabel(technicians.get(leave.userId))} has a pending leave request overlapping ${month}`,
    );
  });

  approvedLeaveSnapshot.docs.forEach((leaveDoc) => {
    const leave = mapDocument<PayrollLeave>(leaveDoc.id, leaveDoc.data());

    if (!technicians.has(leave.userId) || !leaveOverlapsMonth(leave, monthStartDate, monthEndDate)) {
      return;
    }

    approvedLeavesByTechnician.set(leave.userId, [
      ...(approvedLeavesByTechnician.get(leave.userId) || []),
      leave,
    ]);
  });

  attendanceSnapshot.docs.forEach((attendanceDoc) => {
    const attendance = attendanceDoc.data() as PayrollAttendance & {
      clockIn?: unknown;
      clockOut?: unknown;
      correctionNote?: string;
      correctionNotes?: string;
    };

    if (!technicians.has(attendance.userId)) {
      return;
    }

    attendanceByTechnician.set(attendance.userId, [
      ...(attendanceByTechnician.get(attendance.userId) || []),
      attendance,
    ]);

    if (attendance.clockIn && !attendance.clockOut) {
      addIssue(
        attendance.userId,
        'critical',
        'missing_clock_out',
        `${getTechnicianLabel(technicians.get(attendance.userId))} has missing clock-out on ${attendance.date}`,
      );
    }

    const correctionText = attendance.correctionNote || attendance.correctionNotes;
    if (correctionText?.trim()) {
      addIssue(
        attendance.userId,
        'warning',
        'correction_note',
        `${getTechnicianLabel(technicians.get(attendance.userId))} has attendance correction note on ${attendance.date}`,
      );
    }
  });

  const attendanceSync: PayrollAttendanceSyncCheck[] = Array.from(technicians.values()).map((technician) => {
    const attendanceRecords = attendanceByTechnician.get(technician.uid) || [];
    const attendanceDates = new Set(attendanceRecords.map((attendance) => attendance.date));
    const approvedLeaves = approvedLeavesByTechnician.get(technician.uid) || [];
    const approvedLeaveDays = expectedWorkingDays.filter((date) =>
      approvedLeaves.some((leave) => leaveCoversDate(leave, date)),
    );
    const missingAttendanceDays = expectedWorkingDays.filter((date) => {
      return !attendanceDates.has(date) && !approvedLeaveDays.includes(date);
    });
    const recordsMissingClockOut = attendanceRecords
      .filter((attendance) => attendance.clockIn && !attendance.clockOut)
      .map((attendance) => attendance.date);
    const correctionNotes = attendanceRecords.filter((attendance) => {
      return Boolean(attendance.correctionNote?.trim() || attendance.correctionNotes?.trim());
    }).length;

    if (missingAttendanceDays.length > 0) {
      addIssue(
        technician.uid,
        'warning',
        'missing_attendance',
        `${getTechnicianLabel(technician)} has ${missingAttendanceDays.length} missing attendance day(s); these remain payroll-deductible if no approved leave exists`,
      );
    }

    const status =
      recordsMissingClockOut.length > 0 ||
      criticalIssues.some((issue) => issue.technicianId === technician.uid)
        ? 'Blocked'
        : missingAttendanceDays.length > 0 || correctionNotes > 0
          ? 'Warning'
          : 'Ready';

    return {
      technicianId: technician.uid,
      staffId: technician.staffId,
      displayName: technician.displayName,
      branchId: technician.branchId,
      expectedWorkingDays: expectedWorkingDays.length,
      attendanceRecordsFound: attendanceRecords.length,
      missingAttendanceDays,
      recordsMissingClockOut,
      approvedLeaveDays: approvedLeaveDays.length,
      correctionNotes,
      status,
    };
  });

  const payrollByTechnician = new Map<string, Payroll>();
  payrollSnapshot.docs.forEach((payrollDoc) => {
    const payroll = {
      ...(payrollDoc.data() as Payroll),
      payrollId: payrollDoc.id,
    };

    if (!technicians.has(payroll.technicianId)) {
      return;
    }

    payrollByTechnician.set(payroll.technicianId, payroll);

    if (payroll.status === 'approved' || payroll.status === 'paid') {
      addIssue(
        payroll.technicianId,
        'warning',
        'locked_payroll',
        `${getTechnicianLabel(technicians.get(payroll.technicianId))} already has locked ${payroll.status} payroll`,
      );
    }
  });

  const adjustmentCountByTechnician = new Map<string, number>();
  adjustmentSnapshot.docs.forEach((adjustmentDoc) => {
    const adjustment = adjustmentDoc.data() as PayrollAdjustment;
    const payroll = payrollByTechnician.get(adjustment.technicianId);

    if (!technicians.has(adjustment.technicianId) || !isAdjustmentPendingPayroll(adjustment, payroll)) {
      return;
    }

    adjustmentCountByTechnician.set(
      adjustment.technicianId,
      (adjustmentCountByTechnician.get(adjustment.technicianId) || 0) + 1,
    );
  });

  adjustmentCountByTechnician.forEach((count, technicianId) => {
    addIssue(
      technicianId,
      'warning',
      'pending_adjustment',
      `${getTechnicianLabel(technicians.get(technicianId))} has ${count} adjustment(s) pending payroll generation`,
    );
  });

  const blockedTechnicianIds = Array.from(new Set(criticalIssues.map((issue) => issue.technicianId)));
  const blockedTechnicianIdSet = new Set(blockedTechnicianIds);
  const readyTechnicianIds = Array.from(technicians.keys()).filter((technicianId) => {
    const payroll = payrollByTechnician.get(technicianId);
    return !blockedTechnicianIdSet.has(technicianId) && payroll?.status !== 'approved' && payroll?.status !== 'paid';
  });

  return {
    month,
    criticalIssues,
    warnings,
    readyTechnicianIds,
    blockedTechnicianIds,
    attendanceSync,
  };
}

export async function generatePayrollForTechnician(
  params: GeneratePayrollForTechnicianParams,
): Promise<Omit<Payroll, 'createdAt' | 'updatedAt'>> {
  assertCan(params.generatedByRole, 'payroll.generate');
  assertValidMonth(params.month);
  assertValidWorkingDays(params.workingDaysInMonth, params.month);
  await assertPayrollMonthOpen(params.month);

  const payrollId = getPayrollId(params.technicianId, params.month);
  const payrollRef = doc(db, 'payroll', payrollId);
  const existingPayroll = await getDoc(payrollRef);
  const existingCreatedAt = existingPayroll.exists() ? existingPayroll.data().createdAt : null;
  const wasExistingPayroll = existingPayroll.exists();

  if (existingPayroll.exists()) {
    assertCanRegeneratePayroll(existingPayroll.data().status as PayrollStatus | undefined);
  }

  const userSnapshot = await getDoc(doc(db, 'users', params.technicianId));

  if (!userSnapshot.exists()) {
    throw new Error('Technician user not found');
  }

  const userData = userSnapshot.data() as PayrollUser;
  const user: PayrollUser & { technicianId: string } = {
    ...userData,
    uid: userData.uid || params.technicianId,
    baseSalary: Number(userData.baseSalary || 0),
    technicianId: params.technicianId,
  };

  if (user.role !== 'technician') {
    throw new Error('Payroll can only be generated for technician users');
  }

  if (!user.isActive) {
    throw new Error('Payroll cannot be generated for inactive technician');
  }

  assertValidPayrollGenerationInput({
    baseSalary: user.baseSalary,
    month: params.month,
    workingDaysInMonth: params.workingDaysInMonth,
  });

  const monthStartDate = `${params.month}-01`;
  const monthEndDate = getMonthEndDate(params.month);

  const [attendanceSnapshot, leavesSnapshot, commissionsSnapshot, adjustmentsSnapshot] = await Promise.all([
    getDocs(
      query(
        collection(db, 'attendance'),
        where('userId', '==', params.technicianId),
        where('date', '>=', monthStartDate),
        where('date', '<=', monthEndDate),
      ),
    ),
    getDocs(
      query(
        collection(db, 'leaves'),
        where('userId', '==', params.technicianId),
        where('status', '==', 'approved'),
      ),
    ),
    getDocs(
      query(
        collection(db, 'commissions'),
        where('technicianId', '==', params.technicianId),
        where('month', '==', params.month),
      ),
    ),
    getDocs(
      query(
        collection(db, 'payroll_adjustments'),
        where('technicianId', '==', params.technicianId),
        where('month', '==', params.month),
      ),
    ),
  ]);

  const attendanceRecords = attendanceSnapshot.docs.map((attendanceDoc) =>
    mapDocument<PayrollAttendance>(attendanceDoc.id, attendanceDoc.data()),
  );
  const approvedLeaves = leavesSnapshot.docs
    .map((leaveDoc) => mapDocument<PayrollLeave>(leaveDoc.id, leaveDoc.data()))
    .filter((leave) => leave.startDate <= monthEndDate && leave.endDate >= monthStartDate);
  const commissionRecords = commissionsSnapshot.docs.map((commissionDoc) =>
    mapDocument<PayrollCommission>(commissionDoc.id, commissionDoc.data()),
  );
  const approvedCommissions = commissionRecords.filter(isApprovedCommission);
  const manualAdjustments = adjustmentsSnapshot.docs.map((adjustmentDoc) => ({
    ...(adjustmentDoc.data() as PayrollAdjustment),
    adjustmentId: adjustmentDoc.id,
  }));
  const warnings: string[] = [];
  const nonApprovedCommissionCount = commissionRecords.length - approvedCommissions.length;

  if (nonApprovedCommissionCount > 0) {
    warnings.push(`${nonApprovedCommissionCount} commission record(s) were excluded because they are not approved`);
  }

  if (user.baseSalary === 0) {
    warnings.push('Technician baseSalary is 0');
  }

  if (attendanceRecords.some((attendance) => !params.workingDaysInMonth.includes(attendance.date))) {
    warnings.push('Attendance includes date(s) outside configured working days for this payroll run');
  }

  const calculation = calculatePayroll({
    user,
    month: params.month,
    attendanceRecords,
    approvedLeaves,
    approvedCommissions,
    manualAdjustments,
    workingDaysInMonth: params.workingDaysInMonth,
  });

  assertFinitePayrollNumber(calculation.approvedCommission, 'Approved commission');
  assertFinitePayrollNumber(calculation.deductions.absentDeduction, 'Absent deduction');
  assertFinitePayrollNumber(calculation.deductions.halfDayDeduction, 'Half-day deduction');
  assertFinitePayrollNumber(calculation.deductions.manualDeduction, 'Manual deduction');
  assertFinitePayrollNumber(calculation.deductions.adjustmentBonus, 'Adjustment bonus');
  assertFinitePayrollNumber(calculation.deductions.totalDeduction, 'Total deduction');
  assertFinitePayrollNumber(calculation.netSalary, 'Net salary');

  const adjustmentSnapshot = {
    bonuses: calculation.deductions.adjustmentBonus,
    deductions: calculation.deductions.manualDeduction,
    records: manualAdjustments.map((adjustment) => ({
      adjustmentId: adjustment.adjustmentId,
      type: adjustment.type,
      category: adjustment.category,
      amount: Number(adjustment.amount || 0),
      reason: adjustment.reason,
      createdBy: adjustment.createdBy,
    })),
  };

  const breakdown: PayrollBreakdown = {
    baseSalary: user.baseSalary,
    approvedCommission: calculation.approvedCommission,
    attendance: {
      workingDaysInMonth: params.workingDaysInMonth.length,
      presentDays: calculation.attendanceSummary.presentDays,
      absentDays: calculation.attendanceSummary.absentDays,
      halfDays: calculation.attendanceSummary.halfDays,
      approvedLeaveDays: calculation.attendanceSummary.approvedLeaveDays,
      lateMinutes: calculation.attendanceSummary.lateMinutes,
    },
    deductions: {
      absentDeduction: calculation.deductions.absentDeduction,
      halfDayDeduction: calculation.deductions.halfDayDeduction,
      manualDeduction: calculation.deductions.manualDeduction,
    },
    adjustments: adjustmentSnapshot,
  };

  const payrollPayload = {
    payrollId,
    technicianId: params.technicianId,
    staffId: user.staffId,
    displayName: user.displayName,
    branchId: user.branchId,
    month: params.month,
    baseSalary: user.baseSalary,
    approvedCommission: calculation.approvedCommission,
    attendanceSummary: calculation.attendanceSummary,
    deductions: calculation.deductions,
    breakdown,
    warnings,
    netSalary: calculation.netSalary,
    status: 'draft' as const,
    generatedBy: params.generatedBy,
    statusUpdatedBy: params.generatedBy,
    statusUpdatedAt: serverTimestamp(),
    generatedAt: serverTimestamp(),
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await runTransaction(db, async (transaction) => {
    const monthSnapshot = await transaction.get(getPayrollMonthRef(params.month));
    if (monthSnapshot.exists() && monthSnapshot.data().status === 'closed') {
      throw new Error(`Payroll month ${params.month} is closed`);
    }

    const latestPayroll = await transaction.get(payrollRef);
    const latestStatus = latestPayroll.exists()
      ? (latestPayroll.data().status as PayrollStatus | undefined)
      : undefined;

    if (latestPayroll.exists() && latestStatus) {
      assertCanRegeneratePayroll(latestStatus);
    } else if (latestPayroll.exists()) {
      throw new Error(getLockedPayrollMessage(latestStatus));
    }

    transaction.set(
      payrollRef,
      {
        ...payrollPayload,
        createdAt: latestPayroll.exists() ? latestPayroll.data().createdAt : serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(createAuditRef(), {
      actorId: params.generatedBy,
      action: latestPayroll.exists() ? 'payroll.regenerated' : 'payroll.generated',
      targetCollection: 'payroll',
      targetId: payrollId,
      payrollId,
      userId: params.generatedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        technicianId: params.technicianId,
        month: params.month,
        status: 'draft',
        netSalary: calculation.netSalary,
        breakdown,
        warnings,
      },
      createdAt: serverTimestamp(),
    });
  });

  await writeAuditLog({
    entityType: 'payroll',
    entityId: payrollId,
    action: wasExistingPayroll ? 'update' : 'create',
    changedBy: params.generatedBy,
    changedByDisplayName: await getActorDisplayName(params.generatedBy),
    changes: [
      { field: 'baseSalary', before: wasExistingPayroll ? existingPayroll.data().baseSalary : null, after: user.baseSalary },
      {
        field: 'approvedCommission',
        before: wasExistingPayroll ? existingPayroll.data().approvedCommission : null,
        after: calculation.approvedCommission,
      },
      { field: 'netSalary', before: wasExistingPayroll ? existingPayroll.data().netSalary : null, after: calculation.netSalary },
      { field: 'status', before: wasExistingPayroll ? existingPayroll.data().status : null, after: 'draft' },
    ],
    note: wasExistingPayroll ? `Payroll regenerated for ${params.month}` : `Payroll generated for ${params.month}`,
  });

  return {
    payrollId,
    technicianId: params.technicianId,
    staffId: user.staffId,
    displayName: user.displayName,
    branchId: user.branchId,
    month: params.month,
    baseSalary: user.baseSalary,
    approvedCommission: calculation.approvedCommission,
    attendanceSummary: calculation.attendanceSummary,
    deductions: calculation.deductions,
    breakdown,
    warnings,
    netSalary: calculation.netSalary,
    status: 'draft',
    generatedBy: params.generatedBy,
  };
}

export async function approvePayroll(params: ApprovePayrollParams): Promise<void> {
  assertCan(params.approvedByRole, 'payroll.approve');
  const payrollRef = doc(db, 'payroll', params.payrollId);

  await runTransaction(db, async (transaction) => {
    const payrollSnapshot = await transaction.get(payrollRef);

    if (!payrollSnapshot.exists()) {
      throw new Error('Payroll not found');
    }

    const payroll = payrollSnapshot.data() as Payroll;

    if (payroll.status === 'approved') {
      throw new Error('Payroll is already approved');
    }

    assertPayrollStatusTransition(payroll.status, 'approved');

    transaction.update(payrollRef, {
      status: 'approved',
      approvedBy: params.approvedBy,
      approvedAt: serverTimestamp(),
      statusUpdatedBy: params.approvedBy,
      statusUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.approvedBy,
      action: 'payroll.approved',
      targetCollection: 'payroll',
      targetId: params.payrollId,
      payrollId: params.payrollId,
      userId: params.approvedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        technicianId: payroll.technicianId,
        month: payroll.month,
        previousStatus: payroll.status,
        nextStatus: 'approved',
        netSalary: payroll.netSalary,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function markPayrollPaid(params: MarkPayrollPaidParams): Promise<void> {
  assertCan(params.paidByRole, 'payroll.markPaid');
  const payrollRef = doc(db, 'payroll', params.payrollId);

  await runTransaction(db, async (transaction) => {
    const payrollSnapshot = await transaction.get(payrollRef);

    if (!payrollSnapshot.exists()) {
      throw new Error('Payroll not found');
    }

    const payroll = payrollSnapshot.data() as Payroll;

    if (payroll.status === 'paid') {
      throw new Error('Payroll is already paid');
    }

    assertPayrollStatusTransition(payroll.status, 'paid');

    transaction.update(payrollRef, {
      status: 'paid',
      paidBy: params.paidBy,
      paidAt: serverTimestamp(),
      statusUpdatedBy: params.paidBy,
      statusUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(createAuditRef(), {
      actorId: params.paidBy,
      action: 'payroll.paid',
      targetCollection: 'payroll',
      targetId: params.payrollId,
      payrollId: params.payrollId,
      userId: params.paidBy,
      generatedAt: serverTimestamp(),
      metadata: {
        technicianId: payroll.technicianId,
        month: payroll.month,
        previousStatus: payroll.status,
        nextStatus: 'paid',
        netSalary: payroll.netSalary,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function logPayslipGenerated(params: LogPayslipGeneratedParams): Promise<void> {
  const generatedAt = serverTimestamp();
  console.log('[DEBUG READ]', 'logPayslipGenerated.auditCreate', 'audit_logs', {
    userId: params.userId,
    payrollId: params.payrollId,
    action: 'payroll.payslip_generated',
  });

  try {
    await runTransaction(db, async (transaction) => {
      transaction.set(createAuditRef(), {
        actorId: params.userId,
        action: 'payroll.payslip_generated',
        targetCollection: 'payroll',
        targetId: params.payrollId,
        userId: params.userId,
        payrollId: params.payrollId,
        generatedAt,
        metadata: {
          fileName: params.fileName,
        },
        createdAt: generatedAt,
      });
    });
  } catch (error) {
    console.error('[PERMISSION ERROR]', 'logPayslipGenerated.auditCreate', error);
    throw error;
  }
}

export async function createPayrollAdjustment(
  params: CreatePayrollAdjustmentParams,
): Promise<{ adjustmentId: string }> {
  assertCan(params.createdByRole, 'payroll.generate');
  validatePayrollAdjustmentInput(params);
  await assertPayrollMonthOpen(params.month);

  const payrollId = getPayrollId(params.technicianId, params.month);
  const payrollRef = doc(db, 'payroll', payrollId);
  const adjustmentRef = doc(collection(db, 'payroll_adjustments'));

  await runTransaction(db, async (transaction) => {
    const monthSnapshot = await transaction.get(getPayrollMonthRef(params.month));
    if (monthSnapshot.exists() && monthSnapshot.data().status === 'closed') {
      throw new Error(`Payroll month ${params.month} is closed`);
    }

    const payrollSnapshot = await transaction.get(payrollRef);

    if (payrollSnapshot.exists()) {
      assertCanRegeneratePayroll(payrollSnapshot.data().status as PayrollStatus | undefined);
    }

    const payload = {
      technicianId: params.technicianId,
      month: params.month,
      type: params.type,
      category: params.category.trim(),
      amount: Number(params.amount),
      reason: params.reason.trim(),
      createdBy: params.createdBy,
      createdAt: serverTimestamp(),
    };

    transaction.set(adjustmentRef, payload);
    transaction.set(createAuditRef(), {
      actorId: params.createdBy,
      action: 'payroll.adjustment_created',
      targetCollection: 'payroll_adjustments',
      targetId: adjustmentRef.id,
      payrollId,
      userId: params.createdBy,
      generatedAt: serverTimestamp(),
      metadata: {
        technicianId: params.technicianId,
        month: params.month,
        type: params.type,
        category: params.category.trim(),
        amount: Number(params.amount),
      },
      createdAt: serverTimestamp(),
    });
  });

  return { adjustmentId: adjustmentRef.id };
}

export async function getPayrollMonth(month: string): Promise<{ month: string; status: 'open' | 'closed' } | null> {
  assertValidMonth(month);

  const monthSnapshot = await getDoc(getPayrollMonthRef(month));
  if (!monthSnapshot.exists()) return null;

  const data = monthSnapshot.data();
  return {
    month,
    status: data.status === 'closed' ? 'closed' : 'open',
  };
}

export async function closePayrollMonth(params: ClosePayrollMonthParams): Promise<void> {
  assertCan(params.closedByRole, 'payroll.approve');
  assertValidMonth(params.month);
  await validatePayrollMonthCanClose(params.month);

  await runTransaction(db, async (transaction) => {
    const monthRef = getPayrollMonthRef(params.month);
    const monthSnapshot = await transaction.get(monthRef);

    if (monthSnapshot.exists() && monthSnapshot.data().status === 'closed') {
      throw new Error(`Payroll month ${params.month} is already closed`);
    }

    transaction.set(
      monthRef,
      {
        month: params.month,
        status: 'closed',
        closedAt: serverTimestamp(),
        closedBy: params.closedBy,
        updatedAt: serverTimestamp(),
        createdAt: monthSnapshot.exists() ? monthSnapshot.data().createdAt : serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(createAuditRef(), {
      actorId: params.closedBy,
      action: 'payroll.month_closed',
      targetCollection: 'payroll_months',
      targetId: params.month,
      payrollMonth: params.month,
      userId: params.closedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        month: params.month,
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function reopenPayrollMonth(params: ReopenPayrollMonthParams): Promise<void> {
  assertCan(params.reopenedByRole, 'payroll.approve');
  assertValidMonth(params.month);

  if (!params.reason.trim()) {
    throw new Error('Reopen reason is required');
  }

  await runTransaction(db, async (transaction) => {
    const monthRef = getPayrollMonthRef(params.month);
    const monthSnapshot = await transaction.get(monthRef);

    if (!monthSnapshot.exists() || monthSnapshot.data().status !== 'closed') {
      throw new Error(`Payroll month ${params.month} is not closed`);
    }

    transaction.set(
      monthRef,
      {
        ...monthSnapshot.data(),
        month: params.month,
        status: 'open',
        reopenedAt: serverTimestamp(),
        reopenedBy: params.reopenedBy,
        reopenReason: params.reason.trim(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(createAuditRef(), {
      actorId: params.reopenedBy,
      action: 'payroll.month_reopened',
      targetCollection: 'payroll_months',
      targetId: params.month,
      payrollMonth: params.month,
      userId: params.reopenedBy,
      generatedAt: serverTimestamp(),
      metadata: {
        month: params.month,
        reason: params.reason.trim(),
      },
      createdAt: serverTimestamp(),
    });
  });
}

export async function generatePayroll() {
  // TODO: Implement batch payroll generation after single-technician generation is validated.
}
