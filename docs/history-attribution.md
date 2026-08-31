# Atribución de contenido en el historial

> Registro de decisión (2026-08-31). Se decidió **no reescribir el historial** para separar
> contenido de la primera ronda de auditoría que quedó absorbido en los commits de la
> segunda ronda. Este documento registra la atribución real para no perder el contexto.

## Contexto

Durante la segunda ronda de la auditoría se commitearon los cambios con `git commit --only`
sobre archivos que **también había editado la sesión previa** (primera ronda). Como no se
separaron hunks, parte del contenido de la primera ronda quedó absorbido en los commits de
la segunda. La intersección de archivos con el baseline `00b24d6` quedó vacía.

El contenido existe y funciona y está verificado en verde; la mezcla es **atribucional**,
no funcional.

## Contenido previo (ronda 1) absorbido en commits de ronda 2

| Commit (ronda 2) | Archivo compartido | Contenido previo absorbido |
|---|---|---|
| `572c910` (pins SHA) | `sast.yml` | Archivo entero (94 líneas, creado por ronda 1) |
| | `staging-deploy.yml`, `staging-rollback.yml` | 68 + 102 líneas (archivos de staging creados por ronda 1) |
| | `ci.yml`, `dast-nightly.yml`, `staging-smoke.yml` | ~160 líneas previas vs ~26 de pins |
| | `validate-workflows.mjs`, `validate-gates.test.mjs` | ~86 líneas previas vs ~19 del gate |
| `9dd011b` (E2E) | `nightly.yml` | ~52 líneas previas vs ~6 (pins + load-test) |
| `62afb96` (analítica) | `.env.example`, `package.json`, `AnalyticsService.ts` | ~52 líneas previas vs ~23 |
| `a0f1525` (docs) | `audit.md`, `ROPA.md`, `launch-checklist.md` | ~450 líneas previas vs ~81 |

## Consecuencia

El baseline `00b24d6` (primera ronda, 312 archivos) quedó **incompleto**: le faltan ~500+
líneas de gates y documentación de la primera ronda, atribuidas hoy a los commits de la
segunda. A efectos funcionales no hay pérdida; a efectos de auditoría de historial, la
autoría del contenido previo debe entenderse como parte de la primera ronda.

## Motivo de la decisión

- Reescritura de historial destructiva que toca `00b24d6` (commiteado por otro proceso).
- Trabajo de rondas 3/4 sin commitear en el árbol en el momento de la decisión.
- El estado funcional es correcto; el coste de la cirugía superaba el beneficio atribucional.