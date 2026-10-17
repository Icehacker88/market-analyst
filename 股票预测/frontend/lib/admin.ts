// UI hint only. Every admin API independently authorizes its verified session.
export function isAdminUser(user?: { is_admin?: boolean } | null): boolean {
  return user?.is_admin === true;
}
