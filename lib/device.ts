'use client';

const KEY = 'device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''; // на всякий случай
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev-' + (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    localStorage.setItem(KEY, id);
  }
  return id;
}
