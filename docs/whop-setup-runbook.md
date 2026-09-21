# Runbook de configuración de Whop

1. Crear la cuenta merchant con la identidad legal real y aceptar el acuerdo aplicable.
2. Crear el producto Pro y configurar precio, moneda, impuestos y política de reembolso.
3. Configurar el webhook o adaptador aprobado con HTTPS, autenticación y validación de firma.
4. Guardar `WHOP_API_KEY` solo en el gestor de secretos; probar rotación y revocación.
5. Ejecutar una compra de prueba, activar en una instalación limpia, verificar entitlement, reembolsar y comprobar que cae a Free.
6. Registrar referencias de la prueba en el expediente privado.

El repositorio contiene contratos y mocks; no demuestra por sí solo que la cuenta, los webhooks o los permisos reales estén configurados.
