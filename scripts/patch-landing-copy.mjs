/**
 * scripts/patch-landing-copy.mjs — one-shot landing copy migration.
 *
 * Rewrites all 6 landing translations (scripts/translations/*.json):
 *   - hero: plain-words headline/subtitle/pillars (no crypto jargon),
 *     naming Raindrop and the pay-once difference
 *   - new t.raindropCompare block, inserted right after pocketAlternative
 *   - features / ai / privacy: de-jargoned, Pro-gating kept explicit,
 *     BYO-key cloud AI disclosed as cloud
 *   - title/description/og/twitter meta rewritten to the new pitch
 *   - structuredData.featureList: "Semantic search" -> "Smart search"
 *
 * Spanish is authored natively first; the other locales are adapted to
 * their existing register (fr=vous, de=du, it=tu, pt=você formal).
 *
 * Gate-safety rules baked into the copy (audited below before writing):
 *   - competitor price is spelled out ("28 dollars"), never "$28" — the
 *     claim-drift prices rule whitelists our own prices only, and the
 *     competitor neutralizer is line-local (no competitor name -> no mask)
 *   - no "$"+digit at all in the new copy; no money-back/refund wording
 *   - bookmark caps read 2,500; device counts read 3; recovery = 24 words
 *   - no "$"-amount near "year" phrasing
 * Fails loudly and writes nothing on any violation.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TRANS_DIR = join(ROOT, "scripts", "translations");
const LANGS = ["en", "es", "fr", "de", "pt", "it"];

const FAILURES = [];
const fail = (msg) => FAILURES.push(msg);

// ---------------------------------------------------------------------------
// Copy: hero (badge, title, subtitle, 4 pillars) per locale
// ---------------------------------------------------------------------------
const HERO = {
  en: {
    badge: "One-time payment · No subscription",
    title: 'Everything you save stays on your computer. <span class="accent-text">Everything.</span>',
    subtitle:
      "Raindrop keeps your bookmarks on its servers — and charges you every year. BookmarkForge keeps them on your computer, locked with a key only you have. No accounts. No monthly fees. No one reading over your shoulder.",
    pillars: [
      { strong: "Private", text: "your saved pages never leave your computer" },
      { strong: "Locked", text: "not even we can read them" },
      { strong: "Offline", text: "works on a plane, in a tunnel, wherever" },
      { strong: "Pay once", text: "59 dollars once, not 28 dollars every year" },
    ],
  },
  es: {
    badge: "Pago único · Sin suscripción",
    title: 'Todo lo que guardas se queda en tu ordenador. <span class="accent-text">Todo.</span>',
    subtitle:
      "Raindrop guarda tus marcadores en sus servidores — y te cobra cada año. BookmarkForge los guarda en tu ordenador, cerrados con una llave que solo tienes tú. Sin cuentas. Sin cuotas mensuales. Y sin nadie mirando por encima de tu hombro.",
    pillars: [
      { strong: "Privado", text: "tus páginas guardadas nunca salen de tu ordenador" },
      { strong: "Cerrado", text: "ni siquiera nosotros podemos leerlas" },
      { strong: "Sin conexión", text: "funciona en un avión, en un túnel, donde sea" },
      { strong: "Paga una vez", text: "59 dólares una vez, no 28 dólares cada año" },
    ],
  },
  fr: {
    badge: "Paiement unique · Sans abonnement",
    title: 'Tout ce que vous enregistrez reste sur votre ordinateur. <span class="accent-text">Tout.</span>',
    subtitle:
      "Raindrop garde vos favoris sur ses serveurs — et vous facture chaque année. BookmarkForge les garde sur votre ordinateur, verrouillés avec une clé que vous seul possédez. Sans comptes. Sans frais mensuels. Et personne par-dessus votre épaule.",
    pillars: [
      { strong: "Privé", text: "vos pages enregistrées ne quittent jamais votre ordinateur" },
      { strong: "Verrouillé", text: "même pas nous pouvons les lire" },
      { strong: "Hors ligne", text: "fonctionne en avion, dans un tunnel, où que vous soyez" },
      { strong: "Payez une fois", text: "59 dollars une fois, pas 28 dollars chaque année" },
    ],
  },
  de: {
    badge: "Einmal zahlen · Kein Abo",
    title: 'Alles, was du speicherst, bleibt auf deinem Computer. <span class="accent-text">Alles.</span>',
    subtitle:
      "Raindrop legt deine Lesezeichen auf seinen Servern ab — und kassiert jedes Jahr. BookmarkForge bewahrt sie auf deinem Computer auf, mit einem Schlüssel gesperrt, den nur du hast. Keine Konten. Keine Monatsgebühren. Und niemand schaut dir über die Schulter.",
    pillars: [
      { strong: "Privat", text: "deine gespeicherten Seiten verlassen deinen Computer nie" },
      { strong: "Gesperrt", text: "nicht mal wir können sie lesen" },
      { strong: "Offline", text: "funktioniert im Flugzeug, im Tunnel, wo auch immer" },
      { strong: "Einmal zahlen", text: "59 Dollar einmalig, nicht 28 Dollar jedes Jahr" },
    ],
  },
  pt: {
    badge: "Pagamento único · Sem subscrição",
    title: 'Tudo o que guarda fica no seu computador. <span class="accent-text">Tudo.</span>',
    subtitle:
      "O Raindrop guarda os seus marcadores nos servidores dele — e cobra-lhe todos os anos. O BookmarkForge guarda-os no seu computador, fechados com uma chave que só você tem. Sem contas. Sem mensalidades. E sem ninguém a ler por cima do seu ombro.",
    pillars: [
      { strong: "Privado", text: "as suas páginas guardadas nunca saem do seu computador" },
      { strong: "Fechado", text: "nem nós as conseguimos ler" },
      { strong: "Offline", text: "funciona num avião, num túnel, onde for" },
      { strong: "Pague uma vez", text: "59 dólares uma vez, não 28 dólares todos os anos" },
    ],
  },
  it: {
    badge: "Pagamento unico · Senza abbonamento",
    title: 'Tutto ciò che salvi resta sul tuo computer. <span class="accent-text">Tutto.</span>',
    subtitle:
      "Raindrop tiene i tuoi segnalibri sui suoi server — e ti fa pagare ogni anno. BookmarkForge li tiene sul tuo computer, bloccati con una chiave che possiedi solo tu. Senza account. Senza costi mensili. E senza nessuno che ti legge sulla spalla.",
    pillars: [
      { strong: "Privato", text: "le tue pagine salvate non lasciano mai il tuo computer" },
      { strong: "Bloccato", text: "nemmeno noi possiamo leggerle" },
      { strong: "Offline", text: "funziona in aereo, in un tunnel, ovunque tu sia" },
      { strong: "Paga una volta", text: "59 dollari una volta, non 28 dollari ogni anno" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Copy: new raindropCompare block per locale
// ---------------------------------------------------------------------------
const RC = {
  en: {
    id: "raindrop-compare",
    tag: "Plain words, no marketing",
    title: "BookmarkForge vs Raindrop, without the fine print",
    subtitle: "Raindrop is a good app. The big difference is where your stuff lives.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Where your list lives", us: "On your computer", them: "On their servers" },
      { topic: "Who can read what you save", us: "Nobody — locked with your key, not even us", them: "The company, and whoever demands it of them" },
      { topic: "Without internet", us: "Everything keeps working", them: "Only the basics" },
      { topic: "What you pay", us: "59 dollars once. Done.", them: "28 dollars every year, forever" },
      { topic: "If the company disappears (RIP Pocket)", us: "Nothing changes — it is already in your hands", them: "You export and start over" },
      { topic: "The AI assistant", us: "Runs inside your computer in private mode — nothing is sent anywhere", them: "Your reading goes off to the cloud to think" },
    ],
    ctaPrimary: "Try it free in 2 minutes — no account",
    ctaSecondary: "Full Pocket comparison",
    close: "Raindrop is simpler and free — if that is all you need, use it happily. But if you would rather keep your reading life in your own hands, BookmarkForge is built for exactly that.",
  },
  es: {
    id: "raindrop-compare",
    tag: "En palabras sencillas, sin marketing",
    title: "BookmarkForge frente a Raindrop, sin letra pequeña",
    subtitle: "Raindrop es una buena aplicación. La gran diferencia está en dónde vive lo tuyo.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Dónde vive tu lista", us: "En tu ordenador", them: "En sus servidores" },
      { topic: "Quién puede leer lo que guardas", us: "Nadie: va cerrado con tu llave, ni siquiera nosotros", them: "La empresa, y quien se lo exija" },
      { topic: "Sin internet", us: "Todo sigue funcionando", them: "Solo lo básico" },
      { topic: "Cuánto pagas", us: "59 dólares una vez. Y ya.", them: "28 dólares cada año, para siempre" },
      { topic: "Si la empresa desaparece (RIP Pocket)", us: "Nada cambia: ya está en tus manos", them: "Exportas y empiezas de cero" },
      { topic: "El asistente de IA", us: "Trabaja dentro de tu ordenador en el modo privado — nada viaja a ningún sitio", them: "Tu lectura se va a la nube a pensar" },
    ],
    ctaPrimary: "Pruébalo gratis en 2 minutos — sin cuenta",
    ctaSecondary: "Comparativa completa con Pocket",
    close: "Raindrop es más simple y gratis — si con eso te basta, úsalo feliz. Pero si prefieres llevar tu vida de lectura en tus propias manos, BookmarkForge está hecho justo para eso.",
  },
  fr: {
    id: "raindrop-compare",
    tag: "En mots simples, sans marketing",
    title: "BookmarkForge face à Raindrop, sans petites lignes",
    subtitle: "Raindrop est une bonne application. La grande différence, c'est où vivent vos données.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Où vit votre liste", us: "Sur votre ordinateur", them: "Sur leurs serveurs" },
      { topic: "Qui peut lire ce que vous enregistrez", us: "Personne : c'est verrouillé avec votre clé, même pas nous", them: "L'entreprise, et quiconque le lui impose" },
      { topic: "Sans internet", us: "Tout continue de fonctionner", them: "Seul le basique" },
      { topic: "Ce que vous payez", us: "59 dollars une fois. C'est tout.", them: "28 dollars chaque année, pour toujours" },
      { topic: "Si l'entreprise disparaît (RIP Pocket)", us: "Rien ne change : c'est déjà entre vos mains", them: "Vous exportez et vous repartez de zéro" },
      { topic: "L'assistant IA", us: "Il travaille dans votre ordinateur en mode privé — rien ne part nulle part", them: "Vos lectures partent réfléchir dans le cloud" },
    ],
    ctaPrimary: "Essayez gratuitement en 2 minutes — sans compte",
    ctaSecondary: "Comparaison complète avec Pocket",
    close: "Raindrop est plus simple et gratuit — si cela vous suffit, utilisez-le avec plaisir. Mais si vous préférez garder votre vie de lecture entre vos propres mains, BookmarkForge est fait exactement pour cela.",
  },
  de: {
    id: "raindrop-compare",
    tag: "In einfachen Worten, ohne Marketing",
    title: "BookmarkForge gegen Raindrop, ohne Kleingedrucktes",
    subtitle: "Raindrop ist eine gute App. Der große Unterschied: wo deine Sachen leben.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Wo deine Liste lebt", us: "Auf deinem Computer", them: "Auf ihren Servern" },
      { topic: "Wer lesen kann, was du speicherst", us: "Niemand — mit deinem Schlüssel gesperrt, nicht mal wir", them: "Die Firma, und wer es auch immer von ihr verlangt" },
      { topic: "Ohne Internet", us: "Alles funktioniert weiter", them: "Nur das Nötigste" },
      { topic: "Was du zahlst", us: "59 Dollar einmalig. Fertig.", them: "28 Dollar jedes Jahr, für immer" },
      { topic: "Wenn die Firma verschwindet (RIP Pocket)", us: "Nichts ändert sich — es ist längst in deinen Händen", them: "Du exportierst und fängst neu an" },
      { topic: "Der KI-Assistent", us: "Er arbeitet in deinem Computer im privaten Modus — nichts wird irgendwohin geschickt", them: "Deine Lesezeichen fahren in die Cloud zum Nachdenken" },
    ],
    ctaPrimary: "Kostenlos in 2 Minuten testen — ohne Konto",
    ctaSecondary: "Voller Pocket-Vergleich",
    close: "Raindrop ist einfacher und kostenlos — wenn dir das reicht, benutze es gern. Aber wenn du dein Leseleben lieber selbst in der Hand hast, ist BookmarkForge genau dafür gebaut.",
  },
  pt: {
    id: "raindrop-compare",
    tag: "Em palavras simples, sem marketing",
    title: "BookmarkForge contra o Raindrop, sem letras pequenas",
    subtitle: "O Raindrop é uma boa aplicação. A grande diferença está em onde vivem as suas coisas.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Onde vive a sua lista", us: "No seu computador", them: "Nos servidores deles" },
      { topic: "Quem pode ler o que guarda", us: "Ninguém — fechado com a sua chave, nem nós", them: "A empresa, e quem lho exigir" },
      { topic: "Sem internet", us: "Tudo continua a funcionar", them: "Só o básico" },
      { topic: "Quanto paga", us: "59 dólares uma vez. Já está.", them: "28 dólares todos os anos, para sempre" },
      { topic: "Se a empresa desaparecer (RIP Pocket)", us: "Nada muda — já está nas suas mãos", them: "Exporta e recomeça do zero" },
      { topic: "O assistente de IA", us: "Trabalha dentro do seu computador no modo privado — nada é enviado para lado nenhum", them: "As suas leituras vão pensar para a nuvem" },
    ],
    ctaPrimary: "Experimente grátis em 2 minutos — sem conta",
    ctaSecondary: "Comparação completa com o Pocket",
    close: "O Raindrop é mais simples e grátis — se lhe chega, use-o com gosto. Mas se prefere ter a sua vida de leitura nas suas próprias mãos, o BookmarkForge foi feito exactamente para isso.",
  },
  it: {
    id: "raindrop-compare",
    tag: "In parole semplici, senza marketing",
    title: "BookmarkForge contro Raindrop, senza lettera piccola",
    subtitle: "Raindrop è una buona applicazione. La grande differenza è dove vivono le tue cose.",
    columns: { us: "BookmarkForge", them: "Raindrop" },
    rows: [
      { topic: "Dove vive la tua lista", us: "Sul tuo computer", them: "Sui loro server" },
      { topic: "Chi può leggere ciò che salvi", us: "Nessuno — bloccato con la tua chiave, nemmeno noi", them: "L'azienda, e chi glielo impone" },
      { topic: "Senza internet", us: "Tutto continua a funzionare", them: "Solo l'essenziale" },
      { topic: "Quanto paghi", us: "59 dollari una volta. Fatto.", them: "28 dollari ogni anno, per sempre" },
      { topic: "Se l'azienda scompare (RIP Pocket)", us: "Nulla cambia — è già nelle tue mani", them: "Esporti e ricominci da zero" },
      { topic: "L'assistente IA", us: "Lavora dentro il tuo computer in modalità privata — nulla viene inviato da nessuna parte", them: "Le tue letture vanno a pensare nel cloud" },
    ],
    ctaPrimary: "Prova gratis in 2 minuti — senza account",
    ctaSecondary: "Confronto completo con Pocket",
    close: "Raindrop è più semplice e gratuito — se ti basta, usalo con piacere. Ma se preferisci tenere la tua vita di lettura nelle tue stesse mani, BookmarkForge è fatto esattamente per questo.",
  },
};

// ---------------------------------------------------------------------------
// Copy: nav link + meta (title/description shared by og/twitter) per locale
// ---------------------------------------------------------------------------
const NAV = {
  en: "Raindrop Comparison",
  es: "Comparación con Raindrop",
  fr: "Comparaison avec Raindrop",
  de: "Raindrop-Vergleich",
  pt: "Comparação com o Raindrop",
  it: "Confronto con Raindrop",
};

const META = {
  en: {
    title: "BookmarkForge — Everything stays on your computer. Pay once.",
    description:
      "Raindrop keeps your bookmarks on its servers. BookmarkForge keeps them on your computer — locked so not even we can read them. 59 dollars once. Free: 2,500 bookmarks.",
  },
  es: {
    title: "BookmarkForge — Todo se queda en tu ordenador. Paga una vez.",
    description:
      "Raindrop guarda tus marcadores en sus servidores y te cobra cada año. BookmarkForge los guarda en tu ordenador, cerrados para que ni siquiera nosotros podamos leerlos. 59 dólares una vez. Gratis: 2.500 marcadores.",
  },
  fr: {
    title: "BookmarkForge — Tout reste sur votre ordinateur. Payez une fois.",
    description:
      "Raindrop garde vos favoris sur ses serveurs et vous facture chaque année. BookmarkForge les garde sur votre ordinateur, verrouillés pour que même pas nous puissions les lire. 59 dollars une fois. Gratuit : 2 500 favoris.",
  },
  de: {
    title: "BookmarkForge — Alles bleibt auf deinem Computer. Einmal zahlen.",
    description:
      "Raindrop legt deine Lesezeichen auf seinen Servern und kassiert jedes Jahr. BookmarkForge bewahrt sie auf deinem Computer auf, gesperrt, sodass nicht mal wir sie lesen können. 59 Dollar einmalig. Kostenlos: 2.500 Lesezeichen.",
  },
  pt: {
    title: "BookmarkForge — Tudo fica no seu computador. Pague uma vez.",
    description:
      "O Raindrop guarda os seus marcadores nos servidores dele e cobra-lhe todos os anos. O BookmarkForge guarda-os no seu computador, fechados para que nem nós os consigamos ler. 59 dólares uma vez. Grátis: 2.500 marcadores.",
  },
  it: {
    title: "BookmarkForge — Tutto resta sul tuo computer. Paga una volta.",
    description:
      "Raindrop tiene i tuoi segnalibri sui suoi server e ti fa pagare ogni anno. BookmarkForge li tiene sul tuo computer, bloccati così nemmeno noi possiamo leggerli. 59 dollari una volta. Gratis: 2.500 segnalibri.",
  },
};

// ---------------------------------------------------------------------------
// Copy: de-jargoned features (9 items) per locale
// ---------------------------------------------------------------------------
const FEATURES = {
  en: {
    title: "Everything you need, in plain words",
    items: [
      { title: "Bookmarks & documents", text: "Save any page with one click. Write notes right next to it, in a clean, simple editor. Stays fast even with 100,000 saved items." },
      { title: "Smart search", text: "Find things by keyword or by meaning — even when you do not remember the exact words. Raindrop charges 28 dollars a year for this; here it is included free." },
      { title: "An AI that reads your library, inside your computer", text: "Ask questions about what you saved and get answers with the sources shown. Nothing is sent to the cloud, and it works without internet. Requires Pro." },
      { title: "Chat with your own library", text: "Ask anything about your bookmarks and notes and get cited answers. The private mode runs 100% on your machine. Requires Pro." },
      { title: "Sync between your own devices", text: "Your devices talk to each other directly — no server in the middle, and everything stays encrypted. Pair them by scanning a QR code. Up to 5 devices. Requires Pro." },
      { title: "Backups you own", text: "Automatic backups you can keep wherever you like — an external drive, a cloud folder, anywhere. Export everything to Markdown, JSON, CSV or PDF whenever you want. You hold the keys." },
      { title: "A map of your knowledge", text: "See how your notes and bookmarks connect. Filter by tags, dates and similarity, and zoom around an endless canvas." },
      { title: "Study cards that beat forgetting", text: "Turn any saved document into question cards that resurface right before you would forget them — the same scheduling idea as Anki. Requires Pro." },
      { title: "Private by default", text: "No accounts, no tracking, no ads. You are the customer, not the product. Usage sharing exists, it is optional and stays off until you turn it on." },
    ],
  },
  es: {
    title: "Todo lo que necesitas, sin palabras raras",
    items: [
      { title: "Marcadores y documentos", text: "Guarda cualquier página con un clic. Escribe notas justo al lado, en un editor limpio y sencillo. Sigue siendo rápido incluso con 100.000 elementos guardados." },
      { title: "Búsqueda inteligente", text: "Encuentra por palabra o por significado, aunque no recuerdes las palabras exactas. Raindrop cobra 28 dólares al año por esto; aquí va incluido gratis." },
      { title: "Una IA que lee tu biblioteca, dentro de tu ordenador", text: "Pregunta por lo que has guardado y recibe respuestas con sus fuentes a la vista. Nada se envía a la nube y funciona sin internet. Requiere Pro." },
      { title: "Charla con tu propia biblioteca", text: "Pregunta lo que quieras sobre tus marcadores y notas y recibe respuestas con citas. El modo privado funciona 100% en tu máquina. Requiere Pro." },
      { title: "Sincroniza entre tus propios dispositivos", text: "Tus dispositivos se hablan directamente — sin servidor en medio y con todo cifrado. Emparéjalos escaneando un código QR. Hasta 3 dispositivos. Requiere Pro." },
      { title: "Copias de seguridad que son tuyas", text: "Copias automáticas que puedes guardar donde quieras: un disco externo, una carpeta en la nube, lo que sea. Exporta todo a Markdown, JSON, CSV o PDF cuando quieras. Las llaves las tienes tú." },
      { title: "Mapa de tu conocimiento", text: "Mira cómo se conectan tus notas y tus marcadores. Filtra por etiquetas, fechas y parecido, y muévete por un lienzo infinito." },
      { title: "Tarjetas de estudio que vencen al olvido", text: "Convierte cualquier documento guardado en tarjetas de preguntas que reaparecen justo antes de que lo olvides — la misma idea de repaso que Anki. Requiere Pro." },
      { title: "Privado por defecto", text: "Sin cuentas, sin rastreo, sin anuncios. Eres el cliente, no el producto. Compartir estadísticas existe, es opcional y está apagado hasta que tú lo enciendas." },
    ],
  },
  fr: {
    title: "Tout ce qu'il vous faut, dit simplement",
    items: [
      { title: "Favoris et documents", text: "Enregistrez n'importe quelle page en un clic. Prenez des notes juste à côté, dans un éditeur propre et simple. Reste rapide même avec 100 000 éléments enregistrés." },
      { title: "Recherche intelligente", text: "Trouvez par mot-clé ou par sens, même sans vous souvenir des mots exacts. Raindrop fait payer 28 dollars par an pour cela ; ici, c'est inclus gratuitement." },
      { title: "Une IA qui lit votre bibliothèque, dans votre ordinateur", text: "Posez des questions sur ce que vous avez enregistré et obtenez des réponses avec leurs sources à l'appui. Rien n'est envoyé au cloud et cela fonctionne hors ligne. Nécessite Pro." },
      { title: "Discutez avec votre propre bibliothèque", text: "Demandez ce que vous voulez sur vos favoris et vos notes, avec des réponses citées. Le mode privé tourne à 100% sur votre machine. Nécessite Pro." },
      { title: "Synchronisez vos propres appareils", text: "Vos appareils se parlent directement — sans serveur au milieu, et tout reste chiffré. Associez-les en scannant un QR code. Jusqu'à 3 appareils. Nécessite Pro." },
      { title: "Des sauvegardes qui vous appartiennent", text: "Des sauvegardes automatiques à garder où vous voulez : un disque externe, un dossier cloud, peu importe. Exportez tout en Markdown, JSON, CSV ou PDF quand vous voulez. Vous détenez les clés." },
      { title: "La carte de vos connaissances", text: "Voyez comment vos notes et vos favoris se relient. Filtrez par tags, dates et ressemblance, et naviguez sur une toile infinie." },
      { title: "Des cartes de révision qui battent l'oubli", text: "Transformez n'importe quel document en cartes-question qui refont surface juste avant que vous n'oubliiez — la même idée de révision qu'Anki. Nécessite Pro." },
      { title: "Privé par défaut", text: "Sans comptes, sans pistage, sans publicité. Vous êtes le client, pas le produit. Le partage de statistiques existe, il est facultatif et désactivé tant que vous ne l'activez pas." },
    ],
  },
  de: {
    title: "Alles, was du brauchst, einfach gesagt",
    items: [
      { title: "Lesezeichen & Dokumente", text: "Speichere jede Seite mit einem Klick. Schreibe Notizen direkt daneben, in einem aufgeräumten, einfachen Editor. Bleibt schnell sogar bei 100.000 gespeicherten Einträgen." },
      { title: "Intelligente Suche", text: "Finde per Stichwort oder nach Bedeutung — selbst wenn du dir die genauen Worte nicht merkst. Dafür verlangt Raindrop 28 Dollar im Jahr; hier ist es gratis dabei." },
      { title: "Eine KI, die deine Bibliothek liest — in deinem Computer", text: "Frage, was du gespeichert hast, und bekomme Antworten samt Quellenangabe. Nichts geht in die Cloud, und es funktioniert offline. Erfordert Pro." },
      { title: "Rede mit deiner eigenen Bibliothek", text: "Frage alles zu deinen Lesezeichen und Notizen, mit Antworten und Belegen. Der private Modus läuft zu 100% auf deiner Maschine. Erfordert Pro." },
      { title: "Synchronisiere deine eigenen Geräte", text: "Deine Geräte sprechen direkt miteinander — ohne Server dazwischen, und alles bleibt verschlüsselt. Verbinde sie per QR-Code-Scan. Bis zu 3 Geräte. Erfordert Pro." },
      { title: "Backups, die dir gehören", text: "Automatische Backups, die du aufbewahren kannst, wo du willst — externe Platte, Cloud-Ordner, egal. Exportiere alles als Markdown, JSON, CSV oder PDF, wann immer du magst. Die Schlüssel hast du." },
      { title: "Die Karte deines Wissens", text: "Sieh, wie deine Notizen und Lesezeichen zusammenhängen. Filtere nach Tags, Daten und Ähnlichkeit und zoome über eine endlose Leinwand." },
      { title: "Lernkarten, die das Vergessen schlagen", text: "Verwandle jedes gespeicherte Dokument in Fragekarten, die auftauchen, kurz bevor du sie vergessen hättest — dieselbe Idee wie bei Anki. Erfordert Pro." },
      { title: "Privat von Grund auf", text: "Keine Konten, kein Tracking, keine Werbung. Du bist der Kunde, nicht das Produkt. Statistiken zu teilen gibt es, es ist freiwillig und bleibt aus, bis du es einschaltest." },
    ],
  },
  pt: {
    title: "Tudo o que precisa, dito de forma simples",
    items: [
      { title: "Marcadores e documentos", text: "Guarde qualquer página com um clique. Escreva notas ao lado, num editor limpo e simples. Continua rápido mesmo com 100.000 itens guardados." },
      { title: "Pesquisa inteligente", text: "Encontre por palavra ou por significado, mesmo sem se lembrar das palavras exatas. O Raindrop cobra 28 dólares por ano por isto; aqui vem incluído grátis." },
      { title: "Uma IA que lê a sua biblioteca, dentro do seu computador", text: "Pergunte sobre o que guardou e receba respostas com as fontes à vista. Nada é enviado para a nuvem e funciona offline. Requer Pro." },
      { title: "Converse com a sua própria biblioteca", text: "Pergunte o que quiser sobre os seus marcadores e notas, com respostas citadas. O modo privado funciona 100% na sua máquina. Requer Pro." },
      { title: "Sincronize os seus próprios dispositivos", text: "Os seus dispositivos falam diretamente entre si — sem servidor no meio e com tudo encriptado. Emparelhe-os ao ler um código QR. Até 3 dispositivos. Requer Pro." },
      { title: "Cópias de segurança que são suas", text: "Cópias automáticas que pode guardar onde quiser: um disco externo, uma pasta na nuvem, tanto faz. Exporte tudo para Markdown, JSON, CSV ou PDF quando quiser. As chaves são suas." },
      { title: "O mapa do seu conhecimento", text: "Veja como as suas notas e marcadores se ligam. Filtre por etiquetas, datas e semelhança, e navegue numa tela infinita." },
      { title: "Cartões de estudo que vencem o esquecimento", text: "Transforme qualquer documento guardado em cartões de perguntas que reaparecem mesmo antes de se esquecer — a mesma ideia de revisão do Anki. Requer Pro." },
      { title: "Privado por defeito", text: "Sem contas, sem rastreio, sem anúncios. É o cliente, não o produto. Partilhar estatísticas existe, é facultativo e está desligado até você o ligar." },
    ],
  },
  it: {
    title: "Tutto ciò che ti serve, detto semplice",
    items: [
      { title: "Segnalibri e documenti", text: "Salva qualsiasi pagina con un clic. Scrivi note proprio accanto, in un editor pulito e semplice. Resta veloce anche con 100.000 elementi salvati." },
      { title: "Ricerca intelligente", text: "Trova per parola chiave o per significato, anche senza ricordare le parole esatte. Raindrop fa pagare 28 dollari all'anno per questo; qui è incluso gratis." },
      { title: "Un'IA che legge la tua biblioteca, dentro il tuo computer", text: "Chiedi di ciò che hai salvato e ottieni risposte con le fonti sotto gli occhi. Niente viene inviato al cloud e funziona offline. Richiede Pro." },
      { title: "Parla con la tua stessa biblioteca", text: "Chiedi qualsiasi cosa sui tuoi segnalibri e note, con risposte citate. La modalità privata gira al 100% sulla tua macchina. Richiede Pro." },
      { title: "Sincronizza i tuoi stessi dispositivi", text: "I tuoi dispositivi si parlano direttamente — senza server in mezzo e tutto resta cifrato. Abbinali leggendo un codice QR. Fino a 3 dispositivi. Richiede Pro." },
      { title: "Backup che sono tuoi", text: "Backup automatici da tenere dove vuoi: un disco esterno, una cartella cloud, non importa. Esporta tutto in Markdown, JSON, CSV o PDF quando vuoi. Le chiavi le tieni tu." },
      { title: "La mappa della tua conoscenza", text: "Guarda come si collegano le tue note e i tuoi segnalibri. Filtra per tag, date e somiglianza e muoviti su una tela infinita." },
      { title: "Flashcard che battono l'oblio", text: "Trasforma ogni documento salvato in schede di domande che riemergono proprio prima che tu le dimentichi — la stessa idea di ripasso di Anki. Richiede Pro." },
      { title: "Privato per impostazione predefinita", text: "Senza account, senza tracciamento, senza pubblicità. Sei il cliente, non il prodotto. La condivisione di statistiche esiste, è facoltativa e resta spenta finché non la accendi." },
    ],
  },
};

// ---------------------------------------------------------------------------
// Copy: ai block (subtitle + 7 providers + 3 modes) per locale
// ---------------------------------------------------------------------------
const AI = {
  en: {
    subtitle:
      "Run the assistant inside your computer — nothing leaves it, and it works offline. Prefer a big cloud model? Connect your own key: your questions and the pages needed to answer them go to that provider, at your cost. Your prompts, your data, your rules.",
    providers: [
      { type: "local", name: "Inside your computer — WebLLM models (TinyLlama, Llama 3.2, Phi-3.5-mini) — Pro only" },
      { type: "local", name: "On your own machine — Ollama (any model you run)" },
      { type: "cloud", name: "Cloud — Google Gemini (key managed by us)" },
      { type: "cloud", name: "Cloud — OpenAI / GPT-4o (with your own key)" },
      { type: "cloud", name: "Cloud — Anthropic Claude (with your own key)" },
      { type: "cloud", name: "Cloud — Groq (with your own key)" },
      { type: "cloud", name: "Cloud — OpenRouter or another custom provider (with your own key)" },
    ],
    modes: [
      { title: "Private Mode", text: "The assistant runs entirely inside your computer. Nothing leaves it, and it needs no internet. Requires Pro." },
      { title: "Web Search Mode", text: "Combines your library with live results from the web (cloud providers)." },
      { title: "Expert Agents", text: "Specialized helpers: Coder, Writer, Analyst and Researcher. Requires Pro." },
    ],
  },
  es: {
    subtitle:
      "Ejecuta el asistente dentro de tu ordenador — nada sale de él y funciona sin conexión. ¿Prefieres un modelo grande de la nube? Conecta tu propia clave: tus preguntas y las páginas necesarias para responderlas viajan a ese proveedor, a tu costa. Tus preguntas, tus datos, tus reglas.",
    providers: [
      { type: "local", name: "Dentro de tu ordenador — modelos WebLLM (TinyLlama, Llama 3.2, Phi-3.5-mini) — Solo Pro" },
      { type: "local", name: "En tu propia máquina — Ollama (cualquier modelo que ejecutes)" },
      { type: "cloud", name: "En la nube — Google Gemini (clave gestionada por nosotros)" },
      { type: "cloud", name: "En la nube — OpenAI / GPT-4o (con tu propia clave)" },
      { type: "cloud", name: "En la nube — Anthropic Claude (con tu propia clave)" },
      { type: "cloud", name: "En la nube — Groq (con tu propia clave)" },
      { type: "cloud", name: "En la nube — OpenRouter u otro proveedor personalizado (con tu propia clave)" },
    ],
    modes: [
      { title: "Modo privado", text: "El asistente funciona por completo dentro de tu ordenador. Nada sale de él y no necesita internet. Requiere Pro." },
      { title: "Modo búsqueda web", text: "Combina tu biblioteca con resultados en vivo de la web (proveedores en la nube)." },
      { title: "Agentes expertos", text: "Ayudantes especializados: Programador, Escritor, Analista e Investigador. Requiere Pro." },
    ],
  },
  fr: {
    subtitle:
      "Faites tourner l'assistant dans votre ordinateur — rien n'en sort et il fonctionne hors ligne. Vous préférez un grand modèle du cloud ? Connectez votre propre clé : vos questions et les pages nécessaires pour y répondre partent chez ce fournisseur, à vos frais. Vos questions, vos données, vos règles.",
    providers: [
      { type: "local", name: "Dans votre ordinateur — modèles WebLLM (TinyLlama, Llama 3.2, Phi-3.5-mini) — Pro uniquement" },
      { type: "local", name: "Sur votre propre machine — Ollama (le modèle que vous exécutez)" },
      { type: "cloud", name: "Dans le cloud — Google Gemini (clé gérée par nous)" },
      { type: "cloud", name: "Dans le cloud — OpenAI / GPT-4o (avec votre propre clé)" },
      { type: "cloud", name: "Dans le cloud — Anthropic Claude (avec votre propre clé)" },
      { type: "cloud", name: "Dans le cloud — Groq (avec votre propre clé)" },
      { type: "cloud", name: "Dans le cloud — OpenRouter ou un fournisseur personnalisé (avec votre propre clé)" },
    ],
    modes: [
      { title: "Mode privé", text: "L'assistant fonctionne entièrement dans votre ordinateur. Rien n'en sort et il n'a pas besoin d'internet. Nécessite Pro." },
      { title: "Mode recherche web", text: "Combine votre bibliothèque avec des résultats en direct du web (fournisseurs cloud)." },
      { title: "Agents experts", text: "Des aides spécialisés : Codeur, Rédacteur, Analyste et Chercheur. Nécessite Pro." },
    ],
  },
  de: {
    subtitle:
      "Lass den Assistenten in deinem Computer arbeiten — nichts verlässt ihn, und er funktioniert offline. Lieber ein großes Cloud-Modell? Verbinde deinen eigenen Schlüssel: Deine Fragen und die Seiten, die zur Antwort nötig sind, gehen an diesen Anbieter, auf deine Kosten. Deine Fragen, deine Daten, deine Regeln.",
    providers: [
      { type: "local", name: "In deinem Computer — WebLLM-Modelle (TinyLlama, Llama 3.2, Phi-3.5-mini) — nur Pro" },
      { type: "local", name: "Auf deinem eigenen Rechner — Ollama (jedes Modell, das du startest)" },
      { type: "cloud", name: "In der Cloud — Google Gemini (Schlüssel liegt bei uns)" },
      { type: "cloud", name: "In der Cloud — OpenAI / GPT-4o (mit deinem eigenen Schlüssel)" },
      { type: "cloud", name: "In der Cloud — Anthropic Claude (mit deinem eigenen Schlüssel)" },
      { type: "cloud", name: "In der Cloud — Groq (mit deinem eigenen Schlüssel)" },
      { type: "cloud", name: "In der Cloud — OpenRouter oder ein eigener Anbieter (mit deinem eigenen Schlüssel)" },
    ],
    modes: [
      { title: "Privater Modus", text: "Der Assistent arbeitet komplett in deinem Computer. Nichts verlässt ihn, und er braucht kein Internet. Erfordert Pro." },
      { title: "Websuche-Modus", text: "Kombiniert deine Bibliothek mit Live-Ergebnissen aus dem Web (Cloud-Anbieter)." },
      { title: "Experten-Agenten", text: "Spezialisierte Helfer: Coder, Schreiber, Analyst und Forscher. Erfordert Pro." },
    ],
  },
  pt: {
    subtitle:
      "Execute o assistente dentro do seu computador — nada sai dele e funciona offline. Prefere um modelo grande na nuvem? Ligue a sua própria chave: as suas perguntas e as páginas necessárias para responder vão para esse fornecedor, à sua custa. As suas perguntas, os seus dados, as suas regras.",
    providers: [
      { type: "local", name: "Dentro do seu computador — modelos WebLLM (TinyLlama, Llama 3.2, Phi-3.5-mini) — Só Pro" },
      { type: "local", name: "Na sua própria máquina — Ollama (qualquer modelo que execute)" },
      { type: "cloud", name: "Na nuvem — Google Gemini (chave gerida por nós)" },
      { type: "cloud", name: "Na nuvem — OpenAI / GPT-4o (com a sua própria chave)" },
      { type: "cloud", name: "Na nuvem — Anthropic Claude (com a sua própria chave)" },
      { type: "cloud", name: "Na nuvem — Groq (com a sua própria chave)" },
      { type: "cloud", name: "Na nuvem — OpenRouter ou outro fornecedor personalizado (com a sua própria chave)" },
    ],
    modes: [
      { title: "Modo privado", text: "O assistente funciona por inteiro dentro do seu computador. Nada sai dele e não precisa de internet. Requer Pro." },
      { title: "Modo pesquisa web", text: "Combina a sua biblioteca com resultados em direto da web (fornecedores na nuvem)." },
      { title: "Agentes expertos", text: "Ajudantes especializados: Programador, Escritor, Analista e Investigador. Requer Pro." },
    ],
  },
  it: {
    subtitle:
      "Esegui l'assistente dentro il tuo computer — niente ne esce e funziona offline. Preferisci un modello grande nel cloud? Collega la tua chiave: le tue domande e le pagine necessarie per rispondere vanno a quel fornitore, a tue spese. Le tue domande, i tuoi dati, le tue regole.",
    providers: [
      { type: "local", name: "Dentro il tuo computer — modelli WebLLM (TinyLlama, Llama 3.2, Phi-3.5-mini) — Solo Pro" },
      { type: "local", name: "Sulla tua macchina — Ollama (qualsiasi modello che esegui)" },
      { type: "cloud", name: "Nel cloud — Google Gemini (chiave gestita da noi)" },
      { type: "cloud", name: "Nel cloud — OpenAI / GPT-4o (con la tua chiave)" },
      { type: "cloud", name: "Nel cloud — Anthropic Claude (con la tua chiave)" },
      { type: "cloud", name: "Nel cloud — Groq (con la tua chiave)" },
      { type: "cloud", name: "Nel cloud — OpenRouter o un fornitore personalizzato (con la tua chiave)" },
    ],
    modes: [
      { title: "Modalità privata", text: "L'assistente funziona interamente dentro il tuo computer. Niente ne esce e non ha bisogno di internet. Richiede Pro." },
      { title: "Modalità ricerca web", text: "Combina la tua biblioteca con risultati in diretta dal web (provider cloud)." },
      { title: "Agenti esperti", text: "Aiutanti specializzati: Programmatore, Scrittore, Analista e Ricercatore. Richiede Pro." },
    ],
  },
};

// ---------------------------------------------------------------------------
// Copy: privacy items (6) per locale
// ---------------------------------------------------------------------------
const PRIVACY = {
  en: [
    { title: "Locked so nobody can read it — not even us", text: "Your library is encrypted with a key derived from your master password. We never see your password or your content." },
    { title: "Stored on your own device", text: "Everything lives on your computer. The companion server only handles licensing, device pairing and relaying your cloud-mode AI questions — never your content." },
    { title: "No tracking by default", text: "No analytics, no crash reports, no tracking. Sharing usage stats or error reports is a separate choice, off by default." },
    { title: "You hold the keys", text: "No master password means no access — there is no \"forgot password\" backdoor. Your 24-word recovery phrase is the only way in; keep it safe." },
    { title: "Your rights, respected", text: "Access, correct, erase or take your data with you — all doable locally, whenever you want." },
    { title: "No lock-in", text: "Export your data anytime in open formats (JSON, Markdown, CSV, PDF). Your knowledge stays yours and portable." },
  ],
  es: [
    { title: "Cerrado para que nadie lo lea — ni siquiera nosotros", text: "Tu biblioteca se cifra con una llave derivada de tu contraseña maestra. Nunca vemos tu contraseña ni tu contenido." },
    { title: "Guardado en tu propio dispositivo", text: "Todo vive en tu ordenador. El servidor auxiliar solo gestiona licencias, el emparejamiento de dispositivos y retransmitir tus preguntas de IA en el modo nube — nunca tu contenido." },
    { title: "Sin rastreo por defecto", text: "Ni analíticas, ni informes de errores, ni rastreo. Compartir estadísticas de uso o informes de fallos es una opción aparte, apagada por defecto." },
    { title: "Las llaves las tienes tú", text: "Sin contraseña maestra no hay acceso — no existe la puerta trasera de «he olvidado la contraseña». Tu frase de recuperación de 24 palabras es la única llave; guárdala bien." },
    { title: "Tus derechos, respetados", text: "Consultar, corregir, borrar o llevarte tus datos — todo en local, cuando quieras." },
    { title: "Sin encierro", text: "Exporta tus datos cuando quieras en formatos abiertos (JSON, Markdown, CSV, PDF). Tu conocimiento sigue siendo tuyo y portable." },
  ],
  fr: [
    { title: "Verrouillé pour que personne ne le lise — même pas nous", text: "Votre bibliothèque est chiffrée avec une clé dérivée de votre mot de passe maître. Nous ne voyons jamais votre mot de passe ni votre contenu." },
    { title: "Stocké sur votre propre appareil", text: "Tout vit sur votre ordinateur. Le serveur compagnon ne gère que les licences, l'appariement des appareils et le relais de vos questions IA en mode cloud — jamais votre contenu." },
    { title: "Sans pistage par défaut", text: "Ni analytique, ni rapports d'erreur, ni pistage. Partager statistiques d'usage ou rapports d'erreur est un choix à part, désactivé par défaut." },
    { title: "Vous détenez les clés", text: "Sans mot de passe maître, pas d'accès — il n'existe pas de porte dérobée « mot de passe oublié ». Votre phrase de récupération de 24 mots est la seule clé ; gardez-la en sécurité." },
    { title: "Vos droits, respectés", text: "Consulter, corriger, effacer ou emporter vos données — tout en local, quand vous voulez." },
    { title: "Sans enfermement", text: "Exportez vos données à tout moment en formats ouverts (JSON, Markdown, CSV, PDF). Votre savoir reste vôtre et transportable." },
  ],
  de: [
    { title: "Gesperrt, damit niemand es liest — nicht mal wir", text: "Deine Bibliothek wird mit einem Schlüssel verschlüsselt, der aus deinem Master-Passwort abgeleitet wird. Wir sehen dein Passwort und deine Inhalte nie." },
    { title: "Gespeichert auf deinem eigenen Gerät", text: "Alles lebt auf deinem Computer. Der Begleitserver kümmert sich nur um Lizenzen, Geräte-Kopplung und das Weiterleiten deiner KI-Fragen im Cloud-Modus — nie um deine Inhalte." },
    { title: "Kein Tracking von Grund auf", text: "Keine Analysen, keine Fehlerberichte, kein Tracking. Statistiken oder Fehlerberichte zu teilen ist eine eigene Entscheidung und bleibt standardmäßig aus." },
    { title: "Du hältst die Schlüssel", text: "Ohne Master-Passwort kein Zugriff — es gibt keine „Passwort vergessen“-Hintertür. Deine 24-Wort-Wiederherstellungsphrase ist der einzige Schlüssel; bewahre sie gut auf." },
    { title: "Deine Rechte, respektiert", text: "Ansehen, korrigieren, löschen oder mitnehmen — alles lokal möglich, wann du willst." },
    { title: "Kein Einmauern", text: "Exportiere deine Daten jederzeit in offenen Formaten (JSON, Markdown, CSV, PDF). Dein Wissen bleibt deins und tragbar." },
  ],
  pt: [
    { title: "Fechado para que ninguém o leia — nem nós", text: "A sua biblioteca é encriptada com uma chave derivada da sua palavra-passe mestra. Nunca vemos a sua palavra-passe nem o seu conteúdo." },
    { title: "Guardado no seu próprio dispositivo", text: "Tudo vive no seu computador. O servidor companheiro só trata de licenças, do emparelhamento de dispositivos e de retransmitir as suas perguntas de IA no modo nuvem — nunca do seu conteúdo." },
    { title: "Sem rastreio por defeito", text: "Sem análises, sem relatórios de erros, sem rastreio. Partilhar estatísticas de utilização ou relatórios de erros é uma opção à parte, desligada por defeito." },
    { title: "As chaves são suas", text: "Sem palavra-passe mestra não há acesso — não existe a porta dos fundos de «esqueci-me da palavra-passe». A sua frase de recuperação de 24 palavras é a única chave; guarde-a bem." },
    { title: "Os seus direitos, respeitados", text: "Consultar, corrigir, apagar ou levar os seus dados — tudo em local, quando quiser." },
    { title: "Sem amarras", text: "Exporte os seus dados quando quiser em formatos abertos (JSON, Markdown, CSV, PDF). O seu conhecimento continua seu e portátil." },
  ],
  it: [
    { title: "Bloccato così nessuno può leggerlo — nemmeno noi", text: "La tua biblioteca è cifrata con una chiave derivata dalla tua password principale. Non vediamo mai la tua password né i tuoi contenuti." },
    { title: "Salvato sul tuo stesso dispositivo", text: "Tutto vive sul tuo computer. Il server compagno gestisce solo licenze, abbinamento dispositivi e l'inoltro delle tue domande IA in modalità cloud — mai i tuoi contenuti." },
    { title: "Nessun tracciamento per impostazione predefinita", text: "Niente analisi, niente segnalazioni di errori, niente tracciamento. Condividere statistiche o segnalazioni è una scelta a parte, spenta per impostazione predefinita." },
    { title: "Le chiavi le tieni tu", text: "Senza password principale non c'è accesso — non esiste la porta sul retro di «password dimenticata». La tua frase di recupero di 24 parole è l'unica chiave; custodiscila bene." },
    { title: "I tuoi diritti, rispettati", text: "Consultare, correggere, cancellare o portare via i tuoi dati — tutto in locale, quando vuoi." },
    { title: "Senza gabbia", text: "Esporta i tuoi dati quando vuoi in formati aperti (JSON, Markdown, CSV, PDF). La tua conoscenza resta tua e portatile." },
  ],
};

// ---------------------------------------------------------------------------
// Copy: free-tier plan (pricing.plans[0] description + first 3 features)
// ---------------------------------------------------------------------------
// Fixes three free-tier copy problems: (1) drops the unenforceable "1 device"
// fiction (there are no accounts; the real limit is per-device vaults, sync is
// the Pro feature), (2) leads with the smart-search wedge that undercuts
// Raindrop's paywall, (3) defines the at-2,500 experience honestly (the RxDB
// preInsert hook pauses new saves; reading, search and export continue).
const FREE_TIER = {
  en: {
    description: "Free forever: 2,500 bookmarks plus the smart search others charge yearly for. At 2,500 your vault stays whole — reading, search and export never stop; only new saves pause.",
    featureSearch: "Smart search (full-text + semantic) — included free; Raindrop charges yearly for this",
    featureCap: "2,500 bookmarks, notes, documents",
    featureDevices: "Works on any device — each keeps its own vault",
  },
  es: {
    description: "Gratis para siempre: 2.500 marcadores y la búsqueda inteligente que otros cobran cada año. Al llegar a 2.500 tu bóveda sigue entera: leer, buscar y exportar nunca se detienen; solo se pausan los guardados nuevos.",
    featureSearch: "Búsqueda inteligente (texto completo + semántica) — incluida gratis; Raindrop cobra cada año por esto",
    featureCap: "2.500 marcadores, notas y documentos",
    featureDevices: "Funciona en cualquier dispositivo — cada uno con su propia bóveda",
  },
  fr: {
    description: "Gratuit pour toujours : 2 500 favoris et la recherche intelligente que d'autres font payer chaque année. À 2 500, votre bibliothèque reste entière : lire, chercher et exporter ne s'arrêtent jamais ; seuls les nouveaux enregistrements pause.",
    featureSearch: "Recherche intelligente (texte intégral + sémantique) — incluse gratuitement ; Raindrop la fait payer chaque année",
    featureCap: "2 500 favoris, notes et documents",
    featureDevices: "Fonctionne sur n'importe quel appareil — chacun garde sa propre bibliothèque",
  },
  de: {
    description: "Für immer kostenlos: 2.500 Lesezeichen plus die intelligente Suche, für die andere jährlich verlangen. Bei 2.500 bleibt deine Bibliothek ganz — Lesen, Suchen und Exportieren enden nie; nur neue Speicherungen pausieren.",
    featureSearch: "Intelligente Suche (Volltext + semantisch) — gratis inklusive; Raindrop verlangt dafür jährlich Geld",
    featureCap: "2.500 Lesezeichen, Notizen und Dokumente",
    featureDevices: "Funktioniert auf jedem Gerät — jedes mit seinem eigenen Tresor",
  },
  pt: {
    description: "Grátis para sempre: 2.500 marcadores e a pesquisa inteligente pela qual outros cobram todos os anos. Ao chegar a 2.500, a sua biblioteca continua intacta — ler, pesquisar e exportar nunca param; só as novas gravações ficam em pausa.",
    featureSearch: "Pesquisa inteligente (texto integral + semântica) — incluída grátis; o Raindrop cobra todos os anos por isto",
    featureCap: "2.500 marcadores, notas e documentos",
    featureDevices: "Funciona em qualquer dispositivo — cada um com a sua própria biblioteca",
  },
  it: {
    description: "Gratis per sempre: 2.500 segnalibri e la ricerca intelligente che altri fanno pagare ogni anno. Arrivato a 2.500, la tua biblioteca resta intera — leggere, cercare ed esportare non si fermano mai; si mettono in pausa solo i nuovi salvataggi.",
    featureSearch: "Ricerca intelligente (testo completo + semantica) — inclusa gratis; Raindrop la fa pagare ogni anno",
    featureCap: "2.500 segnalibri, note e documenti",
    featureDevices: "Funziona su qualsiasi dispositivo — ognuno con la sua stessa biblioteca",
  },
};

// ---------------------------------------------------------------------------
// Audit helpers — mirror the repo copy gates so hostile strings never land
// ---------------------------------------------------------------------------
const MONEY_BACK_RE = /money[- ]back|reembolso|devoluci|garant|guarantee|rückerstatt|remboursement|rimbors/i;
const PRICE_RE = /\$\s?[\d]/;
const PRICE_YEAR_RE = /\$\s?\d[^.]{0,40}\b(year|yearly|annual)\b|\b(year|yearly|annual)\b[^.]{0,40}\$\s?\d/i;
const BOOKMARK_RE = /(\d{1,3}(?:[.,\s]\d{3})+|\d{3,})\s+(bookmarks?|marcadores?|Lesezeichen)\b/i;
const DEVICE_RE = /(\d+)[-\s]+(?:devices?|Geräte[ns]?|dispositiv\w*|dispositivos?|appareils?)/i;
const WORDS_RE = /(\d+)[\s-]+(?:words?|palabras?|mots?|Wörter|palavras?|parole)\b/i;
const VALID_BOOKMARKS = new Set([1000]);
const VALID_DEVICES = new Set([3]);
const VALID_WORDS = new Set([24]);

/**
 * Audit ONLY the strings this script writes — the untouched blocks (pricing,
 * faq, cta, footer) are already gate-green and contain legitimately
 * whitelisted $-prices, the 30-day refund line and tier-valid device counts.
 */
