// /lib/access.ts
export type Role = "seller" | "manager" | "owner";

/**
 * Защита отключена: доступ разрешён всем ролям на все пути.
 * Оставляем тип Role, чтобы не ломать импорты в компонентах.
 */
export function canAccess(_role: Role, _path: string): boolean {
  return true;
}
