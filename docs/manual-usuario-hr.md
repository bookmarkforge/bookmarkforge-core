# Korisnički priručnik — BookmarkForge v1

**Verzija:** 1.0.0 · **Zadnje ažuriranje:** rujan 2026. · **Licenca:** MIT

## Početak

BookmarkForge sprema oznake, bilješke i dokumente te pomaže organizirati osobno znanje. Sadržaj trezora ostaje u lokalnoj pohrani preglednika i ne šalje se BookmarkForgeu. Vanjski AI pružatelj dobiva samo podatke koje mu izričito pošaljete.

Trezor se lokalno šifrira pomoću AES-GCM-a, a ključ se izvodi iz glavne lozinke pomoću Argon2ida. Podrška ne može vratiti izgubljenu lozinku.

1. Otvorite [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Stvorite glavnu lozinku od najmanje 12 znakova.
3. Sigurno spremite 24 riječi za oporavak.
4. Redovito izvezite šifriranu `.bmf` sigurnosnu kopiju.

## Oznake i pretraživanje

Free uključuje pametno pretraživanje po riječima i značenju. Free dopušta **2.500 oznaka** i nema ograničenje broja uređaja; bez Pro sinkronizacije svaki uređaj ima vlastiti trezor. Kada dosegnete 2.500, ništa se ne briše: čitanje, pretraživanje i izvoz nastavljaju raditi, a pauziraju se samo nova spremanja. Pro uklanja granicu i sinkronizira do pet uređaja putem P2P-a.

## Uvoz iz Pocketa

U **Postavke → Uvoz** odaberite `ril_export.html` ili CSV izvezen iz Pocketa. Prije spremanja prikazuje se pregled poveznica, datuma i oznaka. Čuva se status pročitano, nepročitano i arhivirano. Ako se dosegne Free granica, rezultat navodi broj uvezenih stavki i da je granica dosegnuta; ostatak se ne broji kao preskočen.

## Bilješke, AI i sinkronizacija

Uređivač podržava strukturirane bilješke, tablice i poveznice među dokumentima. Lokalni AI WebLLM/Ollama, RAG razgovor, kartice i P2P sinkronizacija Pro su značajke. Kod vlastitog API ključa vrijede uvjeti odgovarajućeg pružatelja.

## Sigurnosne kopije i pomoć

Čuvajte više `.bmf` kopija na različitim mjestima. Oporavak zahtijeva glavnu lozinku. Kod odbijenog spremanja provjerite Free brojač; kod problema sa sinkronizacijom provjerite mrežu, vatrozid i ID uređaja. Podršci nikad ne šaljite lozinku ni riječi za oporavak.

Podrška: `bookmarkforge@proton.me`.

*Zadnje ažuriranje: rujan 2026. · Verzija 1.0.0*