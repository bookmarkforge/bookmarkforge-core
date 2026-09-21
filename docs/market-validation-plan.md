# Plan de validación de mercado

## Objetivo

Validar que la propuesta local-first resuelve un problema real antes de ampliar infraestructura, marketing o compromisos operativos.

## Hipótesis

1. La privacidad local y el control de las claves son motivos de compra, no solo preferencias técnicas.
2. La importación desde Pocket y exportación portable reducen la barrera de cambio.
3. Los usuarios aceptan configurar su propia clave de IA si el producto explica claramente qué datos salen del dispositivo.
4. El backup y la recuperación son decisivos para la confianza y deben medirse junto con la activación.

## Evidencia a recoger

- Entrevistas y pruebas de onboarding con consentimiento.
- Conversión de landing a instalación y activación.
- Tiempo hasta primer bookmark/documento y finalización del backup.
- Tasa de restore exitoso, tickets de pérdida de datos y abandono.
- Feedback cualitativo segmentado por usuario técnico/no técnico.

No almacenar contenido de vault ni datos personales innecesarios en los experimentos. La analítica debe ser opt-in, agregada y coherente con `docs/ROPA.md`.

## Criterio de decisión

Continuar solo si la retención, activación y feedback confirman la hipótesis sin aumentar el riesgo de privacidad, soporte o recuperación. Registrar cada decisión y su evidencia en un informe fechado; no convertir una muestra pequeña en una claim pública.
