import type { Role } from '@/types';
import type { StaffProfile, StaffProfileCreate, StaffProfileUpdate } from '../types';

const validRoles: Role[] = ['admin', 'manager', 'technician'];

export function assertValidRole(role: Role): void {
  if (!validRoles.includes(role)) {
    throw new Error('Staff role is invalid');
  }
}

export function assertValidBaseSalary(baseSalary: number): void {
  if (!Number.isFinite(baseSalary) || baseSalary < 0) {
    throw new Error('Base salary must be a valid number greater than or equal to 0');
  }
}

export function assertPayrollCriticalFieldsForActiveTechnician(
  staff: Pick<StaffProfile, 'staffId' | 'name' | 'branchId' | 'role' | 'isActive' | 'baseSalary'>,
): void {
  assertValidRole(staff.role);
  assertValidBaseSalary(Number(staff.baseSalary));

  if (staff.role !== 'technician' || !staff.isActive) return;

  if (!staff.staffId.trim()) {
    throw new Error('Active technician must have a staff ID');
  }

  if (!staff.name.trim()) {
    throw new Error('Active technician must have a name');
  }

  if (!staff.branchId.trim()) {
    throw new Error('Active technician must have a branch');
  }
}

export function assertValidStaffProfileUpdate(update: StaffProfileUpdate, existingBaseSalary: number): void {
  assertPayrollCriticalFieldsForActiveTechnician({
    ...update,
    baseSalary: existingBaseSalary,
  });
}

export function assertValidStaffProfileCreate(input: StaffProfileCreate): void {
  if (!input.email.trim()) {
    throw new Error('Staff email is required');
  }

  assertPayrollCriticalFieldsForActiveTechnician(input);
}
