# Operaciones y continuidad

## SLOs

- Disponibilidad objetivo del companion server: **99.9% mensual**.
- Healthcheck `/health`: p95 menor de 500 ms bajo carga normal.
- Señalización WebSocket: p95 de relay menor de 1 s bajo carga normal.

## RPO y RTO

- **RPO:** 24 horas para respaldos operativos configurados; el vault local depende de la exportación del usuario.
- **RTO:** 2 horas para restaurar el companion server y su configuración desde imágenes y secretos respaldados.
- Los datos primarios del vault permanecen localmente en el dispositivo del usuario; el servidor no almacena contenido del vault.

## Backups y restauración

Los drills de backup/restore se ejecutan con `npm run drill:backup-restore`. Cada ejecución debe conservar evidencia de duración, resultado y cualquier desviación del RTO. Las claves de licencia y secretos de despliegue se restauran desde el gestor de secretos, nunca desde el repositorio.

## Incidentes

1. Confirmar el incidente mediante `/health`, logs y métricas administrativas autenticadas.
2. Contener: limitar tráfico, aislar el servicio afectado o activar rollback.
3. Preservar logs y artefactos sin incluir contenido de vault ni credenciales.
4. Restaurar desde la última imagen verificada y ejecutar smoke checks.
5. Registrar causa raíz, impacto, RPO/RTO observado y acciones preventivas.

## Releases y rollback

Todo release debe pasar typecheck, lint, tests, build, auditorías de seguridad y los checks de configuración. El rollback usa imágenes Docker etiquetadas por commit y no debe modificar datos del usuario.

## Push y tracking de ramas

`main` es la rama de integración y su upstream es `origin/main`. El tracking se fija una sola vez y sin depender de la red, porque la configuración vive en el repositorio local:

```bash
git config --local branch.main.remote origin
git config --local branch.main.merge refs/heads/main
```

Mientras el clon no tenga el ref remoto, `git status -sb` muestra `## main...origin/main [gone]`: el tracking está configurado, pero el contador de adelanto/retraso solo queda operativo cuando un fetch o un push autenticado materializa `origin/main`. Flujo de publicación:

```bash
git remote -v                  # confirmar el destino antes de nada
npm run check:ci               # typecheck:prod + lint + test:fast + build:ci + check
git ls-remote origin           # ensaya las credenciales sin publicar nada
git push -u origin main
gh run list --limit 10         # runs disparados por el push
```

Reglas operativas:

- **El destino está confirmado.** `bookmarkforge/core` es el repositorio real y las cuatro superficies lo nombran igual: `repository.url`, el remoto, los badges del README y las RELEASE-NOTES del export. `npm run check:release-target` sale 0 y la ruta de release puede prepararse (`node scripts/export-public-repo.mjs --dry-run` completa la planificación). Reintroducir un slug provisional, un propietario plantilla o una discrepancia declarado/real la vuelve a bloquear; el contrato está en `docs/ADR-058-release-target-confirmation-gate.md`.
- **Sin credenciales no hay push ni fetch.** El helper de git puede no tener credencial almacenada y el aviso resultante (`could not read Username`, `User cancelled dialog`) apunta a eso, no al repositorio: hay que autenticar antes con `gh auth login` y `gh auth setup-git`. Los secretos y variables que consumen los workflows, más la verificación previa completa, están en `docs/github-secrets-and-push-runbook.md`.
- **El primer push publica toda la historia local**, no un commit: conviene revisar antes `git log --oneline` y ejecutar `npm run check:secrets-in-commit`.
- Solo los workflows con disparador `push` reaccionan al envío (CI, SAST y el export público); los de cron y los manuales se lanzan aparte. Un workflow que no aparece tras el push se revisa según el runbook de push, no se asume correcto.
