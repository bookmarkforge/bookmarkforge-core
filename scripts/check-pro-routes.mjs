#!/usr/bin/env node
/**
 * scripts/check-pro-routes.mjs — fail the build when the HTTP surface and its
 * declared route table disagree.
 *
 * Route accounting used to be knowledge carried in someone's head: the HTTP
 * router was a chain of `req.url === "..."` comparisons, and whether a route
 * verified a license proof was invisible in a diff. `server/src/route-table.ts`
 * now declares every route, and `createRouteDispatcher()` builds the single
 * HTTP entry point from it. This gate closes the loop by comparing that
 * declaration against the router that actually runs:
 *
 *   1. COVERAGE     every `req.url` the router dispatches is declared in the
 *                   route table (a new route cannot be mounted unclassified),
 *                   and every declared route is dispatched (no dead policy
 *                   that makes the table look complete while it is not);
 *   2. CAPABILITY   a route under a paid namespace (`PAID_PATH_PREFIXES` in the
 *                   route table; empty today) is a violation, because this
 *                   server no longer has an enforcement point to gate it —
 *                   re-adding the first paid route has to re-add enforcement
 *                   rather than ship unguarded;
 *   3. WIRING       the dispatch function must have exactly one caller — the
 *                   route dispatcher — so no route can bypass the table.
 *
 *   4. EXPOSURE     every declared route is proxied by nginx or listed in
 *                   UNPROXIED_ROUTE_ALLOWLIST with a reason; a stale entry fails.
 *
 * The entitlement guard and its proof/session modes were retired on 2026-10-19
 * with the license/entitlement server surface; there is no `access` field and
 * no guard plan left to agree with.
 *
 * FAIL CLOSED: if the router source, the dispatch function or the route table
 * cannot be read, or the scan finds no routes at all, the gate exits non-zero.
 * A gate that passes because it found nothing is worse than no gate.
 *
 * Usage:
 *   tsx scripts/check-pro-routes.mjs              # the whole check (npm run check:pro-routes)
 *   tsx scripts/check-pro-routes.mjs --json       # machine-readable violations
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// process.cwd() rather than import.meta.url: vitest rewrites module URLs to a
// non-file scheme, and this module is imported by its own unit test. Both the
// CLI and the test run from the repo root.
const ROOT = process.cwd();
const TAG = "[check-pro-routes]";
const SERVER_INDEX = join("server", "src", "index.ts");
const ROUTE_TABLE = join("server", "src", "route-table.ts");
/** The nginx config nginx-render.mjs generates and the web image serves. */
const NGINX_CONF = join("public", "nginx.conf");
/** The compose service name nginx proxies to (see docker-compose.prod.yml). */
const COMPANION_HOST = "bookmarkforge_api";
/**
 * `/_ws_` is an internal rewrite that carries the WebSocket upgrade, not an
 * HTTP route: the route table classifies request/response paths only.
 */
export const NON_HTTP_PROXY_PATHS = new Set(["/_ws_"]);

/**
 * Companion `proxy_pass` locations in the generated nginx config, with the
 * path the companion receives. Nginx resolves a `proxy_pass` without a URI to
 * the location path, and one WITH a URI to that URI (an exact location with a
 * different URI is a rewrite, not a pass-through).
 */
export function extractCompanionProxies(source) {
  const lines = String(source).split(/\r?\n/);
  const proxies = [];
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(
      /^\s*location\s+(?:(=|\^~|~\*|~)\s*)?(\S+)\s*\{/,
    );
    if (!header) continue;
    const modifier = header[1] ?? "";
    const locationPath = header[2];
    let depth = 1;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      depth += opens - closes;
      if (depth === 0) break;
      body.push(line);
    }
    const proxy = body.join("\n").match(/^\s*proxy_pass\s+([^;]+);/m);
    if (!proxy) continue;
    const target = proxy[1].trim();
    let url;
    try {
      url = new URL(target);
    } catch {
      // Relative proxy_pass values are resolved by nginx, not to the
      // companion host; they are outside this gate's scope.
      continue;
    }
    if (url.hostname !== COMPANION_HOST) continue;
    const targetPath = url.pathname && url.pathname !== "/" ? url.pathname : "";
    proxies.push({
      modifier,
      locationPath,
      target,
      path: targetPath || locationPath,
      exactTargetMismatch:
        modifier === "=" && targetPath !== "" && targetPath !== locationPath,
    });
  }
  return proxies;
}

