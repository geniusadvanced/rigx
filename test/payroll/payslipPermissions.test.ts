import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canGeneratePayslip, getPayslipFileName } from '../../src/features/payroll/utils/generatePayslipPdf';
import type { Payroll } from '../../src/features/payroll/types';
import type { UserData } from '../../src/types';

const timestamp = new Date() as unknown as Payroll['createdAt'];

function payroll(status: Payroll['status'], technicianId = 'tech-1'): Payroll {
  return {
    payrollId: `${technicianId}_2026-04`,
    technicianId,
    staffId: 'RIGX 001',
    displayName: 'Tech One',
    branchId: 'branch-a',
    month: '2026-04',
    baseSalary: 5000,
    approvedCommission: 100,
    attendanceSummary: {
      workingDays: 1,
      presentDays: 1,
      lateDays: 0,
      lateMinutes: 0,
      halfDays: 0,
      approvedLeaveDays: 0,
      approvedHalfLeaveDays: 0,
      absentDays: 0,
    },
    deductions: {
      absentDeduction: 0,
      halfDayDeduction: 0,
      manualDeduction: 0,
      adjustmentBonus: 0,
      totalDeduction: 0,
    },
    netSalary: 5100,
    status,
    generatedBy: 'manager-1',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function actor(uid: string, role: UserData['role']): Pick<UserData, 'uid' | 'role'> {
  return { uid, role };
}

describe('payslip permission helpers', () => {
  it('allows technician to generate own approved payslip', () => {
    assert.equal(canGeneratePayslip(payroll('approved'), actor('tech-1', 'technician')), true);
  });

  it('allows technician to generate own paid payslip', () => {
    assert.equal(canGeneratePayslip(payroll('paid'), actor('tech-1', 'technician')), true);
  });

  it('blocks technician from generating draft payslip', () => {
    assert.equal(canGeneratePayslip(payroll('draft'), actor('tech-1', 'technician')), false);
  });

  it('blocks technician from generating another technician payslip', () => {
    assert.equal(canGeneratePayslip(payroll('approved', 'tech-2'), actor('tech-1', 'technician')), false);
  });

  it('allows admin or manager for approved and paid payslips', () => {
    assert.equal(canGeneratePayslip(payroll('approved'), actor('admin-1', 'admin')), true);
    assert.equal(canGeneratePayslip(payroll('paid'), actor('manager-1', 'manager')), true);
  });

  it('blocks admin or manager for draft payslips', () => {
    assert.equal(canGeneratePayslip(payroll('draft'), actor('admin-1', 'admin')), false);
    assert.equal(canGeneratePayslip(payroll('draft'), actor('manager-1', 'manager')), false);
  });

  it('uses deterministic sanitized payslip file names', () => {
    assert.equal(getPayslipFileName(payroll('approved')), 'payslip_RIGX_001_2026-04.pdf');
  });
});
