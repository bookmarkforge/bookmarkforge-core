# Referencia rápida del operador

## Antes de publicar

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test:fast
npm run build:ci
npm run check:security-internal
npm run check
npm run check:launch-checklist:strict
```

No publicar si hay fallos, secretos detectados o si el entorno real no tiene sus variables obligatorias. `npm run check:chunks` puede omitir `dist/` solo en el aggregate local; `npm run build:ci` debe verificar la build real.

## Recuperación

1. Comprobar `/health` y logs redactados.
2. Contener o revertir la imagen etiquetada por commit.
3. Ejecutar `npm run drill:backup-restore` y conservar la evidencia.
4. Para datos de usuario, remitir a `docs/support-data-loss-runbook.md`: el soporte nunca pide contraseñas ni frases de recuperación.

## Comandos útiles

- `npm run server`: companion local.
- `npm run e2e:smoke`: rutas críticas con navegador.
- `npm run e2e:sync`: sincronización WebRTC con señalización local.
- `npm run check:webrtc-certification`: matriz de compatibilidad y evidencia.
- `npm run check:docs-index`: inventario documental.
