# 🏛️ Immo Versailles — Observatoire des ventes par quartier

Application web qui montre **toutes les ventes immobilières réelles de Versailles**
(appartements et maisons), quartier par quartier, à partir des données notariées
publiées par l'État (base DVF).

## Ce que fait l'application

- **Carte des 8 quartiers officiels**, coloriés selon le nombre de ventes
  (foncé = beaucoup de ventes, clair = peu).
- **Classement des quartiers** : nombre de ventes, prix médian au m², tendance.
- **Chaque vente sur la carte** : prix, surface, prix au m², pièces, adresse, date.
- **Courbes d'évolution** des prix et des volumes, année par année.
- **Volet « À vendre »** : saisissez une annonce repérée (prix, surface, quartier),
  l'application la compare aux ventes réelles et dit si c'est une opportunité.
- **Mise à jour automatique** : un robot (GitHub Actions) vérifie chaque mois si
  l'État a publié de nouvelles ventes et met le site à jour tout seul.

## Comment c'est rangé

| Dossier / fichier | Rôle |
|---|---|
| `app/` | Le site web lui-même (ce qui est publié en ligne) |
| `app/data/` | Les données nettoyées que le site affiche |
| `data/raw/` | Les fichiers bruts téléchargés depuis data.gouv.fr |
| `scripts/build_data.py` | La « recette » : télécharge et nettoie les données |
| `scripts/serve.py` | Petit serveur pour voir le site sur cet ordinateur |
| `.github/workflows/` | Le robot de mise à jour et de publication |

## Voir le site sur cet ordinateur

```bash
python3 scripts/serve.py
```

puis ouvrir <http://localhost:8642> dans le navigateur.

## Mettre à jour les données à la main (optionnel)

```bash
python3 scripts/build_data.py
```

## Sources des données

- **Ventes** : base « Demandes de valeurs foncières » (DGFiP), géolocalisée par
  Etalab — <https://files.data.gouv.fr/geo-dvf/>. Prix réels actés chez le
  notaire, publiés ~2 fois par an avec environ 6 mois de délai. 5 dernières
  années disponibles.
- **Quartiers** : « Versailles - Quartiers municipaux », open data de la
  communauté d'agglomération Versailles Grand Parc.
- **Recherche d'adresse** : Base Adresse Nationale (api-adresse.data.gouv.fr).
- **Fond de carte** : OpenStreetMap / CARTO.
