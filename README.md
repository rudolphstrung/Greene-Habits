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
