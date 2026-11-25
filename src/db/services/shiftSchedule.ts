import { ProductionEventEntity } from '../types';

export interface ShiftDefinition {
  label: string;
  windowLabel: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  startTotalMinutes: number;
  endTotalMinutes: number;
  isOvernight: boolean;
}

export interface ShiftHourlySlot {
  key: string;
  hourLabel: string;
  startMs: number;
  endMs: number;
}

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLocalClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Parses configured shift strings such as:
 * - "Shift A (07:00 - 15:30)"
 * - "Shift B (15:30 - 23:00)"
 * - "Shift C (23:00 - 07:00)"
 */
export function parseShiftDefinition(activeShift: string): ShiftDefinition {
  const match = activeShift.match(/^(.*?)\(\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*\)/);
  if (!match) {
    return {
      label: activeShift.trim() || 'Shift A',
      windowLabel: '07:00 - 15:30',
      startHour: 7,
      startMinute: 0,
      endHour: 15,
      endMinute: 30,
      startTotalMinutes: 7 * 60,
      endTotalMinutes: 15 * 60 + 30,
      isOvernight: false,
    };
  }

  const label = match[1].trim() || 'Active Shift';
  const startHour = Number(match[2]);
  const startMinute = Number(match[3]);
  const endHour = Number(match[4]);
  const endMinute = Number(match[5]);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + endMinute;
  const isOvernight = endTotalMinutes <= startTotalMinutes;

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    label,
    windowLabel: `${pad(startHour)}:${pad(startMinute)} - ${pad(endHour)}:${pad(endMinute)}`,
    startHour,
    startMinute,
    endHour,
    endMinute,
    startTotalMinutes,
    endTotalMinutes,
    isOvernight,
  };
}

/**
 * Returns local calendar shift-start date (YYYY-MM-DD) for a given Date.
 * For overnight shifts (e.g. 23:00 - 07:00), timestamps after midnight and before shift end
 * belong to the shift that started on the previous calendar day.
 */
export function getShiftReportingDateForInstant(date: Date, shift: ShiftDefinition): string {
  if (!shift.isOvernight) {
    return formatLocalDate(date);
  }
  const mins = date.getHours() * 60 + date.getMinutes();
  if (mins < shift.endTotalMinutes) {
    const prevDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return formatLocalDate(prevDay);
  }
  return formatLocalDate(date);
}

/**
 * Checks whether an instant falls inside the configured shift time-of-day window:
 * [startTotalMinutes, endTotalMinutes) for daytime shifts, or
 * >= startTotalMinutes || < endTotalMinutes for overnight shifts.
 */
export function isInstantWithinShiftWindow(date: Date, shift: ShiftDefinition): boolean {
  const mins = date.getHours() * 60 + date.getMinutes();
  if (!shift.isOvernight) {
    return mins >= shift.startTotalMinutes && mins < shift.endTotalMinutes;
  }
  return mins >= shift.startTotalMinutes || mins < shift.endTotalMinutes;
}

/**
 * Computes exact local [shiftStart, shiftEnd) Date bounds for a reportingDate (YYYY-MM-DD).
 */
export function getShiftBounds(
  reportingDate: string,
  shift: ShiftDefinition
): { start: Date; end: Date } {
  const [yStr, mStr, dStr] = reportingDate.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  const day = Number(dStr);

  const start = new Date(year, monthIndex, day, shift.startHour, shift.startMinute, 0, 0);
  const end = shift.isOvernight
    ? new Date(year, monthIndex, day + 1, shift.endHour, shift.endMinute, 0, 0)
    : new Date(year, monthIndex, day, shift.endHour, shift.endMinute, 0, 0);

  return { start, end };
}

/**
 * Resolves the single reporting calendar date (YYYY-MM-DD) to display on the Dashboard:
 * - Never mixes multiple calendar dates.
 * - Excludes non-simulated future timestamps (> now).
 * - Prefers the latest reporting date that has events inside the configured shift;
 *   otherwise falls back to the latest operational event date (so switching shifts keeps the same day),
 *   or today's local date when no events exist.
 */
