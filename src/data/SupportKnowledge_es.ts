/**
 * BookmarkForge v1.0.0 ULTRA Support Knowledge Base - Spanish Version
 */

export const SUPPORT_KNOWLEDGE_ES = {
  GENERAL: {
    APP_NAME: "BookmarkForge",
    VERSION: "1.0.0 Estable",
    BUILD_DATE: "Mayo 2026",
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
      "Sincronización Peer-to-Peer. Los datos se envían directamente entre tus dispositivos (ej. Laptop a Móvil) sin tocar un servidor central.",
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
      'Lista virtualizada que maneja 100,000+ elementos sin retraso. Incluye "Búsqueda Profunda" que busca en el texto completo de páginas guardadas. Soporta "Colecciones Inteligentes" que se auto-organizan por etiqueta.',
    FLASHCARDS:
      'Usa un algoritmo modificado tipo Anki de Repetición Espaciada (SRK). Rastrea tu "curva de olvido" para mostrarte tarjetas en el momento perfecto. Soporta oclusión de imágenes y eliminación de texto.',
    GRAPH_VIEW:
      'Visualización interactiva 3D/2D. Puedes filtrar por etiquetas, fecha o "Fuerza de Conexión". Visualiza similitudes semánticas entre notas no relacionadas.',
    VOICE_COMMANDS:
      'Motor de Voz a Acción. Puedes decir "Oye BMF, encuentra mis notas de Biología" o "Guarda esta página". Funciona 100% sin conexión mediante la Web Speech API.',
    OMNIBAR:
      "Ctrl+K. El cerebro de la aplicación. Puede hacer matemáticas, convertir unidades, buscar marcadores y abrir notas simultáneamente. Escribe '>' para comandos del sistema.",
  },

  AI_CONFIGURATION_PRO: {
    CLOUD_VS_LOCAL:
      "La nube (Gemini/OpenAI) es más rápida e inteligente pero requiere internet. Local (Ollama/WebLLM) es 100% privado y funciona sin conexión.",
    PRIVACY_SHIELD_DETAILS:
      'Nuestro "Privacy Shield" usa Regex y NLP para eliminar PII (Información de Identificación Personal) antes de que salga de tu máquina. Incluso si usas IA en la nube, tus secretos están seguros.',
    MODEL_SELECTION:
      "Para uso local, recomendamos Llama 3.2 (3B) para tareas generales o Qwen 2.5 para soporte multilingüe. Para la nube, Gemini 1.5 Pro es la mejor opción.",
    QUANTIZATION:
      "Usamos cuantización de 4 bits (q4f16) para ejecutar modelos grandes en hardware modesto sin perder mucha precisión.",
    TOKEN_OPTIMIZATION:
      "BookmarkForge usa una arquitectura híbrida con un caché semántico local (Voy + Transformers.js). Si haces preguntas similares, la app usa 0 tokens y 0 llamadas API al recuperar la respuesta exacta del caché local. También enruta dinámicamente las solicitudes al modelo óptimo para ahorrar costos.",
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
      "1. Asegúrate de que ambos dispositivos estén en la misma red Wi-Fi. 2. Verifica que el Firewall no esté bloqueando WebRTC. 3. Confirma que los IDs de sincronización coincidan. 4. Reinicia la Sala de Sincronización si es necesario.",
    AI_HALLUCINATIONS:
      'La IA puede equivocarse a veces. Usa los enlaces de "Fuentes" en el Chat para verificar. Ajusta la "Temperatura" en Configuración de IA para respuestas más creativas o factuales.',
    EXTENSION_NOT_SAVING:
      "1. Actualiza la página que intentas guardar. 2. Asegúrate de haber iniciado sesión en BookmarkForge en otra pestaña. 3. Reinstala el bookmarklet.",
    PERFORMANCE_JANK:
      'Si la app se siente lenta, ve a Configuración > Avanzado y ejecuta "Optimización de Base de Datos". También revisa Diagnóstico del Sistema para uso de CPU. La virtualización maneja listas, pero las notas pesadas pueden afectar la RAM.',
    DB_CORRUPTION:
      'Extremadamente raro. Usa "Diagnóstico del Sistema" para verificar la integridad de la BD. Si está corrupta, restaura desde tu última copia de seguridad .bmf.',
  },

  FAQ_EXTENDED: {
    "¿Es gratis?":
      "La aplicación principal es local-first y gratuita. Las funciones avanzadas de IA o sincronización P2P requieren una Licencia Pro v1.0.0.",
    "¿Puedo usarlo en el móvil?":
      "¡Sí! Instálalo como PWA (Progressive Web App) mediante Chrome (Android) o Safari (iOS). Soporta acceso sin conexión y notificaciones push.",
    "¿Dónde están mis archivos?":
      "Dentro del almacenamiento interno del navegador (IndexedDB). No son archivos en tu escritorio, pero puedes exportarlos como .bmf, Markdown o PDF en cualquier momento.",
    "¿Funciona sin internet?":
      "100%. Todas las funciones (Editor, Marcadores, Grafo, IA Local, Búsqueda) funcionan sin conexión a internet.",
    "¿Consume muchos tokens de API?":
      "No. La app usa un algoritmo de Caché Semántico Local. Si haces variaciones de la misma pregunta, usa 0 tokens de API y te ahorra dinero automáticamente.",
    "¿Cómo comparto una nota?":
      "Abre la nota, haz clic en 'Compartir' y genera un enlace P2P cifrado y seguro, o exporta como PDF.",
    "¿Cuántos datos puede almacenar?":
      "Limitado solo por el almacenamiento de tu navegador (generalmente 50% del espacio libre del disco). Puede manejar 100,000+ elementos fácilmente.",
    "¿Puedo importar desde Notion/Evernote?":
      "¡Sí! Usa Configuración > Importar y selecciona tu exportación HTML/JSON. También soportamos importación estándar de marcadores de Chrome.",
  },

  TUTORIALS_QUICK_START: {
    "Configuración en 2 min":
      "1. Establece una Contraseña Maestra. 2. Arrastra 'Guardar en Forge' a la barra de marcadores. 3. Crea tu primera Nota usando '/'. 4. Haz respaldo a .bmf.",
    "Dominando la Búsqueda":
      "Presiona Ctrl+K. Escribe cualquier concepto. Usa '?' para preguntar directamente a la IA sobre tus documentos.",
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
      "Ofrecemos una garantía de devolución de 30 días si la aplicación no cumple tus expectativas.",
    PRO_FEATURES:
      "Sincronización P2P, IA Local Ilimitada y Análisis Avanzados son funciones Pro.",
  },
};
