# Guía de triage — Primer run de CodeQL y Semgrep (SAST)

- **Última revisión:** 2026-08-30
- **Alcance:** primer run de `.github/workflows/sast.yml` (jobs "CodeQL analysis" y "Semgrep analysis") y el gate `scripts/check-sarif-severity.mjs`.
- **Documentos relacionados:** [launch-checklist.md](launch-checklist.md) punto 8, [security.md](security.md) → "Validación externa requerida", [internal-security-checklist.md](internal-security-checklist.md).
- **Mantenimiento:** mantenedor único del repositorio; el gate y esta guía se validan mediante CI.

---

## 1. Cómo funciona el gate (lectura rápida)

| Escáner | Reglas | Salida | Umbral por defecto |
|---|---|---|---|
| CodeQL | `security-extended`, `build-mode: none` | SARIF en `../codeql-results/` (directorio) | `--min-severity high` |
| Semgrep | `p/security-audit` (modo abierto, `--metrics off`) | `semgrep.sarif` (archivo) | `--min-severity high` |

El umbral puede afinarse **por herramienta** (`--min-severity-for <tool>=<severity>`) y los hallazgos ya **aprobados** pueden ignorarse con `--baseline <archivo>` (ver §4). El resumen puede emitirse en formato tabla con `--format table`.

Clasificación que aplica el gate (`check-sarif-severity.mjs`):

1. Si el resultado trae `properties["security-severity"]` y su valor es un rango conocido (`critical|high|medium|low|none`), se usa ese rango.
2. Si no, se mapea `level`: `error` → **high**, `warning` → **medium**, `note` → **low**.
3. Sin ninguna información de severidad → **`unknown` → BLOQUEA** (fail-closed: un escáner que no clasifica no puede pasar en silencio).

Bloqueo = severidad con rango ≤ rango de `--min-severity`. Con `high` (default) bloquean **critical + high + unknown**; `medium` y `low` informan pero no rompen el CI.

> **Detalle práctico de CodeQL:** sus SARIF traen `security-severity` como **puntuación numérica** (p. ej. `"7.5"`), que el gate no interpreta como rango; por tanto, en la práctica los hallazgos de CodeQL se clasifican por `level` (`error` → high → bloquea). Resultado: casi todo hallazgo de `security-extended` bloquea el merge. Es un diseño deliberado (fail-closed); si el ruido se vuelve un problema, no se arregla subiendo el umbral global sino con exclusiones justificadas (§4) — o bajándolo solo tras un baseline limpio (§5).

Salida del gate (el "contrato" que lees en CI):

```
[check-sarif-severity] 3 finding(s) across 2 SARIF file(s):
  - [high] js/command-line-injection (CodeQL) server/src/example-legacy.ts:42 — Unsafe use of child_process exec.
  - [medium] javascript.lang.security.audit.detect-eval-with-expression (Semgrep) src/utils/helpers.ts:10 — Found expression in eval.
[check-sarif-severity] FAIL: 2 finding(s) at or above 'high'
```

Formato de cada línea: `[severidad] id-de-regla (herramienta) archivo:línea — mensaje`.

## 2. Cómo leer un hallazgo

1. **Regla:** busca la referencia oficial de la regla:
   - Semgrep: `https://semgrep.dev/r/<rule-id>` (descripción, patrón, falsos positivos conocidos).
   - CodeQL: la descripción de la consulta en el repositorio `github/codeql` (`javascript/ql/src/...`) o la ficha de la alerta en **Security → Code scanning** de GitHub.
2. **Ubicación:** `archivo:línea` es el *sink* (el punto donde ocurre el daño). El *source* (origen del dato) suele estar más arriba en el flujo; en code scanning puedes ver el flujo de datos completo.
3. **Mensaje:** explica el patrón detectado, no la gravedad real en tu contexto. La gravedad la decides tú tras el triage.
4. **Herramienta:** CodeQL usa análisis de flujo de datos (menos falsos positivos, más esfuerzo de lectura); Semgrep usa patrones (más cobertura, más ruido).

## 3. Clasificación de triage

Cada hallazgo termina en una de estas cuatro veredictos:

| Veredicto | Cuándo | Acción |
|---|---|---|
| **TP — verdadero positivo** | El flujo es alcanzable y el dato es controlable por un actor no confiable | Corregir en un PR de seguimiento; añadir un test que ejercite el caso |
| **FP — falso positivo** | El flujo no es alcanzable, el dato es interno o ya hay mitigación anterior | Excluir con justificación (§4) |
| **Riesgo aceptado** | Es real pero el coste/beneficio de corregirlo ahora no compensa (p. ej. self-XSS en contenido local) | Documentar con owner y fecha de revisión en el registro de triage |
| **Pendiente** | No puedes decidirlo sin más contexto | No tocar nada; dejar bloqueando hasta resolverlo |

**Lista de comprobación para distinguir falsos positivos (en este proyecto):**

