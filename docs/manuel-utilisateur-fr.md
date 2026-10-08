# Manuel utilisateur — BookmarkForge v1

**Version :** 1.0.0 · **Dernière mise à jour :** septembre 2026 · **Licence :** MIT

---

## 1. Présentation

BookmarkForge est une application de connaissance personnelle **local-first** qui vous permet d'enregistrer des liens, de prendre des notes, d'organiser vos connaissances avec des graphes interactifs, d'utiliser l'IA directement dans votre navigateur, et de synchroniser entre appareils sans dépendre de serveurs centraux.

**Ce qui rend BookmarkForge unique :**

- **Vos liens, notes et documents vivent dans votre navigateur** (IndexedDB/RxDB). Le contenu du coffre n'est pas envoyé à BookmarkForge ; si vous utilisez un fournisseur d'IA externe, il ne reçoit que ce que vous envoyez explicitement via cette fonction.
- **Chiffrement de bout en bout** avec AES-GCM et Argon2id. Même les développeurs ne peuvent pas lire votre coffre.
- **IA locale** qui fonctionne hors connexion et sans envoyer vos données à des tiers.
- **Synchronisation P2P** entre vos appareils sans serveurs centraux.
- **Sans abonnement.** Payez une fois et c'est à vous pour toujours.

---

## 2. Premiers pas

### 2.1 Exigences

- Navigateur moderne : Chrome, Edge, Firefox, Safari (16+)
- 8 Go de RAM recommandés
- GPU de base pour l'IA locale (WebGPU)
- Connexion internet (pour l'installation initiale et la synchronisation ; optionnel pour l'utilisation hors ligne)

### 2.2 Installation

