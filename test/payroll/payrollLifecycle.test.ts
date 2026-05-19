import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanRegeneratePayroll,
  assertPayrollStatusTransition,
  assertValidPayrollGenerationInput,
} from '../../src/features/payroll/utils/payrollLifecycle';

describe('payroll lifecycle rules', () => {
  it('allows draft payroll to regenerate', () => {
    assert.doesNotThrow(() => assertCanRegeneratePayroll('draft'));
  });

  it('blocks approved payroll regeneration', () => {
    assert.throws(() => assertCanRegeneratePayroll('approved'), /approved and locked/);
  });

  it('blocks paid payroll regeneration', () => {
    assert.throws(() => assertCanRegeneratePayroll('paid'), /paid and locked/);
  });

  it('allows draft to approved', () => {
    assert.doesNotThrow(() => assertPayrollStatusTransition('draft', 'approved'));
  });

  it('allows approved to paid', () => {
    assert.doesNotThrow(() => assertPayrollStatusTransition('approved', 'paid'));
  });

  it('blocks draft to paid', () => {
    assert.throws(() => assertPayrollStatusTransition('draft', 'paid'), /Only approved payroll can be marked as paid/);
  });

  it('blocks paid payroll updates', () => {
    assert.throws(() => assertPayrollStatusTransition('paid', 'approved'), /paid and locked/);
  });

  it('throws for invalid baseSalary', () => {
    assert.throws(
      () =>
        assertValidPayrollGenerationInput({
          baseSalary: -1,
          month: '2026-04',
          workingDaysInMonth: ['2026-04-01'],
        }),
      /baseSalary is invalid/,
    );
  });

  it('throws for invalid workingDaysInMonth', () => {
    assert.throws(
      () =>
        assertValidPayrollGenerationInput({
          baseSalary: 1000,
          month: '2026-04',
          workingDaysInMonth: ['2026-04-31'],
        }),
      /not a valid calendar date/,
    );
  });
});
