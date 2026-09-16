# Manuel utilisateur — BookmarkForge v1

**Version :** 1.0.0 · **Dernière mise à jour :** septembre 2026 · **Licence :** MIT

## 1. Présentation

BookmarkForge est une application personnelle pour enregistrer des liens, prendre des notes et organiser ses connaissances. Vos marque-pages, notes et documents restent dans le stockage local de votre navigateur. Le contenu de votre coffre n’est pas envoyé à BookmarkForge. Si vous utilisez un fournisseur d’IA externe, seules les données que vous envoyez explicitement à cette fonction lui sont transmises.

Le coffre est chiffré localement avec AES-GCM et une clé dérivée avec Argon2id. Votre mot de passe est indispensable : nous ne pouvons pas le récupérer.

## 2. Commencer

1. Ouvrez [bookmarkforge.com](https://bookmarkforge.com).
2. Installez l’application si votre navigateur propose l’installation PWA, ou utilisez-la directement.
3. Créez un mot de passe maître d’au moins 12 caractères.
4. Conservez les 24 mots de récupération dans un endroit sûr.
5. Exportez régulièrement une sauvegarde `.bmf` chiffrée.

Vous pouvez utiliser BookmarkForge hors connexion après le premier chargement. Le bookmarklet et les extensions servent à enregistrer rapidement la page ouverte.

## 3. Marque-pages et recherche

- Enregistrez une page, son titre, sa date et ses étiquettes.
- Utilisez la recherche par mots-clés ou par sens : la recherche intelligente est incluse dans Free.
- Free autorise **1 000 marque-pages** et ne limite pas le nombre d’appareils. Chaque appareil possède toutefois son propre coffre tant que vous n’utilisez pas la synchronisation P2P de Pro.
- À 1 000 éléments, rien n’est supprimé : la lecture, la recherche et l’export restent disponibles. Seuls les nouveaux enregistrements sont mis en pause.
- Pro supprime cette limite et ajoute la synchronisation P2P entre trois appareils.

## 4. Importer depuis Pocket

Ouvrez **Paramètres → Importer** et sélectionnez `ril_export.html` ou un CSV exporté depuis Pocket. L’application détecte le format et affiche une prévisualisation avant toute écriture : nombre de liens, dates disponibles et étiquettes détectées.

Les états lu, non lu et archivé sont conservés. Si l’import atteint la limite Free, le résultat indique clairement le nombre importé et que la limite est atteinte ; les éléments restants ne sont pas comptés comme ignorés.

## 5. Notes, IA et synchronisation

L’éditeur permet de créer des notes structurées, des tableaux et des liens entre documents. L’IA avec votre propre clé est séparée de BookmarkForge : vous payez directement le fournisseur et ses règles de confidentialité s’appliquent.

L’IA locale WebLLM/Ollama, le chat sur vos données, les flashcards et la synchronisation P2P sont des fonctions Pro. La synchronisation P2P peut nécessiter le même réseau Wi-Fi ou un serveur de signalisation configuré.

## 6. Sauvegarde et récupération

- Exportez un `.bmf` avant une migration ou une opération importante.
- Gardez plusieurs copies dans des endroits différents.
- La restauration demande le mot de passe du coffre.
- Un mot de passe perdu sans phrase de récupération ni sauvegarde exploitable ne peut pas être réinitialisé par le support.

## 7. Free et Pro

| Fonction | Free | Pro |
|---|---|---|
| Marque-pages | 1 000 | Illimités |
| Appareils | Sans limite, coffres séparés | Jusqu’à 3 avec P2P |
| Recherche intelligente | Incluse | Incluse |
| IA avec votre clé | Oui | Oui |
| IA locale et chat RAG | Non | Oui |
| Export JSON/HTML et `.bmf` | Oui | Oui |
| Paiement | Gratuit | Achat unique, licence v1 |

Pour acheter Pro, ouvrez **Paramètres → Pro** et utilisez le checkout Whop. L’activation nécessite une connexion au service de licence ; votre coffre n’est pas envoyé au service.

## 8. Dépannage

- **L’application ne se charge pas :** actualisez le navigateur, vérifiez l’espace disponible et essayez sans extension bloquante.
- **Un enregistrement est refusé :** vérifiez le compteur Free ; à 1 000, exportez, supprimez un élément ou activez Pro.
- **La synchronisation échoue :** vérifiez le réseau, le pare-feu et les identifiants des deux appareils.
- **Une licence ne s’active pas :** vérifiez la connexion et contactez le support avec le code d’erreur, jamais avec votre mot de passe ou votre phrase de récupération.

## 9. Confidentialité et support

Le contenu du coffre reste local par défaut. Les services facultatifs — paiement, licence, IA distante, signalisation ou suivi d’erreurs si vous y consentez — ont leurs propres données techniques et conditions.

Support : `bookmarkforge@proton.me`. Le support ne demandera jamais votre mot de passe ni vos 24 mots.

*Dernière mise à jour : septembre 2026 · Version 1.0.0*