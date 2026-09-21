# Plan de corrección de hallazgos

## P0 — antes de producción

- Mantener el checkout y la documentación crítica íntegros.
- Obtener verde en typecheck, lint, tests, build, seguridad y gates documentales.
- Ejecutar restore completo y validar el entorno real de secretos, backups y alertas.

## P1 — beta controlada

- Ejecutar pentest independiente sobre licencias, WebSocket, backup y telemetría.
- Completar revisión manual WCAG en teclado, lector de pantalla y contraste.
- Certificar Chrome, Firefox, Safari/iOS y Android con la matriz de WebRTC.

## P2 — mejora continua

- Repetir el drill de desastre con evidencia y revisar RPO/RTO.
- Revisar dependencias y configuración de proveedores trimestralmente.
- Convertir cada hallazgo cerrado en una prueba o gate reproducible.

Un hallazgo se cierra solo con evidencia, responsable, fecha y prueba de no regresión.
