# Plantilla — Checklist de encargo de tratamiento (DPA)

**Uso:** borrador de trabajo para revisar y negociar el acuerdo de encargo de tratamiento (Art. 28 RGPD) con un proveedor que trate datos personales por cuenta de BookmarkForge. Es una checklist, no un contrato: un profesional debe revisarla antes de enviarla o firmarla.

**Borrador sin datos reales.** No incluir secretos, credenciales, datos completos de tarjetas, contraseñas de bóveda ni frases de recuperación. Registrar solo la referencia, el estado y la evidencia en `legal/REGISTRO.md`.

## 1. Identificación

| Campo | Valor |
|---|---|
| ID del registro | [P-XX] |
| Proveedor | [PROVEEDOR] |
| Servicio contratado | [SERVICIO] |
| Entidad responsable | [NOMBRE LEGAL / ENTIDAD] |
| Papel del proveedor | encargado del tratamiento / subencargado / responsable independiente |
| Fecha de revisión | [AAAA-MM-DD] |
| Versión del documento del proveedor | [VERSIÓN / FECHA] |

## 2. Elementos del Art. 28 RGPD

- [ ] **Objeto, duración, naturaleza y finalidad** del tratamiento descritos sin ambigüedad.
- [ ] **Categorías de interesados** y **tipos de datos personales** enumerados (¿se tratan datos de categorías especiales? Si sí, justificar).
- [ ] **Instrucciones documentadas** del responsable: el proveedor no trata los datos para fines propios ni para entrenar modelos.
- [ ] **Confidencialidad**: personal autorizado, obligación de secreto y formación.
- [ ] **Medidas de seguridad** del Art. 32: cifrado, control de acceso, registro de eventos, gestión de vulnerabilidades y continuidad.
- [ ] **Subprocesadores**: autorización previa, lista vigente, aviso de cambios con derecho de objeción y mismas obligaciones aguas abajo.
- [ ] **Asistencia al responsable**: derechos de los interesados, evaluaciones de impacto y notificación de brechas sin dilación indebida.
- [ ] **Transferencias internacionales**: mecanismo identificado (decisión de adecuación o Cláusulas Contractuales Tipo) — completar también `SCC-transferencia-internacional.md`.
- [ ] **Devolución o supresión** de los datos al terminar el encargo, con plazos y formato.
- [ ] **Auditoría e inspecciones**: información suficiente para demostrar cumplimiento.
- [ ] **Notificación de brechas**: canal, plazo máximo y contenido mínimo del aviso (qué, cuándo, impacto, medidas).
- [ ] **Responsabilidad y subcontratación de soporte** que pueda acceder a datos.

## 3. Evidencia y cierre

- [ ] Documento exacto identificado (versión y fecha) y conservado en `legal/proveedores/[PROVEEDOR]/`.
- [ ] Firma o click-acceptance por la misma entidad que figura en el aviso legal y el alta fiscal.
- [ ] Fila del registro actualizada con estado, `evidence_ref` y próxima revisión.

## 4. Reglas de no cierre

- No marcar como firmado con solo una página pública de términos si no se identifica la entidad que acepta.
- No aceptar DPA por referencia genérica ("los términos incluyen protección de datos") sin poder mostrar la cláusula.
- No iniciar tratamiento en producción sin DPA cuando el proveedor sea encargado.
