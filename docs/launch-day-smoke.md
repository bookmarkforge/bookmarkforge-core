# Runbook de lanzamiento — Smoke de rutas críticas (BookmarkForge)

> **Qué es:** batería Playwright que ejercita las tres rutas que NO pueden fallar
> el día de lanzamiento: creación de bóveda con contraseña de 12 caracteres,
> recuperación con la frase de 24 palabras, y activación de licencia Pro
> (incluida la comprobación de clave inválida, que debe fallar cerrado).
> Se ejecuta contra la build de producción (`vite preview`), no contra el dev server.

- **Autor:** script de uso único `node scripts/run-launch-smoke.mjs` (no llames a Playwright directamente: el runner limpia puertos huérfanos y verifica prerequisitos).
- **Spec:** `tests/e2e/launch-smoke-critical-paths.spec.ts` (7 tests, ~2 min).
- **Perfil:** `playwright.launch-smoke.config.ts` — 3 servidores orquestados con `webServer` en forma de array (spread) para que **reemplace** el `webServer` de la config base en vez de concatenarse con él.

## Comando

```bash
npm run smoke:launch          # modo producción (build + vite preview) — usar este el día del lanzamiento
npm run smoke:launch:dev      # modo dev (rápido, para iterar)
```

## Qué hace el runner

1. Verifica prerequisitos (Playwright instalado).
2. **Libera los puertos del perfil** (4173 preview, 5173 dev, 8790 mock, 8787 companion) matando listeners huérfanos de ejecuciones anteriores — sin esto, `reuseExistingServer` puede reciclar un servidor viejo con un proxy roto.
3. Ejecuta los 7 tests y traduce el resultado a un veredicto de lanzamiento claro.

## Topología (modo producción)

| Proceso | Puerto | Papel |
|---|---|---|
| `vite preview` | 4173 | sirve `dist/` (build de producción) y proxifica `/api` |
| companion server (señalización + licencias) | 8787 | atiende `/api/license/*` con firma RSA-PSS real |
| `scripts/license-mock.mjs` | 8790 | proveedor Whop simulado (activación + revocación) |

La build se genera con `VITE_E2E_PREVIEW_DIAGNOSTICS=true` para exponer el diagnóstico de backend que usan los tests. `vite.config.ts` proxifica `/api` → `VITE_API_PROXY_TARGET` (8787 en este perfil; el 8799 de `crisis-containment` es un servidor companion efímero de ese spec, no el global).

## Los 7 tests y qué garantizan

1. **Contraseña de 12 caracteres crea bóveda funcional** — la puerta mínima real (11 se rechaza en el test 2 antes de crear nada).
2. **11 caracteres rechazado en la UI** — fail-closed del validador.
3. **Recuperación con las 24 palabras exactas mostradas en setup** — captura la frase de la pantalla de setup y desbloquea con ella.
4. **23 palabras rechazadas** — no hay desbloqueo parcial.
5. **Licencia válida activa vía el servicio de firma real** — cliente ↔ companion ↔ proveedor ↔ firma; el estado firmado pasa la verificación del cliente (exige que la clave privada local coincida con `src/services/licenseKeys.ts`; si no, ejecuta `node scripts/generate-license-keys.mjs --write`).
6. **Clave inválida falla cerrado con error visible.**
7. **Round-trip de backup cifrado .bmf** — exporta vía `BackupService` (el mismo código que llama la UI), destruye IndexedDB (pérdida total), recrea la bóveda con la misma contraseña y restaura desde el asistente F0-2 usando la contraseña del vault (los datos de seguridad del vault no viajan en el backup).

## Triage de fallos

- **Fallo transitorio `browser has been closed`:** flake de infraestructura — re-ejecuta aislado antes de investigar (`npx playwright test --config=playwright.launch-smoke.config.ts -g "nombre del test"`).
- **`ECONNREFUSED 8787` o 502 en licencia:** proceso huérfano o mock muerto — re-ejecuta el runner (paso 2 del runner evita la mayoría); en última instancia cierra procesos node a mano y reintenta.
- **`Signed license state failed verification`:** desincronización de claves — `node scripts/generate-license-keys.mjs --write` (regenera par privado + claves públicas commitadas como conjunto coherente) y reintenta.
- **Export nunca descarga:** el stub de `showSaveFilePicker` debe registrarse con `addInitScript` **antes** del `goto` inicial (los init scripts solo aplican a navegaciones futuras).
- **Fila no aparece tras restaurar:** la bóveda abre en Dashboard — navega explícitamente a Bookmarks antes de asertar.
- **Timeout en recuperación tras un rechazo previo:** `RecoveryService` limita a un intento cada 2 s (`MIN_INTERVAL_MS = 2000`) — deja que el helper espere la ventana.

## Segundo y tercer motor de navegador (firefox + webkit)

Las mismas rutas críticas corren en los otros dos motores con:

```bash
npx playwright install firefox webkit   # una vez
npm run e2e:engines                     # ambos motores (o -- --project=webkit)
```

Perfil: `playwright.engines.config.ts` (misma topología que esta batería, puertos propios). Los tests de licencia se saltan con marcador si no hay clave de firma (p. ej. CI). En CI: job `e2e-engines`. Nota ARM64 Windows: el WebKit de Playwright corre emulado — puede ser lento u OOM si hay procesos huérfanos; el CI en Linux x64 es la referencia.

## Relación con el checklist de lanzamiento

Item 16 de [docs/launch-checklist.md](launch-checklist.md). Todo en verde aquí es una condición previa para marcar la release; un solo rojo = no lanzar.
