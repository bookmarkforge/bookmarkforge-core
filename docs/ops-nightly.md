# Operación del nightly — BookmarkForge

> Workflow: `.github/workflows/nightly.yml` · Cron: `17 2 * * *` UTC diario (+ `17 3 1 * *` para el drill mensual y `23 2 * * 1` —lunes— para el informe semanal de CVEs de dependencias) · Badge en `README.md` (sección "Estado del proyecto").
>
> Auditoría / anclas: `ADR-019` (budget WoW), `P92`/`H5` (política de webhooks HTTPS y secrets) — ver `docs/audit.md`.

## 1. Suites y jobs

| Job | Suite | Shards | Timeout | Presupuesto (repo var) |
|---|---|---|---|---|
| `human-like-sharded` | 15 spec files / 290 tests (`src/tests/human-like/examples`) | 4 | 60 min | `NIGHTLY_HUMAN_LIKE_MAX_MINUTES` |
| `multiuser-sharded` | 51 spec files / ~158 tests (`tests/e2e`, workers=1) | 2 | 45 min | `NIGHTLY_MULTIUSER_MAX_MINUTES` |
| `performance` | `tests/e2e/perf-scale.nightly.spec.ts` | 1 ("single") | 45 min | `NIGHTLY_PERF_SCALE_MAX_MINUTES` |

Jobs de apoyo: `coverage`, `multiuser-report` / `human-like-report` (merge de blobs), `nightly-trends` (CSV de tendencias WoW), `nightly-consistency` (informe alerta-vs-tendencia), `dependency-cve-report` (informe semanal de CVEs del árbol declarado, ver §6), `launch-readiness`, `load-test`, `kpi-staging`, `drill-backup-restore` (mensual) y `webhook-smoke` (manual).

Jobs **no diarios**: `dependency-cve-report` (lunes) y `drill-backup-restore` (día 1) llevan un guard `if` sobre su propia entrada de `schedule`, más `workflow_dispatch` para dispararlos a mano — el resto corre cada noche.

**Nota de dimensionado:** N de shards se sube cambiando `matrix.shard` + `matrix.total` (el merge de blobs es shard-agnóstico). Regla del repo: subir `E2E_TIMEOUT_MULTIPLIER`, nunca borrar waits.

## 2. Alerta de duración — `scripts/nightly-alert.mjs`

Cada suite tiene su **familia de variables** `NIGHTLY_<LABEL>_*`, seleccionada por `NIGHTLY_ALERT_JOB_LABEL` (LABEL = `HUMAN_LIKE` | `MULTIUSER` | `PERF_SCALE`). Tres disparadores:

1. **Fallo del job** — `NIGHTLY_<LABEL>_STATUS` = `failure`/`cancelled` (desde `${{ job.status }}`)
2. **Sobre-presupuesto** — `NIGHTLY_<LABEL>_MINUTES` > `NIGHTLY_<LABEL>_MAX_MINUTES`
3. **Regresión WoW** — duración ≥ `DEGRADE_RATIO` × mediana de semanas previas (por defecto `1.25` = +25 %)

Propiedades de la alerta:

- **La regresión WoW es informativa** (exit 0, nunca falla el job). El fallo y la sobre-duración disparan el payload `nightly_<label>_alert`.
- **Pendiente semanal en el payload**: toda alerta lleva `deltaPctWoW` — % del run actual vs la mediana de la **semana anterior adyacente** (mismo estadístico de 1 decimal que la columna `deltaPctWoW` del resumen de tendencias, incluido el rollover ISO 52/53→1). En Slack aparece como línea `slope ±X% vs prev. week`, de modo que la pendiente semanal de la suite se ve incluso cuando el baseline multi-semana está plano.
- **Webhook HTTPS-only** (`resolveWebhook`): `http://` se rechaza fail-closed. Slack Incoming Webhooks reciben el shape `{text, blocks}`; cualquier otro HTTPS recibe el payload JSON estructurado.
- **Best-effort**: un webhook muerto o timeout de 5 s se loguea (`nightly_webhook_failed`), nunca rompe el nightly.
- **Historia**: cada ejecución anexa `{week, year, minutes, recordedAt}` (ISO-8601) al JSONL de su suite en `.nightly-history/`, persistido en el Actions cache (claves `nightly-<label>-history-v1-…`). El baseline usa **mediana de semanas previas** (≥2 muestras), nunca la semana actual.
- **Log de alertas**: cada alerta disparada se anexa a `.nightly-history/alerts/<suite>-shard-<N>.jsonl` (`NIGHTLY_<LABEL>_ALERT_LOG_FILE`) con `{event, suite, shard, week, year, status, degraded, deltaPct, deltaPctWoW, delivered, recordedAt}` — es la fuente del informe de consistencia alerta-vs-tendencia.
- **Smoke-test**: `webhook-smoke` (workflow_dispatch, inputs `test_alert` + `smoke_suite`) envía una alerta sintética etiquetada con la suite elegida; a diferencia del nightly, **falla en voz alta** si el webhook no responde.

