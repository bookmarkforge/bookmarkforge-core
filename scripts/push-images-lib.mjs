#!/usr/bin/env node
/**
 * scripts/push-images-lib.mjs — Lógica del push de imágenes por SHA a un
 * registro Docker, extraída para poder probarse contra un registro local.
 *
 * Motivo: deploy-prod.mjs --push-images hace retag + push de
 * `bookmarkforge/{web,api}:<sha>` al registro remoto. Esa lógica vivía
 * embebida en su Fase G. Aquí la extraemos a un módulo reutilizable: la MISMA
 * función que corre en producción puede ejercitarse en CI contra un
 * `registry:2` desechable (scripts/test-push-images.mjs) sin depender del
 * pipeline completo de deploy (gates, build, tag git).
 *
 * El módulo es paramétrico: recibe `runOrThrow` (un wrapper de spawn/execSync
 * que honra --dry-run devolviendo 0 sin ejecutar) y `log`/`fail`, de modo que
 * deploy-prod.mjs la inyecta con sus helpers reales y el test inyecta los
 * suyos. Así el comportamiento es idéntico donde sea que se ejecute.
 */

import { spawnSync } from "node:child_process";
import { validateRegistry } from "./registry-policy.mjs";

/**
 * Valida y normaliza el registro destino para --push-images.
 * Fail-closed: solo retorna un registro no vacío y con sintaxis de host/port.
 *
 *   valid                        → { ok:true, registry }
 *   vacío/null (sin dry-run)     → { ok:false, reason:"missing" }
 *   vacío/null (dry-run)         → { ok:true, registry:"registry.example.com" }
 *                                   (simulado: no hay push real en dry-run)
 *   formato inválido             → { ok:false, reason:"invalid" }
 *
 * Regex de host/port: primer char alfanumérico, luego [A-Za-z0-9._:/-]*.
 */
export function resolveRegistry(rawRegistry, { push: _push, dryRun }) {
  void _push; // la flag `push` se documenta en el contrato; aquí solo importa dryRun

  const registry = (typeof rawRegistry === "string" ? rawRegistry : "")
    .trim()
    .replace(/\/+$/, "");
  if (!registry) {
    if (dryRun) {
      return { ok: true, registry: "registry.example.com", simulated: true };
    }
    return { ok: false, reason: "missing" };
  }
  if (!validateRegistry(registry)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, registry };
}

/**
 * Genera el plan de retag + push para web y api de un sha dado.
 * Devuelve [{ name, local, remote }]. Asume `registry` ya normalizado.
 */
export function planPushTargets(sha, registry) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) return [];
  if (!registry) return [];
  return ["web", "api"].map((name) => ({
    name,
    local: `bookmarkforge/${name}:${sha}`,
    remote: `${registry}/bookmarkforge/${name}:${sha}`,
  }));
}

/**
 * Ejecuta el retag + push de las imágenes por SHA al registro, y VERIFICA
 * que la imagen sea visible en el registro antes de declarar éxito.
 *
 * `run` es `(cmd, opts?) => exitCode` y debe honrar --dry-run (0 sin ejecutar).
 * `runVisible` es `(remote, opts?) => boolean` y hace `docker buildx
 * imagetools inspect <remote>` (defaultInspectVisible) para confirmar que el
 * push se propagó y es consultable en el registro.
 *
 * Devuelve { ok, pushed: [remotes…] } en éxito; en fallo devuelve
 * { ok:false, step:"tag"|"push"|"not-visible", remote } (no lanza).
 */
export function pushImages({
  sha,
  registry,
  images = ["web", "api"],
  run,
  runVisible = defaultInspectVisible,
}) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha) || !validateRegistry(registry)) {
    return { ok: false, step: "config", remote: `<configuración inválida>` };
  }
  const pushed = [];
  for (const name of images) {
    const local = `bookmarkforge/${name}:${sha}`;
    const remote = `${registry}/bookmarkforge/${name}:${sha}`;
    if (run(["docker", "tag", local, remote]) !== 0) {
      return { ok: false, step: "tag", remote };
    }
    if (run(["docker", "push", remote], { timeout: 300_000 }) !== 0) {
      return { ok: false, step: "push", remote };
    }
    // Confirmar visibilidad real: el push puede reportar éxito pero la imagen
    // no estar aún consultable (quiesce de registry, credenciales, proxy
    // caching). Sin esto, el tag NO debe imprimirse como desplegable.
    if (!runVisible(remote)) {
      return { ok: false, step: "not-visible", remote };
    }
    pushed.push(remote);
  }
  return { ok: true, pushed };
}

/**
 * Verdadero si la imagen remota es consultable en el registro vía buildx
 * imagetools inspect. Es inyectable para tests (que pasan un mock) y para
 * hosts sin buildx. NO honra dry-run: la verificación de visibilidad es real
 * aunque el resto del push estuviera simulado.
 */
export function defaultInspectVisible(remoteRef) {
  if (typeof remoteRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*\/bookmarkforge\/(?:web|api):[0-9a-f]{7,12}$/i.test(remoteRef)) return false;
  const result = spawnSync("docker", ["buildx", "imagetools", "inspect", remoteRef], {
    stdio: "ignore",
    timeout: 60_000,
  });
  return result.status === 0;
}
