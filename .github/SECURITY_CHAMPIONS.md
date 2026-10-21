# Security Champions Program — BookmarkForge

## Visión General

El programa Security Champions establece responsabilidad distribuida de seguridad
en cada equipo de desarrollo. Cada champion es el primer punto de contacto para
cuestiones de seguridad, revisa cambios críticos, y asegura que las mejores
prácticas de seguridad se integren en el ciclo de vida del desarrollo.

---

## Estructura del Programa

### Roles

| Rol | Responsabilidad | Designación |
|-----|-----------------|-------------|
| **Security Champion** | Revisa cambios de seguridad, mentoriza al equipo | 1 por equipo técnico |
| **Security Lead** | Coordina el programa, aprueba cambios críticos, gestiona el pipeline de seguridad | Mantenedor principal |
| **Security Auditor Externo** | Realiza penetration tests, revisión de código independiente | Contratado externamente |
| **CST (Certified Security Tester)** | Ejecuta el DAST semanal, revisa reportes | Asignado del equipo |

### Criterios de Designación

Un Security Champion debe cumplir al menos 3 de estos 5 criterios:
1. Haber completado el OWASP Secure Software Development Professional (SSP) o equivalente
2. Haber contribuido a 5+ PRs de seguridad en el último trimestre
3. Tener autorización para modificar `server/src/` o `src/utils/crypto-core.ts`
4. Haber participado en al menos un penetration test interno
5. Aprobar el examen interno de seguridad (`npm run check:security-internal` sin errores)

---

## Responsabilidades del Security Champion

### Pre-Commit
- [ ] Verificar que `npm run check:security-internal` pasa antes de push
- [ ] Verificar que `npm run check:server-log-ip-privacy` pasa
- [ ] Verificar que `npm run check:blindeo` pasa
- [ ] Revisar que no se introducen secrets en el código (`npm run check:secrets-in-commit`)
- [ ] Validar que los cambios en `server/src/` no rompen la configuración de seguridad

### Pull Request
- [ ] Aprobar o solicitar cambios en PRs que toquen:
  - `server/src/` (cualquier archivo)
  - `src/utils/crypto-core.ts` y archivos relacionados
  - `src/db/database.ts`
  - `scripts/csp-config.js`
  - `vite.config.ts` (cambios de seguridad)
  - `.github/workflows/*.yml` (cambios de pipeline)
  - `public/_headers`
  - `extension/manifest.json`
- [ ] Verificar que el CSP se actualiza correctamente con nuevos dominios
- [ ] Verificar que los headers de seguridad se mantienen consistentes

### Post-Commit
- [ ] Revisar los resultados de CodeQL y Semgrep en cada CI
- [ ] Investigar y remediar cualquier alerta de severidad High/Critical en 48h
- [ ] Participar en la revisión de DAST semanal
- [ ] Actualizar el `audit-anchors-baseline.json` si se añaden nuevas anclas

### Trimestral
- [ ] Participar en un penetration test externo
- [ ] Revisar el `AGENTS.md` y actualizarlo con nuevas vulnerabilidades descubiertas
- [ ] Realizar un threat model de los nuevos features
- [ ] Revisar la cadena de suministro (`npm audit`, dependabot, SLSA)

---

## Escala de Respuesta a Incidentes de Seguridad

### 🔴 Crítico (P0)
- **Tiempo de respuesta:** < 1 hora
- **Acción:** Aislar, parchear, comunicar
- **Ejemplo:** Secret expuesto en público, RCE en el servidor
- **Notificación:** Security Lead + todos los champions + email al equipo

### 🟠 Alto (P1)
- **Tiempo de respuesta:** < 4 horas
- **Acción:** Parchear, verificar impacto
- **Ejemplo:** XSS en el editor, bypass de autenticación
- **Notificación:** Security Lead + champion del área afectada

### 🟡 Medio (P2)
- **Tiempo de respuesta:** < 24 horas
- **Acción:** Planificar fix, incluir en siguiente sprint
- **Ejemplo:** CSP insuficiente, header missing
- **Notificación:** Security Champion del área

### 🟢 Bajo (P3)
- **Tiempo de respuesta:** < 1 semana
- **Acción:** Incluir en backlog de seguridad
- **Ejemplo:** Mejora de logging de seguridad, documentación
- **Notificación:** Documentar en el issue de seguridad

---

## Checklist de Seguridad por Tipo de Cambio

### Cambios en `server/src/`
```
- [ ] npm run check:security-internal pasa
- [ ] npm run check:workflows pasa
- [ ] npm run check:http-config pasa
- [ ] npm run check:compose-config pasa
- [ ] npm run check:docker-context pasa
- [ ] npm run check:repository-hygiene pasa
- [ ] No se introducen dependencias sin audit
- [ ] El CSP se actualiza si se añaden dominios nuevos
- [ ] Los headers de seguridad se mantienen
- [ ] No se hardcodean secrets o claves privadas
- [ ] rate limiting se mantiene o mejora
- [ ] Los timeouts se mantienen o mejoran
- [ ] La validación de input se refuerza
```

### Cambios en `vite.config.ts` o `scripts/csp-config.js`
```
- [ ] npm run check:csp pasa
- [ ] El CSP_MODERATE refleja la política de producción
- [ ] El CSP_OPEN no tiene permisos excesivos
- [ ] Los dominios en connect-src son necesarios
- [ ] El report-uri está configurado
- [ ] COEP/COOP se mantienen
```

### Cambios en `public/_headers`
```
- [ ] HSTS presente con max-age >= 31536000
- [ ] CSP presente y consistente con csp-config.js
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] Permissions-Policy restrictiva
- [ ] COEP: require-corp
- [ ] COOP: same-origin
- [ ] Report-To / Reporting-Endpoints configurados
```

### Cambios en `extension/manifest.json`
```
- [ ] permissions mínimas necesarias
- [ ] CSP presente y restrictivo
- [ ] content_security_policy válido para Manifest V3
- [ ] incognito: split configurado
- [ ] Sin host_permissions innecesarios
```

### Cambios en `package.json`
```
- [ ] npm audit --omit=dev sin vulnerabilidades High/Critical
- [ ] Dependabot configurado y funcionando
- [ ] Los overrides mantienen versiones seguras
- [ ] No se añaden dependencias sin justificación
- [ ] El supply chain se revisa (SLSA, provenance)
```

---

## Métricas del Programa

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Tiempo medio de remediación P0 | < 1h | Desde detección hasta fix desplegado |
| Tiempo medio de remediación P1 | < 4h | Desde detección hasta fix desplegado |
| Vulnerabilidades High/Critical abiertas | 0 en producción | `npm run check:security-internal` |
| Penetration tests anuales | >= 2 | Programados y ejecutados |
| Cobertura de security gates en CI | 100% | `check:security-internal` como gate obligatorio |
| Champions activos | >= 1 por equipo | Registro en este documento |
| False positives en DAST | < 5% | Revisión trimestral |

---

## Reconocimiento

Los Security Champions reciben:
- Reconocimiento en los release notes
- Prioridad en la selección de features de seguridad
- Bonificación en la evaluación de rendimiento
- Acceso a herramientas de seguridad premium
- Participación en conferencias de seguridad financiada por la empresa

---

## Revisión y Mejora Continua

Este documento se revisa trimestralmente o después de cualquier incidente de seguridad significativo. Los cambios se proponen mediante PR y se discuten en la reunión de seguridad semanal.

Última actualización: Septiembre 2026
Próxima revisión: Diciembre 2026