### CLI

```bash
node scripts/nightly-alert.mjs            # evalúa con env del job
node scripts/nightly-alert.mjs --dry-run  # imprime la decisión sin postear
node scripts/nightly-alert.mjs --test     # alerta sintética (smoke)
```

## 3. Repo vars y secrets (GitHub → Settings → Secrets and variables → Actions)

| Config | Tipo | Uso |
|---|---|---|
| `NIGHTLY_ALERT_WEBHOOK_URL` | **Secret** | Webhook HTTPS de alerta (Slack o genérico). Sin él no se envía nada. |
| `CODECOV_TOKEN` | **Secret** | Subida de `coverage/lcov.info` a Codecov (badge de cobertura del README). Sin él el step se salta y el badge queda vacío. |
| `NIGHTLY_HUMAN_LIKE_MAX_MINUTES` | Var | Presupuesto por shard human-like (p. ej. `60`). Vacío/0 = solo fallos. |
| `NIGHTLY_MULTIUSER_MAX_MINUTES` | Var | Presupuesto por shard multiuser (p. ej. `30`). |
| `NIGHTLY_PERF_SCALE_MAX_MINUTES` | Var | Presupuesto del job performance (p. ej. `45`). |
| `NIGHTLY_HUMAN_LIKE_DEGRADE_RATIO` | Var | Umbral WoW de la suite human-like (multiplicador vs mediana previa; default `1.25` = +25 %). El workflow lo lee como `${{ vars.NIGHTLY_HUMAN_LIKE_DEGRADE_RATIO || '1.25' }}` — sin la var usa el default. |
| `NIGHTLY_MULTIUSER_DEGRADE_RATIO` | Var | Ídem para multiuser (default `1.25`). |
| `NIGHTLY_PERF_SCALE_DEGRADE_RATIO` | Var | Ídem para performance (default `1.25`). |
| `STAGING_URL`, `STAGING_ANALYTICS_ADMIN_TOKEN` | Var/Secret | Job `kpi-staging`. |
| `KPI_MIN_*` | Var | Umbrales de negocio (`kpi-staging`). |
| `DRILL_RTO_MS`, `DRILL_RTO_WARN_MS`, `DRILL_ALERT_WEBHOOK_URL` | Var/Var/Secret | Drill DR mensual. |
| `E2E_TIMEOUT_MULTIPLIER` | Var | Multiplicador de timeouts E2E en runners lentos. |
| `TRENDS_MIN_CONSECUTIVE_DEGRADED` | Var | Semanas consecutivas de degradación WoW que ponen rojo `nightly-trends` (default `3`; `0` desactiva el gate). **Por suite**: `TRENDS_MIN_CONSECUTIVE_DEGRADED_HUMAN_LIKE` / `_MULTIUSER` / `_PERF_SCALE` (suite en snake-case mayúscula) sobreescriben el global solo para esa suite — cada suite puede tener su propio N (p. ej. human-like 2, perf-scale 4); sin la var por suite, cae al valor global. `0` desactiva el gate solo para esa suite. El alert Slack muestra el umbral por suite en la línea `budget` del bloque. |
| `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` | Var | Semanas consecutivas de phantom-alert en la misma suite que ponen rojo `nightly-consistency` (default `2`; `0` desactiva el gate). Phantoms repetidos indican un posible bug en el criterio de degradación. |
| `CONSISTENCY_SVG_PUBLIC_URL` | Var | URL https pública/firmada del SVG de consistencia para incrustarlo como imagen en el job summary de `nightly-consistency` (GitHub sanitiza data URIs — misma limitación que `TRENDS_SVG_PUBLIC_URL`). Vacío = solo tablas, nada sale del repo. |
| `TRENDS_SVG_BUCKET` | Var | Bucket S3 **privado** para el embed del SVG de tendencias sin publicar el artifact. Con la var puesta, `nightly-trends` corre en **dos fases**: la primera (`TRENDS_DEFER_SUMMARY=1`) escribe CSVs/SVG pero omite el summary; el paso `Sign SVG URL` sube el SVG al bucket con `--acl private` y genera una **URL presigned** (`TRENDS_SVG_PRESIGN_EXPIRES`, default `3600` s); la segunda (`TRENDS_SUMMARY_ONLY=1`) reescribe el job summary y `nightly-trends-summary.md` incrustando esa URL — sin re-ejecutar el gate ni los alerts, y siempre con exit 0. El paso de sign es best-effort (`continue-on-error`): una mala configuración del bucket no pone el job rojo, solo deja el summary sin embed. Se requieren los secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` con mínimo `s3:PutObject` + `s3:GetObject`. Vacío = flujo de un solo paso (el embed usa `TRENDS_SVG_PUBLIC_URL` si está puesta). |
| `TRENDS_SVG_PRESIGN_EXPIRES` | Var | TTL en segundos de la URL presigned del SVG de tendencias (default `3600` = 1 h; el embed caduca y deja de renderizar pasada esa ventana, sin afectar al artifact). |
| `CONSISTENCY_SVG_BUCKET` | Var | Bucket S3 **privado** para el embed del SVG de barras de consistencia, mismo patrón de dos fases que `TRENDS_SVG_BUCKET` (fase 1 `CONSISTENCY_DEFER_SUMMARY=1` omite el summary; el paso `Sign SVG URL` sube `nightly-consistency.svg` con `--acl private` y presigna; fase 2 `CONSISTENCY_SUMMARY_ONLY=1` reescribe el summary con la URL, exit 0 siempre). Best-effort (`continue-on-error`). Mismos secrets AWS que el de tendencias. Vacío = un solo paso (usa `CONSISTENCY_SVG_PUBLIC_URL` si está puesta). |
| `CONSISTENCY_SVG_PRESIGN_EXPIRES` | Var | TTL en segundos de la URL presigned del SVG de consistencia (default `3600`). |

Los valores de runtime (webhooks, tokens) **nunca** van en `VITE_*` ni en el repo — solo secrets. `vars.*` y `secrets.*` se referencian en `nightly.yml`; `.env.example` documenta el resto.

## 4. Artefactos

| Artifact | Contenido | Retención |
|---|---|---|
| `nightly-coverage` | `coverage/` + `coverage-history.json` | 14 d |
| codecov badge | `coverage/lcov.info` subido a Codecov si `CODECOV_TOKEN` existe | — (externo, badge en README) |
| `human-like-blob-<N>` / `multiuser-blob-<N>` | Blob reports por shard (entrada del merge) | 7 d |
| `human-like-raw-blobs` / `multiuser-raw-blobs` | Copia consolidada de los blobs crudos (evidencia de triaje si el merge falla de verdad) | 14 d |
| `nightly-human-like-report` / `nightly-multiuser-report` | HTML unificado tras `merge-reports` | 14 d |
| `<suite>-merge-status` | JSON de decisión del merge (skipped/merged, found/expected) | 14 d |
| `nightly-trends` | `nightly-trends.csv` (muestras por shard) + `nightly-trends-summary.csv` (mediana semanal por suite, min/max/count, `deltaPctWoW` — % vs la mediana de la semana anterior, solo semanas adyacentes —, `degradedWoW` = `DEGRADED` cuando la semana supera el criterio del alert, ≥ 1.25× la mediana previa, y `streak` — longitud de la racha actual de semanas DEGRADED consecutivas por suite; 0 si no degradada, se resetea con un hueco; la tendencia es visible **antes** de que el gate falle) + `nightly-trends.svg` (gráfico de líneas SVG autocontenido de la mediana semanal por suite, con los puntos DEGRADED coloreados en una **rampa de racha** — tonalidad creciente desde rojo claro (streak 1) hasta rojo oscuro (`#b91c1c`) al alcanzar el umbral del gate por suite, de modo que las rachas más cercanas a poner el job en rojo son las más oscuras; la leyenda muestra la rampa `streak 1 … streak N → gate` — y las **rachas sostenidas** — las que disparan el fail-loud gate — resaltadas con banda roja, puntos con anillo y etiqueta `sustained ×N`; además, una **línea punteada de referencia del umbral de degradación** por suite — `1.25×` la mediana de la semana anterior adyacente, el mismo `DEGRADE_RATIO` del criterio —, de modo que el cruce de la serie sólida por encima de su umbral punteado se ve directamente en el gráfico, con swatch de leyenda "threshold (1.25× prev. week)"; la escala Y se ajusta para no recortar la línea de umbral; **leyenda compacta bajo el eje X** — una sola fila reúne los tres estilos de punto con sus radios exactos (normal = color de suite, DEGRADED = rampa de racha, racha sostenida = anillo oscuro) **y la rampa completa** como un swatch de gradiente continuo `streak 1 → N → gate` (de `#fca5a5` claro a `#b91c1c` oscuro, con N = umbral del gate por suite), de modo que el gráfico se lee sin acudir al CSV; y **título accesible en cada punto** — `<title>` con suite, semana, mediana, `deltaPctWoW` y `streak` —, para inspección estática (tooltip en navegadores, tree en visores SVG, lectores de pantalla) sin abrir el CSV) + `nightly-trends-summary.md` (copia del mismo resumen del job summary como artifact, para adjuntarlo a un issue o guardarlo fuera de Actions; incluye los enlaces al run cuando corre en CI). **El job puede ponerse rojo**: si una suite tiene ≥ `TRENDS_MIN_CONSECUTIVE_DEGRADED` (default 3) semanas **consecutivas** marcadas DEGRADED, `nightly-trends.mjs` escribe los CSVs, postea `nightly_trends_sustained` al webhook (best-effort, con la pendiente `deltaPctWoW` de la última semana de la racha) y sale con exit 1 (tendencia sostenida = señal real). El envío del alert está **aislado en su propio try/catch**: incluso si el sender lanza (webhook caído en firme), el exit code del gate no cambia y los CSVs ya escritos antes quedan intactos — el fallo se loguea como `nightly_trends_alert_send_failed` y el job sigue rojo por la degradación, no por la entrega. El payload del alert incluye además los **findings de consistencia** de las semanas afectadas (missed/phantom, el mismo `classifyConsistency` que usa el informe `nightly-consistency` — leído del mismo alert log del cache, así que Slack y el CSV nunca pueden discrepar): en Slack aparecen como sección "Alert-vs-trend consistency" con un bloque por finding (🟡 missed / 🔴 phantom). **Early warning (best-effort)**: cuando el gate NO dispara pero una suite tiene la racha en **N−1** (una semana menos que su umbral), el job envía `nightly_trends_early_warning` la noche anterior (en Slack: bloque por suite con `streak N−1 of N` y la pendiente) — un día de margen antes del fallo; el exit code queda en 0 (el run sigue verde) y el envío está aislado en try/catch como el del gate. Con el gate ya disparado no hay early warning (no queda margen). En Slack el alert lleva además un **botón interactivo "Open run summary"** (actions block) que abre el job summary del run y sus artifacts con un clic — la URL se construye con los env `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` que Actions inyecta, así que el enlace apunta al run exacto que disparó el alert. Un hueco en la historia rompe la racha. Además publica un **job summary** de GitHub (tabla de semanas DEGRADED con la columna **`streak`** — la racha actual de cada suite, la misma del CSV, para ver sin descargar artifacts cuántas semanas consecutivas lleva cada suite y a qué distancia está del gate — + semanas con pendiente negativa como mejoras + rachas sostenidas + enlaces al run y a sus artifacts, construidos con los env `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID`) vía `GITHUB_STEP_SUMMARY` — visible sin descargar artifacts, incluso cuando el job queda rojo. **Embed del SVG**: GitHub sanitiza las imágenes inline (data URIs) en los job summaries, así que el gráfico solo se incrusta cuando hay una URL https alcanzable. Dos caminos: (1) la repo var `TRENDS_SVG_PUBLIC_URL` apunta a una URL firmada/privada; o (2) **automático en CI** — con `TRENDS_SVG_BUCKET` puesto, el nightly sube el SVG a un bucket S3 **privado** y genera una URL **presigned** que inyecta como `TRENDS_SVG_PUBLIC_URL` (dos fases: `TRENDS_DEFER_SUMMARY=1` omite el summary en el primer paso, el paso `Sign SVG URL` presigna, y `TRENDS_SUMMARY_ONLY=1` reescribe el summary con la URL — el artifact nunca se publica, solo la URL firmada de vida corta). Con la URL presente, el summary gana `### Trend chart` con `![Nightly WoW trends chart](<url>)`; sin var y sin bucket (default), el summary queda solo con enlaces — **nada sale del repo por defecto**, coherente con el modelo local-first. | 90 d |
| `nightly-consistency` | `nightly-consistency.csv` + `.json` + `nightly-consistency.svg` — informe alerta-vs-tendencia: por suite+semana, `kind` = `consistent` / `missed-alert` (suite DEGRADED sin alert WoW de ningún shard — puede ser artefacto de agregación por mediana) / `phantom-alert` (alert WoW de shard sin corroboración a nivel suite), y la columna `undeliveredAlerts` (alerts de esa suite+semana cuyo webhook falló — `delivered=false`, webhook caído). El **SVG** es un gráfico de barras autocontenido (860×480, sin dependencias): una barra por suite+semana coloreada por **`severity`** (rojo oscuro `#b91c1c` = high — missed-alert con `streak >= 2`, lo más grave; ámbar = medium — missed de racha 1 o phantom-alert; verde = low — consistent; gris = NO-ROW), con altura proporcional al número de alerts de la semana, stub translúcido para semanas sin alerts, etiquetas de suite+semana en el eje X, leyenda superior y — bajo el eje X — una **leyenda de marcadores** que explica los cuatro estilos de barra con sus colores exactos (`high (missed-alert, streak ≥ 2)`, `medium (streak-1 miss / phantom)`, `low (consistent)`, `NO-ROW`) — los findings más graves (rojo oscuro) saltan a la vista junto a la mayoría verde. **Cada barra se divide en dos segmentos apilados**: abajo, el segmento `delivered` en el color de la `severity`; arriba, el segmento `undelivered` (webhook caído) con un patrón de rayado diagonal autocontenido (`<pattern>` SVG, sin dependencias) — una barra con una franja rayada en su parte superior indica que parte de los alerts de esa suite+semana nunca llegaron al webhook, y la altura del segmento rayado es proporcional a `undeliveredAlerts`. La leyenda ocupa dos filas (los 3 colores de `severity` + NO-ROW + el swatch rayado `undelivered (webhook down)`), y el `<title>` de cada barra incluye el recuento (`3 alerts, 2 undelivered`). Cada barra lleva un `<title>` accesible con suite, semana, `kind`, `severity`, número de alerts (pluralizado), mediana, `deltaPctWoW` (o `no adjacent baseline`) y racha actual — tooltip al hover, tree en visores y texto para screen readers, sin abrir el CSV. Además reconcilia el `deltaPctWoW` del payload de cada alert con la fila del CSV de resumen: `deltaMatch` = `match` (iguales), `granularity` (difieren en suite multi-shard — la fila CSV es la mediana, los alerts son por shard: esperado) o `mismatch` (difieren en suite de 1 shard — señal real; contado en `deltaMismatch` del JSON). **Ponderación por racha**: cada fila lleva `severity` — `high` para missed-alerts con `streak >= 2` (la suite lleva semanas consecutivas DEGRADED sin corroboración de alert: lo más grave), `medium` para missed de racha 1 o phantom-alerts, `low` para consistent. El detalle del missed de racha alta incluye `, streak N`, el JSON cuenta `highSeverity`, y la tabla de findings del CSV y del job summary se ordena **high primero** — lo que hay que mirar primero queda arriba. **Bloque aparte en el CSV**: tras la tabla suite+semana, una segunda tabla lista cada alert no entregado (`# undelivered alerts (delivered=false — webhook down)` con `suite,week,year,shard,status,minutes,deltaPctWoW,recordedAt`), una fila por alert — una caída del webhook se ve sin abrir el JSON. Publica también un **job summary** de GitHub (tabla de missed/phantom alerts + reconciliación de deltas + tabla de delivery failures) vía `GITHUB_STEP_SUMMARY`. **Embed del SVG**: con una URL https alcanzable, el summary gana la sección `### Consistency chart` con `![Nightly alert-vs-trend consistency chart](<url>)`. Dos caminos: (1) la repo var `CONSISTENCY_SVG_PUBLIC_URL` (URL firmada/privada); o (2) **automático en CI** — con `CONSISTENCY_SVG_BUCKET` puesto, el nightly sube `nightly-consistency.svg` a un bucket S3 **privado**, genera una URL **presigned** y reescribe el summary con ella (dos fases: `CONSISTENCY_DEFER_SUMMARY=1` omite el summary en el primer paso, el paso `Sign SVG URL` presigna, y `CONSISTENCY_SUMMARY_ONLY=1` reescribe con la URL — exit 0 siempre, sin re-ejecutar el gate). Sin var y sin bucket (default), el summary queda solo con tablas — **nada sale del repo por defecto**, igual que en `nightly-trends`. Advisory **excepto un fail-loud gate**: si una suite acumula ≥ `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` (default 2) semanas **consecutivas** de phantom-alert (alert WoW sin corroboración a nivel suite), el script escribe CSVs/JSON/summary y sale con exit 1 logueando `nightly_consistency_sustained_phantom` — phantoms repetidos en la misma suite sugieren un bug en el criterio de degradación. Un hueco o una semana no-phantom rompen la racha. | 90 d |
| `nightly-dependency-cve-report` | `dependency-cve-report-prod.md` + su `.json` hermano y `dependency-cve-report-dev.md` + su `.json` — el informe de CVEs del árbol declarado en los dos perfiles de `npm audit` (prod y dev), con la tabla `own` / `inherited` y el **bump mínimo** por advisory; se publica **cada lunes aunque el gate esté verde** (ver §6). Las mismas tablas van al job summary del run (`--step-summary`), así que se leen sin descargar nada. `if-no-files-found: error`: el informe ES el entregable, su ausencia es un fallo real. | 90 d |
| `nightly-performance` | `test-results/`, `playwright-report-*` | 14 d |
| `kpi-report-<run_id>`, `drill-backup-restore-<run_id>` | Evidencia de KPIs / drill | 30/90 d |

