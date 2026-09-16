# DECISIÓN DE PRECIOS — BookmarkForge v1

**Estado: APROBADO Y CONGELADO** · Fecha: 2026-09-14 · Autoridad: el propietario del producto

---

## 1. La decisión

BookmarkForge se vende con **licencia lifetime versionada, sin suscripciones**.
Estos son los precios finales y oficiales del lanzamiento:

| Tier | Precio | Nota |
|---|---|---|
| **Free** | **$0** | Para siempre. 1.000 bookmarks, 1 dispositivo. Sin caducidad. |
| **Pro Early Bird** | **$59** | Solo los primeros **200** compradores. `priceValidUntil: 2026-12-31`. |
| **Pro Regular v1** | **$79** | El precio oficial de v1 tras agotar Early Bird (6-12 meses). |
| **Founder** | **$99** | Limitado a **100**. Idéntico a Pro en código + badge + beta v2 + 60% off de por vida en futuras majors. |
| **v2.0 (futuro, 12-18 meses)** | **$89 nuevos / $35 owners v1** | 60% off grabado en los términos legales. Así nace la recurrencia sin suscripción. |
| **v3.0 (futuro)** | **$99 nuevos / $39 owners** | Mismo patrón. |

## 2. Por qué estos números (el razonamiento que se congeló con ellos)

- **$59 early bird:** lo bastante bajo para impulso de lanzamiento, lo bastante alto para no devaluar el cifrado + local AI. FOMO real con 200 unidades.
- **$79 regular:** ancla por debajo del psicológico $100. Equivale a 2 años de Raindrop o 1,3 años de Instapaper — "paga una vez vs $96-120/año" es el mensaje. Es el precio que se defiende ante la competencia verificada en 2026.
- **$99 Founder:** misma cosa por más dinero = margen 100% del extra; el badge y la beta son gratis de producir. Cap 100 = escasez honesta.
- **v2 a 60% off:** recurrencia sin suscripción. 1.000 compradores de v1 a $79 → $79k año 1; si el 30% actualiza a v2 a $35 → +$10.5k sin adquirir un solo cliente nuevo.
- **Se descartó:** $49 (devalúa el producto), suscripción mensual (traiciona a la audiencia local-first, compite contra Raindrop $3/mes y pierde), Starter/Team tiers (parálisis de elección con 0 datos de segmentación).

## 3. Fases de precio y sus gatillos

| Fase | Pro | Founder | Cuándo se activa |
|---|---|---|---|
| **Early** (activa) | $59 | $99 | Lanzamiento → agotar 200 unidades o 2026-12-31 |
| **Regular** (siguiente) | $79 | $99 | Al agotar Early Bird. Cambiar `earlyBird.phase: "regular"` en `src/constants/pricing.ts` |
| **Full** (opcional) | $99 | $129 | Solo tras 500+ reviews positivas y datos; decisión manual, no automática |

**Procedimiento de cambio de fase** (10 min): editar `earlyBird.phase` en `src/constants/pricing.ts` → regenerar OG pricing (`og-image-pricing`) → actualizar las landings si el copy cambia → commit + deploy. El flag está diseñado para ser un one-line change.

## 4. Lo que esto NO es (para no reabrir el debate)

- **No es una suscripción.** Nada caduca. La frase legal ancla está en la landing, en `privacy-and-terms` y en el JSON-LD.
- **No es "lifetime del usuario".** Es **lifetime de la versión mayor** — texto legal: *"Lifetime license for BookmarkForge v1. Includes all v1.x updates and 12 months of feature updates. Security updates forever. Future major versions (v2, v3) 60% off for existing owners. 30-day refund via Whop."*
- **No se añaden tiers** hasta 300-500 ventas con datos reales (Family, AI Plus, etc. — todo eso es post-tracción).

## 5. Registro de cambios de precio

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-09-14 | Decisión inicial congelada: Free $0 / Pro $59→$79 / Founder $99 / v2 $89/$35 | Lanzamiento v1 |
| 2026-09-16 | El Core público pasa a MIT; los componentes Pro permanecen propietarios | Decisión Open Core (ver §6) |

## 6. Decisión de licencia del repo público — CERRADA

**Estado: APROBADA Y CONGELADA** · Fecha: 2026-09-14 · Revisable solo junto con una revisión completa de precios (regla de las 50 ventas, §4).

**Decisión:** el repositorio público Open Core se publica bajo **MIT**. El checkout privado puede contener componentes Pro propietarios, pero el exportador los elimina y escribe un manifiesto con `license: "MIT"`. La marca (nombre, logo y dominios) queda fuera de la concesión MIT mediante `NOTICE` + `TRADEMARKS.md` en la exportación pública.

**Por qué MIT para el Core y licencia propietaria para Pro:**

- **Adopción del Core:** MIT reduce fricción para usuarios, forks y contribuciones al núcleo.
- **Separación comercial explícita:** las funciones Pro se distribuyen fuera de la exportación pública bajo `PRO-LICENSE.md`.
- **Protección de marca:** el nombre y el logo se reservan mediante `TRADEMARKS.md`; una licencia de software no sustituye el registro de marca.
- **Control operativo:** el exportador y `check:open-core` fallan si vuelve a aparecer un archivo Pro en el árbol público.

**Artefactos de esta decisión (vía `scripts/export-public-repo.mjs`):**

- `LICENSE` — texto MIT del Core.
- `NOTICE` — copyright, alcance del Core y reserva expresa de la marca.
- `TRADEMARKS.md` — política de marca: uso nominativo permitido y forks con nombre y logo propios.
- `manifest.json` — licencia y lista de componentes Pro excluidos.

**Pendiente del propietario (fuera del repo):** registro de la marca en OEPM (~150€, España) y EUIPO cuando haya ventas europeas — es el único bloqueo absoluto frente a forks que compitan usando nombre/logo.

---

*Cualquier cambio futuro de estos precios exige: (1) actualizar `src/constants/pricing.ts`, (2) regenerar landings + OG si aplica, (3) actualizar esta tabla de registro, (4) actualizar los términos legales si afecta al contrato lifetime.*
