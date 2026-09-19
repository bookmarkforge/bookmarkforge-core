# Registro de actividades de tratamiento (ROPA)

## Responsable y alcance

El responsable del tratamiento debe completar los datos legales y de contacto en el entorno de negocio antes del lanzamiento. Este registro describe la arquitectura actual de BookmarkForge y sus límites técnicos.

## Datos tratados

- Datos de cuenta o licencia necesarios para activar planes de pago.
- Datos técnicos mínimos de seguridad y diagnóstico, con retención limitada.
- Eventos analíticos agregados únicamente después de consentimiento explícito.
- Contenido del vault: permanece localmente y no se envía al companion server como parte del funcionamiento normal.

## Finalidad y base legal

- Prestación del servicio y soporte: ejecución del contrato.
- Seguridad, prevención de abuso y disponibilidad: interés legítimo documentado.
- Analítica opcional y errores remotos: consentimiento, revocable desde la aplicación.

## Proveedores y transferencias

Los proveedores externos deben estar listados en el inventario contractual del responsable, con DPA y revisión de transferencias internacionales cuando aplique. Las claves de proveedores AI se almacenan en el vault del usuario y las llamadas se realizan desde el navegador según la configuración elegida.

## Retención y derechos

Los datos operativos se conservan solo durante el periodo necesario para seguridad, soporte y obligaciones legales. Las solicitudes de acceso, rectificación, supresión y oposición deben registrarse y atenderse mediante el canal de privacidad definido por el operador.

## Medidas técnicas

Cifrado local, control de acceso, rate limiting, CSP, SAST, auditoría de dependencias, backups controlados y procedimientos de respuesta ante incidentes. Este documento debe revisarse al cambiar proveedores, endpoints o categorías de datos.
