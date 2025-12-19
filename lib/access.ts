// /lib/access.ts
export type Role = "seller" | "manager" | "owner";

export const ACCESS: Record<string, Array<Role>> = {
  "/admin/stats": ["manager", "owner"],
  "/settings/payroll": ["owner"],
  "/settings": ["owner"], // сама страница настроек
};

export function canAccess(role: Role, path: string): boolean {
  const key = Object.keys(ACCESS).find(k => path.startsWith(k));
  if (!key) return true; // если путь не в карте — доступен всем
  return ACCESS[key].includes(role);
}
