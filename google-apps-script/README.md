# Copie des formulaires dans Google (Sheet + Drive + email)

Chaque formulaire envoyé sur le site est aussi enregistré dans votre Google :
- **Google Sheet "PRO CV – Commandes"** : une ligne par client (nom, téléphone, poste, message complet).
- **Google Drive "PRO CV – Clients"** : un dossier par client avec sa photo et ses documents.
- **Un email** par nouveau client, avec la photo et les documents en pièce jointe
  (envoyé quand la dernière photo arrive, ou au plus tard après 10 minutes).

Ça marche même si le client n'appuie jamais sur "Envoyer" dans WhatsApp.

## Installation (une seule fois, ~5 min)

1. Ouvrez https://script.google.com avec votre compte Google → **Nouveau projet**.
2. Supprimez le code présent et collez tout le contenu de `Code.gs`. Enregistrez (Ctrl+S).
3. En haut, choisissez la fonction **setup** puis cliquez **▶ Exécuter**.
   Google demande l'autorisation → **Examiner les autorisations** → votre compte →
   **Paramètres avancés** → **Accéder au projet (non sécurisé)** → **Autoriser**.
   (C'est votre propre script, c'est normal.)
4. **Déployer** → **Nouveau déploiement** → icône ⚙ → **Application Web**.
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   → **Déployer** → copiez l'**URL de l'application Web** (finit par `/exec`).
5. Dans `index.html`, mettez cette URL ici :
   ```js
   var SAVE_URL = 'https://script.google.com/macros/s/XXXX/exec';
   ```
   puis publiez le site (commit + push).

## Modifier le script plus tard

Après un changement dans `Code.gs` : **Déployer** → **Gérer les déploiements** → ✏ →
Version : **Nouvelle version** → **Déployer**. L'URL reste la même.
