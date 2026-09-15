# Checklist privada — violación de datos personales

## Primeras horas

- [ ] Abrir `BMF-INC-[AAAA]-[NNN]`.
- [ ] Registrar fecha, hora, zona horaria y fuente del primer indicio.
- [ ] Designar responsable del incidente y suplente.
- [ ] Preservar logs, configuraciones, mensajes del proveedor y hashes de evidencias.
- [ ] Contener sin destruir evidencias.
- [ ] Identificar sistemas, proveedores y categorías de datos potencialmente afectadas.
- [ ] Avisar al responsable de tratamiento interno y al DPO/asesor, si existe.

## Reloj de 72 horas

- [ ] Determinar cuándo el responsable tuvo conocimiento razonable.
- [ ] Calcular la fecha y hora límite.
- [ ] Si se trata de un encargado, registrar la hora en que avisó al responsable.
- [ ] Preparar una notificación inicial si los hechos aún no están completos.
- [ ] Si se supera el plazo, documentar el motivo exacto del retraso.

## Decisiones RGPD

- [ ] ¿Es una violación de datos personales?
- [ ] ¿Es improbable que exista riesgo para las personas?
- [ ] ¿Debe notificarse a la autoridad conforme al art. 33?
- [ ] ¿Es probable un alto riesgo que exige comunicar a usuarios conforme al art. 34?
- [ ] ¿El cifrado, la minimización o la revocación hacen improbable el riesgo?
- [ ] ¿La comunicación individual es posible y proporcionada?
- [ ] ¿Hay obligaciones contractuales adicionales con Whop, hosting u otros proveedores?

## Antes de enviar

- [ ] Revisar hechos, cifras y categorías de datos.
- [ ] No incluir secretos, credenciales, frases de recuperación ni detalles explotables.
- [ ] Confirmar entidad legal y autoridad competente.
- [ ] Aprobar `notificacion-art-33-autoridad.md`.
- [ ] Si procede, aprobar `notificacion-art-34-interesados.md`.
- [ ] Guardar copia final, fecha/hora de envío y acuse en el repositorio cifrado.
- [ ] Actualizar `legal/REGISTRO.md` solo con la referencia, no con datos personales completos.

## Después

- [ ] Enviar actualizaciones cuando se confirme información material.
- [ ] Revocar accesos temporales y rotar secretos.
- [ ] Completar análisis de causa raíz.
- [ ] Registrar medidas correctoras, responsables y fechas.
- [ ] Revisar contratos y DPAs del proveedor implicado.
- [ ] Conservar el expediente durante el plazo legal y de responsabilidad aplicable.
