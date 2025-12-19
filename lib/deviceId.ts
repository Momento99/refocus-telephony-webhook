// lib/deviceId.ts
// Стабильный device_id для браузера. Хранится в localStorage.
// Не используем куки, чтобы не конфликтовать с auth.

const LS_KEY = 'security.device_id.v1';

function randomId() {
  // простая, но достаточная для device_id
  return 'dev-' + crypto.randomUUID();
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'dev-server';
  try {
    const existing = localStorage.getItem(LS_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(LS_KEY, id);
    return id;
  } catch {
    // если localStorage недоступен
    return randomId();
  }
}
