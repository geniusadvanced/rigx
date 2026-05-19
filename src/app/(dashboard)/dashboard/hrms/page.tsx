'use client';

import AttendanceReviewPage from '../attendance-review/page';
import HRStaffPage from '../hr/staff/page';
import PayrollPage from '../payroll/page';

export default function HRMSPage() {
  return (
    <div className="space-y-6">
      <AttendanceReviewPage />
      <HRStaffPage />
      <PayrollPage />
    </div>
  );
}
