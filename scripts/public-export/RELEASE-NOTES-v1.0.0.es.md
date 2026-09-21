# BookmarkForge v1.0.0 — Notas de la versión

*Primera versión estable del repositorio público. Este repo distribuye el **Core con licencia MIT**; las funciones Pro son propietarias y, por diseño, no forman parte de esta exportación.*

BookmarkForge es un vault de conocimiento personal local-first para tus
marcadores y tus lecturas: todo vive cifrado en tu navegador, funciona sin
conexión y se sincroniza entre pares — sin cuentas, sin rastreo, y nadie puede
leer tus datos. Ni siquiera nosotros.

---

## El Core (MIT) — lo que incluye esta versión

Todo lo siguiente funciona en esta compilación pública tal cual se publica:

- **Marcadores y lectura** — gestión completa: añadir, editar, etiquetar,
  organizar, buscar, archivar; importación desde Pocket, exportaciones del
  navegador (HTML), CSV y más, conservando fechas y etiquetas.
- **Notas de texto enriquecido** — editor por bloques (BlockNote) asociado a
  cualquier elemento.
- **Grafo de conocimiento** — mapa visual de tu biblioteca (D3), con vistas de
  calendario, Kanban y galería.
- **Búsqueda inteligente — incluida gratis** — búsqueda difusa instantánea
  (Fuse.js) más búsqueda semántica sobre embeddings que se ejecutan en tu
  navegador. Sin suscripción.
- **Vault de seguridad** — cifrado AES-GCM con clave derivada por Argon2id,
  frase de recuperación de 24 palabras, detección de manipulación y
  almacenamiento fail-closed. Tus datos son tuyos en el sentido más fuerte:
  no podríamos entregarlos ni queriendo.
- **Importación / exportación** — formatos abiertos en ambos sentidos (JSON,
  CSV, HTML); sin encadenarte a la plataforma.
- **30 idiomas** — interfaz y documentación completas (ver `docs/index.md`).
- **PWA + extensión de navegador** — instalable, funciona offline, captura
  rápida desde cualquier página.
- **Plan Free** — hasta 1.000 elementos, con todas las funciones del Core.
  Gratis para siempre.

## Lo que añade Pro (propietario — no está en este repositorio)

Pro es una capa independiente de código cerrado. Su implementación se excluye
de la exportación pública, y esa exclusión la verifica la CI:

| Función | Qué hace |
|---|---|
| IA local (WebLLM) | LLM ejecutándose dentro de tu ordenador, sin pasar por la nube |
| Chat RAG | Respuestas fundamentadas en tu propia biblioteca |
| 30+ agentes expertos | Análisis especializados de tu vault con un clic |
| Flashcards | Tarjetas de estudio con repetición espaciada generadas desde tus marcadores |
| Sincronización P2P | Sincronización cifrada de extremo a extremo entre tus dispositivos |
| PDF + OCR | Leer, extraer e indexar documentos PDF |
| Backups cifrados | Copias locales automáticas, versionadas y cifradas |

**Precio** — pago único, sin suscripción: **$59 Early Bird** (primeras 200
licencias) → **$79 precio regular**. La licencia cubre la vida útil de la
versión v1: todos los arreglos de fallos y actualizaciones de seguridad de
v1.x para siempre, 12 meses de novedades de funciones, y v1 sigue funcionando
para siempre. Las versiones mayores futuras (v2, v3) son productos separados,
con 60% de descuento para quienes ya tienen v1. Reembolso de 30 días sin
preguntas. Compra en [bookmarkforge.com](https://bookmarkforge.com).

> **Nota honesta sobre esta compilación:** una licencia Pro **no** desbloquea
> funciones Pro dentro de este repositorio, porque el código Pro simplemente no
> está aquí. En un Core autoalojado, las superficies Pro se muestran como un
> estado claro de «Disponible en Pro» en lugar de fallar en silencio.

## Cómo está cableado Pro en esta compilación

- Los componentes del Core resuelven los servicios Pro a través del gate de
  entitlement `src/services/pro-access.ts` (MIT), que comprueba la licencia
  *antes* de pedir código Pro: un usuario Free nunca descarga lo que no puede
  usar.
- En el servidor, los servicios Pro resuelven a pares marcados como placeholder
  (`.d.ts` con la superficie de tipos + `.js` inerte) que nunca rompen tu build
  y avisan una sola vez:
  `[open-core] <module> is a Pro feature and is not included in this build`.
- La lista exacta de módulos propietarios es auditable en
  `scripts/pro-boundary.mjs`, y `npm run check:open-core` re-verifica la
  frontera de este repositorio en la CI de cada push.

## Autoalojamiento

**Requisitos:** Node.js ≥ 20.19.

```bash
git clone https://github.com/bookmarkforge/core.git
cd core
npm install
npm run dev        # la app en http://localhost:5173
```

Compilación de producción: `npm run build`, y sirve `dist/` desde cualquier
hosting estático — el vault funciona por completo en tu navegador.

**Servidor complementario (opcional)** — señalización para P2P, validación de
licencias y analítica opt-in:

```bash
npm run server     # escucha en :8787
```

**Docker** — se incluyen un `Dockerfile` multi-stage con digest fijado y un
`docker-compose.prod.yml` de producción.

**Trae tu propia clave:** los proveedores de IA en la nube (OpenAI, Gemini, …)
se configuran en Ajustes; tu clave queda dentro de tu vault y las llamadas van
directamente de tu navegador al proveedor. El relay de IA en servidor es una
función Pro.

Las variables de entorno y la API del servidor están documentadas en
[docs/architecture.md](docs/architecture.md) y
[docs/server-api-index.md](docs/server-api-index.md).

## Verificación

Esta versión la produce el pipeline de exportación automatizado: el árbol
público se materializa y, dentro de él, se ejecutan typecheck, build de
producción y la suite de gates en cada push — la frontera Open Core no puede
romperse en silencio.

## Licencia y marcas

- El Core se distribuye bajo la [licencia MIT](LICENSE).
- Los componentes Pro son propietarios (ver [NOTICE](NOTICE)).
- El nombre y el logotipo de BookmarkForge están protegidos según
  [TRADEMARKS.md](TRADEMARKS.md): los forks deben usar otro nombre, otro
  logotipo y otro dominio.

## Enlaces

- Sitio y licencias Pro: <https://bookmarkforge.com>
- Manuales de usuario en 30 idiomas: [docs/index.md](docs/index.md)
- Reportes de seguridad: [SECURITY.md](.github/SECURITY.md) (por favor, en
  privado)