- [ ] ¿El *source* es realmente controlable por un tercero? En BookmarkForge:
  - El vault, notas y marcadores **nunca salen del dispositivo**; un hallazgo XSS sobre contenido local suele ser *self-XSS* (el usuario se ataca a sí mismo) → riesgo bajo, no necesariamente FP.
  - Lo que sí llega al servidor: señalización P2P (HMAC obligatorio en producción), validación de licencias y entitlement (origen restringido + rate-limited), telemetría opt-in sin contenido y analítica agregada. Las llamadas a proveedores de IA **no** pasan por el servidor: salen del navegador con la clave del usuario, así que un hallazgo sobre ese flujo se evalúa en el cliente.
- [ ] ¿El *sink* ya está protegido por una mitigación existente? Revisa los controles de `docs/security.md` ("Controles activos"): DOMPurify centralizado, validación SSRF/IP, rate limits, CSP estricta.
- [ ] ¿El código es alcanzable? Mocks locales (`license-mock`, `mock-openai-server`), ramas muertas y código solo de build no corren en producción.
- [ ] ¿El hallazgo está en tests o fixtures? Los tests pueden disparar patrones (p. ej. `eval` para evaluar expresiones de test) sin riesgo real; excluye por ruta (§4) en lugar de por regla.
- [ ] ¿Semgrep marca algo que el mensaje contradice? Las reglas de patrón a veces aciertan el patrón pero no el contexto; léelas con el código delante.

**Regla de oro:** ante la duda, **no excluyas**. Un hallazgo dudoso que bloquea obliga a mirarlo; un hallazgo excluido nadie lo vuelve a ver.

## 4. Supresión con justificación

La exclusión es una decisión de seguridad, no una comodidad. Toda exclusión necesita: la regla concreta, un comentario con el porqué y revisión explícita del mantenedor único.

### Semgrep — `nosemgrep` (inline, en el código)

```ts
// nosemgrep: javascript.lang.security.audit.detect-eval-with-expression
// Justificación: la entrada es un literal interno de build, nunca datos de usuario.
const value = eval(code);
```

- Siempre con el **id de regla** y un comentario de justificación. Un `# nosemgrep` pelado (sin id) silencia todas las reglas en esa línea: prohibido.
- El hallazgo se elimina **en tiempo de escaneo**, así que ni siquiera llega al SARIF ni al gate. Es la vía rápida y auditable.

### CodeQL — exclusión por ruta (config-file)

CodeQL no tiene equivalente inline. El mecanismo soportado por la action es un archivo de configuración con `paths-ignore`:

```yaml
# .github/codeql/codeql-config.yml
paths-ignore:
  - "**/*.test.*"
  - "**/__tests__/**"
  - "tests/**"
  - "scripts/**/mocks/**"
```

Referéncialo en `sast.yml` (init de CodeQL): `config-file: .github/codeql/codeql-config.yml`.

- Sirve para **rutas** (tests, mocks, generados), no para **reglas individuales**: la exclusión por consulta no está soportada limpiamente por la action. Si una regla concreta genera ruido real, la vía correcta es arreglar el código o reducir el conjunto de consultas, no filtrar por regla.
- Dismiss en la UI de code scanning limpia la lista de alertas pero **no afecta al gate de CI**, que lee un SARIF nuevo en cada ejecución.

### Baseline: hallazgos conocidos y aprobados (`--baseline`)

El modo `--baseline` ignora hallazgos que ya fueron **triageados y aprobados explícitamente** — FP documentados o riesgos aceptados con fecha de revisión. Es complementario a `nosemgrep`: el inline silencia en el código; el baseline centraliza la aprobación y deja el código intacto.

Formato (`.github/sast-baseline.json`):

```json
[
  {
    "ruleId": "js/command-line-injection",
    "file": "server/src/example-legacy.ts",
    "tool": "CodeQL",
    "line": 42,
    "approved": true,
    "justification": "FP: entrada limitada a orígenes autenticados; ticket #123"
  }
]
```

- **Coincidencia:** `tool` (opcional, insensible a mayúsculas), `ruleId`, `file` (normalizado: separadores y `./`) y `line` (opcional; si se omite, coincide con cualquier línea de ese archivo+regla).
- **Fail-closed:** toda entrada requiere `approved: true` y `justification` no vacía; si falta alguna, el gate falla. Un hallazgo sin aprobar jamás se ignora.
- **Stale:** si una entrada ya no coincide con ningún hallazgo (el código se arregló), el gate avisa para que se limpie el baseline.
- **Cuándo usar baseline en vez de `nosemgrep`:** FP con referencia externa (ticket, decisión), riesgos aceptados con fecha de revisión, o silenciar rutas/reglas que CodeQL no permite excluir inline. Prefiere `nosemgrep` para FPs triviales y evidentes en el propio código.
- El archivo vive en `.github/sast-baseline.json`; cada alta en el baseline es un cambio de seguridad revisable en el PR y debe quedar justificada.

### Reglas de oro de la exclusión

1. Exclusión ≠ arreglo: primero intenta corregir el código.
2. Justificación obligatoria en el propio artefacto (comentario o `paths-ignore` con explicación en el PR).
3. Revisión por el mantenedor único y validación de los checks del PR.
4. Nunca excluir clases enteras ("todo lo que marque regla X") sin justificar cada ocurrencia.
5. Revisar la lista de exclusiones en cada revisión trimestral: el código cambia y un FP de ayer puede ser un TP de hoy.

