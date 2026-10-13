# Käyttöopas — BookmarkForge v1

**Versio:** 1.0.0 · **Päivitetty:** syyskuu 2026 · **Lisenssi:** MIT

## Aloittaminen

BookmarkForge tallentaa kirjanmerkit, muistiinpanot ja asiakirjat sekä auttaa järjestämään henkilökohtaista tietoa. Holvin sisältö pysyy selaimen paikallisessa tallennustilassa eikä sitä lähetetä BookmarkForgelle. Ulkoinen tekoälypalvelu saa vain tiedot, jotka lähetät sille nimenomaisesti.

Holvi salataan paikallisesti AES-GCM:llä ja avain johdetaan pääsalasanasta Argon2idillä. Tuki ei voi palauttaa kadonnutta salasanaa.

1. Avaa [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Luo vähintään 12 merkkiä pitkä pääsalasana.
3. Säilytä 24 palautussanaa turvallisesti.
4. Vie säännöllisesti salattu `.bmf`-varmuuskopio.

## Kirjanmerkit ja haku

Free sisältää älykkään hakuominaisuuden sanoilla ja merkityksellä. Free sallii **2 500 kirjanmerkkiä** eikä rajoita laitteiden määrää; ilman Pron synkronointia jokaisella laitteella on oma holvinsa. Kun 2 500 täyttyy, mitään ei poisteta: lukeminen, haku ja vienti toimivat edelleen, mutta uudet tallennukset pysähtyvät. Pro poistaa rajan ja synkronoi enintään viisi laitetta P2P-yhteydellä.

## Pocket-tuonti

Valitse **Asetukset → Tuo** ja avaa `ril_export.html` tai Pocketista viety CSV. Ennen tallennusta näet esikatselun linkeistä, päivämääristä ja tunnisteista. Luettu-, lukematon- ja arkistotila säilyvät. Jos Free-raja saavutetaan, tulos kertoo tuodun määrän ja rajan saavuttamisen; loppuja ei lasketa ohitetuiksi.

## Muistiinpanot, tekoäly ja synkronointi

Editorissa voi tehdä rakenteisia muistiinpanoja, taulukoita ja asiakirjojen välisiä linkkejä. WebLLM/Ollama-paikallinen tekoäly, RAG-keskustelu, muistikortit ja P2P-synkronointi ovat Pro-ominaisuuksia. Oman API-avaimen käytössä noudatetaan palveluntarjoajan ehtoja.

## Varmuuskopiot ja tuki

Säilytä useita `.bmf`-kopioita eri paikoissa. Palautus vaatii pääsalasanan. Jos tallennus estyy, tarkista Free-laskuri; jos synkronointi ei toimi, tarkista verkko, palomuuri ja laitetunnukset. Älä lähetä salasanaa tai palautussanoja tuelle.

Tuki: `bookmarkforge@proton.me`.

*Päivitetty: syyskuu 2026 · Versio 1.0.0*