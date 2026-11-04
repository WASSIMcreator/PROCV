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

## Alerte WhatsApp automatique (optionnel)

À chaque commande, le script peut vous envoyer sur WhatsApp les informations du client
et le lien Drive des photos (les fichiers eux-mêmes restent dans Drive).

1. Ajoutez le numéro **+34 644 66 32 62** (CallMeBot) dans vos contacts, puis envoyez-lui
   sur WhatsApp : `I allow callmebot to send me messages`. Il vous répond avec un **apikey**.
2. Dans Apps Script : ⚙ **Paramètres du projet** → **Propriétés du script** → ajoutez
   `WA_PHONE` = votre numéro (ex. `212706828446`) et `WA_APIKEY` = l'apikey reçu.
3. Choisissez la fonction **testWhatsApp** → **▶ Exécuter** : vous devez recevoir un message.

Sans ces deux propriétés, rien n'est envoyé sur WhatsApp (l'email marche toujours).

## Modifier le script plus tard

Après un changement dans `Code.gs`, **dans cet ordre** :

1. Collez le nouveau code et enregistrez (Ctrl+S).
2. Choisissez la fonction **setup** → **▶ Exécuter**, et acceptez les nouvelles autorisations
   si Google les demande. **Obligatoire** : sans ça, le site reçoit des erreurs
   (« Autorisation requise ») et la vérification des 10 minutes n'existe pas.
3. **Déployer** → **Gérer les déploiements** → ✏ → Version : **Nouvelle version** → **Déployer**.
   L'URL reste la même.
