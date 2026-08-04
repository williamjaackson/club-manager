// The club operates on Brisbane time. Queensland does not observe daylight
// saving, so the +10:00 offset is correct year-round.
const BRISBANE_UTC_OFFSET = "+10:00";
const BRISBANE_TIME_ZONE = "Australia/Brisbane";

export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseBrisbaneDateTime(value: string, optionName: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`${optionName} must use YYYY-MM-DD HH:mm Brisbane time.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error(`${optionName} is not a valid Brisbane date and time.`);
  }

  return Math.floor(
    Date.parse(
      `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${BRISBANE_UTC_OFFSET}`,
    ) / 1000,
  );
}

export function optionalBrisbaneDateTime(
  value: string,
  fieldName: string,
): number | undefined {
  return value.trim() ? parseBrisbaneDateTime(value, fieldName) : undefined;
}

export function formatScheduleText(startsAt: number, endsAt?: number): string {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: BRISBANE_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
  const start = formatter.format(new Date(startsAt * 1000));
  return endsAt === undefined
    ? `${start} (Brisbane)`
    : `${start} – ${formatter.format(new Date(endsAt * 1000))} (Brisbane)`;
}

export function isSameBrisbaneDay(a: number, b: number): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRISBANE_TIME_ZONE,
    dateStyle: "short",
  });
  return formatter.format(new Date(a * 1000)) === formatter.format(new Date(b * 1000));
}

// Formats an epoch back into the wizard's "YYYY-MM-DD HH:mm" input format.
export function formatBrisbaneDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRISBANE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BRISBANE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} ${time}`;
}

// Parses "30m", "12h", "2d" (single unit) into seconds.
export function parseDurationSeconds(value: string, fieldName: string): number {
  const match = /^(\d+)\s*(m|h|d)$/i.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`${fieldName} must look like 30m, 12h, or 2d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = amount * (unit === "m" ? 60 : unit === "h" ? 3600 : 86_400);
  if (seconds < 5 * 60 || seconds > 14 * 86_400) {
    throw new Error(`${fieldName} must be between 5 minutes and 14 days.`);
  }
  return seconds;
}
