export function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`gw:${key}`) || 'null') ?? fallback; } catch { return fallback; }
}
export function write(key: string, value: unknown) {
  try { localStorage.setItem(`gw:${key}`, JSON.stringify(value)); if (key === 'sound') window.dispatchEvent(new Event('gw:settings')); } catch { return; }
}
