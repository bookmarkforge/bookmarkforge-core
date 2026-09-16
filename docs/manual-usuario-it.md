# Manuale utente — BookmarkForge v1

**Versione:** 1.0.0 · **Ultimo aggiornamento:** settembre 2026 · **Licenza:** MIT

## 1. Panoramica

BookmarkForge salva segnalibri, note e documenti in una raccolta personale della conoscenza. Il contenuto del tuo archivio resta nello spazio locale del browser e non viene inviato a BookmarkForge. Se usi un provider AI esterno, riceve solo i dati che invii esplicitamente a quella funzione.

L’archivio è cifrato localmente con AES-GCM; Argon2id deriva la chiave dalla password principale. La password è indispensabile e non può essere recuperata dal supporto.

## 2. Per iniziare

1. Apri [bookmarkforge.com](https://bookmarkforge.com).
2. Installa la PWA quando il browser lo propone, oppure usa direttamente l’app web.
3. Crea una password principale di almeno 12 caratteri.
4. Conserva in sicurezza le 24 parole di recupero.
5. Esporta periodicamente un backup `.bmf` cifrato.

Dopo il primo caricamento puoi usare BookmarkForge offline. Il bookmarklet e le estensioni salvano rapidamente la pagina aperta.

## 3. Segnalibri e ricerca

- Salva URL, titolo, data ed etichette della pagina.
- La ricerca intelligente per parole e significato è inclusa nel piano Free.
- Free consente **1.000 segnalibri** e non impone un limite di dispositivi. Senza la sincronizzazione Pro, però, ogni dispositivo mantiene il proprio archivio.
- A 1.000 elementi non viene eliminato nulla: lettura, ricerca ed esportazione continuano a funzionare. Vengono solo sospesi i nuovi salvataggi.
- Pro rimuove il limite e sincronizza fino a tre dispositivi tramite P2P.

## 4. Importare da Pocket

Apri **Impostazioni → Importa** e scegli `ril_export.html` oppure un CSV esportato da Pocket. Il formato viene riconosciuto e, prima del salvataggio, viene mostrata un’anteprima con numero di link, date disponibili ed etichette.

Gli stati letto, non letto e archiviato vengono conservati. Se l’importazione raggiunge il limite Free, il risultato indica quanti elementi sono stati importati e che il limite è stato raggiunto; gli elementi rimanenti non vengono conteggiati come saltati.

## 5. Note, AI e sincronizzazione

L’editor supporta note strutturate, tabelle e collegamenti tra documenti. Per l’AI con una tua chiave API valgono le condizioni del provider e paghi direttamente quel servizio.

AI locale con WebLLM/Ollama, chat sui tuoi dati, flashcard e sincronizzazione P2P sono funzioni Pro. La sincronizzazione P2P può richiedere la stessa rete Wi-Fi o un servizio di segnalazione configurato.

## 6. Backup e recupero

- Crea un backup `.bmf` prima di una migrazione o di un’operazione importante.
- Conserva più copie in luoghi diversi.
- Il ripristino richiede la password principale.
- Una password persa non può essere sostituita dal supporto senza frase di recupero o backup valido.

## 7. Free e Pro

| Funzione | Free | Pro |
|---|---|---|
| Segnalibri | 1.000 | Illimitati |
| Dispositivi | Nessun limite, archivi separati | Fino a 3 con P2P |
| Ricerca intelligente | Inclusa | Inclusa |
| AI con chiave propria | Sì | Sì |
| AI locale e chat RAG | No | Sì |
| Export JSON/HTML e `.bmf` | Sì | Sì |
| Pagamento | Gratuito | Licenza v1 una tantum |

Attiva Pro da **Impostazioni → Pro** usando il checkout Whop. L’attivazione contatta il servizio licenze; l’archivio non viene trasferito.

## 8. Risoluzione dei problemi

- **L’app non si carica:** aggiorna il browser, controlla lo spazio disponibile e disattiva temporaneamente le estensioni problematiche.
- **Salvataggio rifiutato:** controlla il contatore Free; a 1.000 esporta, elimina un elemento oppure attiva Pro.
- **Sincronizzazione fallita:** controlla rete, firewall e ID dei dispositivi.
- **Licenza non attivata:** verifica la connessione e invia al supporto il codice di errore, mai password o frase di recupero.

## 9. Privacy e supporto

Il contenuto dell’archivio resta locale per impostazione predefinita. Pagamenti, licenze, AI remota, segnalazione P2P ed eventuali report di errore trattano solo i dati tecnici necessari secondo i relativi consensi e condizioni.

Supporto: `bookmarkforge@proton.me`. Il supporto non chiederà mai password o frase di recupero.

*Ultimo aggiornamento: settembre 2026 · Versione 1.0.0*