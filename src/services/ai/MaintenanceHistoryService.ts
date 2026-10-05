import { safeGet, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { securityVault } from "../SecurityVault";

const STORAGE_KEY = STORAGE_KEYS.INTELLIGENT_MAINTENANCE_HISTORY;
const MAX_ENTRIES = 25;
const MAX_OPERATIONS = 10;

type MaintenanceStatus = "completed" | "partial" | "failed" | "skipped";

export interface MaintenanceHistoryEntry {
  id: string;
  completedAt: string;
  status: MaintenanceStatus;
  repaired: number;
  failed: number;
  skipped: number;
  operations: string[];
}

let scope = createScope();

function createScope(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function rotateScope(): void {
  scope = createScope();
}

function read(): MaintenanceHistoryEntry[] {
  const raw = safeGet(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function isValidEntry(entry: unknown): entry is MaintenanceHistoryEntry {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  return typeof value.id === "string" && value.id.length <= 100 &&
    typeof value.completedAt === "string" &&
    (value.status === "completed" || value.status === "partial" || value.status === "failed" || value.status === "skipped") &&
    Number.isSafeInteger(value.repaired) && Number(value.repaired) >= 0 &&
    Number.isSafeInteger(value.failed) && Number(value.failed) >= 0 &&
    Number.isSafeInteger(value.skipped) && Number(value.skipped) >= 0 &&
    Array.isArray(value.operations) &&
    value.operations.length <= MAX_OPERATIONS &&
    value.operations.every((operation) => typeof operation === "string" && operation.length <= 64);
}

export const maintenanceHistoryService = {
  list(): MaintenanceHistoryEntry[] {
    return read();
  },
  add(entry: Omit<MaintenanceHistoryEntry, "id">): MaintenanceHistoryEntry {
    const complete: MaintenanceHistoryEntry = {
      ...entry,
      id: `${scope}:${createScope()}`,
      operations: entry.operations.slice(0, MAX_OPERATIONS),
    };
    safeSet(STORAGE_KEY, JSON.stringify([complete, ...read()].slice(0, MAX_ENTRIES)));
    return complete;
  },
  clear(): void {
    safeSet(STORAGE_KEY, "[]");
  },
};

securityVault.onLock(rotateScope);
securityVault.onUnlock(rotateScope);