**Merge resiliente** (`scripts/merge-nightly-blobs.mjs`): con 0 blobs o set incompleto (shard cancelado antes del run) el merge **hace skip con exit 0** y sube el status JSON — el fallo real ya lo reporta el shard. Solo un fallo genuino de `merge-reports` (set completo) propaga exit 1.

## 5. Triaje de un nightly rojo

### Paso 1 — Identificar el job rojo

1. Abrir **Actions → Nightly validation → último run** (o el enlace "runs fallidos" del README, filtrado por `conclusion=failure`).
2. En la pestaña *Summary* ver qué jobs fallaron: `human-like-sharded`, `multiuser-sharded`, `performance`, `coverage`, `kpi-staging`, `launch-readiness`, `drill-backup-restore`, `load-test`, o un job de merge/reportes.

### Paso 2 — Clasificar por familia de fallo

| Síntoma | Causa probable | Acción |
|---|---|---|
| Job E2E rojo + el **shard mismo** falló en un test | Test flaky o regresión funcional | Re-run del job (`Re-run failed jobs`); si persiste, revisar el test y el reporte HTML unificado |
| Job E2E rojo por **timeout del job** (60/45 min) | Suite creció o hardware lento | Subir N de shards, revisar `nightly-trends.csv`, ajustar presupuesto |
| `*report` (merge) rojo **solo por blobs ausentes** | Shard cancelado antes del run | **No es un fallo real**: el merge hizo skip (ver `*-merge-status.json`). El shard faltante ya está rojo aparte |
| `*report` rojo con set **completo** de blobs | Merge corrupto (bug) | Investigar `playwright merge-reports` — este caso sí es un fallo real |
| Alerta Slack de **DEGRADED +X% WoW** | Duración creciente semana a semana | Revisar `nightly-trends.csv`; buscar tests que ralentizaron; decidir si es ruido (bump ratio) o señal (actuar) |
| `nightly-trends` rojo por **sustained degradation** | ≥ N semanas **consecutivas** de DEGRADED en una suite | **Es señal real, no ruido**: mirar el CSV de resumen para ver la racha (`degradedWoW`) y el job summary; el alert Slack `nightly_trends_sustained` incluye la pendiente de la última semana. Subir shards o presupuesto solo tras confirmar la pendiente |
| Informe `nightly-consistency` con **missed-alert** | Suite DEGRADED en el resumen sin alert WoW de ningún shard | Verificar si es artefacto de mediana (ningún shard cruzó 1.25× pero la mediana sí) o un alert no enviado; revisar el log de alertas de esa suite. Si `severity = high` (streak ≥ 2) es **prioridad**: la suite lleva semanas consecutivas DEGRADED sin corroboración — investigar el criterio de degradación o el envío de alerts antes de que el gate dispare |
| Informe `nightly-consistency` con **phantom-alert** | Alert WoW de un shard sin fila DEGRADED de la suite | Revisar la fila del shard en el resumen: puede ser un shard que degradó mientras la suite no; si se repite, investigar el criterio |
| Job `nightly-consistency` **rojo** (`nightly_consistency_sustained_phantom`) | ≥ `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` (default 2) semanas consecutivas de phantom-alert en la misma suite | El criterio de degradación está emitiendo alerts sin corroboración de la mediana: revisar el umbral por suite (`NIGHTLY_*_DEGRADE_RATIO`) y la agregación de shards antes de silenciar. El CSV/JSON se escriben antes del exit 1, la evidencia está en el artifact |
| Fila en el bloque `# undelivered alerts` del CSV | Alert `delivered=false` — el webhook no recibió el payload (caído, URL rechazada o rate-limited) | El alert se disparó pero no llegó a Slack: revisar el estado del endpoint (`NIGHTLY_ALERT_WEBHOOK_URL`), el `nightly_webhook_failed` del log del job y re-enviar manualmente si la suite estaba DEGRADED. El informe de tendencias y los artifacts no dependen de la entrega — la señal de degradación sigue en el CSV aunque Slack no recibiera nada |
| Informe `nightly-consistency` con **deltaMatch = mismatch** | `deltaPctWoW` del alert ≠ fila del CSV en una suite de 1 shard | Señal real de deriva payload-vs-CSV: revisar qué valor se envió a Slack vs el resumen; indicio de bug en el enriquecimiento o en la historia |
| Informe semanal `nightly-dependency-cve-report` con un advisory **`own`**, o con un `inherited` **sin aceptación escrita** | El gate de CI habría puesto el job rojo; si el informe es lo primero que lo enseña, el gate no corrió en esa revisión (o el advisory llegó después del último CI) | Abrir el `.md` del perfil afectado: la columna **Arrives via** nombra la dependencia directa y la **Minimal lever** dice el cambio más barato (`refresh-lockfile`, `bump-parent`, `bump-direct` u `override-pin`). Un advisory `own` no se baselina nunca — es nuestra línea del manifiesto |
| Informe semanal con advisories **por debajo del umbral** (low/moderate) | El gate solo mira `high` (threshold por defecto); el informe lista **todo** lo que `npm audit` reporta | Sin acción obligatoria: el informe existe para decidir con los ojos abiertos. Si el advisory afecta a algo que se ejecuta en el navegador del usuario, adelantar el bump es más barato que esperar a que suba de severidad |
| Informe semanal **vacío** (`0 advisory(ies)` en ambos perfiles) | Semana limpia: eso es un informe correcto, no un job roto | Nada. El valor del artefacto está en las semanas en que no lo sea: el job publica una **clasificación**, nunca un gate |
| `kpi-staging` / `launch-readiness` rojo | Umbrales de negocio/checklist | Revisar en staging; ajustar repo vars `KPI_MIN_*` o resolver el bloqueante |
| `drill-backup-restore` rojo | RTO gate del drill mensual | Revisar el informe del drill (`DRILL_*`), no es nightly diario |

