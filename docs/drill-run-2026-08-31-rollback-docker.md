# Registro de ejecución — Drill de rollback Docker (2026-08-31)

> Evidencia de la ejecución local del drill de rollback en modo Docker
> (`DRILL_DOCKER=1`) contra los tags `prod-*` existentes en el repo.

## Resultado

| | |
|---|---|
| **Resultado global** | ❌ **FAIL** — falló en fase PREP |
| **Fecha / hora (UTC)** | 2026-08-31 10:19:04 |
| **Modo** | Docker (`docker-compose.staging.yml`), run desde worktree aislado en HEAD (`0a379ca`) |
| **Base URL** | `http://127.0.0.1:18080` |
| **Duración total** | 416.3 s |

## Fases

| Fase | Estado | Detalle | Tiempo |
|---|---|---|---|
| PREP | ❌ FAIL | `build de 572c910 falló (exit 1) — CAMINO A imposible` | 198.0 s |
| BASELINE | ❌ FAIL | `docker compose up falló (exit 1) — revisa el build` | 217.8 s |
| KILL | — | no ejecutada (BASELINE falló) | — |
| DETECT | — | no ejecutada | — |
| ROLLBACK | — | no ejecutada | — |
| RE-VERIFY | — | no ejecutada | — |

Salida JSON completa: `/tmp/drill-rollback-docker.json` (run aislada; no persiste).

## Causa raíz (hallazgo real de build)

La imagen del tag prod-* previo no se puede construir. El stage `deps` del
`Dockerfile` ejecuta `npm ci --omit=dev`, pero `package.json` declara el script
`prepare: "husky"` y `husky` es una **devDependency** (`^9.1.7`). Al hacer
`npm ci --omit=dev`, npm instala las deps de producción (sin husky) y luego
ejecuta `prepare` → `/bin/sh -c husky` → **command not found → exit 127**.

Reproducido de forma aislada:
```
> [deps 2/2] RUN npm ci --omit=dev && npm cache clean --force:
136.8 npm error code 127
136.8 npm error command failed
136.8 npm error command sh -c husky
```

Afecta tanto al tag previo (`572c910`) como a **HEAD** (`0a379ca`); ambos declaran
`"prepare": "husky"`. Esto significa que **el drill trimestral en CI fallaría
igualmente** en la primera run: no puede construir la imagen del tag previo para
el rollback por imagen (CAMINO A).

## Impacto y mitigación

- El drill de rollback Docker **queda bloqueado por el build** hasta que se corrija.
- Fix propuesto (no ejecutado):
  1. `Dockerfile` stage `deps`: cambiar `RUN npm ci --omit=dev && npm cache clean --force`
     por `RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force`
     (husky solo es necesario para hooks de git locales, no en la imagen).
     Alternativa: mover `husky` a un `prepare` condicionado (`husky || true`).
  2. Re-ejecutar el drill completo.
- Nota operativa: probar también en CI (workflow `drill-quarterly.yml`) una vez corregido.

## Estado del working tree tras la ejecución

- Run ejecutada desde un **worktree git aislado** en HEAD soldado (`0a379ca`),
  no en el working tree principal → ningún checkout del drill tocó los cambios
  locales sin commitear.
- Sin containers del drill vivos ni imágenes residuales de la build fallida.
- Worktree limpio y removido (`git worktree prune`).