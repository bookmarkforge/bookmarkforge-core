# Benutzerhandbuch — BookmarkForge v1

**Version:** 1.0.0 · **Letzte Aktualisierung:** September 2026 · **Lizenz:** MIT

---

## 1. Einführung

BookmarkForge ist eine **local-first** persönliche Wissensanwendung, mit der du Lesezeichen speichern, Notizen machen, dein Wissen mit interaktiven Graphen organisieren, KI direkt in deinem Browser nutzen und zwischen Geräten synchronisieren kannst – ohne zentrale Server.

**Was BookmarkForge einzigartig macht:**

- **Deine Lesezeichen, Notizen und Dokumente leben in deinem Browser** (IndexedDB/RxDB). Der Tresorinhalt wird nicht an BookmarkForge gesendet; wenn du einen externen KI-Anbieter nutzt, erhält dieser nur das, was du explizit über diese Funktion sendest.
- **Ende-zu-Ende-Verschlüsselung** mit AES-GCM und Argon2id. Nicht einmal Entwickler können deinen Tresor lesen.
- **Lokale KI**, die offline funktioniert und ohne deine Daten an Dritte sendet.
- **P2P-Synchronisation** zwischen deinen Geräten ohne zentrale Server.
- **Kein Abonnement.** Einmal zahlen und es gehört dir für immer.

---

## 2. Erste Schritte

### 2.1 Anforderungen

- Moderner Browser: Chrome, Edge, Firefox, Safari (16+)
- 8 GB RAM empfohlen
- Basis-GPU für lokale KI (WebGPU)
- Internetverbindung (für die Ersteinrichtung und Synchronisation; optional für Offline-Nutzung)

### 2.2 Installation