### Paso 3 — Acciones según gravedad

- **Flaky conocido** → re-run; si se repite en la semana, añadirlo al seguimiento (no borrar waits ni saltar tests sin motivo — `no-unexplained-test-skip` lo bloquea).
- **Regresión de duración** → antes de subir el presupuesto, mirar el CSV de tendencias (`nightly-trends`, 90 días) para confirmar que la pendiente es real; la columna `deltaPctWoW` del resumen da el % de cambio semana a semana (vacío si no hay semana anterior adyacente o la mediana previa es 0). El presupuesto es un **sensor**, no una válvula de escape.
- **Merge skip** → confirmar con el `*-merge-status.json` y cerrar sin acción (el nightly ya refleja el fallo del shard).
- **Fallo de webhook** → `NIGHTLY_ALERT_WEBHOOK_URL` mal configurado o caído: validar con `webhook-smoke` (dispatch manual con `test_alert` + `smoke_suite`).

### Paso 4 — Verificación de la alerta

- El webhook se prueba con el job `webhook-smoke` (Actions → *Run workflow* → `test_alert: true`, elegir suite).
- El badge del README y el enlace "runs fallidos" dan el estado sin abrir Actions.

## 6. Informe semanal de CVEs de dependencias — `dependency-cve-report`

El gate `check:direct-cve` (y su gemelo `check:override-cve`) solo habla cuando **falla**: con el árbol limpio imprime una línea `ok` y nada más. La clasificación que la gente necesita leer —qué advisory es `own` (nuestra línea del manifiesto), cuál es `inherited` (llega a través de algo que declaramos), **por qué dependencia directa** llega y **cuál es el bump mínimo** que lo cierra— es precisamente la que se queda invisible en una semana verde. Este job la publica:

