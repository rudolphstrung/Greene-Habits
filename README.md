# Greene Habits

Habit tracker partagé, page unique, sans compte utilisateur.

## Développement

    npm install
    DB_PATH=./dev.db npm start     # http://localhost:3000
    npm test

## Déploiement

Container Node servant le front et l'API. La base SQLite vit dans un volume
monté sur `/data` — jamais dans l'image, sinon chaque redéploiement effacerait
tout l'historique.

- Domaine : `greene.shinouki.com`
- Volume Dokploy : `greene-data` → `/data`
- Port : 3000

## Règles du modèle

- Le rouge n'est jamais stocké : un point vire au rouge parce que sa période
  est passée sous l'objectif, ce qui est recalculé à chaque lecture. Aucun cron.
- `date_ref` = le jour pour une habitude quotidienne, le lundi de la semaine
  pour une hebdomadaire.
- Le type d'une habitude est immuable après création.
- Rien n'est jamais supprimé : `archived = 1`.
- Chaque entry fige l'objectif de l'habitude au moment où elle est écrite
  (`entries.objectif`). Une période passée est jugée sur l'objectif en vigueur
  à l'époque ; seule la période en cours suit l'objectif actuel. Augmenter
  l'objectif d'une habitude ne repeint donc jamais en rouge une période déjà
  réussie — la barre ne monte qu'à partir de maintenant.
- Un point n'est cliquable que dans la fenêtre acceptée par `/api/toggle`
  (création de l'habitude → période courante incluse), ce que le serveur
  expose via `cliquable` sur chaque point ; le front ne le devine jamais.
