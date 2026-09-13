# ADR-042: Temas de usuario solo-CSS (D4)

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde `src/services/ThemeService.ts` y su suite adversarial)

## Contexto

La personalización visual era una superficie de riesgo sin decisión registrada:
un "tema de usuario" es, a efectos del navegador, CSS controlado por el
usuario (o por un import futuro) que se inyecta en el documento de la app —
el mismo documento que muestra el vault descifrado. Los vectores clásicos del
CSS como canal de ejecución/exfiltración (`@import` externo, `url()`,
`expression()`, `behavior:`, `-moz-binding`, esquemas `javascript:`) pueden
convertir un tema inocente en un canal de fuga: una petición de red con datos
codificados en la URL es exfiltración silenciosa en una app local-first cuyo
CSP de producción es la única línea defensiva restante. La decisión "D4" de la
serie ADR-042 fija el modelo de temas como **CSS-only con sanitización
fail-closed**.

## Decisión

1. **Un tema es CSS puro, nada más.** El modelo de datos es exclusivamente una
   hoja de estilos: no hay JS, no hay HTML, no hay URLs externas. Cualquier
   construct que pueda cargar un recurso externo o ejecutar código queda
   fuera del lenguaje permitido por diseño, no por filtrado de salida.
2. **Sanitización fail-closed (`sanitizeThemeCss`).** El servicio rechaza el
   tema completo si encuentra cualquiera de los constructos prohibidos:
   `@import`, `url(`, `expression(`, `behavior:`, `javascript:`,
   `-moz-binding`. La normalización previa (`normalizeCssForSafety`) neutraliza
   las evasiones sintácticas que el navegador trataría como equivalentes:
   comentarios (`u/**/rl(`), escapes hexadecimales CSS (`u\72 l(`), escapes de
   identificador, y descarta escapes hacia puntos de código inválidos
   (NUL, > 0x10FFFF, sustitutos). Sin tema válido no hay aplicación: la
   denegación es la respuesta por defecto.
3. **Límite de volumen.** Máximo **64 KB** de CSS por tema: acota el coste de
   hasheo/parsing y elimina la clase "tema de 50 MB" como vector de
   degradación del hilo de UI.
4. **Inyección por `textContent`, nunca `innerHTML`.** El tema se aplica en un
   `<style id="bookmarkforge-user-theme" data-bookmarkforge-theme="user">`
   dedicado, creado una sola vez y reutilizado, vía `textContent` — el escape
   a marcado es estructuralmente imposible, no una regla de estilo de código.
5. **Persistencia local y re-sanitizada.** El CSS se guarda en localStorage
   (`forge_user_theme_css`) solo tras pasar el sanitizador, y `load()`
   **re-sanitiza al leer**: un tema envenenado por manipulación externa del
   storage (devtools, otra pestaña) no revive — falla como `null` y no se
   aplica. Opt-in y 100 % local: no hay sincronización de temas.
6. **Cobertura adversarial anclada a la suite.** `ThemeService.test.ts`
   ejercita las evasiones conocidas (escapes CSS, obfuscación por comentarios,
   vectores legacy IE/Gecko, límite de volumen) y el ciclo completo
   aplicar/limpiar/persistir/cargar, incluido el caso de tema corrupto en
   storage.

## Consecuencias

- La superficie de personalización es inerte por construcción: el peor caso
  de un tema malicioso es un CSS inválido que no se aplica — nunca una
  petición de red, nunca ejecución de código.
- Reglas nuevas (p. ej. permitir `url(#fragment)` interno, data-URIs) son
  cambios a nivel ADR: cada permiso nuevo reabre un canal de exfiltración en
  una app cuyo presupuesto de confianza es cero por diseño.
- El `<style>` dedicado hace trivial el razonamiento de cascada (un nodo, una
  identidad, borrado = estado limpio) y evita filtrar el tema por el DOM de
  componentes.
- Numeración: la serie ADR-042 sigue siendo prosa implícita excepto esta
  decisión D4, ahora formalizada. ADR-042 no pertenece al catálogo de anclas
  (`scripts/audit-anchors.mjs`); su protección es la suite unitaria
  adversarial existente en `src/tests/services/ThemeService.test.ts`.
