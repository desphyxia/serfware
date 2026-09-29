/** Simulation time. The simulation advances in fixed ticks; everything else derives from them. */

export const TICKS_PER_SECOND = 10;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Real seconds per in-game hour at 1x speed. A 24-hour day lasts 12 minutes. */
export const SECONDS_PER_GAME_HOUR = 30;

export interface DayInfo {
  day: number; // 1-based
  hour: number; // 0..23
  minute: number; // 0..59
  fraction: number; // 0..1 through the day, 0 = midnight
}

export function ticksPerDay(dayLengthHours: number): number {
  return Math.round(dayLengthHours * SECONDS_PER_GAME_HOUR * TICKS_PER_SECOND);
}

/** Start each world at 06:30 on day 1 so the first view is a sunrise. */
export const START_FRACTION = 6.5 / 24;

export function dayInfo(tick: number, dayLengthHours: number): DayInfo {
  const perDay = ticksPerDay(dayLengthHours);
  const startOffset = Math.round(START_FRACTION * perDay);
  const t = tick + startOffset;
  const day = Math.floor(t / perDay) + 1;
  const within = t - (day - 1) * perDay;
  const fraction = within / perDay;
  const hoursFloat = fraction * dayLengthHours;
  const hour = Math.floor(hoursFloat);
  const minute = Math.floor((hoursFloat - hour) * 60);
  return { day, hour, minute, fraction };
}

export function formatDay(info: DayInfo): string {
  const hh = String(info.hour).padStart(2, "0");
  const mm = String(info.minute).padStart(2, "0");
  return `Day ${info.day} ${hh}:${mm}`;
}
