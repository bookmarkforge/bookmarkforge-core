# Benutzerhandbuch — BookmarkForge v1

**Version:** 1.0.0 · **Letzte Aktualisierung:** September 2026 · **Lizenz:** AGPL-3.0

## 1. Überblick

BookmarkForge speichert Lesezeichen, Notizen und Dokumente in einer persönlichen Wissenssammlung. Die Inhalte deines Tresors bleiben im lokalen Browser-Speicher. Der Tresorinhalt wird nicht an BookmarkForge gesendet. Wenn du einen externen KI-Anbieter nutzt, erhält dieser nur Daten, die du ausdrücklich an diese Funktion sendest.

Der Tresor wird lokal mit AES-GCM verschlüsselt; Argon2id leitet den Schlüssel aus deinem Passwort ab. Das Hauptpasswort ist unverzichtbar und kann von uns nicht zurückgesetzt werden.

## 2. Erste Schritte

1. Öffne [bookmarkforge.com](https://bookmarkforge.com).
2. Installiere die PWA, falls dein Browser dies anbietet, oder nutze die Web-App direkt.
3. Erstelle ein Hauptpasswort mit mindestens 12 Zeichen.
4. Bewahre die 24 Wörter der Wiederherstellung sicher auf.
5. Exportiere regelmäßig eine verschlüsselte `.bmf`-Sicherung.

Nach dem ersten Laden kann BookmarkForge offline verwendet werden. Bookmarklet und Browser-Erweiterungen speichern die aktuell geöffnete Seite.

## 3. Lesezeichen und Suche

- Speichere URL, Titel, Datum und Tags einer Seite.
- Die intelligente Suche nach Begriffen und Bedeutung ist in Free enthalten.
- Free erlaubt **1.000 Lesezeichen** und hat keine Gerätebegrenzung. Ohne Pro-Synchronisierung besitzt jedes Gerät jedoch seinen eigenen Tresor.
- Bei 1.000 Einträgen wird nichts gelöscht: Lesen, Suchen und Exportieren bleiben möglich. Nur neue Speicherungen werden angehalten.
- Pro hebt die Grenze auf und synchronisiert bis zu drei Geräte per P2P.

## 4. Von Pocket importieren

Öffne **Einstellungen → Import** und wähle `ril_export.html` oder eine Pocket-CSV-Datei. Das Format wird erkannt. Vor dem Speichern zeigt die App eine Vorschau mit Linkanzahl, vorhandenen Datumsangaben und Tags.

Gelesen-, ungelesen- und archiviert-Status bleiben erhalten. Wenn beim Import die Free-Grenze erreicht wird, meldet das Ergebnis ehrlich, wie viele Elemente importiert wurden und dass die Grenze erreicht ist. Die übrigen Elemente werden nicht als übersprungen gezählt.

## 5. Notizen, KI und Synchronisierung

Der Editor unterstützt strukturierte Notizen, Tabellen und Verknüpfungen zwischen Dokumenten. Bei einer KI mit deinem eigenen API-Schlüssel gelten die Bedingungen des jeweiligen Anbieters; du bezahlst ihn direkt.

Lokale KI mit WebLLM/Ollama, Chat über deine Daten, Lernkarten und P2P-Synchronisierung sind Pro-Funktionen. P2P kann dasselbe WLAN oder einen konfigurierten Signalisierungsdienst benötigen.

## 6. Sicherungen und Wiederherstellung

- Erstelle vor einer Migration eine `.bmf`-Sicherung.
- Bewahre mehrere Kopien an unterschiedlichen Orten auf.
- Für die Wiederherstellung wird dein Hauptpasswort benötigt.
- Ein verlorenes Passwort kann ohne Wiederherstellungsphrase oder brauchbare Sicherung nicht vom Support ersetzt werden.

## 7. Free und Pro

| Funktion | Free | Pro |
|---|---|---|
| Lesezeichen | 1.000 | Unbegrenzt |
| Geräte | Keine Begrenzung, getrennte Tresore | Bis zu 3 mit P2P |
| Intelligente Suche | Enthalten | Enthalten |
| KI mit eigenem Schlüssel | Ja | Ja |
| Lokale KI und RAG-Chat | Nein | Ja |
| JSON/HTML- und `.bmf`-Export | Ja | Ja |
| Zahlung | Kostenlos | Einmalige v1-Lizenz |

Aktiviere Pro über **Einstellungen → Pro** und den Whop-Checkout. Für die Aktivierung wird der Lizenzdienst kontaktiert; dein Tresor wird nicht übertragen.

## 8. Fehlerbehebung

- **App lädt nicht:** Browser aktualisieren, Speicherplatz prüfen und störende Erweiterungen testweise deaktivieren.
- **Speichern abgelehnt:** Free-Zähler prüfen; bei 1.000 exportieren, einen Eintrag löschen oder Pro aktivieren.
- **Synchronisierung scheitert:** Netzwerk, Firewall und Geräte-IDs prüfen.
- **Lizenz lässt sich nicht aktivieren:** Verbindung prüfen und den Fehlercode an den Support senden, niemals Passwort oder Wiederherstellungsphrase.

## 9. Datenschutz und Support

Der Tresorinhalt bleibt standardmäßig lokal. Optionale Dienste wie Zahlung, Lizenzprüfung, entfernte KI, Signalisierung oder Fehlerberichte verarbeiten nur ihre jeweils erforderlichen technischen Daten und benötigen gegebenenfalls deine Einwilligung.

Support: `bookmarkforge@proton.me`. Der Support fragt niemals nach Passwort oder Wiederherstellungsphrase.

*Letzte Aktualisierung: September 2026 · Version 1.0.0*