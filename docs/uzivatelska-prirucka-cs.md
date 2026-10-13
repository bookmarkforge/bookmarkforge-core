# Uživatelská příručka — BookmarkForge v1

**Verze:** 1.0.0 · **Poslední aktualizace:** září 2026 · **Licence:** MIT

## Začínáme

BookmarkForge ukládá záložky, poznámky a dokumenty a pomáhá organizovat osobní znalosti. Obsah trezoru zůstává v místním úložišti prohlížeče a neposílá se do BookmarkForge. Externí poskytovatel AI obdrží jen data, která mu výslovně odešlete.

Trezor se místně šifruje pomocí AES-GCM a klíč se odvozuje z hlavního hesla pomocí Argon2id. Hlavní heslo nelze obnovit podporou.

1. Otevřete [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Vytvořte hlavní heslo dlouhé alespoň 12 znaků.
3. Bezpečně uložte 24 obnovovacích slov.
4. Pravidelně exportujte šifrovanou zálohu `.bmf`.

## Záložky a vyhledávání

Free obsahuje chytré vyhledávání podle slov i významu. Free umožňuje **2 500 záložek** a nemá limit počtu zařízení; bez synchronizace Pro má každé zařízení vlastní trezor. Po dosažení 2 500 se nic nemaže: čtení, vyhledávání a export pokračují, pouze se pozastaví nové ukládání. Pro limit odstraní a synchronizuje až pět zařízení přes P2P.

## Import z Pocket

V nabídce **Nastavení → Import** vyberte `ril_export.html` nebo CSV exportované z Pocket. Před uložením se zobrazí náhled odkazů, dat a štítků. Zachovají se stavy přečteno, nepřečteno a archivováno. Při dosažení limitu Free výsledek uvede počet importovaných položek a dosažení limitu; zbytek se nepočítá jako přeskočený.

## Poznámky, AI a synchronizace

Editor podporuje strukturované poznámky, tabulky a odkazy mezi dokumenty. Lokální AI WebLLM/Ollama, RAG chat, kartičky a P2P synchronizace jsou funkce Pro. Při použití vlastního API klíče platí podmínky daného poskytovatele.

## Zálohy a pomoc

Uchovávejte několik kopií `.bmf` na různých místech. Obnovení vyžaduje hlavní heslo. Při odmítnutém uložení zkontrolujte počítadlo Free; při potížích se synchronizací zkontrolujte síť, firewall a ID zařízení. Heslo ani obnovovací slova nikdy neposílejte podpoře.

Podpora: `bookmarkforge@proton.me`.

*Poslední aktualizace: září 2026 · Verze 1.0.0*