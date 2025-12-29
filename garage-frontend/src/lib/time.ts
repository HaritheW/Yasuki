export const IST_TIMEZONE = "Asia/Colombo";

export type DateInput = string | Date | null | undefined;

/**
 * SQLite CURRENT_TIMESTAMP is usually stored as a naive string like "YYYY-MM-DD HH:MM:SS" (UTC).
 * JS `new Date("YYYY-MM-DD HH:MM:SS")` interprets it as *local time* (wrong).
 *
 * This parser treats naive timestamps as UTC by appending "Z".
 */
export function parseSqliteUtcTimestamp(value: DateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) return null;

  // Already ISO-ish with timezone info
  if (/[zZ]$/.test(text) || /[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = text.replace(" ", "T");

  // Date-only "YYYY-MM-DD" -> treat as UTC midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Naive "YYYY-MM-DDTHH:MM:SS" -> treat as UTC
  const parsed = new Date(`${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatISTDate(value: DateInput): string {
  const parsed = parseSqliteUtcTimestamp(value);
  if (!parsed) return value ? String(value) : "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(parsed);
}

export function formatISTDateTime(value: DateInput): string {
  const parsed = parseSqliteUtcTimestamp(value);
  if (!parsed) return value ? String(value) : "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}


