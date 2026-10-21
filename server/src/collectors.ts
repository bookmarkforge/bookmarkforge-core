/**
 * server/src/collectors.ts — composition for the public HTTP collectors.
 *
 * The client-events, product-analytics and Open Graph handlers are already
 * modules; this factory is the single place the entry composes them, so the
 * wiring (and the shared server instance id) lives in one reviewable spot
 * instead of being spread through `index.ts`.
 */
import { createAnalyticsHandler } from "./business-analytics";
import { createClientEventsHandler } from "./client-events";
import { createOgHandler } from "./og-handler";

export interface HttpCollectorOptions {
  serverInstanceId: string;
}

export interface HttpCollectors {
  clientEventsHandler: ReturnType<typeof createClientEventsHandler>;
  analyticsHandler: ReturnType<typeof createAnalyticsHandler>;
  ogHandler: ReturnType<typeof createOgHandler>;
}

export function createHttpCollectors(options: HttpCollectorOptions): HttpCollectors {
  return {
    clientEventsHandler: createClientEventsHandler({
      serverInstanceId: options.serverInstanceId,
    }),
    analyticsHandler: createAnalyticsHandler({
      serverInstanceId: options.serverInstanceId,
    }),
    ogHandler: createOgHandler(),
  };
}
