/**
 * BookmarkForge v1.0.0 ULTRA Support Knowledge Base - Spanish Version
 */

export const SUPPORT_KNOWLEDGE_ES = {
  GENERAL: {
    APP_NAME: "BookmarkForge",
    VERSION: "1.0.0",
    BUILD_DATE: "Noviembre 2026",
    PHILOSOPHY:
      "Privacidad total, rendimiento local-first e inteligencia humana aumentada con IA.",
    DATA_STORAGE:
      "100% Local-First. Tus datos viven en IndexedDB dentro de tu navegador (RxDB). NO tenemos acceso a tus datos, NO hay servidores rastreando tus clics, y NO hay base de datos en la nube guardando tus notas.",
  },

  GLOSSARY: {
    RAG: 'Generación Aumentada por Recuperación. Significa que la IA "lee" tus notas locales antes de responder, así conoce tu conocimiento específico.',
    EMBEDDINGS:
      'Representaciones matemáticas del texto que permiten a la IA encontrar "significado" en lugar de solo coincidir palabras.',
    P2P_SYNC:
      "Sincronización Peer-to-Peer. Tu contenido viaja cifrado directamente entre tus dispositivos (ej. Laptop a Móvil). Un servidor de señalización solo ayuda a los dispositivos a encontrarse — nunca ve tus datos.",
    VAULT:
      "El contenedor cifrado para tus datos más sensibles y configuración de IA.",
    WEBLLM:
      "Tecnología que ejecuta modelos completos de IA (como Llama 3) directamente en tu navegador usando tu tarjeta gráfica (WebGPU).",
    SPACED_REPETITION:
      "Técnica de aprendizaje que aumenta los intervalos entre revisiones de tarjetas de memoria para mejorar la retención a largo plazo.",
    ZERO_KNOWLEDGE:
      "Principio de seguridad donde nosotros (los desarrolladores) tenemos conocimiento cero de tus claves de cifrado o datos.",
  },

  CORE_FEATURES_ADVANCED: {
    EDITOR:
      'Editor basado en bloques. Soporta comandos /, arrastrar y soltar, LaTeX para matemáticas, diagramas Mermaid para gráficos, y resaltado de código para 50+ lenguajes. Incluye "AI Copilot" para ayuda en tiempo real.',
    BOOKMARKS:
      'Lista virtualizada diseñada para bibliotecas grandes — desplazamiento fluido con miles de elementos. Incluye "Búsqueda Profunda" en tu biblioteca. Soporta etiquetas, sugerencias de auto-etiquetado con IA y colecciones. (El plan Free tiene un límite de 500 marcadores; Pro es ilimitado.)',
    FLASHCARDS:
      'Usa un algoritmo modificado tipo Anki de Repetición Espaciada (SRK). Rastrea tu "curva de olvido" para mostrarte tarjetas en el momento perfecto.',
    GRAPH_VIEW:
      'Visualización interactiva 2D dirigida por fuerzas (SVG). Los nodos son tus notas y marcadores; las aristas conectan elementos que comparten etiquetas. Puedes filtrar por etiquetas o rango de fechas y exportar el grafo como PNG/SVG.',
    VOICE_COMMANDS:
      'Voz push-to-talk: el Dictado por Voz transcribe la voz en las notas y el Centro de Comandos de Voz ejecuta acciones. Usa la Web Speech API del navegador — Chrome/Edge la soportan y requiere conexión a internet; el soporte en Firefox es limitado.',
    OMNIBAR:
      "Ctrl+K. Búsqueda difusa en tus documentos y marcadores (títulos y resúmenes). Selecciona un resultado para abrirlo; los documentos también ofrecen copiar enlace y eliminar. `Ctrl+Shift+P` abre el mismo Omnibar.",
  },

  AI_CONFIGURATION_PRO: {
    CLOUD_VS_LOCAL:
      "La nube (Gemini/OpenAI) es más rápida e inteligente pero requiere internet. Local (Ollama/WebLLM) es 100% privado y funciona sin conexión.",
    PRIVACY_SHIELD_DETAILS:
      'No hay eliminación automática de PII — los proveedores en la nube reciben los prompts y el contexto del vault que la app envía. Para máxima privacidad usa el "Modo Privado" (icono de escudo en el Chat): restringe la IA a proveedores locales (Ollama/WebLLM) para que nada salga de tu dispositivo. Revisa lo que compartes con proveedores en la nube.',
    MODEL_SELECTION:
      "Para uso local, recomendamos modelos pequeños actuales vía Ollama (p. ej., Llama 3.2) o WebLLM para inferencia nativa en el navegador. Para la nube, cualquier proveedor compatible con OpenAI o de primera parte que el usuario configure con su propia clave funciona — no hay un modelo obligatorio único.",
    QUANTIZATION:
      "Usamos cuantización de 4 bits (q4f16) para ejecutar modelos grandes en hardware modesto sin perder mucha precisión.",
    TOKEN_OPTIMIZATION:
      "BookmarkForge incluye un caché semántico local (búsqueda vectorial Voy + embeddings locales). Las preguntas repetidas o muy similares pueden responderse desde la caché sin una nueva llamada API, lo que reduce el uso de tokens en proveedores en la nube.",
  },

  SECURITY_DEEP_DIVE: {
    MASTER_PASSWORD_POLICY:
      "Mínimo 12 caracteres. Recomendamos una frase de contraseña. La clave AES-GCM se deriva con Argon2id (versión 4), nuestro KDF único y obligatorio desde la auditoría de seguridad (ADR-019).",
    ENCRYPTION_DETAILS:
      "Usamos la API SubtleCrypto nativa del navegador. Las claves nunca se almacenan en texto plano; se derivan sobre la marcha y solo existen en memoria (RAM).",
    DATA_RECOVERY:
      'NO existe el enlace "Olvidé mi contraseña". Tu contraseña es la ÚNICA clave. Siempre guarda una copia de seguridad .bmf en un lugar seguro. No podemos ayudarte si la pierdes.',
    OFFLINE_VALIDATION:
      "La validación de la licencia ocurre localmente después de un handshake inicial. Sin rastreo constante.",
  },

  TROUBLESHOOTING_MASTER_LIST: {
    APP_NOT_LOADING:
      "1. Limpia la caché del navegador. 2. Actualiza Chrome/Edge a la última versión. 3. Verifica si tu disco está lleno. 4. Desactiva extensiones conflictivas (los bloqueadores de anuncios a veces bloquean IndexedDB).",
    SYNC_FAILING:
      "1. Los dispositivos NO necesitan la misma red — un servidor de señalización ayuda a los pares a encontrarse; solo el canal de datos cifrado es P2P. 2. Verifica que el Firewall no esté bloqueando WebRTC. 3. Confirma que ambos dispositivos muestren la misma Sala/ID de sincronización. 4. Vuelve a emparejar desde el panel de Colaboración si la sesión está obsoleta.",
    AI_HALLUCINATIONS:
      'La IA puede equivocarse a veces. Usa los enlaces de "Fuentes" en el Chat para verificar las respuestas contra tus propias notas. Si las respuestas siguen siendo poco fiables, prueba otro modelo en Configuración de IA o haz preguntas más específicas.',
    EXTENSION_NOT_SAVING:
      "1. Actualiza la página que intentas guardar y vuelve a hacer clic en la extensión o el bookmarklet — abre la página de captura de BookmarkForge. 2. No hay inicio de sesión con cuenta: confirma el guardado con tu contraseña maestra en esa página (o desbloquea la bóveda antes). 3. Usuarios autoalojados: verifica la URL de la instancia en las opciones de la extensión.",
    PERFORMANCE_JANK:
      'Si la app se siente lenta, ve a Configuración > Almacenamiento y ejecuta "Compactar Base de Datos". También revisa Diagnóstico del Sistema para el estado del almacenamiento y el navegador. La virtualización maneja listas, pero las notas pesadas pueden afectar la RAM.',
    DB_CORRUPTION:
      'Extremadamente raro. Usa "Diagnóstico del Sistema" para verificar el estado de tu almacenamiento y navegador (ejecuta una prueba real de IndexedDB). Si perdiste datos o no se pueden leer, restaura desde tu última copia de seguridad .bmf.',
  },

  FAQ_EXTENDED: {
    "¿Es gratis?":
      "Sí — el plan Free es gratuito para siempre con 500 marcadores, notas, documentos, búsqueda inteligente, grafo de conocimiento, exportación JSON/HTML y copias de seguridad .bmf cifradas. Pro es un pago único (sin suscripción) que desbloquea marcadores ilimitados, sincronización P2P en 5 dispositivos, IA local, chat RAG, tarjetas de memoria y exportación PDF/OCR. Al llegar al límite de 500 marcadores puedes seguir leyendo, buscando y exportando — solo se pausan los guardados nuevos.",
    "¿Puedo usarlo en el móvil?":
      "¡Sí! Instálalo como PWA (Progressive Web App) mediante Chrome (Android) o Safari (iOS). Soporta acceso sin conexión y notificaciones locales del navegador.",
    "¿Dónde están mis archivos?":
      "Dentro del almacenamiento interno del navegador (IndexedDB). No son archivos en tu escritorio, pero puedes exportarlos como .bmf, Markdown o PDF en cualquier momento.",
    "¿Funciona sin internet?":
      "Sí — el editor, marcadores, grafo, búsqueda, tarjetas de memoria e IA local (Ollama/WebLLM) funcionan sin internet. Los proveedores de IA en la nube y la búsqueda web necesitan conexión.",
    "¿Consume muchos tokens de API?":
      "El uso de IA en la nube depende del precio de tu proveedor. El caché semántico local puede responder preguntas repetidas o muy similares sin una nueva llamada API, lo que reduce el gasto de tokens. Los modelos locales (Ollama/WebLLM) no usan tokens de API.",
    "¿Cómo comparto una nota?":
      "Abre la nota, haz clic en 'Compartir' y genera un enlace. El enlace incrusta el contenido del documento — cualquiera que tenga la URL puede leerlo, así que compártelo solo con personas de confianza. También puedes exportar como PDF.",
    "¿Cuántos datos puede almacenar?":
      "Limitado por la cuota de almacenamiento de tu navegador — normalmente una parte importante de tu espacio libre en disco (depende del navegador). El plan Free tiene un límite de 500 marcadores; Pro es ilimitado dentro de esa cuota.",
    "¿Puedo importar desde Notion/Evernote?":
      "Desde Notion: sí — en Notion usa Configuración → Exportar → \"Markdown y CSV\", luego importa el ZIP en BookmarkForge (Ajustes → Importar). Las páginas se convierten en documentos y se conserva la estructura de carpetas. Desde Evernote: exporta tus notas como `.enex` (Evernote → Configuración → Exportar) e importa el archivo directamente — las notas se convierten en documentos con etiquetas y fechas (los adjuntos no se importan). BookmarkForge también importa exportaciones de marcadores JSON/CSV/HTML (Pocket, Raindrop, Omnivore), exportaciones de posts de Pinboard y copias de seguridad places.json de Firefox, vaults Markdown/Obsidian en ZIP y marcadores de Chrome.",
  },

  TUTORIALS_QUICK_START: {
    "Configuración en 2 min":
      "1. Establece una Contraseña Maestra. 2. Arrastra 'Guardar en Forge' a la barra de marcadores. 3. Crea tu primera Nota usando '/'. 4. Haz respaldo a .bmf.",
    "Dominando la Búsqueda":
      "Pulsa Ctrl+K y escribe cualquier concepto para buscar de forma difusa en tus documentos y marcadores. Para respuestas de IA sobre tus notas, abre la pestaña Chat.",
    "Convirtiéndote en Usuario Pro":
      "Usa Flashcards para memorizar tus notas. Usa la Vista de Grafo para ver cómo tus ideas se conectan a lo largo de los meses.",
  },

  COMPATIBILITY_MATRIX: {
    WINDOWS: "Chrome/Edge (Mejor), Firefox (Bueno).",
    MACOS: "Safari (Mejor para batería), Chrome (Mejor para IA).",
    LINUX: "Firefox (Soporte completo), Brave (Habilita WebGPU).",
    MOBILE: "iOS 16+ (PWA Safari), Android 12+ (PWA Chrome).",
    HARDWARE: "Se recomienda 8GB de RAM y una GPU básica para IA Local.",
  },

  GDPR_PRIVACY_COMPLIANCE: {
    COMPLIANCE:
      "BookmarkForge cumple con el RGPD por diseño. Como no recopilamos ni almacenamos tus datos en nuestros servidores, eres el único propietario y controlador de tu información.",
    DATA_PORTABILITY:
      "Puedes exportar todos tus datos en JSON (.bmf) o en formato legible Markdown/CSV en cualquier momento.",
    NO_TRACKING:
      "Sin Google Analytics, sin telemetría, sin píxeles de rastreo. 100% limpio.",
  },

  LICENSE_SUPPORT: {
    PAYMENT_PROCESSOR:
      "Todos los pagos son procesados de forma segura por nuestro proveedor de pagos. Nunca vemos la información de tu tarjeta de crédito.",
    REFUND_POLICY:
      "Los reembolsos los gestiona el proveedor de pagos donde compraste. Las compras directas en Whop tienen una ventana de reembolso de 30 días; los lifetime deals de AppSumo tienen una ventana de 60 días sin importar el motivo — solicítalo allí, no por email. Fuera de esas ventanas, los casos se revisan individualmente.",
    PRO_FEATURES:
      "Pro (pago único, lifetime de v1) incluye: marcadores ilimitados, sincronización P2P en hasta 5 dispositivos, IA local (WebLLM/Ollama), chat RAG con agentes expertos, tarjetas de memoria con repetición espaciada, exportación PDF + OCR, exportación avanzada (7 formatos: Notion, Obsidian, JSON, JSONL, CSV, Markdown, HTML) y sincronización de copias de seguridad en la nube a tu propio almacenamiento. Los reembolsos los procesa el proveedor de pagos — las compras directas en Whop tienen una ventana de 30 días, los deals de AppSumo una ventana de 60 días.",
  },
};
