import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPayrollCriticalFieldsForActiveTechnician,
  assertValidBaseSalary,
  assertValidRole,
  assertValidStaffProfileCreate,
} from '../../src/features/hr/utils/staffValidation';

describe('staff validation', () => {
  it('allows valid roles', () => {
    assert.doesNotThrow(() => assertValidRole('admin'));
    assert.doesNotThrow(() => assertValidRole('manager'));
    assert.doesNotThrow(() => assertValidRole('technician'));
  });

  it('blocks invalid base salary', () => {
    assert.throws(() => assertValidBaseSalary(-1), /Base salary/);
    assert.throws(() => assertValidBaseSalary(Number.NaN), /Base salary/);
  });

  it('requires payroll-critical fields for active technicians', () => {
    assert.throws(
      () =>
        assertPayrollCriticalFieldsForActiveTechnician({
          staffId: '',
          name: 'Tech One',
          branchId: 'branch-a',
          role: 'technician',
          isActive: true,
          baseSalary: 1000,
        }),
      /staff ID/,
    );

    assert.throws(
      () =>
        assertPayrollCriticalFieldsForActiveTechnician({
          staffId: 'T001',
          name: '',
          branchId: 'branch-a',
          role: 'technician',
          isActive: true,
          baseSalary: 1000,
        }),
      /name/,
    );

    assert.throws(
      () =>
        assertPayrollCriticalFieldsForActiveTechnician({
          staffId: 'T001',
          name: 'Tech One',
          branchId: '',
          role: 'technician',
          isActive: true,
          baseSalary: 1000,
        }),
      /branch/,
    );
  });

  it('does not require payroll-critical fields for inactive technicians', () => {
    assert.doesNotThrow(() =>
      assertPayrollCriticalFieldsForActiveTechnician({
        staffId: '',
        name: '',
        branchId: '',
        role: 'technician',
        isActive: false,
        baseSalary: 0,
      }),
    );
  });

  it('validates staff profile creation input', () => {
    assert.doesNotThrow(() =>
      assertValidStaffProfileCreate({
        staffId: 'T001',
        name: 'Tech One',
        email: 'tech@example.com',
        role: 'technician',
        branchId: 'branch-a',
        isActive: true,
        baseSalary: 1000,
      }),
    );

    assert.throws(
      () =>
        assertValidStaffProfileCreate({
          staffId: 'T001',
          name: 'Tech One',
          email: '',
          role: 'technician',
          branchId: 'branch-a',
          isActive: true,
          baseSalary: 1000,
        }),
      /email/,
    );

    assert.throws(
      () =>
        assertValidStaffProfileCreate({
          staffId: 'T001',
          name: 'Tech One',
          email: 'tech@example.com',
          role: 'technician',
          branchId: 'branch-a',
          isActive: true,
          baseSalary: -1,
        }),
      /Base salary/,
    );
  });
});
