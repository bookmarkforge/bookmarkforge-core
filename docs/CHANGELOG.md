# Changelog

Cambios por versión, del más reciente al más antiguo. Cada entrada cita los commits que la componen, para poder auditarla contra el historial.

## [1.0.0] — 2026-09-19 · rama `release/v1.0.0`

**Sin publicar:** el primer push a `origin` sigue pendiente, así que esta versión todavía no existe en el remoto.

Base de la rama: `121d13f` (padre) → `bd259ea` (punta). Son 10 commits y cubren tres frentes: cierre de fugas y carreras en la bóveda, integridad verificable de los backups remotos, y gobernanza documental vigilada por gates de CI.

### Seguridad y bóveda

- **Fuga de clave en el desbloqueo** (`c9f5804`): si falla la creación del token de verificación durante el desbloqueo, la clave de dispositivo se zeroiza y el vault queda bloqueado. La regresión cubre el fallo de `crypto.subtle.sign`.
- **Carrera de sales KDF entre pestañas** (`c9f5804`): las adopciones se serializan, de modo que una lectura lenta y obsoleta ya no puede reinstalar una sal retirada después de que aterrizara una adopción más nueva; la generación de ciclo de vida descarta el trabajo pendiente al parar o reiniciar.
- **Derivación en vuelo vs. ciclo de vida** (`c9f5804`): la persistencia del wrapper se aborta cuando la clave de dispositivo cambió durante una derivación Argon2id en curso (bloqueo o cierre a mitad de rewrap).
- **Contrato de bloqueo en la UI** (`c9f5804`): cuando una rotación hermana fuerza el bloqueo fail-closed, el shell de React se bloquea mediante `useSecurityStore.lock()`. El bloqueo criptográfico por sí solo dejaba un vault muerto detrás de una interfaz viva (ADR-046).

### Decodificación defensiva

- **Decodificador compartido** (`239e922`): `decodeDataUrlToBytes` se suma a `decodeDefensiveBase64(Async)` en el módulo de Base64 defensivo. La validación estricta de charset y padding y la cota de tamaño decodificado se aplican antes de cualquier reserva de memoria; la decodificación escribe por bloques en un único búfer pre-dimensionado y la entrada malformada devuelve `null` en lugar de lanzar una excepción en el camino feliz del llamador.
- **Refuerzos heredados** (`239e922`): ajustes pendientes en `utils/` (almacenamiento RxDB, resiliencia, serialización segura de errores y JSON, descargas, diagnóstico E2E, escaneos de auditoría y conocimiento, matriz de compatibilidad heredada, formato de audio).
- **Duplicados eliminados** (`6d4e73a`): los tres parsers `dataUrlToBytes` repetidos (adjuntos de documentos, `FolderSyncService`, `exporter.formatters`) y el decodificador cacheado de TTS delegan ahora en el decodificador compartido, con cotas de tamaño por contexto. Los payloads percent-encoded mantienen una ruta acotada de `decodeURIComponent` que antes no tenía límite.
- **Contraseñas de backup** (`6d4e73a`): export e import normalizan la contraseña (trim) de la misma forma. Antes discrepaban, así que una contraseña compuesta solo de espacios podía producir un `.json` en claro que igualmente declaraba la extensión cifrada `.bmf`.

### Backups y sincronización remota

- **Retención remota configurable** (`e6ff2c0`): `remoteRetentionCount` (por defecto 10, acotado entre 1 y 100) con selector en ajustes. La retención poda payload y sidecar como una sola unidad mediante borrado best-effort en WebDAV, S3 y los cinco proveedores por token.
- **Sidecar HMAC por versión** (`e6ff2c0`): cada subida publica un sidecar que liga una etiqueta HMAC-SHA256 (derivada de la contraseña maestra mediante HKDF con etiqueta dedicada) a los bytes exactos del payload y al nombre remoto. La restauración verifica la descarga cruda antes de cualquier decodificación Base64, trabajo Argon2id o acceso a la base de datos: sidecar ausente significa camino heredado, y una etiqueta presente pero inválida aborta la restauración.
- **Restauración hostil** (`e6ff2c0`): regresiones para ciphertext truncado, backup excesivamente grande, colección no permitida y ciphertext alterado. La restauración remota valida estrictamente a través del decodificador defensivo compartido (charset, padding y cota de 100 MB) antes de reservar el archivo temporal.

### Documentación y gobernanza

- **Inventario canónico** (`f03ca1a`): el índice documental se deriva de los archivos que existen en disco, así que el retiro de un documento pasa a ser explícito en lugar de una deriva permanente en CI. La brecha de 61 documentos se colapsa en un inventario vivo más ADRs de retiro.
- **Política y gates de documentación** (`f03ca1a`): ADR-026 (retiro documentado), ADR-040 (fusión del gate de Markdown), documentación operativa mínima (operaciones, seguridad, ROPA, API, correos de onboarding), la página de privacidad de la extensión que exige la prueba de rollback, y el baseline de deriva de auditoría.
- **Reversión del retiro masivo** (`384bdea`): el borrado en bloque (más de 30 ADRs, plantillas legales de notificación de violaciones RGPD y runbooks) había esquivado el mecanismo de consentimiento de ADR-026 y dejaba material protegido sin reemplazo equivalente. Se restauran los 79 archivos y se renumera el ADR de política de retiro a ADR-059 para liberar el número en colisión.
- **Estado de release** (`f03ca1a`): el informe de estado registra la matriz de regresión completa, las remediaciones de la sesión y los bloqueos externos que quedan.
- **Baselines regenerados** (`fb35bc0`): el índice documental lista 103 documentos y el baseline de Markdown cubre 102 archivos y 32 ADRs sin hallazgos.

### Calidad interna y E2E

- **Hardening de servicios y composición** (`59644c6`): cambios pendientes en base de datos, hooks, memoria, observabilidad, telemetría, analítica, servicios de IA, validación de sincronización y la unificación de imports del vault de seguridad. El import dinámico de `auth.ts` pasa a estático: vivía en un módulo ya presente en la cadena estática y solo producía avisos de import dinámico inefectivo.
- **Cadenas i18n faltantes** (`24ba20c`): la clave del aviso de cambio de bóveda en otra pestaña que `AppInitializer` referenciaba sin existir en el catálogo inglés, más las cadenas de restauración e integridad y de retención remota. Los catálogos de los 29 locales quedan completos.
- **Entitlements Pro en E2E** (`bd259ea`): el adaptador Whop del companion apuntaba a un puerto muerto, así que toda activación Pro fallaba y los specs de backup y restauración chocaban con el muro Pro. El mock de licencias pasa a ser un servidor de Playwright, la ruta de licencia se enruta al servidor de firma por delante de la regla genérica del proxy, y `seedProEntitlement` ejecuta la activación real dentro de la página (sin forja en el cliente; la firma la hace el servidor de firma con la clave de desarrollo ignorada por git, y sin ella falla de forma ruidosa en lugar de conceder Pro en silencio).
