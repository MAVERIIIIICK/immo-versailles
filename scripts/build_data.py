#!/usr/bin/env python3
"""Prépare les données de l'application Immo Versailles.

1. Télécharge (si besoin) les ventes DVF de Versailles (2021 → dernière année dispo).
2. Nettoie : garde les ventes simples d'appartements et de maisons, écarte les
   ventes en bloc et les valeurs aberrantes.
3. Rattache chaque vente à son quartier officiel.
4. Écrit app/data/ventes.json et app/data/quartiers.geojson pour le site.
"""

import csv
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import date

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data", "raw")
OUT = os.path.join(BASE, "app", "data")
DVF_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/communes/78/78646.csv"
FIRST_YEAR = 2021

# Garde-fous contre les valeurs aberrantes (ventes symboliques, erreurs de saisie…)
MIN_SURFACE = 9
MIN_PRICE = 15_000
MIN_PPM2 = 1_000
MAX_PPM2 = 25_000


def download():
    os.makedirs(RAW, exist_ok=True)
    years = []
    year = FIRST_YEAR
    while year <= date.today().year:
        path = os.path.join(RAW, f"dvf_{year}.csv")
        url = DVF_URL.format(year=year)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "immo-versailles"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            if len(data) < 200:
                break
            with open(path, "wb") as f:
                f.write(data)
            years.append(year)
            print(f"  {year} : téléchargé ({len(data)//1024} Ko)")
        except Exception as e:
            if os.path.exists(path):
                years.append(year)
                print(f"  {year} : téléchargement impossible ({e}), fichier local conservé")
            else:
                print(f"  {year} : indisponible ({e})")
        year += 1
    return years


def point_in_polygon(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_feature(lon, lat, geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if point_in_polygon(lon, lat, poly[0]):
            for hole in poly[1:]:
                if point_in_polygon(lon, lat, hole):
                    break
            else:
                return True
    return False


def main():
    print("1) Téléchargement des ventes DVF…")
    years = download()
    if not years:
        sys.exit("Aucune donnée DVF disponible.")

    quartiers = json.load(open(os.path.join(RAW, "quartiers.geojson")))
    q_features = quartiers["features"]

    print("2) Nettoyage des ventes…")
    mutations = defaultdict(list)
    for year in years:
        with open(os.path.join(RAW, f"dvf_{year}.csv"), newline="") as f:
            for row in csv.DictReader(f):
                mutations[row["id_mutation"]].append(row)

    ventes = []
    stats = defaultdict(int)
    for mid, rows in mutations.items():
        if rows[0]["nature_mutation"] != "Vente":
            stats["pas une vente classique"] += 1
            continue
        biens = [r for r in rows if r["type_local"] in ("Appartement", "Maison")]
        if len(biens) == 0:
            stats["ni appartement ni maison"] += 1
            continue
        # Une vente avec plusieurs logements = vente en bloc → moyenne faussée, on écarte
        if len({(r["type_local"], r["surface_reelle_bati"]) for r in biens}) > 1:
            stats["vente en bloc / multi-logements"] += 1
            continue
        r = biens[0]
        try:
            prix = float(r["valeur_fonciere"])
            surface = float(r["surface_reelle_bati"])
            lon = float(r["longitude"])
            lat = float(r["latitude"])
        except (ValueError, KeyError):
            stats["données incomplètes"] += 1
            continue
        if surface < MIN_SURFACE or prix < MIN_PRICE:
            stats["surface ou prix trop faible"] += 1
            continue
        ppm2 = prix / surface
        if not (MIN_PPM2 <= ppm2 <= MAX_PPM2):
            stats["prix au m² aberrant"] += 1
            continue

        quartier = None
        for feat in q_features:
            if point_in_feature(lon, lat, feat["geometry"]):
                quartier = feat["properties"]["NOM"]
                break
        if quartier is None:
            stats["hors des quartiers"] += 1
            continue

        numero = r["adresse_numero"].split(".")[0] if r["adresse_numero"] else ""
        adresse = " ".join(x for x in [numero, r["adresse_suffixe"], r["adresse_nom_voie"]] if x)
        ventes.append({
            "date": r["date_mutation"],
            "type": r["type_local"],
            "prix": round(prix),
            "surface": round(surface),
            "ppm2": round(ppm2),
            "pieces": int(float(r["nombre_pieces_principales"] or 0)),
            "adresse": adresse.title(),
            "quartier": quartier,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })

    ventes.sort(key=lambda v: v["date"], reverse=True)
    print(f"   {len(ventes)} ventes propres conservées")
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"   écartées — {k} : {v}")

    print("3) Écriture des fichiers pour le site…")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "ventes.json"), "w") as f:
        json.dump({
            "maj": date.today().isoformat(),
            "periode": [ventes[-1]["date"], ventes[0]["date"]],
            "ventes": ventes,
        }, f, ensure_ascii=False, separators=(",", ":"))

    slim = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "properties": {"nom": feat["properties"]["NOM"]},
             "geometry": feat["geometry"]}
            for feat in q_features
        ],
    }
    with open(os.path.join(OUT, "quartiers.geojson"), "w") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))

    print("   Terminé ✔")


if __name__ == "__main__":
    main()
