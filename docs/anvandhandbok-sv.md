# Användarhandbok — BookmarkForge v1

**Version:** 1.0.0 · **Senast uppdaterad:** september 2026 · **Licens:** MIT

## Kom igång

BookmarkForge sparar bokmärken, anteckningar och dokument och hjälper dig att organisera personlig kunskap. Innehållet i valvet stannar i webbläsarens lokala lagring och skickas inte till BookmarkForge. En extern AI-leverantör får bara data som du uttryckligen skickar till funktionen.

Valvet krypteras lokalt med AES-GCM och Argon2id härleder nyckeln från huvudlösenordet. Supporten kan inte återställa ett förlorat lösenord.

1. Öppna [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Skapa ett huvudlösenord på minst 12 tecken.
3. Förvara de 24 återställningsorden säkert.
4. Exportera regelbundet en krypterad `.bmf`-säkerhetskopia.

## Bokmärken och sökning

Free innehåller smart sökning efter ord och betydelse. Free tillåter **2 500 bokmärken** och har ingen gräns för antal enheter; utan Pro-synkronisering har varje enhet ett eget valv. När 2 500 nås raderas inget: läsning, sökning och export fortsätter, medan nya sparningar pausas. Pro tar bort gränsen och synkroniserar upp till fem enheter via P2P.

## Import från Pocket

Välj `ril_export.html` eller en Pocket-CSV under **Inställningar → Importera**. Före sparandet visas en förhandsgranskning av länkar, datum och taggar. Status för läst, oläst och arkiverad bevaras. När Free-gränsen nås anger resultatet hur många objekt som importerades och att gränsen nåddes; resten räknas inte som överhoppade.

## Anteckningar, AI och synkronisering

Redigeraren stöder strukturerade anteckningar, tabeller och länkar mellan dokument. Lokal AI med WebLLM/Ollama, RAG-chatt, flashcards och P2P-synkronisering är Pro-funktioner. Om du använder egen API-nyckel gäller leverantörens villkor.

## Säkerhetskopior och hjälp

Spara flera `.bmf`-kopior på olika platser. Återställning kräver huvudlösenordet. Kontrollera Free-räknaren om en sparning nekas; kontrollera nätverk, brandvägg och enhets-ID vid synkroniseringsproblem. Skicka aldrig lösenord eller återställningsord till supporten.

Support: `bookmarkforge@proton.me`.

*Senast uppdaterad: september 2026 · Version 1.0.0*