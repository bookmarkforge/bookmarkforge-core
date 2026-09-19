# ADR-060: Gate de consolidación legal RGPD (`check:legal-consolidation`)

- **Estado:** Aceptada (2026-09-19)
- **Fecha:** 2026-09-19
- **Relacionadas:** [ADR-028 — gate drift detection](adr-028-gate-drift-detection.md), [ADR-026 — retiro controlado de documentación](adr-026-documentation-retirement.md)

## Contexto

El procedimiento operativo de violación de datos personales vivía solo en las plantillas privadas de `legal/plantillas/` (notificación a la autoridad del art. 33, comunicación a interesados del art. 34 y checklist de violación), mientras `docs/security.md` —la referencia operativa que el equipo lee— reducía los incidentes a dos frases genéricas. El retiro documental masivo de 2026-09 demostró el riesgo: ADR-026 prohíbe que material de cumplimiento desaparezca sin reemplazo equivalente, y la restauración del corpus dejó la consolidación sin mecanismo de verificación.

El fallo concreto que este gate previene es el que ADR-028 define como *gate drift* en su variante documental: la sección consolidada de `docs/security.md` pierde —por edición, refactor o futuro retiro— el reloj de 72 horas, la referencia a las plantillas del art. 33/34 o la regla de no solicitar secrets a usuarios, y el procedimiento real de incidentes queda sin cobertura documental sin que nada falle. Es exactamente la clase de pérdida que hizo necesaria la cláusula de "reemplazo equivalente" de ADR-026, hoy solo protegida por revisión manual.

## Decisión

Se implementa el gate `npm run check:legal-consolidation` (`scripts/check-legal-consolidation.mjs`), integrado en la cadena `check` en el bloque de seguridad (tras `check:server-log-ip-privacy`), que verifica:

1. **Sección consolidada:** `docs/security.md` mantiene el encabezado `### Procedimiento de violación de datos personales (RGPD)` con el reloj de 72 horas, las tres rutas de plantilla y la regla de frases de recuperación.
2. **Plantillas intactas:** las tres plantillas existen, superan un mínimo de tamaño (una plantilla vaciada por un borrado accidental no puede pasar) y conservan sus anclas legales (`BMF-INC-[AAAA]-[NNN]`, "72 horas", la regla "No incluir secretos" y la referencia a `legal/REGISTRO.md`).
3. **Registro de incidentes:** `legal/REGISTRO.md` sigue presente como repositorio de referencias.
4. **Fail-closed de secretos:** ninguna plantilla de borrador contiene credenciales aparentes (JWT, claves de proveedor, blobs opacos largos); las plantillas son borradores y deben permanecer sin datos reales.

La lógica es una función pura (`runLegalConsolidationChecks`) sobre fixtures en memoria, con el wrapper CLI haciendo el I/O — el mismo patrón de `check:csp-sync.mjs` — de modo que `scripts/__tests__/check-legal-consolidation.test.mjs` conduce el gate con corpus completos, secciones mutiladas, plantillas guts y secretos inyectados.

## Consecuencias

- La consolidación del procedimiento RGPD en la documentación operativa pasa a ser verificable en CI; perder cualquier pieza del reemplazo equivale a romper el gate.
- El gate no valida la exactitud jurídica de las plantillas (eso sigue requiriendo revisión de un profesional, como ya exige `legal/plantillas/README.md`); verifica presencia, integridad estructural y ausencia de secretos.
- Las ediciones legítimas del procedimiento actualizan el test de congelación junto con el contenido, con el diff revisado en PR.
- Cumple los dos criterios de ADR-028: el fallo es una divergencia verificable (material de cumplimiento consolidado vs. documentación real) y la verdad tiene fuentes únicas versionadas (`docs/security.md` y `legal/plantillas/`).
