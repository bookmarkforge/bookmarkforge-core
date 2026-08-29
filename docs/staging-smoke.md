# Smoke post-deploy de staging y rollback

## Smoke tests

El workflow `.github/workflows/staging-smoke.yml` se ejecuta manualmente después de desplegar staging o puede invocarse desde otro workflow mediante `workflow_call`.

Entradas obligatorias:

- `staging_url`: URL HTTPS del staging recién desplegado.
- `image_tag`: tag o SHA de las imágenes desplegadas, para trazabilidad.

El workflow rechaza explícitamente dominios de producción y no ejecuta despliegues ni rollback.

Ejecuta:

1. Validación de URL y tag.
2. `npm run production-smoke` contra staging.
3. Smoke Playwright de inicialización y accesibilidad.
4. Subida de reportes, traces, screenshots y vídeos si existen.

## Integración post-deploy

Desde un pipeline de staging se puede invocar el workflow reutilizable:

```yaml
jobs:
  staging-smoke:
    uses: ORG/REPO/.github/workflows/staging-smoke.yml@main
    with:
      staging_url: https://app.staging.example.com
      image_tag: ${{ github.sha }}
```

Sustituye `ORG/REPO` y configura permisos de Actions según la organización.

## Rollback manual

Si falla el smoke:

1. Congela nuevos despliegues.
2. Conserva el reporte del workflow y el SHA desplegado.
3. Selecciona el último tag `prod-*` validado.
4. Ejecuta el procedimiento aprobado en un entorno controlado:

```bash
node scripts/rollback.mjs --auto --verify
```

5. Confirma `/health`, smoke funcional y logs.
6. Documenta causa raíz, impacto, duración y decisión.

El workflow sólo muestra instrucciones: **no hace rollback automático**, no usa `:latest` y no modifica producción. El operador debe tener autorización explícita antes de ejecutar cualquier rollback productivo.
