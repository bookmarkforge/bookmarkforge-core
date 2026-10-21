/**
 * Open Core placeholder runtime support. Every Pro module in this repository is
 * replaced by a generated declaration file plus an inert module that imports this
 * helper, so the Core keeps resolving and running without the proprietary
 * implementation.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const warned = new Set();

function warnOnce(moduleName, property) {
  const key = moduleName + "." + property;
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[open-core] " + key + " is a Pro feature and is not included in this build.");
  }
  // A placeholder surface was actually reached: give the host application a
  // machine-readable signal so it can present an upgrade experience instead
  // of relying on the console line alone.
  if (typeof globalThis !== "undefined" && typeof globalThis.dispatchEvent === "function") {
    try {
      globalThis.dispatchEvent(
        new CustomEvent("open-core:pro-reached", { detail: { module: moduleName, property: property } })
      );
    } catch {
      // Non-DOM runtimes (workers, tests): the console line above is enough.
    }
  }
}

/** Inert value: callable, constructable and property-accessible to any depth. */
function inert(moduleName) {
  const target = function placeholder() {
    return undefined;
  };
  const proxy = new Proxy(target, {
    get(_target, property) {
      if (property === "then" || property === "toJSON") return undefined;
      // Detectability: the loader (pro-access) probes this exact key to
      // refuse handing a placeholder out as if it were the implementation.
      if (property === "__isProPlaceholder") return true;
      if (property === "toString" || property === "valueOf" || property === Symbol.toPrimitive) {
        return () => "[open-core] Pro feature not included";
      }
      if (property === "name") return "placeholder";
      if (typeof property === "string") warnOnce(moduleName, property);
      return proxy;
    },
    apply() {
      return undefined;
    },
    construct() {
      return proxy;
    },
    has() {
      return true;
    },
  });
  return proxy;
}

export function placeholderFor(moduleName) {
  return inert(moduleName);
}
