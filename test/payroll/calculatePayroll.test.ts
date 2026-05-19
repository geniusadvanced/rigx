import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll } from '../../src/features/payroll/utils/calculatePayroll';
import type {
  PayrollAdjustment,
  PayrollAttendance,
  PayrollCommission,
  PayrollLeave,
  PayrollUser,
} from '../../src/features/payroll/types';

const timestamp = new Date() as unknown as PayrollAttendance['createdAt'];

const user: PayrollUser = {
  uid: 'tech-1',
  staffId: 'RIGX001',
  displayName: 'Tech One',
  role: 'technician',
  branchId: 'branch-a',
  isActive: true,
  baseSalary: 5000,
};

function commission(status: PayrollCommission['status'], amount: number): PayrollCommission {
  return {
    commissionId: `commission-${status}-${amount}`,
    technicianId: 'tech-1',
    jobId: `job-${amount}`,
    month: '2026-04',
    jobTotal: amount * 20,
    rate: 0.05,
    amount,
    eligibilityStatus: status === 'approved' ? 'eligible' : 'pending_approval',
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function attendance(date: string, status: PayrollAttendance['status'], lateMinutes = 0): PayrollAttendance {
  return {
    userId: 'tech-1',
    branchId: 'branch-a',
    date,
    status,
    attendanceType: status === 'half_day' ? 'half' : 'full',
    lateMinutes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('calculatePayroll', () => {
  it('calculates normal payroll with commission, absent, half-day, and manual deductions', () => {
    const manualAdjustments: PayrollAdjustment[] = [
      {
        adjustmentId: 'adjustment-1',
        technicianId: 'tech-1',
        month: '2026-04',
        type: 'deduction',
        category: 'Manual correction',
        amount: 200,
        reason: 'Manual correction',
        createdBy: 'manager-1',
        createdAt: timestamp,
      },
      {
        adjustmentId: 'adjustment-2',
        technicianId: 'tech-1',
        month: '2026-04',
        type: 'bonus',
        category: 'Performance',
        amount: 100,
        reason: 'Performance bonus',
        createdBy: 'manager-1',
        createdAt: timestamp,
      },
    ];
    const approvedLeaves: PayrollLeave[] = [
      {
        leaveId: 'leave-1',
        userId: 'tech-1',
        branchId: 'branch-a',
        leaveType: 'annual',
        status: 'approved',
        startDate: '2026-04-04',
        endDate: '2026-04-04',
        reason: 'Annual leave',
        createdBy: 'tech-1',
        createdAt: timestamp,
      },
    ];

    const result = calculatePayroll({
      user,
      month: '2026-04',
      workingDaysInMonth: ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'],
      attendanceRecords: [
        attendance('2026-04-01', 'present'),
        attendance('2026-04-02', 'late', 20),
        attendance('2026-04-03', 'half_day'),
      ],
      approvedLeaves,
      approvedCommissions: [
        commission('approved', 300),
        commission('approved', 150),
        commission('pending', 999),
        commission('rejected', 999),
      ],
      manualAdjustments,
    });

    assert.deepEqual(result.attendanceSummary, {
      workingDays: 5,
      presentDays: 2,
      lateDays: 1,
      lateMinutes: 20,
      halfDays: 1,
      approvedLeaveDays: 1,
      approvedHalfLeaveDays: 0,
      absentDays: 1,
    });
    assert.equal(result.approvedCommission, 450);
    assert.equal(result.deductions.absentDeduction, 1000);
    assert.equal(result.deductions.halfDayDeduction, 500);
    assert.equal(result.deductions.manualDeduction, 200);
    assert.equal(result.deductions.adjustmentBonus, 100);
    assert.equal(result.deductions.totalDeduction, 1700);
    assert.equal(result.netSalary, 3850);
  });

  it('counts only approved commissions', () => {
    const result = calculatePayroll({
      user,
      month: '2026-04',
      workingDaysInMonth: ['2026-04-01'],
      attendanceRecords: [attendance('2026-04-01', 'present')],
      approvedLeaves: [],
      approvedCommissions: [commission('approved', 100), commission('pending', 200), commission('rejected', 300)],
      manualAdjustments: [],
    });

    assert.equal(result.approvedCommission, 100);
  });
}
);
