import type { LeaveRequest, LeaveStatus } from '../types';

export function assertValidLeaveDateRange(startDate: string, endDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Leave dates must use YYYY-MM-DD format');
  }

  if (startDate > endDate) {
    throw new Error('Leave end date cannot be before start date');
  }
}

export function assertCanCancelLeave(status: LeaveStatus): void {
  if (status !== 'pending') {
    throw new Error('Only pending leave can be cancelled');
  }
}

export function assertCanReviewLeave(status: LeaveStatus): void {
  if (status !== 'pending') {
    throw new Error('Only pending leave can be approved or rejected');
  }
}

export function leaveRangesOverlap(
  firstStartDate: string,
  firstEndDate: string,
  secondStartDate: string,
  secondEndDate: string,
): boolean {
  return firstStartDate <= secondEndDate && secondStartDate <= firstEndDate;
}

export function assertNoOverlappingActiveLeave(
  existingLeaves: Pick<LeaveRequest, 'startDate' | 'endDate' | 'status'>[],
  startDate: string,
  endDate: string,
): void {
  const overlappingLeave = existingLeaves.find((leave) => {
    const isActive = leave.status === 'pending' || leave.status === 'approved';
    return isActive && leaveRangesOverlap(startDate, endDate, leave.startDate, leave.endDate);
  });

  if (overlappingLeave) {
    throw new Error('Leave request overlaps an existing pending or approved leave');
  }
}