/**
 * Fail when nginx proxies a path the companion does not serve. This is the
 * A2 class: `/api/license/*` and `/api/affiliate/*` were proxied to a server
 * whose dispatcher answers 426 for every undeclared route, so the Pro panel
 * saw "Upgrade Required" instead of a clear 404. `vacuous-proxy-scan` keeps a
 * parser change from turning the gate green by finding nothing.
 */
export function evaluateProxyRoutes({
  proxies,
  matchPolicy,
  nonHttpPaths = NON_HTTP_PROXY_PATHS,
}) {
  const violations = [];
  if (!Array.isArray(proxies) || proxies.length === 0) {
    violations.push(
      violation(
        "vacuous-proxy-scan",
        NGINX_CONF,
        "no companion proxy_pass location found in public/nginx.conf — the scan or the nginx template changed shape, so this gate cannot certify the proxy topology",
      ),
    );
    return violations;
  }
  for (const proxy of proxies) {
    if (nonHttpPaths.has(proxy.path)) continue;
    if (proxy.exactTargetMismatch) {
      violations.push(
        violation(
          "proxy-target-mismatch",
          proxy.locationPath,
          `nginx location ${proxy.modifier} ${proxy.locationPath} proxies to ${proxy.target}, so the companion receives ${proxy.path} instead of the exact path the location declares`,
        ),
      );
    }
    if (!matchPolicy(proxy.path)) {
      violations.push(
        violation(
          "proxy-target-unclassified",
          proxy.locationPath,
          `nginx proxies ${proxy.path} to the companion, but no route policy matches it — the companion answers 426 and the endpoint is dead; remove the proxy or declare the route in server/src/route-table.ts`,
        ),
      );
    }
  }
  return violations;
}


/**
 * Routes the table declares but nginx deliberately does not expose. Every
 * entry needs a reason; the exposure check fails when a route is neither
 * proxied nor listed here, and when an entry is stale (the route disappeared
 * or nginx started proxying it).
 */
export const UNPROXIED_ROUTE_ALLOWLIST = new Map([
  [
    "/admin",
    "operator-only signaling diagnostics; keep the token-gated admin surface off the public web edge and reach the api origin directly",
  ],
]);

/**
 * Reverse of `evaluateProxyRoutes`: every declared route must be reachable
 * from the web edge or explicitly documented as intentionally unexposed.
 * This is what makes the exposure decision data instead of a comment.
 */
export function evaluateRouteExposure({
  policies,
  proxies,
  matchPolicy,
  allowlist = UNPROXIED_ROUTE_ALLOWLIST,
}) {
  const violations = [];
  if (!Array.isArray(policies) || policies.length === 0) {
    violations.push(
      violation(
        "vacuous-exposure-scan",
        "*",
        "the route table declares no policy — the exposure check cannot certify anything",
      ),
    );
    return violations;
  }
  const exposedPolicies = new Set();
  for (const proxy of proxies) {
    const policy = matchPolicy(proxy.path);
    if (policy) exposedPolicies.add(policy.path);
  }
  for (const policy of policies) {
    const exposed = exposedPolicies.has(policy.path);
    const allowlisted = allowlist.has(policy.path);
    if (exposed && allowlisted) {
      violations.push(
        violation(
          "stale-unexposed-allowlist",
          policy.path,
          "listed as intentionally unexposed, but nginx proxies it — remove the allowlist entry or the proxy",
        ),
      );
    } else if (!exposed && !allowlisted) {
      violations.push(
        violation(
          "route-not-proxied",
          policy.path,
          "declared in the route table but no nginx location proxies it — expose it or add it to UNPROXIED_ROUTE_ALLOWLIST with a reason",
        ),
      );
    }
  }
  for (const [path, reason] of allowlist) {
    if (!policies.some((policy) => policy.path === path)) {
      violations.push(
        violation(
          "stale-unexposed-allowlist",
          path,
          "allowlisted as intentionally unexposed, but no route policy declares it — remove the entry",
        ),
      );
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      violations.push(
        violation(
          "empty-unexposed-reason",
          path,
          "an intentionally unexposed route must carry the reason it is not on the web edge",
        ),
      );
    }
  }
  return violations;
}

/**
 * The HTTP dispatch. Exported by name so the wiring rule and the router cannot
 * drift apart silently: renaming it in `index.ts` fails this gate until the
 * gate is updated in the same change.
 */