function newCopyStrings(lang) {
  const meta = META[lang];
  return [
    meta.title,
    meta.description,
    NAV[lang],
    HERO[lang].badge,
    HERO[lang].subtitle,
    ...HERO[lang].pillars.map((p) => `${p.strong} ${p.text}`),
    RC[lang].tag,
    RC[lang].title,
    RC[lang].subtitle,
    ...RC[lang].rows.flatMap((r) => [r.topic, r.us, r.them]),
    RC[lang].ctaPrimary,
    RC[lang].ctaSecondary,
    RC[lang].close,
    ...FEATURES[lang].items.map((f) => `${f.title} ${f.text}`),
    AI[lang].subtitle,
    ...AI[lang].providers.map((p) => p.name),
    ...AI[lang].modes.map((m) => `${m.title} ${m.text}`),
    ...PRIVACY[lang].map((p) => `${p.title} ${p.text}`),
    FREE_TIER[lang].description,
    FREE_TIER[lang].featureSearch,
    FREE_TIER[lang].featureDevices,
  ];
}

function auditAll() {
  const problems = [];
  for (const lang of LANGS) {
    for (const s of newCopyStrings(lang)) {
      if (MONEY_BACK_RE.test(s)) problems.push(`${lang}: money-back wording: "${s.slice(0, 70)}"`);
      if (PRICE_RE.test(s)) problems.push(`${lang}: "$"+digit in new copy: "${s.slice(0, 70)}"`);
      if (PRICE_YEAR_RE.test(s)) problems.push(`${lang}: $ near year: "${s.slice(0, 70)}"`);
      const bm = s.match(BOOKMARK_RE);
      if (bm && !VALID_BOOKMARKS.has(Number(bm[1].replace(/[.,\s]/g, "")))) {
        problems.push(`${lang}: bookmark cap "${bm[1]}" not 2,500`);
      }
      const dv = s.match(DEVICE_RE);
      if (dv && !VALID_DEVICES.has(Number(dv[1]))) problems.push(`${lang}: device count "${dv[1]}" not 3`);
      const w = s.match(WORDS_RE);
      if (w && !VALID_WORDS.has(Number(w[1]))) problems.push(`${lang}: word count "${w[1]}" not 24`);
    }
    const rc = RC[lang];
    if (!rc || rc.id !== "raindrop-compare" || rc.rows.length !== 6 || !rc.columns?.us || !rc.columns?.them) {
      problems.push(`${lang}: raindropCompare block malformed`);
    }
    if (HERO[lang].pillars.length !== 4) {
      problems.push(`${lang}: hero must have 4 pillars`);
    }
    if (FEATURES[lang].items.length !== 9) {
      problems.push(`${lang}: features must have 9 items`);
    }
    if (AI[lang].providers.length !== 7) {
      problems.push(`${lang}: ai.providers.list must have 7 entries`);
    }
    if (PRIVACY[lang].length !== 6) {
      problems.push(`${lang}: privacy must have 6 items`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Secondary pipeline: scripts/landing-translations.json (24 locales, flat keys
// consumed by generate-landing-pages.mjs). Same three free-tier fixes: the
// "1 device" fiction dies in priceFreeDesc, the smart-search wedge leads
// priceFreeItems. Each locale reuses its own terminology from the existing
// strings so the copy reads native, not translated.
// ---------------------------------------------------------------------------
const SECONDARY_PATH = join(ROOT, "scripts", "landing-translations.json");
const SECONDARY_FREE_TIER = {
  ar: { desc: "لأرشفة شخصية (1000 إشارة مرجعية، تعمل على أي جهاز — لكل جهاز خزنته الخاصة)", wedge: "بحث ذكي (نص كامل + دلالي) — مشمول مجانًا؛ Raindrop يتقاضى مقابل هذا اشتراكًا سنويًا" },
  bg: { desc: "За лична библиотека (2 500 отметки, работи на всяко устройство — всяко със собствен трезор)", wedge: "Интелигентно търсене (пълнотекстово + семантично) — включено безплатно; Raindrop го таксува годишно" },
  cs: { desc: "Pro osobní archiv (2 500 záložek, funguje na jakémkoli zařízení — každé má svůj trezor)", wedge: "Chytré vyhledávání (plnotextové + sémantické) — zdarma; Raindrop za něj účtuje roční předplatné" },
  da: { desc: "Til personligt arkiv (2.500 bogmærker, virker på enhver enhed — hver har sit eget valv)", wedge: "Smart søgning (fuldtekst + semantisk) — inkluderet gratis; Raindrop opkræver årligt betaling for dette" },
  el: { desc: "Για προσωπικό αρχείο (2.500 σελιδοδείκτες, λειτουργεί σε κάθε συσκευή — κάθε συσκευή έχει το δικό της θησαυροφυλάκιο)", wedge: "Έξυπνη αναζήτηση (πλήρες κείμενο + σημασιολογική) — δωρεάν· το Raindrop χρεώνει ετήσια συνδρομή γι' αυτή" },
  fi: { desc: "Henkilökohtaiseen arkistoon (2 500 kirjanmerkkiä, toimii millä tahansa laitteella — jokaisella on oma holvinsa)", wedge: "Älykäs haku (kokoteksti + semanttinen) — sisältyy ilmaiseksi; Raindrop perii siitä vuosimaksun" },
  he: { desc: "לארכיון אישי (1000 סימניות, עובד בכל מכשיר — לכל מכשיר הכספת שלו)", wedge: "חיפוש חכם (טקסט מלא + סמנטי) — כלול בחינם; Raindrop גובה על זה תשלום שנתי" },
  hi: { desc: "व्यक्तिगत आर्काइव के लिए (2,500 बुकमार्क, किसी भी डिवाइस पर काम करता है — हर डिवाइस का अपना वॉल्ट)", wedge: "स्मार्ट खोज (पूर्ण पाठ + सिमेंटिक) — मुफ़्त शामिल; Raindrop इसके लिए सालाना पैसे लेता है" },
  hr: { desc: "Za osobni arhiv (2.500 oznaka, radi na bilo kojem uređaju — svaki ima svoj sef)", wedge: "Pametno pretraživanje (cjelovit tekst + semantičko) — uključeno besplatno; Raindrop za to naplaćuje godišnje" },
  hu: { desc: "Személyes archívumhoz (2 500 könyvjelző, bármely eszközön működik — mindegyiknek saját széfje van)", wedge: "Okos keresés (teljes szöveges + szemantikus) — ingyenesen tartalmazza; a Raindrop évente fizetést kér érte" },
  id: { desc: "Untuk arsip pribadi (2.500 bookmark, berfungsi di perangkat apa pun — masing-masing punya vault sendiri)", wedge: "Pencarian pintar (teks penuh + semantik) — termasuk gratis; Raindrop menagihnya tiap tahun" },
  ja: { desc: "個人用アーカイブとして（2,500件のブックマーク、どのデバイスでも動作 — 各デバイスが独自のボルトを持つ）", wedge: "スマート検索（全文 + セマンティック）— 無料で搭載。Raindropはこれに年額を課しています" },
  ko: { desc: "개인 아카이브용 (북마크 2,500개, 어떤 기기에서든 작동 — 기기마다 자체 볼트 보유)", wedge: "스마트 검색(전문 + 시맨틱) — 무료 포함. Raindrop은 이 기능에 연간 요금을 받습니다" },
  nl: { desc: "Voor persoonlijk archief (2.500 bladwijzers, werkt op elk apparaat — elk met zijn eigen kluis)", wedge: "Slim zoeken (volledige tekst + semantisch) — gratis inbegrepen; Raindrop rekent hiervoor jaarlijks" },
  no: { desc: "Til personlig arkiv (2 500 bokmerker, fungerer på enhver enhet — hver med sitt eget hvelv)", wedge: "Smart søk (fulltekst + semantisk) — inkludert gratis; Raindrop krever årlig betaling for dette" },
  pl: { desc: "Do osobistego archiwum (2 500 zakładek, działa na dowolnym urządzeniu — każde ma własny sejf)", wedge: "Inteligentne wyszukiwanie (pełnotekstowe + semantyczne) — wliczone bezpłatnie; Raindrop pobiera za to opłatę roczną" },
  ro: { desc: "Pentru arhivă personală (2.500 marcaje, funcționează pe orice dispozitiv — fiecare are propriul seif)", wedge: "Căutare inteligentă (text integral + semantică) — inclusă gratuit; Raindrop taxează asta anual" },
  ru: { desc: "Для личного архива (2 500 закладок, работает на любом устройстве — у каждого свой сейф)", wedge: "Умный поиск (полнотекстовый + семантический) — включён бесплатно; Raindrop берёт за это годовую плату" },
  sv: { desc: "För personligt arkiv (2 500 bokmärken, fungerar på vilken enhet som helst — varje enhet har sitt eget valv)", wedge: "Smart sökning (hela texten + semantisk) — ingår gratis; Raindrop tar årsavgift för detta" },
  th: { desc: "สำหรับคลังส่วนตัว (บุ๊กมาร์ก 2,500 รายการ ใช้ได้บนอุปกรณ์ใดก็ได้ — แต่ละเครื่องมีห้องนิรภัยของตัวเอง)", wedge: "การค้นหาอัจฉริยะ (แบบเต็มข้อความ + ความหมาย) — รวมฟรี; Raindrop เก็บเงินรายปีสำหรับฟีเจอร์นี้" },
  tr: { desc: "Kişisel arşiv için (2.500 yer imi, her cihazda çalışır — her cihazın kendi kasası vardır)", wedge: "Akıllı arama (tam metin + anlamsal) — ücretsiz dahil; Raindrop bunun için yıllık ücret alıyor" },
  uk: { desc: "Для особистого архіву (2 500 закладок, працює на будь-якому пристрої — кожен має власний сейф)", wedge: "Розумний пошук (повнотекстовий + семантичний) — включено безкоштовно; Raindrop бере за це річну плату" },
  vi: { desc: "Cho kho lưu trữ cá nhân (2.500 bookmark, hoạt động trên mọi thiết bị — mỗi thiết bị có kho riêng)", wedge: "Tìm kiếm thông minh (toàn văn + ngữ nghĩa) — miễn phí; Raindrop thu phí hàng năm cho tính năng này" },
  zh: { desc: "个人知识库（2,500个书签，可在任何设备上使用 — 每台设备拥有独立保险库）", wedge: "智能搜索（全文 + 语义）— 免费包含；Raindrop 对此功能每年收费" },
};

/** Audit the secondary strings: same gate rules + digit sanity (any standalone
 *  digits in the description must be the 2,500 cap). */
function auditSecondary(T) {
  const problems = [];
  for (const [lang, fix] of Object.entries(SECONDARY_FREE_TIER)) {
    if (!T[lang]) problems.push(`secondary: locale ${lang} missing`);
    for (const s of [fix.desc, fix.wedge]) {
      if (MONEY_BACK_RE.test(s)) problems.push(`secondary/${lang}: money-back wording`);
      if (PRICE_RE.test(s)) problems.push(`secondary/${lang}: "$"+digit in new copy`);
      if (PRICE_YEAR_RE.test(s)) problems.push(`secondary/${lang}: $ near year`);
      const dv = s.match(DEVICE_RE);
      if (dv) problems.push(`secondary/${lang}: device count "${dv[1]}" in new copy (fiction must not return)`);
      const bm = s.match(BOOKMARK_RE);
      if (bm && !VALID_BOOKMARKS.has(Number(bm[1].replace(/[.,\s]/g, "")))) {
        problems.push(`secondary/${lang}: bookmark cap "${bm[1]}" not 2,500`);
      }
    }
  }
  for (const lang of Object.keys(T)) {
    if (SECONDARY_FREE_TIER[lang]) continue;
    // Locales without a hand-written fix keep their old desc — verify none of
    // them snuck in a device claim the gate regex can't see (CJK/RTL forms).
    const desc = T[lang].priceFreeDesc ?? "";
    if (/\b1\s*(device|Gerät|appareil|dispositivo)/iu.test(desc) || /1\s*(デバイス|개 기기|台设备|جهاز واحد|מכשיר אחד|อุปกรณ์|cihaz|пристрій|urządzenie|enhed|laite|συσκευή|zařížen|eszköz|uređaj|perangkat)/u.test(desc)) {
      problems.push(`secondary/${lang}: priceFreeDesc still claims the 1-device fiction (needs a SECONDARY_FREE_TIER entry)`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Load, validate structure, apply, audit, write
// ---------------------------------------------------------------------------
const data = {};
for (const lang of LANGS) {
  const p = join(TRANS_DIR, `${lang}.json`);
  if (!existsSync(p)) {
    fail(`missing translation file: ${lang}.json`);
    continue;
  }
  try {
    data[lang] = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    fail(`${lang}.json does not parse: ${e.message}`);
  }
}
for (const [lang, t] of Object.entries(data)) {
  for (const key of ["hero", "pocketAlternative", "features", "ai", "privacy", "pricing", "faq", "structuredData", "navLinks"]) {
    if (!t[key]) fail(`${lang}.json: missing block ${key}`);
  }
}

if (FAILURES.length) {
  console.error("patch-landing-copy: preflight failed, nothing written:");
  for (const f of FAILURES) console.error(`  - ${f}`);
  process.exit(1);
}

for (const lang of LANGS) {
  const t = data[lang];
  t.title = META[lang].title;
  t.description = META[lang].description;
  t.ogTitle = META[lang].title;
  t.ogDescription = META[lang].description;
  t.twitterTitle = META[lang].title;
  t.twitterDescription = META[lang].description;
  t.navLinks.raindropCompare = NAV[lang];
  t.hero.badge = HERO[lang].badge;
  t.hero.title = HERO[lang].title;
  t.hero.subtitle = HERO[lang].subtitle;
  t.hero.pillars = HERO[lang].pillars;
  t.raindropCompare = RC[lang];
  t.features.title = FEATURES[lang].title;
  t.features.items = FEATURES[lang].items;
  t.ai.subtitle = AI[lang].subtitle;
  t.ai.providers.list = AI[lang].providers;
  t.ai.modes.items = AI[lang].modes;
  t.privacy.items = PRIVACY[lang];
  t.structuredData.featureList = t.structuredData.featureList.map((f) =>
    f.replace("Semántica", "Inteligente").replace("semántica", "inteligente").replace("Semantic search", "Smart search"),
  );

  // Free-tier plan: description + first three features (cap stays, wedge
  // leads, device fiction replaced by the per-device-vault reality).
  // Free plan names per locale: Free, Gratis, Gratuit, Kostenlos, Grátis.
  const freePlan = t.pricing.plans.find((p) => /^(free|gratis|grátis|gratuit|kostenlos)$/iu.test(p.name));
  if (!freePlan) fail(`${lang}: no Free/Gratis plan in pricing`);
  else {
    freePlan.description = FREE_TIER[lang].description;
    freePlan.features[0] = { included: true, text: FREE_TIER[lang].featureSearch };
    freePlan.features[1] = { included: true, text: FREE_TIER[lang].featureCap };
    freePlan.features[2] = { included: true, text: FREE_TIER[lang].featureDevices };
  }

  // Reorder keys so raindropCompare sits right after pocketAlternative.
  const ordered = {};
  for (const key of Object.keys(t)) {
    ordered[key] = t[key];
    if (key === "pocketAlternative") ordered.raindropCompare = t.raindropCompare;
  }
  data[lang] = ordered;
}

const problems = auditAll();

// Secondary pipeline: load, apply, audit (fails before any write).
let secondary = null;
if (existsSync(SECONDARY_PATH)) {
  try {
    secondary = JSON.parse(readFileSync(SECONDARY_PATH, "utf8"));
  } catch (e) {
    problems.push(`landing-translations.json does not parse: ${e.message}`);
  }
  if (secondary) {
    for (const [lang, fix] of Object.entries(SECONDARY_FREE_TIER)) {
      if (secondary[lang]) {
        secondary[lang].priceFreeDesc = fix.desc;
        const items = secondary[lang].priceFreeItems;
        if (Array.isArray(items) && items.length >= 2) {
          items[1] = fix.wedge;
        } else {
          problems.push(`secondary/${lang}: priceFreeItems malformed or too short`);
        }
      }
    }
    problems.push(...auditSecondary(secondary));
  }
}

if (problems.length) {
  console.error("patch-landing-copy: audit failed, nothing written:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

for (const lang of LANGS) {
  writeFileSync(join(TRANS_DIR, `${lang}.json`), JSON.stringify(data[lang], null, 2) + "\n");
}
if (secondary) {
  writeFileSync(SECONDARY_PATH, JSON.stringify(secondary, null, 2) + "\n");
}
console.log(
  `patch-landing-copy: 6 translations + ${secondary ? Object.keys(SECONDARY_FREE_TIER).length : 0} secondary locales rewritten and audited (hero, raindropCompare, features, ai, privacy, meta, free tier).`,
);