1. Öffne [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Klicke auf **"Install App"** oder **"Add to Home Screen"**
3. Die App installiert sich als PWA (Progressive Web App)
4. Du kannst sie auch als Browser-Erweiterung nutzen

### 2.3 Ersteinrichtung

1. **Hauptpasswort:** Minimum 12 Zeichen. Eine Passphrase wird empfohlen.
   - Leitet deinen AES-GCM-Schlüssel mit Argon2id ab (KDF obligatorisch seit ADR-019)
   - **Dein Passwort ist der EINZIGE Schlüssel.** Wenn du es verlierst, gibt es keine Wiederherstellung.
2. **Wiederherstellungsphrase:** Speichere die 24 Wörter an einem sicheren Ort.
3. **Device ID:** Wird automatisch generiert. Wird zum Aktivieren von Pro-Lizenzen verwendet.

### 2.4 Das Bookmarklet

Ziehe den **"Save to Forge"**-Button in die Lesezeichenleiste deines Browsers. Wenn du auf einer Webseite bist, klicke darauf, um sie als Lesezeichen zu speichern.

---

## 3. Hauptfunktionen

### 3.1 Lesezeichen

- **Virtualisierte Liste**, die 100.000+ Elemente ohne Verzögerung verarbeitet
- **Tiefensuche:** durchsucht den Volltext gespeicherter Seiten
- **Intelligente Sammlungen:** automatische Organisation nach Tag
- **Import/Export:** aus Notion, Evernote, Chrome oder Export als .bmf, Markdown, PDF
- **Free:** 2.500 Lesezeichen, intelligente Suche enthalten, keine Gerätebegrenzung. Bei 2.500 bleibt dein Tresor für Lesen, Suche und Export verfügbar; nur neue Speicherungen werden pausiert. **Pro:** Unbegrenzte Lesezeichen.

### 3.2 Notiz-Editor

Block-basierter Editor mit:
- `/`-Befehlen für schnelle Block-Einfügung
- Drag-and-Drop
- LaTeX für Mathematik
- Mermaid-Diagramme für Grafiken
- Syntax-Highlighting für 50+ Sprachen
- **AI Copilot** für Echtzeit-Unterstützung

### 3.3 Wissensgraph

Interaktive 3D/2D-Visualisierung deiner Notizen:
- Filter nach Tag, Datum oder "Verbindungsstärke"
- Visualisiere semantische Ähnlichkeiten zwischen nicht verwandten Notizen
- Erkunde, wie sich deine Ideen im Laufe der Zeit verbinden

### 3.4 Lernkarten

- Modifizierter Anki-artiger **Spaced Repetition (SRK)**-Algorithmus
- Verfolgt deine "Vergessenskurve", um Karten zum perfekten Zeitpunkt anzuzeigen
- Unterstützt Bildokklusion und Textlöschung
- **Nur in Pro verfügbar**

### 3.5 Sprachbefehle

Sprache-zu-Aktion-Motor:
- Sag "Hey BMF, finde meine Biologie-Notizen"
- Sag "Speichere diese Seite"
- Funktioniert 100% offline über die Web Speech API

### 3.6 Omnibar (Ctrl+K)

Das Gehirn der Anwendung:
- Mathematik, Einheitenumrechnung
- Gleichzeitige Lesezeichen- und Notizsuche
- Tippe `>` für Systembefehle

---

## 4. KI in BookmarkForge

### 4.1 KI mit eigenem API-Schlüssel (Free)

- Nutzt Gemini, OpenAI, Anthropic oder jeden kompatiblen Anbieter
- Du zahlst für Tokens direkt an deinen Anbieter
- Die App leitet Anfragen dynamisch an das optimale Modell weiter
- **Semantischer lokaler Cache:** ähnliche Fragen nutzen 0 API-Tokens

### 4.2 Lokale KI — WebLLM/Ollama (Pro)

- Führt vollständige KI-Modelle (wie Llama 3.2, Qwen 2.5) direkt in deinem Browser aus
- Nutzt deine GPU (WebGPU)
- **Keine Internetverbindung** erforderlich
- 4-Bit-Quantisierung (q4f16) läuft auf bescheidener Hardware
- **Keine Token-Kosten** und keine Datenübermittlung an Dritte

### 4.3 RAG-Chat über deine Daten (Pro)

- Die KI "liest" deine lokalen Notizen vor der Antwort
- Antworten basierend auf deinem spezifischen Wissen
- Hybride Architektur mit lokalem semantischem Cache
- Ähnliche Fragen nutzen 0 Tokens und 0 API-Aufrufe

### 4.4 Experten-Agenten (Pro)

- Spezialisierte Agenten für verschiedene Bereiche
- Automatisieren komplexe Analyseaufgaben

---

## 5. P2P-Synchronisation

### 5.1 Anforderungen

- Beide Geräte im selben WLAN-Netzwerk
- Firewall muss WebRTC zulassen
- Übereinstimmende Sync-IDs

### 5.2 Einrichtung

1. Gehe zu **Einstellungen > Sync**
2. Aktiviere "P2P-Sync aktivieren"
3. Stelle sicher, dass beide Geräte im selben Netzwerk sind
4. Bestätige, dass die Sync-IDs übereinstimmen

### 5.3 Fehlerbehebung

| Problem | Lösung |
|---|---|
| Sync schlägt fehl | Überprüfe, ob beide Geräte im selben WLAN sind |
| Firewall blockiert WebRTC | Konfiguriere Firewall, um WebRTC zuzulassen |
| Sync-IDs stimmen nicht überein | Starte den Sync-Raum neu |
| Langsame Verbindung | Überprüfe die Netzwerklatenz |

---

## 6. Sicherheit und Datenschutz

### 6.1 Verschlüsselung

- **AES-GCM** mit durch **Argon2id** abgeleiteten Schlüsseln (Version 4)
- Schlüssel werden niemals im Klartext gespeichert
- On-the-fly abgeleitet und existieren nur im Speicher (RAM)
- Nutzt die native SubtleCrypto-API des Browsers

### 6.2 Hauptpasswort

- Minimum 12 Zeichen
- Keine "Passwort vergessen"-Funktion vorhanden
- Dein Passwort ist der EINZIGE Schlüssel
- Wenn du es verlierst, **können wir dir nicht helfen**
- Speichere immer eine .bmf-Sicherung an einem sicheren Ort

### 6.3 Wiederherstellung

- Exportiere deinen Tresor jederzeit als `.bmf`-Datei
- Format: Verschlüsseltes JSON mit deinem Hauptschlüssel
- Speichere es sicher (USB, externes Laufwerk, verschlüsselte Cloud)
- Zum Wiederherstellen: Gehe zu **Einstellungen > Wiederherstellen** und wähle deine .bmf-Datei
- Die Wiederherstellung erfordert dein Hauptpasswort

### 6.4 Datenschutzrichtlinie

- **Zero-Knowledge:** Entwickler haben keine Kenntnis deiner Schlüssel oder Daten
- Kein Google Analytics, keine Telemetrie, keine Tracking-Pixel
- Keine zentralen Server, die deine Daten speichern
- DSGVO durch Design
- Der Lizenzserver validiert deine Lizenz ohne Zugriff auf deinen Tresor

### 6.5 Lizenzvalidierung

- Die Pro-Lizenz wird nach einem initialen Handshake lokal validiert
- Keine ständige Überwachung
- Lizenznachweis signiert mit RSA-PSS (SHA-256, Salt 32)
- Re-Validierung alle 48 Stunden bei Verbindung
- Nachweise älter als 30 Tage werden vom Entitlement-Server abgelehnt

---

## 7. Free vs Pro

### 7.1 Funktionsvergleich

| Funktion | Free | Pro |
|---|---|--- |
| Preis | $0 | $79 (lebenslang) |
| Lesezeichen | 2.500 | Unbegrenzt |
| Geräte | Keine Begrenzung (jedes Gerät hat eigenen Tresor) | Bis zu 5 + P2P-Sync |
| KI mit eigenem Schlüssel | ✅ | ✅ |
| Lokale KI (WebLLM/Ollama) | ❌ | ✅ |
| RAG-Chat über deine Daten | ❌ | ✅ |
| Lernkarten + PDF/OCR | ❌ | ✅ |
| Erweiterter Export (10+ Formate) | ❌ | ✅ |
| Lokale Tresor-Verschlüsselung (AES-GCM) | ✅ | ✅ |
| Support | Community | E-Mail 48h |
| v2/v3-Rabatte | ❌ | 60% Rabatt |

### 7.2 Wie man auf Pro aktualisiert

1. Gehe zu **Einstellungen > Abonnement**
2. Klicke auf **"Get Pro Lifetime"**
3. Du wirst zu Whop für die Zahlung weitergeleitet
4. Nach dem Kauf aktiviert sich die App automatisch
5. Die Lizenz wird vom Server validiert und lokal signiert

**Early Bird:** Die ersten 200 Käufer zahlen $59 (ausverkauft oder bis 2026-12-31). Der reguläre Preis ist $79.

### 7.3 Zukünftige Updates (v2, v3)

- v1-Besitzer zahlen einen **60% Rabatt** auf zukünftige Hauptversionen
- v2 für neue Kunden: $89. v2 für v1-Besitzer: $35
- v3 für neue Kunden: $99. v3 für v1-Besitzer: $39
- v1-Besitzer **behalten v1 für immer funktional**

---

## 8. Import und Export

### Hinweis zu Pocket

Pocket-HTML-Exporte (`ril_export.html`) und Pocket-formatierte CSV-Dateien werden automatisch erkannt. Vor dem Speichern zeigt die App eine Vorschau mit Links, Daten und Tags. Gelesen-/Archiviert-Status bleibt erhalten; wenn die Free-Grenze beim Import erreicht wird, meldet das Ergebnis ehrlich, wie viele Elemente importiert wurden und dass die Grenze erreicht ist, anstatt den Rest als übersprungen zu zählen.

### 8.1 Import

Gehe zu **Einstellungen > Import**:
- **HTML/JSON aus Notion oder Evernote**
- **Chrome-Lesezeichen-Export**
- **.bmf-Sicherung**

### 8.2 Export

- **.bmf:** Vollständige verschlüsselte Sicherung
- **Markdown:** Notizen in lesbarem Format
- **PDF:** Exportiere Notizen als PDF-Dokumente
- **JSON:** Strukturierte Daten

### 8.3 Sicherung und Wiederherstellung

- Exportiere regelmäßig deinen Tresor als .bmf
- Speichere es an einem sicheren Ort
- Zum Wiederherstellen: Gehe zu **Einstellungen > Wiederherstellen** und wähle deine .bmf-Datei
- Die Wiederherstellung erfordert dein Hauptpasswort

---

## 9. Fehlerbehebung

### 9.1 App lädt nicht

1. Lösche den Browser-Cache
2. Aktualisiere Chrome/Edge auf die neueste Version
3. Überprüfe, ob deine Festplatte voll ist
4. Deaktiviere konfliktreiche Erweiterungen (Ad-Blocker blockieren manchmal IndexedDB)

### 9.2 Sync schlägt fehl

1. Überprüfe, ob beide Geräte im selben WLAN sind
2. Überprüfe, ob die Firewall WebRTC zulässt
3. Bestätige, dass die Sync-IDs übereinstimmen
4. Starte den Sync-Raum bei Bedarf neu

### 9.3 KI halluziniert oder antwortet falsch

1. KI kann Fehler machen — Nutze die "Quellen"-Links im Chat zur Überprüfung
2. Passe die "Temperatur" in den KI-Einstellungen an
3. Wenn du lokale KI nutzt, überprüfe, ob das Modell korrekt geladen ist

### 9.4 Erweiterungen speichern nicht

1. Aktualisiere die Seite, die du speichern möchtest
2. Stelle sicher, dass du in einem anderen Tab bei BookmarkForge eingeloggt bist
3. Installiere das Bookmarklet neu

### 9.5 Langsame Leistung

1. Gehe zu Einstellungen > Erweitert und führe "Datenbankoptimierung" aus
2. Überprüfe die Systemdiagnose für CPU-Auslastung
3. Virtualisierung verarbeitet große Listen, aber schwere Notizen können den RAM beeinflussen

### 9.6 Datenbank korrupt

1. Nutze "Systemdiagnose" zur Integritätsprüfung
2. Wenn korrupt, stelle von deiner letzten .bmf-Sicherung wieder her

### 9.7 Pro-Lizenz funktioniert nicht

1. Überprüfe, ob deine Internetverbindung funktioniert (periodische Validierung erforderlich)
2. Versuche Re-Validierung in **Einstellungen > Lizenz > Re-validieren**
3. Wenn das Problem besteht, kontaktiere **bookmarkforge@proton.me**
4. Innerhalb von 30 Tagen über Whop erstattungsfähig

### 9.8 Lizenzfehler: SIGNING_KEY_INVALID

Dieser Fehler zeigt, dass der Server nicht korrekt konfiguriert ist. Es ist kein Benutzerproblem. Kontaktiere den Support.

---

## 10. Erweiterte Konfiguration

Für erweiterte Bereitstellung, Self-Hosting und Server-API-Konfiguration,
siehe interne Dokumentation oder kontaktiere den Support.

> Die Lizenzvalidierung wird ausschließlich auf dem Server durchgeführt.
> BookmarkForge erfordert eine gültige Lizenz für den Zugriff auf Pro-Funktionen.

---

## 11. FAQ

**Ist es kostenlos?**
Die Hauptanwendung ist local-first und kostenlos. Erweiterte KI-Funktionen und P2P-Synchronisation erfordern eine Pro-Lizenz.

**Kann ich es auf Mobilgeräten nutzen?**
Ja. Installiere es als PWA über Chrome (Android) oder Safari (iOS). Unterstützt Offline-Zugriff und Push-Benachrichtigungen.

**Wo sind meine Dateien?**
Im Browserspeicher (IndexedDB). Du kannst sie jederzeit als .bmf, Markdown oder PDF exportieren.

**Funktioniert es ohne Internet?**
100%. Alle Funktionen (Editor, Lesezeichen, Graph, Lokale KI, Suche) funktionieren ohne Internetverbindung.

**Verbraucht es viele API-Tokens?**
Nein. Die App nutzt einen Semantischen Lokalen Cache. Wenn du Variationen derselben Frage stellst, nutzt sie 0 API-Tokens.

**Batterieverbrauch?**
Lokale KI nutzt WebGPU. Auf Laptops kann sie die Batterie schneller verbrauchen. Deaktiviere lokale KI in den Einstellungen, um Batterie zu sparen.

---

## 12. Support

| Stufe | Kanal | Antwortzeit |
|---|---|---|
| **Free** | Community — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | E-Mail — bookmarkforge@proton.me | 48h (Werktage) |

**Sicherheitshinweis:** Dein Tresor ist verschlüsselt. Wir können deine Daten nicht sehen. Verlorenes Passwort = Verlorene Daten. Der Support wird niemals nach deinem Passwort oder deiner Wiederherstellungsphrase fragen.

---

## 13. Rechtliches

- **Code-Lizenz:** MIT-or-later
- **Marke:** BookmarkForge und seine Marken sind geschützt (siehe `TRADEMARKS.md`)
- **Preise:** Eingefroren in `docs/pricing-decision.md`. Alle Preise sind lebenslang für Version 1.
- **Rückerstattungen:** 30 Tage über Whop. Vollständige Rückerstattungsrichtlinie.
- **Datenschutz:** Siehe `docs/ROPA.md` für das Verarbeitungsverzeichnis personenbezogener Daten unter DSGVO.

---

*Letzte Aktualisierung: September 2026 · Version 1.0.0*
