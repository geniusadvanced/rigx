import type { UserRole } from './roles';

export type Permission =
  | 'dashboard.view'
  | 'jobs.view.all'
  | 'jobs.view.assigned'
  | 'jobs.create'
  | 'jobs.update'
  | 'jobs.sendTrackingLink'
  | 'jobs.assign'
  | 'jobs.delete'
  | 'jobs.approve'
  | 'jobs.manageWarranty'
  | 'jobs.createWarrantyClaim'
  | 'attendance.clock'
  | 'attendance.view.own'
  | 'attendance.view.all'
  | 'attendance.override'
  | 'leaves.create'
  | 'leaves.view.own'
  | 'leaves.view.all'
  | 'leaves.approve'
  | 'payroll.view.own'
  | 'payroll.view.all'
  | 'payroll.generate'
  | 'payroll.approve'
  | 'payroll.markPaid'
  | 'hr.view'
  | 'hr.manage'
  | 'customers.view'
  | 'customers.manage'
  | 'devices.view'
  | 'devices.manage'
  | 'partsOrders.view'
  | 'partsOrders.manage'
  | 'partners.view'
  | 'partners.manage'
  | 'notices.view'
  | 'notices.manage'
  | 'chat.view'
  | 'schedules.view'
  | 'schedules.create'
  | 'schedules.updateOwn'
  | 'schedules.manage'
  | 'reports.view'
  | 'account.view'
  | 'pos.view'
  | 'pos.operate'
  | 'pos.manage'
  | 'adminKpi.view'
  | 'auditLogs.view';

export const allPermissions: Permission[] = [
  'dashboard.view',
  'jobs.view.all',
  'jobs.view.assigned',
  'jobs.create',
  'jobs.update',
  'jobs.sendTrackingLink',
  'jobs.assign',
  'jobs.delete',
  'jobs.approve',
  'jobs.manageWarranty',
  'jobs.createWarrantyClaim',
  'attendance.clock',
  'attendance.view.own',
  'attendance.view.all',
  'attendance.override',
  'leaves.create',
  'leaves.view.own',
  'leaves.view.all',
  'leaves.approve',
  'payroll.view.own',
  'payroll.view.all',
  'payroll.generate',
  'payroll.approve',
  'payroll.markPaid',
  'hr.view',
  'hr.manage',
  'customers.view',
  'customers.manage',
  'devices.view',
  'devices.manage',
  'partsOrders.view',
  'partsOrders.manage',
  'partners.view',
  'partners.manage',
  'notices.view',
  'notices.manage',
  'chat.view',
  'schedules.view',
  'schedules.create',
  'schedules.updateOwn',
  'schedules.manage',
  'reports.view',
  'account.view',
  'pos.view',
  'pos.operate',
  'pos.manage',
  'adminKpi.view',
  'auditLogs.view',
];

export const rolePermissions: Record<UserRole, Permission[]> = {
  admin: allPermissions,
  manager: allPermissions.filter((permission) => {
    return ![
      'jobs.delete',
      'hr.manage',
      'adminKpi.view',
    ].includes(permission);
  }),
  technician: [
    'dashboard.view',
    'jobs.view.assigned',
    'jobs.create',
    'jobs.sendTrackingLink',
    'attendance.clock',
    'attendance.view.own',
    'leaves.create',
    'leaves.view.own',
    'payroll.view.own',
    'pos.view',
    'notices.view',
    'chat.view',
    'schedules.view',
    'schedules.create',
    'schedules.updateOwn',
    'partsOrders.view',
    'partners.view',
  ],
};
