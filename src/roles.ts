import type { AuthUser } from './types';

/** `true` when `user` holds `role`, as its primary role or among its RBAC roles. */
export function hasRole(user: AuthUser | null, role: string | readonly string[]): boolean {
  if (!user) return false;
  const wanted = typeof role === 'string' ? [role] : role;
  return wanted.some((r) => user.role === r || (Array.isArray(user.roles) && user.roles.includes(r)));
}