export function resolveShiftReportingDate(
  events: ProductionEventEntity[],
  shift: ShiftDefinition,
  now: Date,
  explicitReportingDate?: string
): string {
  if (explicitReportingDate) {
    return explicitReportingDate;
  }

  let latestShiftDate: string | null = null;
  let latestAnyEventDate: string | null = null;
  const nowMs = now.getTime();

  for (const ev of events) {
    const dt = new Date(ev.timestamp);
    if (Number.isNaN(dt.getTime())) continue;
    if (!ev.isSimulated && dt.getTime() > nowMs) continue;

    const localDate = formatLocalDate(dt);
    if (!latestAnyEventDate || localDate > latestAnyEventDate) {
      latestAnyEventDate = localDate;
    }

    if (isInstantWithinShiftWindow(dt, shift)) {
      const shiftDate = getShiftReportingDateForInstant(dt, shift);
      if (!latestShiftDate || shiftDate > latestShiftDate) {
        latestShiftDate = shiftDate;
      }
    }
  }

  return latestShiftDate || latestAnyEventDate || formatLocalDate(now);
}

/**
 * Builds chronological hourly intervals belonging exclusively to the configured shift
 * and reporting date. Excludes future hours (> now) unless viewing a strictly simulated
 * historical/demo date whose date exceeds the workstation clock.
 */
export function buildShiftHourlySlots(
  reportingDate: string,
  shift: ShiftDefinition,
  now: Date,
  allowSimulatedDateCutoffBypass: boolean
): ShiftHourlySlot[] {
  const { start, end } = getShiftBounds(reportingDate, shift);
  const slots: ShiftHourlySlot[] = [];
  const nowMs = now.getTime();

  let cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    start.getHours(),
    0,
    0,
    0
  );

  const pad = (n: number) => String(n).padStart(2, '0');

  // Safety guard: max 24 slots per shift
  for (let i = 0; i < 24 && cursor.getTime() < end.getTime(); i++) {
    const nextHour = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate(),
      cursor.getHours() + 1,
      0,
      0,
      0
    );

    const effectiveStartMs = Math.max(cursor.getTime(), start.getTime());
    const effectiveEndMs = Math.min(nextHour.getTime(), end.getTime());

    if (effectiveStartMs < effectiveEndMs) {
      if (!allowSimulatedDateCutoffBypass && effectiveStartMs > nowMs) {
        break;
      }

      const effDate = new Date(effectiveStartMs);
      const hourLabel = `${pad(effDate.getHours())}:${pad(effDate.getMinutes())}`;
      const key = `${formatLocalDate(effDate)}T${hourLabel}`;

      slots.push({
        key,
        hourLabel,
        startMs: effectiveStartMs,
        endMs: effectiveEndMs,
      });
    }

    cursor = nextHour;
  }

  return slots;
}

export interface ScopedShiftEventsResult {
  shift: ShiftDefinition;
  reportingDate: string;
  slots: ShiftHourlySlot[];
  shiftEvents: ProductionEventEntity[];
}

/**
 * Filters persisted HOURLY_OUTPUT events strictly to the configured shift window
 * and single reporting date, excluding future hours/events.
 */
export function filterEventsForShiftAndDate(
  allHourlyEvents: ProductionEventEntity[],
  activeShift: string,
  options?: { reportingDate?: string; now?: Date }
): ScopedShiftEventsResult {
  const now = options?.now ?? new Date();
  const shift = parseShiftDefinition(activeShift);
  const reportingDate = resolveShiftReportingDate(
    allHourlyEvents,
    shift,
    now,
    options?.reportingDate
  );

  const { start, end } = getShiftBounds(reportingDate, shift);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const nowMs = now.getTime();
  const todayLocal = formatLocalDate(now);

  // Events strictly inside [shiftStart, shiftEnd) for reportingDate
  const inBoundsEvents = allHourlyEvents.filter((ev) => {
    const t = new Date(ev.timestamp).getTime();
    if (Number.isNaN(t)) return false;
    return t >= startMs && t < endMs;
  });

  // Never bypass future cutoff for today's date or for real (non-simulated) data.
  // Only allow completed simulated demo dates if the workstation clock happens to be earlier.
  const isStrictlyFutureDate = reportingDate > todayLocal;
  const allowSimulatedDateCutoffBypass =
    isStrictlyFutureDate &&
    inBoundsEvents.length > 0 &&
    inBoundsEvents.every((ev) => ev.isSimulated);

  const slots = buildShiftHourlySlots(
    reportingDate,
    shift,
    now,
    allowSimulatedDateCutoffBypass
  );

  const maxSlotEndMs =
    slots.length > 0 ? slots[slots.length - 1].endMs : startMs;

  const shiftEvents = inBoundsEvents.filter((ev) => {
    const t = new Date(ev.timestamp).getTime();
    if (t >= maxSlotEndMs) return false;
    if (!allowSimulatedDateCutoffBypass && t > nowMs) return false;
    return true;
  });

  return {
    shift,
    reportingDate,
    slots,
    shiftEvents,
  };
}
