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

## Protection anti-spam

Le lien `/exec` est visible dans le code du site, donc n'importe qui peut lui envoyer des données.
Le script refuse :
- les fichiers (les photos et documents arrivent par WhatsApp) ;
- les formulaires sans nom ou sans téléphone, et les envois trop gros ;
- les robots qui remplissent le champ caché `pc_check` ;
- plus de **20** nouvelles commandes par heure, et plus de **3** par numéro de téléphone en 6 h
  (à changer en haut de `Code.gs` : `MAX_NEW_PER_HOUR`, `MAX_NEW_PER_PHONE`).

Un client refusé envoie quand même ses réponses dans WhatsApp : rien n'est perdu.

## Modifier le script plus tard

Après un changement dans `Code.gs`, **dans cet ordre** :

1. Collez le nouveau code et enregistrez (Ctrl+S).
2. Choisissez la fonction **setup** → **▶ Exécuter**, et acceptez les nouvelles autorisations
   si Google les demande. **Obligatoire** : sans ça, le site reçoit des erreurs
   (« Autorisation requise ») et la vérification des 10 minutes n'existe pas.
3. **Déployer** → **Gérer les déploiements** → ✏ → Version : **Nouvelle version** → **Déployer**.
   L'URL reste la même.

## Meta Conversions API (Lead + Purchase côté serveur)

Le script renvoie à Meta, depuis Google :
- **Lead** quand un client envoie le formulaire avec un allemand **A2 ou plus** et un vrai numéro.
  Il porte le même `event_id` que le Lead du Pixel : Meta n'en compte qu'un.
- **Purchase (200 MAD)** quand vous cochez **Payé** dans la feuille `Commandes`. Une seule fois
  par ligne : décocher puis recocher n'envoie rien de plus.

Email, téléphone, prénom et nom sont envoyés hachés (SHA-256). Le statut de chaque envoi
s'écrit dans `CAPI_Lead_Status` et `CAPI_Purchase_Status`.

1. Meta **Events Manager** → votre Pixel **1814127609805768** → **Paramètres** →
   **API Conversions** → **Générer un token d'accès**. Copiez-le.
2. Apps Script → ⚙ **Paramètres du projet** → **Propriétés du script** → ajoutez
   `META_CAPI_TOKEN` = le token. Pour tester, ajoutez aussi `META_TEST_EVENT_CODE` = le code
   affiché dans **Tester les événements** (ex. `TEST12345`), puis **supprimez-le** après le test.
3. Collez le nouveau `Code.gs`, enregistrez, exécutez **setup** puis **setupCapiColumns**
   (acceptez les autorisations), puis **Déployer** → **Gérer les déploiements** → ✏ →
   **Nouvelle version**. `setupCapiColumns` ajoute les colonnes à la fin de la feuille et crée
   le déclencheur « Lors d'une modification » pour `onCommandesEdit`.
4. Vérifiez : exécutez **testCapi** (le journal doit afficher `OK`), puis envoyez un formulaire
   en B1 et cochez **Payé** sur sa ligne : dans **Tester les événements**, vous devez voir
   un Lead (Navigateur + Serveur, dédupliqué) et un Purchase (Serveur).

Ne mettez jamais le token dans `Code.gs` ni dans le site.
