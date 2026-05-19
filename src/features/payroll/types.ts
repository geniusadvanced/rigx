import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type PayrollStatus = 'draft' | 'approved' | 'paid';
export type PayrollMonthStatus = 'open' | 'closed';

export type LeaveType = 'annual' | 'emergency' | 'medical' | 'unpaid' | 'other';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type CommissionEligibilityStatus =
  | 'eligible'
  | 'not_eligible'
  | 'pending_documents'
  | 'pending_approval';

export type CommissionStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export type PayrollAdjustmentType = 'bonus' | 'deduction';

export type PayrollChecklistSeverity = 'critical' | 'warning';
export type PayrollAttendanceSyncStatus = 'Ready' | 'Warning' | 'Blocked';

export interface PayrollUser {
  uid: string;
  staffId: string;
  displayName: string;
  role: Role;
  branchId: string;
  isActive: boolean;
  baseSalary: number;
}

export interface PayrollAttendance {
  userId: string;
  branchId: string;
  date: string;
  status: 'present' | 'late' | 'half_day';
  attendanceType?: 'full' | 'half';
  totalHours?: number;
  lateMinutes?: number;
  clockInBranchId?: string;
  clockOutBranchId?: string;
  crossBranchAttendance?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayrollLeave {
  leaveId: string;
  userId: string;
  branchId?: string;
  leaveType: LeaveType;
  type?: 'half_day';
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  reason: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: Timestamp;
  rejectedBy?: string;
  rejectedAt?: Timestamp;
  rejectionReason?: string;
  cancelledAt?: Timestamp;
  createdAt: Timestamp;
}

export interface PayrollCommission {
  commissionId: string;
  technicianId: string;
  jobId: string;
  month: string;
  jobTotal: number;
  commissionBasis?: 'net_profit' | 'legacy';
  rate: number;
  amount: number;
  amountCollected?: number;
  partsCost?: number;
  outsourceCost?: number;
  otherDirectCost?: number;
  totalDirectCost?: number;
  netProfit?: number;
  calculatedAt?: Timestamp;
  eligibilityStatus: CommissionEligibilityStatus;
  status: CommissionStatus;
  approvedBy?: string;
  approvedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayrollAdjustment {
  adjustmentId: string;
  technicianId: string;
  month: string;
  type: PayrollAdjustmentType;
  category: string;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface PayrollAttendanceSummary {
  workingDays: number;
  presentDays: number;
  lateDays: number;
  lateMinutes: number;
  halfDays: number;
  approvedLeaveDays: number;
  approvedHalfLeaveDays: number;
  absentDays: number;
}

export interface PayrollDeductions {
  absentDeduction: number;
  halfDayDeduction: number;
  manualDeduction: number;
  adjustmentBonus: number;
  totalDeduction: number;
}

export interface PayrollBreakdown {
  baseSalary: number;
  approvedCommission: number;
  attendance: {
    workingDaysInMonth: number;
    presentDays: number;
    absentDays: number;
    halfDays: number;
    approvedLeaveDays: number;
    lateMinutes: number;
  };
  deductions: {
    absentDeduction: number;
    halfDayDeduction: number;
    manualDeduction: number;
  };
  adjustments?: {
    bonuses: number;
    deductions: number;
    records: Array<{
      adjustmentId: string;
      type: PayrollAdjustmentType;
      category: string;
      amount: number;
      reason: string;
      createdBy: string;
    }>;
  };
}

export interface Payroll {
  payrollId: string;
  technicianId: string;
  staffId: string;
  displayName: string;
  branchId: string;
  month: string;
  baseSalary: number;
  approvedCommission: number;
  attendanceSummary: PayrollAttendanceSummary;
  deductions: PayrollDeductions;
  breakdown?: PayrollBreakdown;
  warnings?: string[];
  netSalary: number;
  status: PayrollStatus;
  generatedBy: string;
  approvedBy?: string;
  paidBy?: string;
  approvedAt?: Timestamp;
  paidAt?: Timestamp;
  statusUpdatedBy?: string;
  statusUpdatedAt?: Timestamp;
  generatedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayrollMonth {
  month: string;
  status: PayrollMonthStatus;
  closedAt?: Timestamp;
  closedBy?: string;
  reopenedAt?: Timestamp;
  reopenedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PayrollChecklistIssue {
  technicianId: string;
  staffId?: string;
  displayName?: string;
  branchId?: string;
  severity: PayrollChecklistSeverity;
  code:
    | 'missing_base_salary'
    | 'missing_staff_id'
    | 'missing_branch_id'
    | 'pending_leave'
    | 'missing_attendance'
    | 'missing_clock_out'
    | 'correction_note'
    | 'locked_payroll'
    | 'pending_adjustment';
  message: string;
}

export interface PayrollAttendanceSyncCheck {
  technicianId: string;
  staffId?: string;
  displayName?: string;
  branchId?: string;
  expectedWorkingDays: number;
  attendanceRecordsFound: number;
  missingAttendanceDays: string[];
  recordsMissingClockOut: string[];
  approvedLeaveDays: number;
  correctionNotes: number;
  status: PayrollAttendanceSyncStatus;
}

export interface PayrollPreRunChecklist {
  month: string;
  criticalIssues: PayrollChecklistIssue[];
  warnings: PayrollChecklistIssue[];
  readyTechnicianIds: string[];
  blockedTechnicianIds: string[];
  attendanceSync: PayrollAttendanceSyncCheck[];
}
