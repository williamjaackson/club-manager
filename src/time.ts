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