export const DISPATCH_FN = "dispatchHttpRequest";
/** The only function allowed to call `DISPATCH_FN`. */
export const ROUTE_DISPATCHER = "createRouteDispatcher";

/**
 * `req.url === "/x"`, `req.url?.startsWith("/x?")` and query-stripped path
 * comparisons like `httpPath === "/x"` — i.e. every comparison shape the
 * router uses to own a path. The identifier is generic on purpose: the OG
 * routes dispatch on `httpPath` (query stripped) so `/og?utm=…` still cards;
 * literals that do not start with "/" (e.g. `req.method === "GET"`) are
 * filtered out by the caller.
 */
const ROUTE_IDENT_RE = String.raw`(?:req\.url|[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)`;
const ROUTE_LITERAL_RE = new RegExp(
  String.raw`${ROUTE_IDENT_RE}\s*===\s*"((?:[^"\\\n]|\\.)*)"` +
    String.raw`|${ROUTE_IDENT_RE}\s*\??\.startsWith\(\s*"((?:[^"\\\n]|\\.)*)"`,
  "g",
);

/**
 * Route path literals the router dispatches, in source order, deduplicated.
 * Scoped to the dispatch function body when its markers are present so literals
 * inside unrelated helpers (health, CSP) are not mistaken for routes.
 */
export function extractDispatchedRoutePaths(source) {
  const startMarker = `const ${DISPATCH_FN}`;
  const endMarker = `${ROUTE_DISPATCHER}(`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const scoped =
    start !== -1 && end !== -1 && end > start ? source.slice(start, end) : source;

  const paths = [];
  ROUTE_LITERAL_RE.lastIndex = 0;
  let match;
  while ((match = ROUTE_LITERAL_RE.exec(scoped)) !== null) {
    const literal = match[1] ?? match[2];
    if (literal?.startsWith("/") && !paths.includes(literal)) paths.push(literal);
  }
  return paths;
}

/** Violation: `{ rule, route, detail }`, printable and machine-readable. */
function violation(rule, route, detail) {
  return { rule, route, detail };
}

/**
 * The check itself, with the route table injected so it is unit-testable
 * against fixtures. `matchPolicy` must be the REAL `matchRoutePolicy` from
 * `server/src/route-table.ts`: the gate asserts the code that runs, not a
 * second copy of its rules.
 */
export function evaluateRoutePolicies({
  policies,
  paidPrefixes,
  dispatchedPaths,
  matchPolicy,
}) {
  const violations = [];

  if (!Array.isArray(dispatchedPaths) || dispatchedPaths.length === 0) {
    violations.push(
      violation(
        "vacuous-scan",
        "*",
        `no \`req.url\` route literals found in ${SERVER_INDEX} — the scan or the router changed shape, so this gate cannot certify anything`,
      ),
    );
  }

  // 1a. Every dispatched route is classified; 1b. every class is dispatched.
  for (const path of dispatchedPaths) {
    if (!matchPolicy(path)) {
      violations.push(
        violation(
          "unclassified-route",
          path,
          "the router dispatches this path but the route table does not declare it — add a policy to server/src/route-table.ts",
        ),
      );
    }
  }
  for (const policy of policies) {
    const declared = dispatchedPaths.some(
      (path) => matchPolicy(path)?.path === policy.path,
    );
    if (!declared) {
      violations.push(
        violation(
          "dead-policy",
          policy.path,
          "declared in the route table but never dispatched by server/src/index.ts — a policy that matches nothing certifies nothing",
        ),
      );
    }
    if (!Array.isArray(policy.methods) || policy.methods.length === 0) {
      violations.push(
        violation(
          "empty-methods",
          policy.path,
          "the policy declares no HTTP method, so nothing documents what this route answers",
        ),
      );
    }
  }

  // 2. A paid namespace has no enforcement point left: adding one back fails.
  for (const policy of policies) {
    if (paidPrefixes.some((prefix) => policy.path.startsWith(prefix))) {
      violations.push(
        violation(
          "paid-route-without-enforcement",
          policy.path,
          `under a paid namespace (${paidPrefixes.join(", ")}) but this server has no entitlement guard — re-add an enforcement point before mounting a paid route`,
        ),
      );
    }
  }

  return violations;
}

/**
 * The HTTP dispatch must have exactly one caller. Two occurrences are the
 * declaration and the `dispatch:` wiring; anything more means a route (or a
 * helper) can reach the handler chain without passing through the dispatcher.
 */
