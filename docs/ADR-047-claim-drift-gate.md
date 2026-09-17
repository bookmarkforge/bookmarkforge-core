# ADR-047: Gate de drift de claims factuales (`check:claim-drift`)

- **Estado:** Aceptada (2026-09-15)
- **Fecha:** 2026-09-15
- **Relacionadas:** [ADR-028 — gate drift detection](adr-028-gate-drift-detection.md), [ADR-019 — Argon2id](adr-019-argon2id-migration.md)

## Contexto

Los strings visibles por el usuario derivaron repetidamente del comportamiento real del código, y cada caso se detectó solo por auditoría manual:

- copy que prometía una "frase seed de **12 palabras**" cuando `RecoveryService` genera frases de **24 palabras** (bip39, 256 bits);
- "mínimo **8 caracteres**" cuando `SECURITY_CONFIG.MIN_PASSWORD_LENGTH` es **12**;
- PBKDF2 anunciado en copy de usuario mientras la bóveda usa **Argon2id V4** (ADR-019);
- garantía de devolución de **14 días** en la base de conocimiento de soporte cuando `PRICING_CONFIG.lifetimeVersioned.refundDays` es **30**.

Es exactamente la clase de fallo que ADR-028 define como *gate drift*: el producto promete algo que el código no cumple. El riesgo de negocio es directo — un usuario que pierde datos por seguir una instrucción falsa pide reembolso y publica reseña negativa.

El gate `npm run check:claim-drift` (`scripts/check-claim-drift.mjs`, integrado en la cadena `check` después de `check:i18n` y como step propio de CI) extrae la verdad de las constantes reales del código — `src/constants/config.ts`, `src/constants/pricing.ts`, `src/utils/argon2-kdf.ts` (perfiles desktop/móvil), `src/services/BackupService.ts` (intervalo de auto-backup), `src/components/StorageStatus.tsx` (antigüedad de backup caducado) — y escanea la superficie visible por el usuario (30 locales, landings HTML, base de conocimiento de soporte) buscando números que la contradigan.

## Decisión

Se implementa un gate automatizado que:

1. **Fail-closed:** si una constante no se puede localizar (refactor que la renombró), el gate FALLA con mensaje explícito en vez de pasar en silencio.
2. **Veredictos por tier:** un claim numérico es válido si coincide con CUALQUIER tier de `pricing.ts`, así añadir un tier no rompe claims verdaderos.
3. **Multilingüe por construcción:** sustantivos de unidad en los 30 idiomas (word/word-count, devices, MiB, hours/hora/horas/Stunden…), con cualificadores Unicode (lookarounds, no `\b`, que no funciona con "über/älter").
4. **Fail-closed del canal de verdad:** la extracción devuelve `null` cuando no puede leer una fuente; los tests congelan los valores reales (12, 24, 30, {0,3}, free=0, {1000}, {64,128}, 24 h, 48 h).
5. **Doble ancla por claim sensible (free-device-count, free-bookmark-cap):** las reglas que protegen el posicionamiento de Free usan veredicto por escalar (`freeDeviceCap` = `maxDevices` del tier `free`, `freeBookmarkCap` = `maxBookmarks` del tier `free`; no sets) con contexto multilingüe ("free/gratis/gratuit/kostenlos/…", claves `app_freeTier*`) y anti-contexto ("pro/unlock/founder/…"): una línea que nombra Free PERO depende de los tiers de pago no se trata como copy de Free. `free-bookmark-cap` añade la rama "unlimited" multilingüe: en copy Free, "unlimited bookmarks" es drift SIEMPRE, con o sin número.

El gate cumple los dos criterios del mecanismo de ADR-028: el fallo concreto es una divergencia entre promesa y código, y la verdad tiene una única fuente versionada.

## Consecuencias

- Cubre claims numéricos factuales (contraseñas, palabras de recuperación, dispositivos, bookmarks, MiB, horas, precios, reembolsos) y la mención prohibida de PBKDF2 en copy de usuario. Los claims de dispositivos en copy de Free tienen además una regla dedicada anclada al escalar del tier free.
- No cubre claims cualitativos ("el más seguro"), ni copy que describe comportamiento no constante. Esos siguen siendo responsabilidad de revisión manual y de la auditoría de soporte.
- Los archivos del export público ejecutan el mismo gate (el exporter lo corre dentro del árbol exportado y `ci.yml` lo lleva al repo público), de modo que el árbol open-source también queda protegido.
- El test de congelación (`scripts/__tests__/check-claim-drift.test.mjs`) falla si alguien cambia una constante sin actualizar copy, o el copy sin actualizar constantes.