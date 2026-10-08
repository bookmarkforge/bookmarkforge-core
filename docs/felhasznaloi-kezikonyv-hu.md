# Felhasználói kézikönyv — BookmarkForge v1

**Verzió:** 1.0.0 · **Utolsó frissítés:** 2026. szeptember · **Licenc:** MIT

## Kezdés

A BookmarkForge könyvjelzőket, jegyzeteket és dokumentumokat ment, és segít a személyes tudás rendszerezésében. A tároló tartalma a böngésző helyi tárhelyén marad, nem küldjük el a BookmarkForge részére. Külső AI-szolgáltató csak azt az adatot kapja meg, amelyet kifejezetten elküldesz neki.

A tároló helyben AES-GCM-mel titkosított, a kulcsot pedig az Argon2id a fő jelszóból származtatja. Az elveszett jelszót a támogatás nem tudja visszaállítani.

1. Nyisd meg a [bookmarkforgeapp.com](https://bookmarkforgeapp.com) oldalt.
2. Hozz létre legalább 12 karakteres fő jelszót.
3. A 24 helyreállítási szót biztonságosan őrizd meg.
4. Rendszeresen exportálj titkosított `.bmf` biztonsági mentést.

## Könyvjelzők és keresés

A Free tartalmazza a szavak és jelentés szerinti intelligens keresést. A Free **2 500 könyvjelzőt** engedélyez, és nincs eszközszám-korlátja; Pro-szinkronizálás nélkül minden eszköz saját tárolót használ. 2 500 elemnél semmi sem törlődik: az olvasás, keresés és export folytatódik, csak az új mentések szünetelnek. A Pro megszünteti a korlátot, és legfeljebb öt eszköz P2P-szinkronizálását teszi lehetővé.

## Import Pocketből

A **Beállítások → Importálás** menüben válaszd a `ril_export.html` fájlt vagy a Pocketből exportált CSV-t. Mentés előtt előnézet jelenik meg a linkekről, dátumokról és címkékről. Az olvasott, olvasatlan és archivált állapot megmarad. A Free-korlát elérésekor az eredmény jelzi az importált elemek számát és a korlátot; a többit nem számítja kihagyottnak.

## Jegyzetek, AI és szinkronizálás

A szerkesztő strukturált jegyzeteket, táblákat és dokumentumok közötti hivatkozásokat támogat. A WebLLM/Ollama helyi AI, az adatokon alapuló RAG-chat, a tanulókártyák és a P2P-szinkronizálás Pro-funkciók. Saját API-kulcs használatakor a szolgáltató feltételei érvényesek.

## Mentés és segítség

Több `.bmf` példányt tárolj különböző helyeken. A visszaállításhoz kell a fő jelszó. Sikertelen mentésnél ellenőrizd a Free számlálót; szinkronizálási hibánál a hálózatot, tűzfalat és eszközazonosítókat. Jelszót vagy helyreállítási szavakat ne küldj a támogatásnak.

Támogatás: `bookmarkforge@proton.me`.

*Utolsó frissítés: 2026. szeptember · Verzió 1.0.0*