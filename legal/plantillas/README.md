# Plantillas privadas

Mantener aquí únicamente borradores sin secretos ni datos reales.

## Violación de datos personales

- `notificacion-art-33-autoridad.md` — notificación a la autoridad de control.
- `notificacion-art-34-interesados.md` — comunicación a los interesados.
- `checklist-violacion-seguridad.md` — checklist de gestión de la violación.

Las tres alimentan la sección de incidentes de `docs/security.md` y son material de cumplimiento protegido por ADR-026.

## Contratos, transferencias y proveedores

- `DPA-proveedor.md` — checklist de encargo de tratamiento (Art. 28 RGPD).
- `SCC-transferencia-internacional.md` — revisión de transferencias fuera del EEE.
- `confirmacion-Whop.md` — preguntas sobre vendedor, merchant of record, IVA, reembolsos y payouts.
- `revision-privacidad-proveedor.md` — ficha de minimización, retención, subprocesadores y seguridad.

Cada ficha se apoya en las filas de proveedor (`P-01` a `P-09`) de `legal/REGISTRO.md` y en la evidencia guardada en `legal/proveedores/` y `legal/evidencias/`.

Cada plantilla debe revisarse por un profesional antes de enviarse o firmarse.

## Cobertura

El gate `npm run check:legal-consolidation` verifica que las siete plantillas existan, superen el mínimo de tamaño y conserven sus anclas legales (con la comparación insensible a mayúsculas). Borrar, vaciar o despojar de anclas a cualquiera de ellas rompe CI: son borradores, pero no desechables.
