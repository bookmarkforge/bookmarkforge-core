# Manuale utente — BookmarkForge v1

**Versione:** 1.0.0 · **Ultimo aggiornamento:** settembre 2026 · **Licenza:** MIT

---

## 1. Introduzione

BookmarkForge è un'applicazione di conoscenza personale **local-first** che ti permette di salvare segnalibri, prendere note, organizzare la tua conoscenza con grafici interattivi, usare l'IA direttamente nel tuo browser e sincronizzare tra dispositivi senza dipendere da server centrali.

**Cosa rende BookmarkForge unico:**

- **I tuoi segnalibri, note e documenti vivono nel tuo browser** (IndexedDB/RxDB). Il contenuto dell'archivio non viene inviato a BookmarkForge; se usi un provider AI esterno, riceve solo ciò che invii esplicitamente attraverso quella funzione.
- **Cifratura end-to-end** con AES-GCM e Argon2id. Nemmeno gli sviluppatori possono leggere il tuo archivio.
- **IA locale** che funziona offline e senza inviare i tuoi dati a terze parti.
- **Sincronizzazione P2P** tra i tuoi dispositivi senza server centrali.
- **Nessun abbonamento.** Paga una volta ed è tuo per sempre.

---

## 2. Per iniziare

### 2.1 Requisiti

