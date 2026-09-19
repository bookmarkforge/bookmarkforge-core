# Plantilla — Revisión de transferencias internacionales (SCC / CCT)

**Uso:** borrador para revisar cualquier tratamiento que salga del Espacio Económico Europeo (EEE), decidir si necesita Cláusulas Contractuales Tipo y documentar las medidas suplementarias. No es asesoramiento jurídico.

**Borrador sin datos reales.** No incluir secretos ni contratos firmados; registrar referencias y estados en `legal/REGISTRO.md`.

## 1. Identificar la transferencia

| Campo | Valor |
|---|---|
| ID del registro | [P-XX] |
| Exportador | [NOMBRE LEGAL / ENTIDAD] |
| Importador | [PROVEEDOR / ENTIDAD] |
| País de destino y regiones de respaldo | [PAÍS / REGIÓN] |
| Servicio y actividad de tratamiento | [SERVICIO] |
| Datos y categorías de interesados | [DATOS] |
| Papel del importador | encargado / responsable independiente / subencargado |

## 2. Decidir el mecanismo

1. **¿Existe decisión de adecuación** de la Comisión para el país o el marco aplicable? Si sí, documentar la referencia y fecha; fin del análisis salvo revisión anual.
2. **Si no hay adecuación**, elegir el módulo de Cláusulas Contractuales Tipo aplicable (responsable a encargado, responsable a responsable, encargado a encargado) y verificar que el módulo cubre la actividad real.
3. **No usar CCT sin evaluación de transferencia**: las cláusulas por sí solas no bastan si el ordenamiento del país importador permite accesos que vacíen las garantías.

## 3. Evaluación de transferencia (TIA)

- [ ] Leyes y prácticas del país importador relevantes para el servicio (acceso gubernamental, obligaciones de divulgación, recurso efectivo).
- [ ] Naturaleza de los datos y daño potencial de una divulgación.
- [ ] ¿Puede el importador oponerse a una orden ilegal y notificar al exportador?
- [ ] Medidas suplementarias **técnicas**: cifrado, seudonimización, minimización, control de claves, ubicación y retención.
- [ ] Medidas suplementarias **organizativas** y contractuales: transparencia, auditoría, límites de acceso y personal autorizado.
- [ ] Riesgo residual aceptado por un responsable identificado, o transferencia suspendida.

Argumento de minimización del producto: el contenido de la bóveda viaja cifrado de extremo a extremo desde el dispositivo y el servidor no recibe contenido en claro ni claves. Documentar qué metadatos sí cruzan la frontera (IP, identificadores de sesión, logs) y no presentar el cifrado como sustituto de un mecanismo jurídico válido.

## 4. Cierre y seguimiento

- [ ] Módulo de CCT firmado o aceptado, con versión y fecha identificadas.
- [ ] Medidas suplementarias implementadas o con ticket de seguimiento.
- [ ] Fila del registro actualizada con mecanismo, región, `evidence_ref` y próxima revisión.
- [ ] Revisar de nuevo si cambia el proveedor, la región, el servicio o la legislación del país destino.
