# RIGX RBAC

RIGX currently uses three roles:

- `admin`
- `manager`
- `technician`

Permissions are centralized in `permissions.ts`. Use `can(role, permission)` for feature checks and `isAdmin`, `isManager`, `isTechnician`, or `isAdminOrManager` for simple role checks.

Example:

```ts
if (can(profile?.role, 'payroll.generate')) {
  // show payroll generation action
}
```

Firestore and Storage security rules remain the final authority. This frontend RBAC module is for consistent UI/service behavior and does not replace backend rules.

Current role map:

- `admin`: all permissions.
- `manager`: operational permissions, excluding destructive job delete, HR profile/salary management, and Admin KPI.
- `technician`: own/assigned workflow permissions for dashboard, jobs, attendance, leave, payroll, notices, chat, parts orders, and Genius Partners.

Known mismatches to review later:

- Technician customer/device access is described in product behavior, but Firestore rules currently restrict `customers` and `devices` reads to admin/manager.
- Warranty claim creation is intentionally admin/manager only in the current service/rules, so technicians do not receive `jobs.createWarrantyClaim`.
- Parts order technician access is assigned-job related; UI permission only means the route/action may render, not all records are readable.
- Audit log page currently allows admin/manager in UI and rules.
- Payroll close/reopen is admin-only in UI but there is no dedicated permission in the first RBAC permission list; use `isAdmin(role)` until a specific permission is added.
