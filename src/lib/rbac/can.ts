import { rolePermissions, type Permission } from './permissions';
import { isKnownRole, type UserRole } from './roles';

export function can(role: UserRole | string | null | undefined, permission: Permission): boolean {
  if (!isKnownRole(role)) return false;
  return rolePermissions[role].includes(permission);
}

export function canAny(role: UserRole | string | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function canAll(role: UserRole | string | null | undefined, permissions: Permission[]): boolean {
  return permissions.every((permission) => can(role, permission));
}

export function isAdmin(role: UserRole | string | null | undefined): boolean {
  return role === 'admin';
}

export function isManager(role: UserRole | string | null | undefined): boolean {
  return role === 'manager';
}

export function isTechnician(role: UserRole | string | null | undefined): boolean {
  return role === 'technician';
}

export function isAdminOrManager(role: UserRole | string | null | undefined): boolean {
  return isAdmin(role) || isManager(role);
}

export function assertCan(role: UserRole | string | null | undefined, permission: Permission): void {
  if (!isKnownRole(role)) {
    throw new Error('RBAC: role required');
  }

  if (!can(role, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
