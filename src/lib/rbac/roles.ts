export type UserRole = 'admin' | 'manager' | 'technician';

export const userRoles: UserRole[] = ['admin', 'manager', 'technician'];

export function isKnownRole(role: unknown): role is UserRole {
  return role === 'admin' || role === 'manager' || role === 'technician';
}