- Browser moderno: Chrome, Edge, Firefox, Safari (16+)
- 8 GB di RAM raccomandati
- GPU di base per IA locale (WebGPU)
- Connessione internet (per la configurazione iniziale e la sincronizzazione; opzionale per l'uso offline)

### 2.2 Installazione

1. Apri [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Clicca su **"Install App"** o **"Add to Home Screen"**
3. L'app si installa come PWA (Progressive Web App)
4. Puoi anche usarla come estensione del browser

### 2.3 Configurazione iniziale

1. **Password principale:** Minimo 12 caratteri. Si raccomanda una passphrase.
   - Deriva la tua chiave AES-GCM con Argon2id (KDF obbligatorio da ADR-019)
   - **La tua password è l'UNICA chiave.** Se la perdi, non c'è recupero.
2. **Frase di recupero:** Salva le 24 parole in un luogo sicuro.
3. **Device ID:** Generato automaticamente. Usato per attivare le licenze Pro.

### 2.4 Il bookmarklet

Trascina il pulsante **"Save to Forge"** nella barra dei segnalibri del tuo browser. Ogni volta che sei su una pagina web, cliccaci per salvarla come segnalibro.

---

## 3. Funzionalità principali

### 3.1 Segnalibri

- **Lista virtualizzata** che gestisce 100.000+ elementi senza ritardo
- **Ricerca profonda:** cerca nel testo completo delle pagine salvate
- **Collezioni intelligenti:** auto-organizzazione per etichetta
- **Import/Export:** da Notion, Evernote, Chrome, o esporta come .bmf, Markdown, PDF
- **Free:** 2.500 segnalibri, ricerca intelligente inclusa e senza limite di dispositivi. A 2.500, i tuoi dati rimangono disponibili per lettura, ricerca ed export; solo i nuovi salvataggi vengono messi in pausa. **Pro:** segnalibri illimitati.

### 3.2 Editor di note

Editor basato su blocchi con:
- Comandi `/` per inserimento rapido di blocchi
- Drag and drop
- LaTeX per la matematica
- Diagrammi Mermaid per i grafici
- Evidenziazione sintassi per 50+ linguaggi
- **AI Copilot** per assistenza in tempo reale

### 3.3 Grafo della conoscenza

Visualizzazione interattiva 3D/2D delle tue note:
- Filtra per etichetta, data o "Forza di connessione"
- Visualizza somiglianze semantiche tra note non correlate
- Esplora come le tue idee si connettono nel tempo

### 3.4 Flashcards

- Algoritmo modificato tipo Anki di **Spaced Repetition (SRK)**
- Traccia la tua "curva di oblivio" per mostrare le carte nel momento perfetto
- Supporta occlusione di immagini ed eliminazione del testo
- **Disponibile solo in Pro**

### 3.5 Comandi vocali

Motore voce-azione:
- Di "Hey BMF, trova le mie note di Biologia"
- Di "Salva questa pagina"
- Funziona 100% offline tramite la Web Speech API

### 3.6 Omnibar (Ctrl+K)

Il cervello dell'applicazione:
- Matematica, conversione unità
- Ricerca simultanea di segnalibri e note
- Digita `>` per comandi di sistema

---

## 4. IA in BookmarkForge

### 4.1 IA con la tua chiave API (Free)

- Usa Gemini, OpenAI, Anthropic, o qualsiasi provider compatibile
- Paga il costo dei token direttamente al tuo provider
- L'app instrada dinamicamente le richieste al modello ottimale
- **Cache semantico locale:** se fai domande simili, usa 0 token API

### 4.2 IA Locale — WebLLM/Ollama (Pro)

- Esegue modelli AI completi (come Llama 3.2, Qwen 2.5) direttamente nel tuo browser
- Usa la tua GPU (WebGPU)
- **Nessuna connessione internet** richiesta per funzionare
- Quantizzazione 4 bit (q4f16) per eseguire su hardware modesto
- **Nessun costo di token** e nessun invio di dati a terze parti

### 4.3 Chat RAG sui tuoi dati (Pro)

- L'IA "legge" le tue note locali prima di rispondere
- Risponde basandosi sulla tua conoscenza specifica
- Architettura ibrida con cache semantico locale
- Se fai domande simili, l'app usa 0 token e 0 chiamate API

### 4.4 Agenti esperti (Pro)

- Agenti specializzati in diversi domini
- Automatizzano compiti complessi di analisi

---

## 5. Sincronizzazione P2P

### 5.1 Requisiti

- Entrambi i dispositivi sulla stessa rete Wi-Fi
- Il firewall deve permettere WebRTC
- ID di sincronizzazione corrispondenti

### 5.2 Configurazione

1. Vai a **Impostazioni > Sincronizzazione**
2. Attiva "Abilita sincronizzazione P2P"
3. Assicurati che entrambi i dispositivi siano sulla stessa rete
4. Conferma che gli ID di sincronizzazione corrispondono

### 5.3 Risoluzione problemi

| Problema | Soluzione |
|---|---|
| Sync fallendo | Verifica che entrambi i dispositivi siano sullo stesso Wi-Fi |
| Firewall bloccando WebRTC | Configura il firewall per permettere WebRTC |
| ID di sincronizzazione non corrispondono | Riavvia la Sala di Sincronizzazione |
| Connessione lenta | Verifica la latenza della rete |

---

## 6. Sicurezza e privacy

### 6.1 Cifratura

- **AES-GCM** con chiavi derivate da **Argon2id** (versione 4)
- Le chiavi non sono mai memorizzate in chiaro
- Derivate al volo ed esistono solo in memoria (RAM)
- Usa l'API SubtleCrypto nativa del browser

### 6.2 Password principale

- Minimo 12 caratteri
- Non esiste funzionalità "Password dimenticata"
- La tua password è l'UNICA chiave
- Se la perdi, **non possiamo aiutarti**
- Salva sempre un backup .bmf in un luogo sicuro

### 6.3 Recupero

- Esporta il tuo archivio come file `.bmf` in qualsiasi momento
- Formato: JSON cifrato con la tua chiave principale
- Salvalo in sicurezza (USB, disco esterno, cloud cifrato)
- Per ripristinare: vai a **Impostazioni > Ripristina** e seleziona il tuo file .bmf
- Il ripristino richiede la tua password principale

### 6.4 Politica sulla privacy

- **Zero-knowledge:** gli sviluppatori hanno conoscenza zero delle tue chiavi o dati
- Nessun Google Analytics, nessuna telemetria, nessun pixel di tracciamento
- Nessun server centrale che memorizza i tuoi dati
- GDPR per design
- Il server delle licenze valida la tua licenza senza accedere al tuo archivio

### 6.5 Validazione licenze

- La licenza Pro è validata localmente dopo un handshake iniziale
- Nessun tracciamento costante
- Prova di licenza firmata con RSA-PSS (SHA-256, salt 32)
- Ri-validazione ogni 48 ore quando connesso
- Prove più vecchie di 30 giorni sono rifiutate dal server di entitlement

---

## 7. Free vs Pro

### 7.1 Tabella comparativa

| Funzionalità | Free | Pro |
|---|---|--- |
| Prezzo | $0 | $79 (vitalizio) |
| Segnalibri | 2.500 | Illimitati |
| Dispositivi | Nessun limite (ogni dispositivo ha il suo archivio) | Fino a 5 + sincronizzazione P2P |
| IA con chiave propria | ✅ | ✅ |
| IA Locale (WebLLM/Ollama) | ❌ | ✅ |
| Chat RAG sui tuoi dati | ❌ | ✅ |
| Flashcards + PDF/OCR | ❌ | ✅ |
| Export avanzato (10+ formati) | ❌ | ✅ |
| Cifratura locale dell'archivio (AES-GCM) | ✅ | ✅ |
| Supporto | Comunità | Email 48h |
| Sconti v2/v3 | ❌ | 60% sconto |

### 7.2 Come aggiornare a Pro

1. Vai a **Impostazioni > Abbonamento**
2. Clicca su **"Get Pro Lifetime"**
3. Sarai reindirizzato a Whop per il pagamento
4. Dopo l'acquisto, l'app si attiva automaticamente
5. La licenza è validata dal server e firmata localmente

**Early Bird:** I primi 200 acquirenti pagano $59 (esaurito o fino al 2026-12-31). Il prezzo regolare è $79.

### 7.3 Aggiornamenti futuri (v2, v3)

- I proprietari di v1 pagano uno **sconto del 60%** su versioni principali future
- v2 per nuovi: $89. v2 per proprietari v1: $35
- v3 per nuovi: $99. v3 per proprietari v1: $39
- I proprietari di v1 **mantengono v1 funzionale per sempre**

---

## 8. Importare ed esportare

### Nota su Pocket

L'importazione riconosce le esportazioni HTML (`ril_export.html`) e CSV di Pocket. Prima di salvare qualsiasi cosa, l'app mostra un'anteprima con link, date ed etichette. Lo stato letto/archiviato è preservato; se il limite Free viene raggiunto nell'importazione, il risultato indica onestamente quanti elementi sono stati importati e che il limite è stato raggiunto, invece di contare il resto come ignorato.

### 8.1 Importare

Vai a **Impostazioni > Importa**:
- **HTML/JSON da Notion o Evernote**
- **Export segnalibri Chrome**
- **Backup .bmf**

### 8.2 Esportare

- **.bmf:** Backup completo cifrato
- **Markdown:** Note in formato leggibile
- **PDF:** Esporta note come documenti PDF
- **JSON:** Dati strutturati

### 8.3 Backup e ripristino

- Esporta regolarmente il tuo archivio come .bmf
- Salvalo in un luogo sicuro
- Per ripristinare: vai a **Impostazioni > Ripristina** e seleziona il tuo file .bmf
- Il ripristino richiede la tua password principale

---

## 9. Risoluzione problemi

### 9.1 L'app non carica

1. Pulisci la cache del browser
2. Aggiorna Chrome/Edge all'ultima versione
3. Verifica se il tuo disco è pieno
4. Disabilita estensioni in conflitto (gli ad-blocker a volte bloccano IndexedDB)

### 9.2 Sincronizzazione fallendo

1. Assicurati che entrambi i dispositivi siano sullo stesso Wi-Fi
2. Verifica che il firewall permetta WebRTC
3. Conferma che gli ID di sincronizzazione corrispondano
4. Riavvia la Sala di Sincronizzazione se necessario

### 9.3 IA allucina o risponde in modo errato

1. L'IA può commettere errori — usa i link "Fonti" nel Chat per verificare
2. Regola la "Temperatura" nelle impostazioni IA
3. Se usi IA locale, verifica che il modello sia caricato correttamente

### 9.4 Estensioni non salvano

1. Aggiorna la pagina che stai cercando di salvare
2. Assicurati di essere loggato a BookmarkForge in un'altra scheda
3. Reinstalla il bookmarklet

### 9.5 Prestazioni lente

1. Vai a Impostazioni > Avanzato ed esegui "Ottimizzazione Database"
2. Verifica la Diagnosi Sistema per l'uso CPU
3. La virtualizzazione gestisce liste grandi, ma note pesanti possono influenzare la RAM

### 9.6 Database corrotto

1. Usa "Diagnosi Sistema" per verificare l'integrità
2. Se è corrotto, ripristina dal tuo ultimo backup .bmf

### 9.7 Licenza Pro non funziona

1. Verifica che la tua connessione internet funzioni (validazione periodica richiesta)
2. Prova a ri-validare in **Impostazioni > Licenza > Ri-valida**
3. Se il problema persiste, contatta **bookmarkforge@proton.me**
4. Rimborsabile entro 30 giorni via Whop

### 9.8 Errore licenza: SIGNING_KEY_INVALID

Questo errore indica che il server non è configurato correttamente. Non è un problema utente. Contatta il supporto.

---

## 10. Configurazione avanzata

Per configurazioni avanzate di deployment, self-hosting e API del server,
consulta la documentazione interna o contatta il supporto.

> La validazione delle licenze viene eseguita esclusivamente sul server.
> BookmarkForge richiede una licenza valida per accedere alle funzionalità Pro.

---

## 11. FAQ

**È gratuito?**
L'applicazione principale è local-first e gratuita. Le funzionalità avanzate di IA e sincronizzazione P2P richiedono una licenza Pro.

**Posso usarlo sul mobile?**
Sì. Installala come PWA via Chrome (Android) o Safari (iOS). Supporta l'accesso offline e le notifiche push.

**Dove sono i miei file?**
Nello spazio interno del browser (IndexedDB). Puoi esportarli come .bmf, Markdown o PDF in qualsiasi momento.

**Funziona senza internet?**
100%. Tutte le funzionalità (Editor, Segnalibri, Grafo, IA Locale, Ricerca) funzionano senza connessione internet.

**Consuma molti token API?**
No. L'app usa un algoritmo di Cache Semantico Locale. Se fai variazioni della stessa domanda, usa 0 token API.

**Consumo batteria?**
L'IA locale usa WebGPU. Su laptop, può consumare batteria più velocemente. Disabilita IA locale nelle impostazioni per risparmiare batteria.

---

## 12. Supporto

| Livello | Canale | Tempo di risposta |
|---|---|---|
| **Free** | Comunità — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | Email — bookmarkforge@proton.me | 48h (giorni lavorativi) |

**Nota di sicurezza:** Il tuo archivio è cifrato. Non possiamo vedere i tuoi dati. Password persa = dati persi. Il supporto non chiederà mai la tua password o frase di recupero.

---

## 13. Legale

- **Licenza codice:** MIT-or-later
- **Marchio:** BookmarkForge e i suoi marchi sono protetti (vedi `TRADEMARKS.md`)
- **Prezzi:** Congelati in `docs/pricing-decision.md`. Tutti i prezzi sono vitalizi versione 1.
- **Rimborsi:** 30 giorni via Whop. Politica di rimborso completa.
- **Privacy:** Vedi `docs/ROPA.md` per il registro di trattamento dati personali sotto GDPR.

---

*Ultimo aggiornamento: settembre 2026 · Versione 1.0.0*
