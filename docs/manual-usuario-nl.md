# Gebruikershandleiding — BookmarkForge v1

**Versie:** 1.0.0 · **Laatst bijgewerkt:** september 2026 · **Licentie:** MIT

## Aan de slag

BookmarkForge bewaart bladwijzers, notities en documenten en helpt je persoonlijke kennis te ordenen. De inhoud van je kluis blijft in de lokale opslag van je browser en wordt niet naar BookmarkForge gestuurd. Een externe AI-aanbieder ontvangt alleen gegevens die je uitdrukkelijk naar die functie stuurt.

De kluis wordt lokaal versleuteld met AES-GCM; Argon2id leidt de sleutel af van je hoofdwachtwoord. Support kan een verloren wachtwoord niet herstellen.

1. Open [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Maak een hoofdwachtwoord van minstens 12 tekens.
3. Bewaar de 24 herstelwoorden veilig.
4. Exporteer regelmatig een versleutelde `.bmf`-back-up.

## Bladwijzers en zoeken

Free bevat slim zoeken op woorden en betekenis. Free ondersteunt **2.500 bladwijzers** en heeft geen limiet op het aantal apparaten; zonder Pro-synchronisatie heeft elk apparaat een eigen kluis. Bij 2.500 wordt niets verwijderd: lezen, zoeken en exporteren blijven werken, alleen nieuwe opslagen worden gepauzeerd. Pro verwijdert de limiet en synchroniseert maximaal vijf apparaten via P2P.

## Importeren vanuit Pocket

Kies in **Instellingen → Importeren** `ril_export.html` of een CSV uit Pocket. Voor het opslaan krijg je een voorbeeld van links, datums en tags. De statussen gelezen, ongelezen en gearchiveerd blijven behouden. Bij het bereiken van de Free-limiet vermeldt het resultaat hoeveel items zijn geïmporteerd en dat de limiet is bereikt; de rest wordt niet als overgeslagen geteld.

## Notities, AI en synchronisatie

De editor ondersteunt gestructureerde notities, tabellen en koppelingen tussen documenten. Lokale AI met WebLLM/Ollama, RAG-chat, flashcards en P2P-synchronisatie zijn Pro-functies. Bij gebruik van je eigen API-sleutel gelden de voorwaarden van de betreffende aanbieder.

## Back-ups en hulp

Bewaar meerdere `.bmf`-kopieën op verschillende plaatsen. Herstel vereist je hoofdwachtwoord. Controleer bij een geweigerde opslag de Free-teller; controleer bij synchronisatieproblemen netwerk, firewall en apparaat-ID. Stuur nooit wachtwoorden of herstelwoorden naar support.

Support: `bookmarkforge@proton.me`.

*Laatst bijgewerkt: september 2026 · Versie 1.0.0*