# Manual de utilizare — BookmarkForge v1

**Versiune:** 1.0.0 · **Actualizat:** septembrie 2026 · **Licență:** MIT

## Noțiuni de bază

BookmarkForge salvează marcaje, note și documente și te ajută să-ți organizezi cunoștințele. Conținutul seifului rămâne în stocarea locală a browserului și nu este trimis către BookmarkForge. Un furnizor AI extern primește doar datele pe care le trimiți explicit funcției respective.

Seiful este criptat local cu AES-GCM, iar Argon2id derivă cheia din parola principală. Suportul nu poate recupera o parolă pierdută.

1. Deschide [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Creează o parolă principală de cel puțin 12 caractere.
3. Păstrează în siguranță cele 24 de cuvinte de recuperare.
4. Exportă regulat o copie `.bmf` criptată.

## Marcaje și căutare

Free include căutare inteligentă după cuvinte și sens. Free permite **2.500 de marcaje** și nu are limită de dispozitive; fără sincronizarea Pro, fiecare dispozitiv are propriul seif. La 2.500 nu se șterge nimic: citirea, căutarea și exportul continuă, iar doar salvările noi sunt puse pe pauză. Pro elimină limita și sincronizează până la cinci dispozitive prin P2P.

## Import din Pocket

În **Setări → Import** selectează `ril_export.html` sau un CSV exportat din Pocket. Înainte de salvare apare o previzualizare cu linkuri, date și etichete. Stările citit, necitit și arhivat sunt păstrate. Dacă limita Free este atinsă, rezultatul arată câte elemente au fost importate și că limita a fost atinsă; restul nu este numărat ca omis.

## Note, AI și sincronizare

Editorul acceptă note structurate, tabele și legături între documente. AI local cu WebLLM/Ollama, chat RAG, carduri de învățare și sincronizarea P2P sunt funcții Pro. Pentru propria cheie API se aplică termenii furnizorului.

## Backup și ajutor

Păstrează mai multe copii `.bmf` în locuri diferite. Restaurarea necesită parola principală. Dacă salvarea este refuzată, verifică numărătoarea Free; dacă sincronizarea eșuează, verifică rețeaua, firewallul și identificatorii dispozitivelor. Nu trimite niciodată parole sau cuvinte de recuperare către suport.

Asistență: `bookmarkforge@proton.me`.

*Actualizat: septembrie 2026 · Versiunea 1.0.0*