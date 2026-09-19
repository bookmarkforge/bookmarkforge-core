# Plantilla — Confirmación con Whop (vendedor, impuestos, reembolsos)

**Uso:** borrador de preguntas para cerrar por escrito el papel de Whop en el cobro de la licencia Pro, antes de habilitar cobros reales. Se responde por soporte o correo y la evidencia se guarda en `legal/evidencias/` y `legal/proveedores/whop/`.

**Borrador sin datos reales.** No incluir credenciales, identificadores de cuenta ni capturas con datos de compradores.

## 1. Vendedor y merchant of record

- [ ] ¿Quién es la entidad legal que vende al cliente final y en qué jurisdicción está constituida?
- [ ] ¿Whop actúa como merchant of record o solo como procesador de pagos? Citar la cláusula exacta.
- [ ] ¿Qué entidad aparece en el estado de cuenta del comprador y qué nombre figura en la factura o recibo?
- [ ] ¿BookmarkForge consta como vendedor en algún flujo, o siempre figura Whop?

## 2. Impuestos y documentación

- [ ] ¿Quién determina, cobra y declara el IVA u otros impuestos indirectos?
- [ ] ¿Qué documentación fiscal se emite (recibo, factura, autofactura) y con qué datos fiscales del cliente?
- [ ] ¿Qué obligaciones fiscales quedan del lado de BookmarkForge como creador de la aplicación?
- [ ] ¿Cómo se tratan las ventas a consumidores y a empresas dentro y fuera de la Unión Europea?

## 3. Reembolsos, contracargos y payouts

- [ ] ¿Quién atiende las solicitudes de reembolso y bajo qué política y plazos (ventana, consumo, renovaciones)?
- [ ] ¿Cómo se gestionan los contracargos y quién asume el coste y la defensa?
- [ ] ¿En qué divisa y con qué calendario se pagan los payouts, y qué retenciones o comisiones se aplican?
- [ ] ¿Qué ocurre con las suscripciones canceladas, fallidas o con impagos?

## 4. Datos personales y privacidad

- [ ] ¿Qué categorías de datos de comprador recibe BookmarkForge y cuáles quedan solo en Whop?
- [ ] ¿Existe acuerdo de encargo de tratamiento o se considera responsable independiente? Pedir la lista de subprocesadores.
- [ ] ¿En qué regiones se almacenan los datos de compra y qué mecanismo cubre las transferencias fuera del EEE?
- [ ] ¿Se usan datos de compradores para fraude, marketing o entrenamiento de modelos, y con qué base jurídica?
- [ ] ¿Qué plazo de retención aplican a datos de compra y licencia?

## 5. Criterios de cierre

- [ ] Respuesta por escrito con referencia a términos y versión, guardada como evidencia.
- [ ] Fila `P-01` de `legal/REGISTRO.md` actualizada (estado, documento, evidencia, próxima revisión).
- [ ] Checklist de DPA completada si BookmarkForge transfiere datos al sistema de licencias.
- [ ] Nadie habilita cobros reales mientras el papel del vendedor y la facturación sigan sin confirmar.
