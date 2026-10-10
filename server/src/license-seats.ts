export interface SeatBindingResult {
  metadata: Record<string, unknown>;
  bound: string[];
  added: boolean;
  atLimit: boolean;
}

export const DEFAULT_LICENSE_SEATS = 5;

export function boundLicenseDevices(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const devices = new Set<string>();
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      (key === "instance_name" || key.startsWith("bm:")) &&
      typeof value === "string" &&
      value.length > 0
    ) {
      devices.add(value);
    }
  }
  return [...devices];
}

export function bindLicenseDevice(
  metadata: Record<string, unknown> | undefined,
  deviceId: string,
  maxSeats = DEFAULT_LICENSE_SEATS,
): SeatBindingResult {
  const existing = { ...(metadata ?? {}) };
  const bound = boundLicenseDevices(existing);

  if (bound.includes(deviceId)) {
    return { metadata: existing, bound, added: false, atLimit: false };
  }

  if (bound.length >= maxSeats) {
    return { metadata: existing, bound, added: false, atLimit: true };
  }

  const desired = { ...existing };
  if (
    typeof desired.instance_name !== "string" ||
    desired.instance_name.length === 0
  ) {
    desired.instance_name = deviceId;
  } else {
    let slot = 1;
    while (Object.prototype.hasOwnProperty.call(desired, `bm:${slot}`)) {
      slot += 1;
    }
    desired[`bm:${slot}`] = deviceId;
  }

  return {
    metadata: desired,
    bound: [...bound, deviceId],
    added: true,
    atLimit: false,
  };
}

export function unbindLicenseDevice(
  metadata: Record<string, unknown> | undefined,
  deviceId: string,
): Record<string, unknown> {
  const desired = { ...(metadata ?? {}) };

  if (desired.instance_name === deviceId) {
    delete desired.instance_name;
    const replacementKey = Object.keys(desired)
      .filter(
        (key) =>
          key.startsWith("bm:") && typeof desired[key] === "string",
      )
      .sort()[0];

    if (replacementKey) {
      desired.instance_name = desired[replacementKey];
      delete desired[replacementKey];
    }
  } else {
    for (const [key, value] of Object.entries(desired)) {
      if (key.startsWith("bm:") && value === deviceId) {
        delete desired[key];
        break;
      }
    }
  }

  return desired;
}
