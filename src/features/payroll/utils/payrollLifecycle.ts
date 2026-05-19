import type { PayrollStatus } from '../types';

interface PayrollGenerationValidationInput {
  baseSalary: number;
  month: string;
  workingDaysInMonth: string[];
}

export function isLockedPayrollStatus(status?: PayrollStatus): boolean {
  return status === 'approved' || status === 'paid';
}

export function getLockedPayrollMessage(status?: PayrollStatus): string {
  if (status === 'approved') return 'Payroll is approved and locked';
  if (status === 'paid') return 'Payroll is paid and locked';
  return 'Payroll is locked';
}

export function assertCanRegeneratePayroll(status?: PayrollStatus): void {
  if (isLockedPayrollStatus(status)) {
    throw new Error(getLockedPayrollMessage(status));
  }
}

export function assertValidMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Payroll month must use YYYY-MM format');
  }

  const monthNumber = Number(month.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error('Payroll month is invalid');
  }
}

export function assertValidWorkingDays(workingDaysInMonth: string[], month: string): void {
  if (!workingDaysInMonth.length) {
    throw new Error('Working days are required');
  }

  const uniqueWorkingDays = new Set(workingDaysInMonth);
  if (uniqueWorkingDays.size !== workingDaysInMonth.length) {
    throw new Error('Working days contain duplicate dates');
  }

  const invalidFormatDay = workingDaysInMonth.find((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date));
  if (invalidFormatDay) {
    throw new Error(`Working day ${invalidFormatDay} must use YYYY-MM-DD format`);
  }

  const invalidDay = workingDaysInMonth.find((date) => !date.startsWith(`${month}-`));
  if (invalidDay) {
    throw new Error(`Working day ${invalidDay} is outside selected payroll month`);
  }

  const impossibleDay = workingDaysInMonth.find((date) => {
    const [year, monthNumber, day] = date.split('-').map(Number);
    const parsed = new Date(year, monthNumber - 1, day);
    return (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== monthNumber - 1 ||
      parsed.getDate() !== day
    );
  });

  if (impossibleDay) {
    throw new Error(`Working day ${impossibleDay} is not a valid calendar date`);
  }
}

export function assertValidPayrollGenerationInput(input: PayrollGenerationValidationInput): void {
  assertValidMonth(input.month);
  assertValidWorkingDays(input.workingDaysInMonth, input.month);

  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) {
    throw new Error('Technician baseSalary is invalid');
  }
}

export function assertPayrollStatusTransition(currentStatus: PayrollStatus, nextStatus: PayrollStatus): void {
  if (currentStatus === 'draft' && nextStatus === 'approved') return;
  if (currentStatus === 'approved' && nextStatus === 'paid') return;

  if (currentStatus === 'paid') {
    throw new Error('Payroll is paid and locked');
  }

  if (currentStatus === 'draft' && nextStatus === 'paid') {
    throw new Error('Only approved payroll can be marked as paid');
  }

  if (nextStatus === 'approved') {
    throw new Error('Only draft payroll can be approved');
  }

  if (nextStatus === 'paid') {
    throw new Error('Only approved payroll can be marked as paid');
  }

  throw new Error(`Invalid payroll status transition: ${currentStatus} to ${nextStatus}`);
}
