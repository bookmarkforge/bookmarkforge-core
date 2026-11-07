import type { HydrationPriority } from "./types";

export const PRIORITY_DELAYS: Record<HydrationPriority, number> = {
  critical: 0,
  high: 100,
  medium: 500,
  low: 1000,
  idle: 2000,
};
