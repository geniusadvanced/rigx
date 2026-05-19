import type {
  PayrollAdjustment,
  PayrollAttendance,
  PayrollAttendanceSummary,
  PayrollCommission,
  PayrollDeductions,
  PayrollLeave,
  PayrollUser,
} from '../types';

interface PayrollCalculationInput {
  user: PayrollUser & { technicianId?: string };
  month: string;
  attendanceRecords: PayrollAttendance[];
  approvedLeaves: PayrollLeave[];
  approvedCommissions: PayrollCommission[];
  manualAdjustments: PayrollAdjustment[];
  workingDaysInMonth: string[];
}

interface PayrollCalculationResult {
  attendanceSummary: PayrollAttendanceSummary;
  approvedCommission: number;
  deductions: PayrollDeductions;
  netSalary: number;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function isLeaveForDate(leave: PayrollLeave, date: string): boolean {
  return leave.status === 'approved' && leave.startDate <= date && leave.endDate >= date;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const attendanceByDate = new Map(input.attendanceRecords.map((record) => [record.date, record]));
  const attendanceSummary: PayrollAttendanceSummary = {
    workingDays: input.workingDaysInMonth.length,
    presentDays: 0,
    lateDays: 0,
    lateMinutes: 0,
    halfDays: 0,
    approvedLeaveDays: 0,
    approvedHalfLeaveDays: 0,
    absentDays: 0,
  };

  for (const date of input.workingDaysInMonth) {
    const attendance = attendanceByDate.get(date);

    if (attendance) {
      if (attendance.status === 'late') {
        attendanceSummary.presentDays += 1;
        attendanceSummary.lateDays += 1;
        attendanceSummary.lateMinutes += Number(attendance.lateMinutes || 0);
      } else if (attendance.status === 'half_day' || attendance.attendanceType === 'half') {
        attendanceSummary.halfDays += 1;
      } else {
        attendanceSummary.presentDays += 1;
      }

      continue;
    }

    const approvedLeave = input.approvedLeaves.find((leave) => isLeaveForDate(leave, date));

    if (approvedLeave) {
      if (approvedLeave.type === 'half_day') {
        attendanceSummary.approvedHalfLeaveDays += 1;
      } else {
        attendanceSummary.approvedLeaveDays += 1;
      }

      continue;
    }

    attendanceSummary.absentDays += 1;
  }

  const approvedCommission = roundMoney(
    input.approvedCommissions
      .filter((commission) => commission.status === 'approved')
      .reduce((total, commission) => total + Number(commission.amount || 0), 0),
  );
  const dailyRate = input.workingDaysInMonth.length > 0 ? input.user.baseSalary / input.workingDaysInMonth.length : 0;
  const absentDeduction = roundMoney(attendanceSummary.absentDays * dailyRate);
  const halfDayDeduction = roundMoney(attendanceSummary.halfDays * dailyRate * 0.5);
  const manualDeduction = roundMoney(
    input.manualAdjustments
      .filter((adjustment) => adjustment.type === 'deduction')
      .reduce((total, adjustment) => total + Number(adjustment.amount || 0), 0),
  );
  const adjustmentBonus = roundMoney(
    input.manualAdjustments
      .filter((adjustment) => adjustment.type === 'bonus')
      .reduce((total, adjustment) => total + Number(adjustment.amount || 0), 0),
  );
  const totalDeduction = roundMoney(absentDeduction + halfDayDeduction + manualDeduction);
  const deductions: PayrollDeductions = {
    absentDeduction,
    halfDayDeduction,
    manualDeduction,
    adjustmentBonus,
    totalDeduction,
  };
  const netSalary = roundMoney(input.user.baseSalary + approvedCommission + adjustmentBonus - totalDeduction);

  return {
    attendanceSummary,
    approvedCommission,
    deductions,
    netSalary,
  };
}
