/** Memory sampling and a leak heuristic for the crash reporter and debug dialog. */

export interface MemSample {
  /** Milliseconds since page load. */
  t: number;
  heapMB: number | null;
  geometries: number;
  textures: number;
  programs: number;
  objects: number;
}

export type MemMetric = Exclude<keyof MemSample, "t">;

export interface LeakWarning {
  metric: MemMetric;
  perMinute: number;
  r2: number;
  window: number;
}

export interface Trend {
  slopePerMin: number;
  r2: number;
}

/** Least-squares slope (per minute) and coefficient of determination. */
export function trend(times: readonly number[], values: readonly number[]): Trend {
  const n = Math.min(times.length, values.length);
  if (n < 3) return { slopePerMin: 0, r2: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += times[i] as number;
    sy += values[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (times[i] as number) - mx;
    const dy = (values[i] as number) - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { slopePerMin: 0, r2: 0 };
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slopePerMin: slope * 60000, r2 };
}

/** Growth per minute above which a steady trend is reported as a probable leak. */
export const LEAK_THRESHOLDS: Record<MemMetric, number> = {
  heapMB: 3,
  geometries: 2,
  textures: 1,
  programs: 1,
  objects: 20,
};

export class MemoryMonitor {
  readonly samples: MemSample[] = [];
  private readonly lastWarned = new Map<MemMetric, number>();

  constructor(
    private readonly capacity = 360,
    private readonly window = 24,
  ) {}

  add(s: MemSample): LeakWarning[] {
    this.samples.push(s);
    if (this.samples.length > this.capacity) this.samples.shift();
    return this.analyze(s.t);
  }

  /** Returns metrics that grew steadily over the last `window` samples. Each metric warns at most every 5 minutes. */
  analyze(now: number): LeakWarning[] {
    if (this.samples.length < this.window) return [];
    const recent = this.samples.slice(-this.window);
    const times = recent.map((s) => s.t);
    const out: LeakWarning[] = [];
    for (const metric of Object.keys(LEAK_THRESHOLDS) as MemMetric[]) {
      const values = recent.map((s) => s[metric]);
      if (values.some((v) => v === null)) continue;
      const nums = values as number[];
      const { slopePerMin, r2 } = trend(times, nums);
      const grew = (nums[nums.length - 1] as number) - (nums[0] as number);
      if (slopePerMin >= LEAK_THRESHOLDS[metric] && r2 >= 0.85 && grew > 0) {
        const last = this.lastWarned.get(metric);
        if (last === undefined || now - last > 5 * 60000) {
          this.lastWarned.set(metric, now);
          out.push({ metric, perMinute: slopePerMin, r2, window: this.window });
        }
      }
    }
    return out;
  }
}

export function describeLeak(w: LeakWarning): string {
  const unit = w.metric === "heapMB" ? " MB" : "";
  return `Possible leak: ${w.metric} growing ${w.perMinute.toFixed(1)}${unit}/min (r² ${w.r2.toFixed(2)}, last ${w.window} samples)`;
}
