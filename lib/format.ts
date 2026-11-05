// 时间格式化工具
// generated_at 存储为带时区的 TIMESTAMPTZ（数据库容器时区 Asia/Tokyo）
// 展示时区由 DISPLAY_TZ 环境变量控制，默认 Asia/Shanghai

const DISPLAY_TZ = process.env.DISPLAY_TZ || "Asia/Shanghai";

/**
 * 将数据库返回的时间字符串格式化为指定时区的可读时间
 */
export function formatDateTime(
  isoString: string | null,
  tz: string = DISPLAY_TZ
): string {
  if (!isoString) return "未知";
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * 格式化日期（不含时间）
 */
export function formatDate(
  dateStr: string | null,
  tz: string = DISPLAY_TZ
): string {
  if (!dateStr) return "未知";
  try {
    // report_date 是纯日期 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return dateStr;
  }
}

/**
 * 获取当前日期（展示时区）
 */
export function todayStr(tz: string = DISPLAY_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