export function checkDispatcherWiring(source) {
  const violations = [];
  const declarations = source.split(DISPATCH_FN).length - 1;
  if (declarations !== 2) {
    violations.push(
      violation(
        "dispatch-fanout",
        DISPATCH_FN,
        `expected exactly 2 references (the declaration and the dispatcher wiring), found ${declarations} — every extra reference can serve a route without passing through the route table`,
      ),
    );
  }
  if (!source.includes(`dispatch: ${DISPATCH_FN}`)) {
    violations.push(
      violation(
        "dispatch-unwired",
        DISPATCH_FN,
        `the route dispatcher is not wired to it (\`dispatch: ${DISPATCH_FN}\` not found in ${SERVER_INDEX})`,
      ),
    );
  }
  if (!source.includes(`${ROUTE_DISPATCHER}({`)) {
    violations.push(
      violation(
        "dispatch-missing",
        ROUTE_DISPATCHER,
        `the router no longer builds its dispatcher from the route table (${ROUTE_DISPATCHER}({ not found)`,
      ),
    );
  }
  return violations;
}

export function formatViolations(violations) {
  return violations
    .map((entry) => `- ${entry.rule} ${entry.route}: ${entry.detail}`)
    .join("\n");
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const json = process.argv.includes("--json");
  const indexPath = resolve(ROOT, SERVER_INDEX);
  if (!existsSync(indexPath)) {
    // The public export carries no companion backend at all (the exporter
    // excludes server/ and its guard fails if it ever appears), so there is
    // no route surface to police here. The private tree must always have it:
    // a missing backend there is a broken checkout, not an export.
    if (!existsSync(resolve(ROOT, "server"))) {
      console.log(
        `${TAG} ok — no companion backend in this tree (public export); route-table checks run in the private repository`,
      );
      process.exit(0);
    }
    console.error(`${TAG} FAIL — ${SERVER_INDEX} does not exist`);
    process.exit(2);
  }

  // Imported through tsx (this script runs as `tsx scripts/check-pro-routes.mjs`)
  // so the gate reads the SAME declarations the server executes.
  let table;
  try {
    // @vite-ignore keeps vitest from statically resolving a specifier that
    // does not exist in the public export (server/ is excluded there); the
    // isMain branch never runs in tests, and node/tsx resolve it at runtime.
    table = await import(/* @vite-ignore */ "../server/src/route-table.ts");
  } catch (error) {
    console.error(`${TAG} FAIL — could not load ${ROUTE_TABLE}: ${String(error)}`);
    process.exit(2);
  }

  const source = readFileSync(indexPath, "utf8");
  const nginxPath = resolve(ROOT, NGINX_CONF);
  if (!existsSync(nginxPath)) {
    console.error(`${TAG} FAIL — ${NGINX_CONF} does not exist`);
    process.exit(2);
  }
  const proxies = extractCompanionProxies(readFileSync(nginxPath, "utf8"));
  const dispatchedPaths = extractDispatchedRoutePaths(source);
  const violations = [
    ...evaluateProxyRoutes({
      proxies,
      matchPolicy: (path) => table.matchRoutePolicy(path),
    }),
    ...evaluateRouteExposure({
      policies: table.ROUTE_POLICIES,
      proxies,
      matchPolicy: (path) => table.matchRoutePolicy(path),
    }),
    ...evaluateRoutePolicies({
      policies: table.ROUTE_POLICIES,
      paidPrefixes: table.PAID_PATH_PREFIXES,
      dispatchedPaths,
      matchPolicy: (path) => table.matchRoutePolicy(path),
    }),
    ...checkDispatcherWiring(source),
  ];

  if (json) {
    console.log(JSON.stringify({ violations, dispatchedPaths, proxies }, null, 2));
  } else if (violations.length > 0) {
    console.error(`${TAG} FAIL — ${violations.length} violation(s)`);
    console.error(formatViolations(violations));
  } else {
    const paidPrefixes = [...table.PAID_PATH_PREFIXES];
    console.log(
      `${TAG} ${table.ROUTE_POLICIES.length} routes classified, ${dispatchedPaths.length} dispatched, ` +
        `${paidPrefixes.length} paid path prefix(es) declared, ${proxies.length} companion proxies checked, ${UNPROXIED_ROUTE_ALLOWLIST.size} intentionally unexposed`,
    );
  }

  process.exit(violations.length > 0 ? 1 : 0);
}
