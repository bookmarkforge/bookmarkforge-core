import type en from "../../public/locales/en.json";

type NestedKeyOf<T, K = keyof T> = K extends string
  ? T[K] extends Record<string, unknown>
    ? `${K}.${NestedKeyOf<T[K]>}`
    : K
  : never;

declare module "i18next" {
  interface CustomTypeOptions {
    // The runtime default namespace is `app` (see src/i18n.ts): the internal
    // UI + AI assistant payload. The public `landing` namespace is loaded on
    // demand and stays untyped here on purpose — it must never leak into the
    // app's eager key surface.
    defaultNS: "app";
    resources: {
      app: typeof en & Record<string, string>;
    };
  }
}