## 5. Cuándo subir o bajar el umbral

El umbral vive en los dos pasos "Enforce severity policy (block High/Critical)" de `sast.yml` (`--min-severity`). Cambiarlo exige tocar ambos y una revisión explícita del mantenedor único.

| Cambio | Efecto | Cuándo |
|---|---|---|
| Subir a `critical` | Solo bloquean critical (y unknown) | **Solo después** de: (1) un baseline triageado sin TPs high sin corregir, (2) riesgos aceptados documentados con owner y fecha, (3) fecha de re-revisión fijada. Riesgo: los hallazgos **nuevos** high también dejan de bloquear |
| Bajar a `medium` | Bloquean critical + high + medium | Endurecimiento posterior, cuando el baseline esté limpio y el triage de medium sea sostenible |
| Afinar por herramienta (`--min-severity-for semgrep=medium`) | Solo esa herramienta cambia de umbral | Preferible a tocar el umbral global: aísla el ruido de un escáner sin debilitar el otro |
| Mantener `high` | Default actual | Lo correcto para el primer run y mientras haya ruido gestionable |

**Nunca:**
- Tocar el comportamiento fail-closed (`unknown` → bloquea). Quitar eso desactiva la red de seguridad del propio gate.
- Relajar el umbral para "pasar el CI" con hallazgos sin tratar.
- Cambiar el umbral sin entrada en el registro de triage (quién, cuándo, por qué, fecha de revisión).

Recuerda: el ruleset de `main` exige ambos jobs como checks obligatorios. Si el gate falla, el merge queda bloqueado por diseño — no hay atajo.

## 6. Procedimiento del primer run

1. **Lanzar** el workflow: Actions → *SAST security analysis* → Run workflow (rama `main` o una rama dedicada `chore/sast-first-run`).
2. **Esperar** ambos jobs; leer los pasos "Enforce severity policy". El job falla si hay blocking findings — es el comportamiento esperado del primer run.
3. **Recopilar hallazgos:** salida del gate en los logs + alertas en **Security → Code scanning** (filtra por `category: codeql` y `category: semgrep`).
4. **Reproducir localmente** para iterar rápido (comandos en el anexo).
5. **Triagear cada hallazgo** con la tabla de §7: veredicto + acción.
6. **Corregir los TPs** en PRs de seguimiento (con tests). **Excluir los FPs** con justificación (§4) y revisión de security.
7. **Registrar** el resultado en `docs/sast-triage-log.md` (crear el archivo con la tabla rellena): fecha, nº de hallazgos por herramienta, veredictos y decisiones de umbral.
8. **Documentar riesgos aceptados** con owner y fecha de revisión; revisarlos en la siguiente iteración trimestral.

## 7. Plantilla de registro de triage

**Hallazgos del run** (una fila por hallazgo):

| # | Regla (herramienta) | Ubicación | Severidad (gate) | Veredicto | Justificación / acción | Responsable |
|---|---|---|---|---|---|---|
| 1 | `js/command-line-injection` (CodeQL) | `server/src/example-legacy.ts:42` | high | TP | Corregir: validar entrada antes de `exec`; PR #… | @… |
| 2 | `…detect-eval-with-expression` (Semgrep) | `src/utils/helpers.ts:10` | medium | FP | Input interno de build; `nosemgrep` + justificación en el código | @… |

**Decisiones de umbral** (una fila por cambio; también para `--min-severity-for`, cambios de formato y altas/limpiezas del baseline):

| Fecha | Cambio | Motivo | Aprobado por | Fecha de revisión |
|---|---|---|---|---|
| — | `--min-severity high` (default) | Baseline inicial | — | — |

---

## Anexo: reproducción local

```bash
# Semgrep (misma versión y reglas que CI)
pipx run semgrep==1.174.0 scan --config p/security-audit --metrics off \
  --sarif --output semgrep.sarif
node scripts/check-sarif-severity.mjs --min-severity high semgrep.sarif

# Gate sobre un directorio de SARIF (caso CodeQL)
node scripts/check-sarif-severity.mjs --min-severity high ../codeql-results

# Umbral por herramienta (p. ej. solo Semgrep a medium)
node scripts/check-sarif-severity.mjs --min-severity high \
  --min-severity-for semgrep=medium semgrep.sarif

# Resumen en formato tabla
node scripts/check-sarif-severity.mjs --format table ../codeql-results

# Ignorar hallazgos aprobados (baseline) y reportar en tabla
node scripts/check-sarif-severity.mjs --baseline .github/sast-baseline.json \
  --format table ../codeql-results

# Ver la lista de reglas de Semgrep sin escanear
pipx run semgrep==1.174.0 --validate-config --config p/security-audit
```

CodeQL local requiere el CLI de CodeQL (`codeql database create` + `codeql database analyze`); la vía principal para triage es CI + code scanning, no la reproducción local.
