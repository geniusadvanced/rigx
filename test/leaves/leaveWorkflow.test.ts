import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanCancelLeave,
  assertCanReviewLeave,
  assertNoOverlappingActiveLeave,
  assertValidLeaveDateRange,
  leaveRangesOverlap,
} from '../../src/features/leaves/utils/leaveWorkflow';

describe('leave workflow rules', () => {
  it('allows valid date ranges', () => {
    assert.doesNotThrow(() => assertValidLeaveDateRange('2026-04-01', '2026-04-03'));
  });

  it('blocks invalid date ranges', () => {
    assert.throws(() => assertValidLeaveDateRange('2026-04-03', '2026-04-01'), /cannot be before/);
  });

  it('allows pending leave cancellation', () => {
    assert.doesNotThrow(() => assertCanCancelLeave('pending'));
  });

  it('blocks cancellation after decision', () => {
    assert.throws(() => assertCanCancelLeave('approved'), /Only pending leave/);
    assert.throws(() => assertCanCancelLeave('rejected'), /Only pending leave/);
    assert.throws(() => assertCanCancelLeave('cancelled'), /Only pending leave/);
  });

  it('allows manager review only while pending', () => {
    assert.doesNotThrow(() => assertCanReviewLeave('pending'));
    assert.throws(() => assertCanReviewLeave('approved'), /Only pending leave/);
    assert.throws(() => assertCanReviewLeave('cancelled'), /Only pending leave/);
  });

  it('detects overlapping leave ranges', () => {
    assert.equal(leaveRangesOverlap('2026-04-02', '2026-04-04', '2026-04-04', '2026-04-05'), true);
    assert.equal(leaveRangesOverlap('2026-04-02', '2026-04-04', '2026-04-05', '2026-04-06'), false);
  });

  it('blocks overlapping pending or approved leave', () => {
    assert.throws(
      () =>
        assertNoOverlappingActiveLeave(
          [{ startDate: '2026-04-02', endDate: '2026-04-04', status: 'approved' }],
          '2026-04-03',
          '2026-04-05',
        ),
      /overlaps/,
    );
    assert.doesNotThrow(() =>
      assertNoOverlappingActiveLeave(
        [{ startDate: '2026-04-02', endDate: '2026-04-04', status: 'cancelled' }],
        '2026-04-03',
        '2026-04-05',
      ),
    );
  });
});
