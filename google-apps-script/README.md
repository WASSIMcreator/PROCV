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

## Compteur de visiteurs du jour

Sous la ligne « 48 h », le site affiche « X شخص زار PRO CV اليوم » : le vrai nombre de
visiteurs du jour (heure du Maroc), compté par ce script. Chaque navigateur garde un
identifiant au hasard (pas de nom, pas d'IP) et compte une seule fois par jour.
La ligne reste cachée tant qu'il y a moins de 5 visiteurs, ou si le script ne répond pas.

Pour compter aussi vos **autres sites PRO CV**, collez ce code juste avant `</body>`
(ou dans « code personnalisé / scripts » de votre plateforme). Il compte la visite sans rien afficher :

```html
<script>
(function(){var u='https://script.google.com/macros/s/AKfycbzgv2FyFIPnSp7VxJ39ofa8LLK6Od-Cn9PF4VzkLLwC1-hgg8MdUEfEGdAYycyMEOtwtw/exec',k='procv-vid',id='';try{id=localStorage.getItem(k)||''}catch(e){}if(!/^[a-z0-9]{10}$/.test(id)){id='';while(id.length<10)id+=Math.random().toString(36).slice(2);id=id.slice(0,10);try{localStorage.setItem(k,id)}catch(e){}}if(window.fetch)fetch(u+'?a=seen&id='+id).catch(function(){});})();
</script>
```

Une même personne qui ouvre deux sites différents compte deux fois (chaque site a sa
propre mémoire dans le navigateur).

## Modifier le script plus tard

Après un changement dans `Code.gs`, **dans cet ordre** :

1. Collez le nouveau code et enregistrez (Ctrl+S).
2. Choisissez la fonction **setup** → **▶ Exécuter**, et acceptez les nouvelles autorisations
   si Google les demande. **Obligatoire** : sans ça, le site reçoit des erreurs
   (« Autorisation requise ») et la vérification des 10 minutes n'existe pas.
3. **Déployer** → **Gérer les déploiements** → ✏ → Version : **Nouvelle version** → **Déployer**.
   L'URL reste la même.
