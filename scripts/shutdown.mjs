/**
 * scripts/shutdown.mjs — Shared clean-exit helper for scripts that use fetch.
 *
 * `process.exit()` while undici (fetch) has keep-alive sockets open triggers
 * a native libuv abort on Windows (exit 0xC0000409 / 3221226505).  The fix:
 * close the undici dispatcher cleanly, set process.exitCode, and let the event
 * loop drain naturally.  A failsafe timer forces exit after 5s if something
 * ref'd keeps the loop alive.
 *
 * Usage:
 *   import { shutdownExit } from "./shutdown.mjs";
 *   await shutdownExit(code);
 */
export async function shutdownExit(code) {
  process.exitCode = code;
  try {
    const { getGlobalDispatcher } = await import("undici");
    await Promise.race([
      getGlobalDispatcher().close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  } catch {
    // undici not importable — natural drain will close sockets via keep-alive
    // timeout; the failsafe below forces exit.
  }
  // Failsafe: if something ref'd keeps the loop alive (fs threadpool, timers),
  // force exit after a margin — sockets are already closed above.
  setTimeout(() => process.exit(process.exitCode ?? code), 5_000).unref();
}