- **Cadencia semanal** — lunes 02:23 UTC (`cron: '23 2 * * 1'`), más `workflow_dispatch`. La cadencia es deliberada: el job publica una **clasificación**, no una señal, y la base de advisories no se mueve cada noche; un informe diario enterraría la única diferencia real de la semana.
- **Los dos perfiles.** `prod` (el mismo que corre dentro de `npm run check`) y `dev` (el paso propio de CI, donde vive la cadena de herramientas). Cada uno con su `.md` legible y su `.json` hermano.
- **Report mode nunca gatea.** El exit code del job es solo "el audit pudo correr" — si no, falla cerrado (exit 2). Ninguna semana se pone roja por tener advisories; para eso ya está CI.
- **Sin descargas.** `--step-summary` vuelca las mismas tablas al job summary del run, con el perfil en el encabezado de cada una (`## Dependency CVE report — prod (npm audit --omit=dev)`), de modo que la clasificación se lee en la página del run sin bajar el artefacto.
- **El baseline también se ve.** Un advisory heredado aceptado con `--accept … --reason` sigue apareciendo en la tabla `inherited` y se cuenta como `accepted`: "verde" y "sin riesgo aceptado" no son lo mismo, y el informe lo deja explícito.
- **Local:** `npm run cve:report` reproduce exactamente el informe `dev`.

