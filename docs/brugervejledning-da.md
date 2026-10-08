# Brugervejledning — BookmarkForge v1

**Version:** 1.0.0 · **Senest opdateret:** september 2026 · **Licens:** MIT

## Kom godt i gang

BookmarkForge gemmer bogmærker, noter og dokumenter og hjælper dig med at organisere din viden. Indholdet i din boks bliver i browserens lokale lager og sendes ikke til BookmarkForge. En ekstern AI-udbyder modtager kun data, som du udtrykkeligt sender til funktionen.

Boksen krypteres lokalt med AES-GCM, og nøglen udledes af hovedadgangskoden med Argon2id. Support kan ikke gendanne adgangskoden.

1. Åbn [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Opret en hovedadgangskode på mindst 12 tegn.
3. Gem de 24 gendannelsesord sikkert.
4. Eksportér regelmæssigt en krypteret `.bmf`-sikkerhedskopi.

## Bogmærker og søgning

Free indeholder intelligent søgning efter både ord og betydning. Free tillader **2.500 bogmærker** og har ingen grænse for antal enheder; uden Pro-synkronisering har hver enhed sin egen boks. Når du når 2.500, slettes intet: læsning, søgning og eksport fortsætter, mens nye gemninger sættes på pause. Pro fjerner grænsen og synkroniserer op til fem enheder via P2P.

## Import fra Pocket

Vælg `ril_export.html` eller en Pocket-CSV under **Indstillinger → Importér**. Før lagring vises en forhåndsvisning af links, datoer og tags. Læst, ulæst og arkiveret status bevares. Når Free-grænsen nås, viser resultatet hvor mange elementer der blev importeret og at grænsen er nået; resten tælles ikke som sprunget over.

## Noter, AI og synkronisering

Editoren understøtter strukturerede noter, tabeller og links mellem dokumenter. Lokal AI med WebLLM/Ollama, RAG-chat, flashcards og P2P-synkronisering er Pro-funktioner. Ved brug af din egen API-nøgle gælder udbyderens vilkår.

## Sikkerhedskopier og hjælp

Gem flere `.bmf`-kopier forskellige steder. Gendannelse kræver hovedadgangskoden. Ved afvist lagring skal du kontrollere Free-tælleren; ved synkroniseringsproblemer skal du kontrollere netværk, firewall og enheds-ID. Send aldrig adgangskode eller gendannelsesord til support.

Support: `bookmarkforge@proton.me`.

*Senest opdateret: september 2026 · Version 1.0.0*