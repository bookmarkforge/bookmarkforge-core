# Brukerhåndbok — BookmarkForge v1

**Versjon:** 1.0.0 · **Sist oppdatert:** september 2026 · **Lisens:** MIT

## Kom i gang

BookmarkForge lagrer bokmerker, notater og dokumenter og hjelper deg å organisere personlig kunnskap. Innholdet i hvelvet forblir i nettleserens lokale lagring og sendes ikke til BookmarkForge. En ekstern AI-leverandør får bare data du uttrykkelig sender til funksjonen.

Hvelvet krypteres lokalt med AES-GCM, og Argon2id utleder nøkkelen fra hovedpassordet. Kundestøtte kan ikke gjenopprette et mistet passord.

1. Åpne [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Lag et hovedpassord på minst 12 tegn.
3. Oppbevar de 24 gjenopprettingsordene trygt.
4. Eksporter jevnlig en kryptert `.bmf`-sikkerhetskopi.

## Bokmerker og søk

Free inkluderer smart søk etter ord og mening. Free tillater **2 500 bokmerker** og har ingen grense for antall enheter; uten Pro-synkronisering har hver enhet sitt eget hvelv. Når du når 2 500, slettes ingenting: lesing, søk og eksport fortsetter, mens nye lagringer settes på pause. Pro fjerner grensen og synkroniserer opptil fem enheter med P2P.

## Import fra Pocket

Velg `ril_export.html` eller en Pocket-CSV under **Innstillinger → Importer**. Før lagring vises en forhåndsvisning av lenker, datoer og tagger. Statusene lest, ulest og arkivert beholdes. Når Free-grensen nås, viser resultatet hvor mange elementer som ble importert og at grensen er nådd; resten telles ikke som hoppet over.

## Notater, AI og synkronisering

Redigeringsverktøyet støtter strukturerte notater, tabeller og lenker mellom dokumenter. Lokal AI med WebLLM/Ollama, RAG-chat, flashcards og P2P-synkronisering er Pro-funksjoner. Når du bruker egen API-nøkkel, gjelder leverandørens vilkår.

## Sikkerhetskopier og hjelp

Oppbevar flere `.bmf`-kopier på forskjellige steder. Gjenoppretting krever hovedpassordet. Ved avvist lagring må du sjekke Free-telleren; ved synkroniseringsproblemer må du sjekke nettverk, brannmur og enhets-ID. Send aldri passord eller gjenopprettingsord til kundestøtte.

Støtte: `bookmarkforge@proton.me`.

*Sist oppdatert: september 2026 · Versjon 1.0.0*