El job **no debe convertirse en un gate**. Lo único que puede ponerlo rojo es que el artefacto no exista (`if-no-files-found: error`): el informe *es* el entregable. Un fallo del registro npm no lo rompe — `fetchRegistryMetadata` es best-effort y degrada a `basis: offline` diciéndolo en el informe, en vez de inventar una versión mínima.

## 7. Referencias

- `scripts/nightly-alert.mjs` + `scripts/__tests__/nightly-alert.test.mjs` — gate de alertas (tests: 49)
- `scripts/merge-nightly-blobs.mjs` + tests — merge resiliente de blobs
- `scripts/nightly-trends.mjs` + tests — CSV de tendencias
- `scripts/check-direct-cve.mjs` + `scripts/dependency-cve-core.mjs` + tests — gate e informe de CVEs del árbol declarado (clasificación `own` / `inherited` y bump mínimo)
- `.github/workflows/nightly.yml` — definición de jobs, vars y secrets
- `docs/audit.md` — anclas `ADR-019`, `P92`, `H5` y ledger de gaps conocidos

## 8. Deudas conocidas y mejoras pendientes

Estas mejoras quedan registradas aquí como referencia operativa. No bloquean el
lanzamiento, pero son candidatas a ejecutar en el primer sprint post-launch.

- **Cleanup del bucket S3 presigned.** Los SVGs de tendencias y consistencia se
  suben a buckets S3 privados con URLs presigned de vida corta (`TRENDS_SVG_PRESIGN_EXPIRES`,
  default 3600 s). Los objetos caducan por URL pero no se borran del bucket;
  acumular objetos caducados sin lifecycle policy es una deuda de almacenamiento
  creciente. Decidir: (a) lifecycle rule que borre objetos > 7 días, (b) borrado
  explícito post-run en el propio script, o (c) aceptar la acumulación si el
  costo es despreciable. Verificar primero el costo real con un inventario del
  bucket antes de implementar.
- **Extraer `Sign SVG URL` / `Rewrite summary` a action compuesta.** Los pasos
  de sign y rewrite están duplicados entre `nightly-trends` y `nightly-consistency`
  (mismo patrón de dos fases: DEFER_SUMMARY → Sign → SUMMARY_ONLY). Extraerlos
  a una composite action reduce la duplicación y el riesgo de que un cambio en
  uno no llegue al otro.
- **Paridad de la rampa `streak 1→N→gate` en el SVG de consistencia.** El SVG
  de tendencias (`nightly-trends.svg`) muestra la rampa de racha como gradiente
  continuo en la leyenda. El SVG de consistencia (`nightly-consistency.svg`) usa
  colores por severidad (high/medium/low) pero no incluye la rampa de streak;
  un observador que solo mira el SVG de consistencia no ve a qué distancia está
  cada suite del gate. Añadir la rampa de streak al SVG de consistencia (o al
  menos un indicador numérico de streak por barra) cerraría esa brecha de
  legibilidad.
