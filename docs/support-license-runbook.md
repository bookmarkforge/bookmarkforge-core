# Runbook de soporte — licencias

1. Solicitar únicamente ID de pedido, correo de compra y `instanceId`; nunca contraseña, frase ni contenido del vault.
2. Consultar el estado firmado en el servidor y comprobar si la licencia está activa, revocada o caducada.
3. Reintentar activación con conectividad HTTPS y reloj correcto; no registrar tokens completos.
4. Si la firma es inválida o el proveedor no responde, escalar al operador y mantener el producto en modo Free.
5. Para reembolso o chargeback, seguir `support-data-loss-runbook.md` y las políticas del proveedor.

Registrar fecha, resultado y referencia del ticket. La resolución debe ser reproducible sin acceder a datos locales del usuario.
