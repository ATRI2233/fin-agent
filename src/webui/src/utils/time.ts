/**
 * Beijing time (UTC+8) formatting utilities.
 *
 * Backend stores UTC timestamps; the UI always displays Beijing time
 * regardless of the browser's local timezone.
 */

const BEIJING_TZ = 'Asia/Shanghai';

/**
 * Format an ISO timestamp as Beijing time HH:mm:ss.
 *
 * @param iso - ISO 8601 string (e.g. "2026-06-12T05:54:23.273211").
 * @returns "HH:mm:ss" in Beijing time, or fallback if input is falsy.
 */
export function formatTime(iso: string | null | undefined, fallback = '--'): string {
  if (!iso) return fallback;
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      timeZone: BEIJING_TZ,
      hour12: false,
    });
  } catch {
    return fallback;
  }
}

/**
 * Format an ISO timestamp as Beijing date + time (MM-dd HH:mm).
 *
 * @param iso - ISO 8601 string.
 * @returns "MM-dd HH:mm" in Beijing time.
 */
export function formatDateTime(iso: string | null | undefined, fallback = '--'): string {
  if (!iso) return fallback;
  try {
    const d = new Date(iso);
    const parts = d.toLocaleDateString('zh-CN', {
      timeZone: BEIJING_TZ,
      month: '2-digit',
      day: '2-digit',
    });
    const time = d.toLocaleTimeString('zh-CN', {
      timeZone: BEIJING_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${parts} ${time}`;
  } catch {
    return fallback;
  }
}

/**
 * Format an ISO timestamp as full Beijing date + time (yyyy-MM-dd HH:mm:ss).
 */
export function formatFull(iso: string | null | undefined, fallback = '--'): string {
  if (!iso) return fallback;
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: BEIJING_TZ,
      hour12: false,
    });
  } catch {
    return fallback;
  }
}

/**
 * Get current Beijing time as HH:mm:ss.
 */
export function nowBeijing(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    timeZone: BEIJING_TZ,
    hour12: false,
  });
}

/**
 * Relative time from now (e.g. "3 分钟前").
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}
