# Podręcznik użytkownika — BookmarkForge v1

**Wersja:** 1.0.0 · **Ostatnia aktualizacja:** wrzesień 2026 · **Licencja:** MIT

## Rozpoczęcie pracy

BookmarkForge zapisuje zakładki, notatki i dokumenty oraz pomaga porządkować osobistą wiedzę. Zawartość sejfu pozostaje w lokalnej pamięci przeglądarki i nie jest wysyłana do BookmarkForge. Zewnętrzny dostawca AI otrzymuje tylko dane, które wyraźnie wyślesz do tej funkcji.

Sejf jest lokalnie szyfrowany za pomocą AES-GCM, a Argon2id wyprowadza klucz z hasła głównego. Obsługa nie może odzyskać utraconego hasła.

1. Otwórz [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Utwórz hasło główne o długości co najmniej 12 znaków.
3. Bezpiecznie przechowuj 24 słowa odzyskiwania.
4. Regularnie eksportuj zaszyfrowaną kopię `.bmf`.

## Zakładki i wyszukiwanie

Free zawiera inteligentne wyszukiwanie według słów i znaczenia. Free obsługuje **2 500 zakładek** i nie ma limitu urządzeń; bez synchronizacji Pro każde urządzenie ma własny sejf. Po osiągnięciu 2 500 nic nie jest usuwane: czytanie, wyszukiwanie i eksport działają dalej, a wstrzymane zostają tylko nowe zapisy. Pro usuwa limit i synchronizuje do pięciu urządzeń przez P2P.

## Import z Pocket

Wybierz `ril_export.html` lub plik CSV z Pocket w **Ustawienia → Import**. Przed zapisaniem zobaczysz podgląd linków, dat i tagów. Statusy przeczytane, nieprzeczytane i zarchiwizowane zostają zachowane. Po osiągnięciu limitu Free wynik podaje liczbę zaimportowanych elementów i informuje o limicie; pozostałe nie są liczone jako pominięte.

## Notatki, AI i synchronizacja

Edytor obsługuje uporządkowane notatki, tabele i odnośniki między dokumentami. Lokalna AI WebLLM/Ollama, czat RAG, fiszki i synchronizacja P2P to funkcje Pro. Przy użyciu własnego klucza API obowiązują warunki danego dostawcy.

## Kopie zapasowe i pomoc

Przechowuj kilka kopii `.bmf` w różnych miejscach. Przywracanie wymaga hasła głównego. Przy odrzuconym zapisie sprawdź licznik Free; przy problemach z synchronizacją sprawdź sieć, zaporę i identyfikatory urządzeń. Nigdy nie wysyłaj obsłudze hasła ani słów odzyskiwania.

Wsparcie: `bookmarkforge@proton.me`.

*Ostatnia aktualizacja: wrzesień 2026 · Wersja 1.0.0*