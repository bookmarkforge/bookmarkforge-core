# Plantilla — Ficha de revisión de privacidad por proveedor

**Uso:** borrador para revisar un proveedor concreto antes de usarlo en producción: qué datos recibe, cuánto se conservan, quién más los ve y qué controles aplica BookmarkForge. Una ficha por proveedor, fechada.

**Borrador sin datos reales.** No incluir secretos ni contratos firmados; registrar el resultado y la referencia en `legal/REGISTRO.md`.

## 1. Identificación

| Campo | Valor |
|---|---|
| ID del registro | [P-XX] |
| Proveedor y servicio | [PROVEEDOR] |
| Papel | responsable / encargado / subencargado / tercero destinatario |
| Actividades cubiertas | [ACTIVIDADES] |
| Región y transferencias | [REGIÓN / MECANISMO] |
| Fecha de la ficha | [AAAA-MM-DD] |

## 2. Minimización

- [ ] Lista de campos personales que el proveedor recibe realmente (no los que "podría" recibir).
- [ ] Justificación por campo: qué funcionalidad se pierde si se elimina.
- [ ] Datos que se evitan por diseño: contenido de bóveda, claves, tokens de sesión, direcciones de la biblioteca.
- [ ] Verificación de que los avisos de privacidad y los scrubbers del cliente coinciden con esta lista.

## 3. Retención

- [ ] Plazos por categoría (logs, metadatos técnicos, datos de cuenta, datos de compra) y dónde se configuran.
- [ ] Retención por defecto del plan contratado y cómo se reduce si el mínimo es excesivo.
- [ ] Exportaciones, copias de seguridad y réplicas: mismo plazo o distinto.
- [ ] Borrado a petición: canal, plazo de respuesta y evidencia del proceso.

## 4. Subprocesadores y transferencias

- [ ] Lista de subprocesadores publicada, con avisos de cambio y derecho de objeción.
- [ ] Si hay transferencia fuera del EEE, completar también `SCC-transferencia-internacional.md`.
- [ ] Si el proveedor trata datos por cuenta propia, completar `DPA-proveedor.md`.

## 5. Seguridad y operación

- [ ] Cifrado en tránsito y en reposo, y gestión de claves.
- [ ] Control de acceso interno, MFA obligatoria y registro de auditoría.
- [ ] Notificación de incidentes: canal, plazo y contenido del aviso.
- [ ] Continuidad: dependencia crítica identificada, plan de sustitución y exportabilidad de los datos.

## 6. Resultado

- [ ] Riesgos abiertos y medidas aceptadas, con responsable y fecha límite.
- [ ] Decisión: aprobado / aprobado con condiciones / no usar en producción.
- [ ] Fila del registro actualizada con estado, `evidence_ref` y próxima revisión.