1. Ouvrez [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Cliquez sur **"Install App"** ou **"Add to Home Screen"**
3. L'application s'installe comme PWA (Progressive Web App)
4. Vous pouvez également l'utiliser comme extension de navigateur

### 2.3 Configuration initiale

1. **Mot de passe maître :** Minimum 12 caractères. Une phrase de passe est recommandée.
   - Dérive votre clé AES-GCM avec Argon2id (KDF obligatoire depuis ADR-019)
   - **Votre mot de passe est la SEULE clé.** Si vous le perdez, il n'y a pas de récupération.
2. **Phrase de récupération :** Sauvegardez les 24 mots dans un endroit sécurisé.
3. **Device ID :** Généré automatiquement. Utilisé pour activer les licences Pro.

### 2.4 Le bookmarklet

Faites glisser le bouton **"Save to Forge"** vers la barre de favoris de votre navigateur. Chaque fois que vous êtes sur une page web, cliquez dessus pour l'enregistrer comme lien.

---

## 3. Fonctionnalités principales

### 3.1 Liens

- **Liste virtualisée** gérant 100 000+ éléments sans retard
- **Recherche approfondie :** recherche dans le texte complet des pages enregistrées
- **Collections intelligentes :** auto-organisation par étiquette
- **Import/Export :** depuis Notion, Evernote, Chrome, ou exportez en .bmf, Markdown, PDF
- **Free :** 2 500 liens, recherche intelligente incluse et sans limite d'appareils. À 2 500, vos données restent disponibles pour lecture, recherche et export ; seuls les nouveaux enregistrements sont en pause. **Pro :** liens illimités.

### 3.2 Éditeur de notes

Éditeur basé sur blocs avec :
- Commandes `/` pour insertion rapide de blocs
- Glisser-déposer
- LaTeX pour les mathématiques
- Diagrammes Mermaid pour les graphiques
- Coloration syntaxique pour 50+ langages
- **AI Copilot** pour assistance en temps réel

### 3.3 Graphe de connaissances

Visualisation interactive 3D/2D de vos notes :
- Filtrez par étiquette, date, ou "Force de connexion"
- Visualisez les similitudes sémantiques entre notes non apparentées
- Explorez comment vos idées se connectent dans le temps

### 3.4 Flashcards

- Algorithme modifié de type Anki de **Répétition Espacée (SRK)**
- Suit votre "courbe d'oubli" pour afficher les cartes au moment parfait
- Supporte l'occlusion d'images et la suppression de texte
- **Disponible uniquement en Pro**

### 3.5 Commandes vocales

Moteur Voix vers Action :
- Dites "Hey BMF, trouve mes notes de Biologie"
- Dites "Enregistre cette page"
- Fonctionne 100% hors connexion via la Web Speech API

### 3.6 Omnibar (Ctrl+K)

Le cerveau de l'application :
- Mathématiques, conversion d'unités
- Recherche simultanée de liens et notes
- Tapez `>` pour les commandes système

---

## 4. IA dans BookmarkForge

### 4.1 IA avec votre propre clé API (Free)

- Utilise Gemini, OpenAI, Anthropic, ou tout fournisseur compatible
- Vous payez les coûts de tokens directement à votre fournisseur
- L'application route dynamiquement les requêtes vers le modèle optimal
- **Cache sémantique local :** si vous posez des questions similaires, utilise 0 tokens d'API

### 4.2 IA Locale — WebLLM/Ollama (Pro)

- Exécute des modèles d'IA complets (comme Llama 3.2, Qwen 2.5) directement dans votre navigateur
- Utilise votre carte graphique (WebGPU)
- **Pas de connexion internet** requise pour fonctionner
- Quantification 4 bits (q4f16) pour s'exécuter sur matériel modeste
- **Aucun coût de tokens** et pas d'envoi de données à des tiers

### 4.3 Chat RAG sur vos données (Pro)

- L'IA "lit" vos notes locales avant de répondre
- Répond basé sur vos connaissances spécifiques
- Architecture hybride avec cache sémantique local
- Si vous posez des questions similaires, l'application utilise 0 tokens et 0 appels API

### 4.4 Agents experts (Pro)

- Agents spécialisés dans différents domaines
- Automatisent des tâches complexes d'analyse

---

## 5. Synchronisation P2P

### 5.1 Exigences

- Les deux appareils sur le même réseau Wi-Fi
- Le pare-feu doit autoriser WebRTC
- IDs de synchronisation correspondants

### 5.2 Configuration

1. Allez à **Paramètres > Synchronisation**
2. Activez "Activer la synchronisation P2P"
3. Assurez-vous que les deux appareils sont sur le même réseau
4. Confirmez que les IDs de synchronisation correspondent

### 5.3 Dépannage

| Problème | Solution |
|---|---|
| La synchro échoue | Vérifiez que les deux appareils sont sur le même Wi-Fi |
| Pare-feu bloquant WebRTC | Configurez le pare-feu pour autoriser WebRTC |
| IDs de synchro ne correspondent pas | Redémarrez la Salle de Synchronisation |
| Connexion lente | Vérifiez la latence du réseau |

---

## 6. Sécurité et confidentialité

### 6.1 Chiffrement

- **AES-GCM** avec clés dérivées par **Argon2id** (version 4)
- Les clés ne sont jamais stockées en texte clair
- Dérivées à la volée et n'existent qu'en mémoire (RAM)
- Utilise l'API SubtleCrypto native du navigateur

### 6.2 Mot de passe maître

- Minimum 12 caractères
- Pas de fonctionnalité "Mot de passe oublié"
- Votre mot de passe est la SEULE clé
- Si vous le perdez, **nous ne pouvons pas vous aider**
- Sauvegardez toujours une copie .bmf dans un endroit sécurisé

### 6.3 Récupération

- Exportez votre coffre comme fichier `.bmf` à tout moment
- Format : JSON chiffré avec votre clé maître
- Stockez-le en sécurité (USB, disque externe, cloud chiffré)
- Pour restaurer : allez à **Paramètres > Restaurer** et sélectionnez votre fichier .bmf
- La restauration nécessite votre mot de passe maître

### 6.4 Politique de confidentialité

- **Zero-knowledge :** les développeurs ont une connaissance zéro de vos clés ou données
- Pas de Google Analytics, pas de télémétrie, pas de pixels de suivi
- Pas de serveurs centraux stockant vos données
- RGPD par conception
- Le serveur de licences valide votre licence sans accéder à votre coffre

### 6.5 Validation de licences

- La licence Pro est validée localement après un handshake initial
- Pas de suivi constant
- Preuve de licence signée avec RSA-PSS (SHA-256, salt 32)
- Re-validation toutes les 48 heures lors de la connexion
- Les preuves de plus de 30 jours sont rejetées par le serveur d'entitlement

---

## 7. Free vs Pro

### 7.1 Tableau comparatif

| Fonctionnalité | Free | Pro |
|---|---|--- |
| Prix | $0 | $79 (à vie) |
| Liens | 2 500 | Illimités |
| Appareils | Sans limite (chaque appareil a son coffre) | Jusqu'à 5 + synchro P2P |
| IA avec clé propre | ✅ | ✅ |
| IA Locale (WebLLM/Ollama) | ❌ | ✅ |
| Chat RAG sur vos données | ❌ | ✅ |
| Flashcards + PDF/OCR | ❌ | ✅ |
| Export avancé (10+ formats) | ❌ | ✅ |
| Chiffrement local du coffre (AES-GCM) | ✅ | ✅ |
| Support | Communauté | Email 48h |
| Réductions v2/v3 | ❌ | 60% de réduction |

### 7.2 Comment passer à Pro

1. Allez à **Paramètres > Abonnement**
2. Cliquez sur **"Get Pro Lifetime"**
3. Vous serez redirigé vers Whop pour le paiement
4. Après l'achat, l'application s'active automatiquement
5. La licence est validée par le serveur et signée localement

**Early Bird :** Les 200 premiers acheteurs paient $59 (épuisé ou jusqu'au 2026-12-31). Le prix régulier est $79.

### 7.3 Mises à jour futures (v2, v3)

- Les propriétaires de v1 paient une **réduction de 60%** sur les futures versions majeures
- v2 pour nouveaux : $89. v2 pour propriétaires v1 : $35
- v3 pour nouveaux : $99. v3 pour propriétaires v1 : $39
- Les propriétaires de v1 **gardent v1 fonctionnel pour toujours**

---

## 8. Importer et exporter

### Note sur Pocket

L'importation reconnaît les exportations HTML (`ril_export.html`) et CSV de Pocket. Avant d'enregistrer quoi que ce soit, l'application affiche un aperçu avec les liens, dates et étiquettes. L'état lu/archivé est préservé ; si la limite Free est atteinte, le résultat indique combien d'éléments ont été importés et que la limite est atteinte, sans compter le reste comme ignoré.

### 8.1 Importer

Allez à **Paramètres > Importer** :
- **HTML/JSON depuis Notion ou Evernote**
- **Export de liens Chrome**
- **Sauvegarde .bmf**

### 8.2 Exporter

- **.bmf :** Sauvegarde complète chiffrée
- **Markdown :** Notes en format lisible
- **PDF :** Exporte les notes comme documents PDF
- **JSON :** Données structurées

### 8.3 Sauvegarde et restauration

- Exportez régulièrement votre coffre comme .bmf
- Stockez-le dans un endroit sécurisé
- Pour restaurer : allez à **Paramètres > Restaurer** et sélectionnez votre fichier .bmf
- La restauration nécessite votre mot de passe maître

---

## 9. Dépannage

### 9.1 L'application ne charge pas

1. Videz le cache du navigateur
2. Mettez à jour Chrome/Edge vers la dernière version
3. Vérifiez si votre disque est plein
4. Désactivez les extensions en conflit (les bloqueurs de publicités bloquent parfois IndexedDB)

### 9.2 La synchronisation échoue

1. Assurez-vous que les deux appareils sont sur le même Wi-Fi
2. Vérifiez que le pare-feu autorise WebRTC
3. Confirmez que les IDs de synchronisation correspondent
4. Redémarrez la Salle de Synchronisation si nécessaire

### 9.3 L'IA hallucine ou répond incorrectement

1. L'IA peut se tromper — utilisez les liens "Sources" dans le Chat pour vérifier
2. Ajustez la "Température" dans les paramètres IA
3. Si vous utilisez l'IA locale, vérifiez que le modèle est chargé correctement

### 9.4 Les extensions n'enregistrent pas

1. Mettez à jour la page que vous essayez d'enregistrer
2. Assurez-vous d'être connecté à BookmarkForge dans un autre onglet
3. Réinstallez le bookmarklet

### 9.5 Performance lente

1. Allez à Paramètres > Avancé et exécutez "Optimisation de la base de données"
2. Vérifiez le Diagnostic du système pour l'utilisation CPU
3. La virtualisation gère les grandes listes, mais les notes lourdes peuvent affecter la RAM

### 9.6 Base de données corrompue

1. Utilisez "Diagnostic du système" pour vérifier l'intégrité
2. Si elle est corrompue, restaurez depuis votre dernière sauvegarde .bmf

### 9.7 La licence Pro ne fonctionne pas

1. Vérifiez que votre connexion internet fonctionne (validation périodique requise)
2. Essayez de re-valider dans **Paramètres > Licence > Re-valider**
3. Si le problème persiste, contactez **bookmarkforge@proton.me**
4. Remboursable dans les 30 jours via Whop

### 9.8 Erreur de licence : SIGNING_KEY_INVALID

Cette erreur indique que le serveur n'est pas configuré correctement. Ce n'est pas un problème utilisateur. Contactez le support.

---

## 10. Configuration avancée

Pour les configurations avancées de déploiement, auto-hébergement et API du serveur,
référez-vous à la documentation interne ou contactez le support.

> La validation de licences est effectuée exclusivement sur le serveur.
> BookmarkForge nécessite une licence valide pour accéder aux fonctionnalités Pro.

---

## 11. FAQ

**Est-ce gratuit ?**
L'application principale est local-first et gratuite. Les fonctionnalités avancées d'IA et de synchronisation P2P nécessitent une licence Pro.

**Puis-je l'utiliser sur mobile ?**
Oui. Installez-la comme PWA via Chrome (Android) ou Safari (iOS). Supporte l'accès hors ligne et les notifications push.

**Où sont mes fichiers ?**
Dans le stockage interne du navigateur (IndexedDB). Vous pouvez les exporter comme .bmf, Markdown ou PDF à tout moment.

**Fonctionne-t-il sans internet ?**
100%. Toutes les fonctionnalités (Éditeur, Liens, Graphe, IA Locale, Recherche) fonctionnent sans connexion internet.

**Consomme-t-il beaucoup de tokens d'API ?**
Non. L'application utilise un algorithme de Cache Sémantique Local. Si vous posez des variations de la même question, elle utilise 0 tokens d'API.

**Consommation de batterie ?**
L'IA locale utilise WebGPU. Sur les ordinateurs portables, elle peut consommer la batterie plus rapidement. Désactivez l'IA locale dans les paramètres pour économiser la batterie.

---

## 12. Support

| Niveau | Canal | Temps de réponse |
|---|---|---|
| **Free** | Communauté — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | Email — bookmarkforge@proton.me | 48h (jours ouvrables) |

**Note de sécurité :** Votre coffre est chiffré. Nous ne pouvons pas voir vos données. Mot de passe perdu = données perdues. Le support ne vous demandera jamais votre mot de passe ou votre phrase de récupération.

---

## 13. Légal

- **Licence du code :** MIT-or-later
- **Marque :** BookmarkForge et ses marques sont protégées (voir `TRADEMARKS.md`)
- **Tarifs :** Figés dans `docs/pricing-decision.md`. Tous les prix sont à vie version 1.
- **Remboursements :** 30 jours via Whop. Politique de remboursement complète.
- **Confidentialité :** Voir `docs/ROPA.md` pour le registre de traitement des données personnelles sous RGPD.

---

*Dernière mise à jour : septembre 2026 · Version 1.0.0*
