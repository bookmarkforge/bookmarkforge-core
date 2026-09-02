# ADR-038: Comparación en tiempo constante de firmas HMAC en las cadenas de atestación

- **Estado:** aceptado (implementado; ancla `p3-constant-time-hmac`)
- **Fecha:** 2026-09-02

## Contexto

La auditoría del 2026-09-02 (`docs/audit-report-2026-09-02.md`, hallazgo M-1)
detectó una inconsistencia interna: la base de código dispone de una primitiva
de comparación en tiempo constante (`constantTimeCompare`,
`src/services/security-vault/compare.ts`) y la usa correctamente en
`SecurityVault` (verificación del plaintext y del share secret) y, del lado del
servidor Node, `timingSafeEqual` protege todos los secrets de signaling. Pero
las dos cadenas de atestación del cliente comparaban hex firmado con `===` /
`!==`:

1. `MutationGuard.verify` y `MutationGuard.detectTampering`
   (`src/services/security/MutationGuard.ts`).
2. `AttestationChain.verifyChain` — tanto la firma como el `prevHash`, que
   transporta el HMAC del entry anterior
   (`src/services/security/AttestationChain.ts`).

Una comparación de strings con cortocircuito filtra la longitud del prefijo
que coincide a cualquier atacante capaz de insertar firmas elegidas en el
almacenamiento (localStorage / SecureStorage cifrado) y observar el resultado
booleano de `verify` / `verifyChain` — el clásico oráculo de timing de
comparación de strings. El coste de la mitigación es despreciable frente al
coste de derivar la clave HMAC (Argon2id + importKey), y el código ya tenía la
primitiva exportada: era pura inconsistencia, no una limitación técnica.

## Decisión

1. **Toda comparación de digests secretos usa `constantTimeCompare`.** Se
   sustituyeron los 3 puntos de comparación (`MutationGuard.verify`,
   `MutationGuard.detectTampering`, `AttestationChain.verifyChain` — este
   último incluye el `prevHash` por transportar un HMAC secreto) por la
   primitiva compartida de `src/services/security-vault/compare.ts`. Nada
   cambia semánticamente para entradas legítimas: la primitiva es fail-closed
   para longitudes distintas (XOR de longitudes incluido en el acumulador).
2. **Regresión anclada:** `src/tests/security/p3-constant-time-hmac.regression.test.ts`
   combina (a) escaneo del código fuente sin comentarios (mismo método que
   `p2-secure-storage-prod-guard.regression.test.ts`) que rechaza cualquier
   `===`/`!==` sobre `.signature`/`.prevHash` y exige la llamada explícita a
   `constantTimeCompare` en los 3 puntos, con (b) un pin comportamental de la
   primitiva (igualdad, desigualdad en el último byte, desigualdad de
   longitud en ambos sentidos, vacíos). El ancla `p3-constant-time-hmac` está
   catalogada en `scripts/audit-anchors.mjs` + baseline: borrar el test es un
   cambio de nivel ADR y rompe `npm run check:audit-drift`.
3. **Perfil rápido honesto:** `scripts/test-fast.mjs` listaba
   `security/MutationGuard.test.ts` (extensión `.ts`) cuando el archivo real es
   `.tsx`; el `.filter(has)` lo descartaba en silencio y sus 12 tests nunca
   corrían en `test:fast`. Se corrigió el selector y se añadió
   `AttestationChain.test.tsx`, que no estaba en el perfil.
4. **AGENTS.md sin cifras frágiles:** la mención "bounded Vitest suites
   (62 files)" se vuelve descriptiva — el conteo real ya había derivado (63
   archivos en la ejecución de la auditoría; +1 con el nuevo test de
   regresión y +2 selectores corregidos) y ningún gate lo respalda.

## Consecuencias

- Los oráculos de timing en las dos cadenas de atestación del cliente quedan
  cerrados y protegidos por regresión anclada; el surface de comparación de
  la app ahora es uniforme (SecurityVault, MutationGuard, AttestationChain,
  servidor Node).
- `test:fast` ejecuta los suites de MutationGuard y AttestationChain de
  verdad; su conteo de archivos sube y deja de estar documentado como número
  que puede derivar sin que nadie lo detecte.
- Cualquier compare futuro de material secreto debe añadirse al escaneo del
  test de regresión o crear un ancla propia; usar `===` sobre un digest vuelve
  a ser un fallo de CI, no una opinión de revisión.
- Queda pendiente (fuera de alcance aquí, registrado en el informe de
  auditoría): los 24 locales restantes con `syst_perfMismatchDesc` en inglés
  y el verificador de contraseña sin salt del caché de sesión (M-2).
