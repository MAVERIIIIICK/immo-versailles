/* Immo Versailles — observatoire des ventes par quartier */
"use strict";

// ---------- État global ----------
const state = {
  type: "tous",          // tous | Appartement | Maison
  periode: "12m",        // 12m | 2025 | 2024 | … | all
  quartier: null,        // quartier sélectionné (détail)
  tab: "marche",
};

let DATA = null;          // { maj, periode, ventes }
let premierAffichage = true;   // l'animation d'entrée ne joue qu'une fois
let QUARTIERS = null;     // GeoJSON
let map, coucheQuartiers, couchePoints, coucheAnnonces;
const rendu = L.canvas({ padding: 0.3 });

// Palette séquentielle (bleu, du clair au foncé) pour le coloriage des quartiers
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const sombre = matchMedia("(prefers-color-scheme: dark)");

// Icônes dessinées dans index.html (trait homogène), référencées par identifiant
const icone = (nom) => `<svg class="icone" aria-hidden="true"><use href="#i-${nom}"/></svg>`;
const iconeTendance = { up: "haut", down: "bas", flat: "stable" };

const fmtEuro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtNb = new Intl.NumberFormat("fr-FR");
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

// ---------- Petites maths ----------
function mediane(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- Périodes ----------
function decaleMois(iso, mois) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + mois);
  return d.toISOString().slice(0, 10);
}
function bornesPeriode(p) {
  const maxDate = DATA.periode[1];
  if (p === "12m") return [decaleMois(maxDate, -12), maxDate];
  if (p === "all") return ["0000", "9999"];
  return [p + "-01-01", p + "-12-31"];
}
function bornesPrecedentes(p) {
  if (p === "12m") {
    const [debut] = bornesPeriode("12m");
    return [decaleMois(debut, -12), decaleMois(debut, -1) /* approx fin */];
  }
  if (p === "all") return null;
  const an = parseInt(p, 10) - 1;
  const premierAn = parseInt(DATA.periode[0].slice(0, 4), 10);
  if (an < premierAn) return null;
  return [an + "-01-01", an + "-12-31"];
}
function labelPeriode(p) {
  if (p === "12m") return "sur les 12 derniers mois connus";
  if (p === "all") return "depuis " + DATA.periode[0].slice(0, 4);
  return "en " + p;
}

// ---------- Filtres ----------
function ventesFiltrees(bornes, type, quartier) {
  const [d1, d2] = bornes;
  return DATA.ventes.filter((v) =>
    v.date >= d1 && v.date <= d2 &&
    (type === "tous" || v.type === type) &&
    (!quartier || v.quartier === quartier)
  );
}

function statsParQuartier() {
  const bornes = bornesPeriode(state.periode);
  const avant = bornesPrecedentes(state.periode);
  const noms = QUARTIERS.features.map((f) => f.properties.nom);
  return noms.map((nom) => {
    const ventes = ventesFiltrees(bornes, state.type, nom);
    const ppm2 = mediane(ventes.map((v) => v.ppm2));
    let evol = null;
    if (avant) {
      const ppm2Avant = mediane(ventesFiltrees(avant, state.type, nom).map((v) => v.ppm2));
      if (ppm2 && ppm2Avant) evol = ((ppm2 - ppm2Avant) / ppm2Avant) * 100;
    }
    return { nom, nb: ventes.length, ppm2, evol };
  }).sort((a, b) => b.nb - a.nb);
}

// ---------- Carte ----------
function initCarte() {
  map = L.map("map", { zoomControl: true }).setView([48.8035, 2.125], 13);
  const style = sombre.matches ? "dark_all" : "light_all";
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);
  couchePoints = L.layerGroup().addTo(map);
  coucheAnnonces = L.layerGroup().addTo(map);
}

function couleurQuartier(nb, maxNb) {
  if (!nb) return RAMP[0];
  const i = Math.min(RAMP.length - 1, Math.round((nb / maxNb) * (RAMP.length - 1)));
  return RAMP[Math.max(1, i)];
}

function dessineQuartiers() {
  const stats = Object.fromEntries(statsParQuartier().map((s) => [s.nom, s]));
  const maxNb = Math.max(1, ...Object.values(stats).map((s) => s.nb));
  if (coucheQuartiers) coucheQuartiers.remove();
  coucheQuartiers = L.geoJSON(QUARTIERS, {
    style: (f) => {
      const nom = f.properties.nom;
      const sel = state.quartier === nom;
      return {
        color: "#ffffff",
        weight: sel ? 3 : 1.5,
        fillColor: couleurQuartier(stats[nom].nb, maxNb),
        fillOpacity: state.quartier ? (sel ? 0.25 : 0.55) : 0.72,
      };
    },
    onEachFeature: (f, layer) => {
      const nom = f.properties.nom;
      layer.bindTooltip(() => {
        const s = stats[nom];
        return `<div class="q-tooltip"><b>${nom}</b><br>${s.nb} vente${s.nb > 1 ? "s" : ""} ${labelPeriode(state.periode)}<br>${s.ppm2 ? "Prix médian : " + fmtNb.format(Math.round(s.ppm2)) + " €/m²" : "Pas assez de ventes"}</div>`;
      }, { sticky: true });
      layer.on("click", () => ouvreDetail(nom));
      layer.on("mouseover", () => layer.setStyle({ weight: 3 }));
      layer.on("mouseout", () => coucheQuartiers.resetStyle(layer));
    },
  }).addTo(map);
}

function dessinePoints() {
  couchePoints.clearLayers();
  if (!state.quartier) return;
  const ventes = ventesFiltrees(bornesPeriode(state.periode), state.type, state.quartier);
  for (const v of ventes) {
    const c = v.type === "Maison" ? getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const marker = L.circleMarker([v.lat, v.lon], {
      renderer: rendu, radius: 6, fillColor: c, fillOpacity: 1, color: "#ffffff", weight: 2,
    });
    marker.bindPopup(popupVente(v));
    marker.addTo(couchePoints);
  }
}

function popupVente(v) {
  const c = v.type === "Maison" ? "var(--accent-2)" : "var(--accent)";
  return `<div class="popup-vente">
    <span class="pv-badge" style="background:${c}">${v.type}${v.pieces ? " · " + v.pieces + " p." : ""}</span><br>
    <span class="pv-prix">${fmtEuro.format(v.prix)}</span><br>
    ${v.surface} m² → <b>${fmtNb.format(v.ppm2)} €/m²</b><br>
    ${v.adresse || "Adresse non précisée"}<br>
    <span style="color:var(--muted)">Vendu le ${fmtDate(v.date)}</span>
  </div>`;
}

function zoomeSur(nom) {
  const feat = QUARTIERS.features.find((f) => f.properties.nom === nom);
  const layer = L.geoJSON(feat);
  map.fitBounds(layer.getBounds(), { padding: [30, 30] });
}

// ---------- Panneau : liste ----------
function afficheListe() {
  const stats = statsParQuartier();
  const conteneur = document.getElementById("listeQuartiers");
  const maxNb = Math.max(1, ...stats.map((s) => s.nb));
  conteneur.innerHTML = "";
  stats.forEach((s, i) => {
    const carte = document.createElement("button");
    carte.type = "button";
    carte.className = "quartier-card" + (premierAffichage ? " entree" : "");
    carte.style.setProperty("--i", i);
    let trend = "";
    if (s.evol !== null) {
      const sens = s.evol > 1 ? "up" : s.evol < -1 ? "down" : "flat";
      trend = `<div class="q-trend trend-${sens}">${icone(iconeTendance[sens])}${Math.abs(s.evol).toFixed(1)} %</div>`;
    }
    carte.innerHTML = `
      <div class="q-swatch" style="background:${couleurQuartier(s.nb, maxNb)}"></div>
      <div>
        <div class="q-name">${s.nom}</div>
        <div class="q-sub">${s.ppm2 ? fmtNb.format(Math.round(s.ppm2)) + " €/m² (médian)" : "Pas assez de ventes"}</div>
      </div>
      <div class="q-stats">
        <div class="q-count">${s.nb}<small>vente${s.nb > 1 ? "s" : ""}</small></div>
        ${trend}
      </div>`;
    carte.onclick = () => ouvreDetail(s.nom);
    conteneur.appendChild(carte);
  });
  premierAffichage = false;
}

// ---------- Panneau : détail d'un quartier ----------
function ouvreDetail(nom) {
  state.quartier = nom;
  document.getElementById("vueListe").classList.add("hidden");
  document.getElementById("vueDetail").classList.remove("hidden");
  activeOnglet("marche");
  afficheDetail();
  dessineQuartiers();
  dessinePoints();
  zoomeSur(nom);
}
function fermeDetail() {
  state.quartier = null;
  document.getElementById("vueDetail").classList.add("hidden");
  document.getElementById("vueListe").classList.remove("hidden");
  dessineQuartiers();
  dessinePoints();
  map.fitBounds(coucheQuartiers.getBounds(), { padding: [10, 10] });
}

function afficheDetail() {
  const nom = state.quartier;
  const bornes = bornesPeriode(state.periode);
  const ventes = ventesFiltrees(bornes, state.type, nom);
  const ppm2 = mediane(ventes.map((v) => v.ppm2));
  const prixMed = mediane(ventes.map((v) => v.prix));
  const surfMed = mediane(ventes.map((v) => v.surface));
  const nbAppart = ventes.filter((v) => v.type === "Appartement").length;
  const nbMaison = ventes.filter((v) => v.type === "Maison").length;

  const avant = bornesPrecedentes(state.periode);
  let delta = "";
  if (avant && ppm2) {
    const ppm2Avant = mediane(ventesFiltrees(avant, state.type, nom).map((v) => v.ppm2));
    if (ppm2Avant) {
      const e = ((ppm2 - ppm2Avant) / ppm2Avant) * 100;
      const sens = e > 1 ? "up" : e < -1 ? "down" : "flat";
      delta = `<div class="delta trend-${sens}">${icone(iconeTendance[sens])}${Math.abs(e).toFixed(1)} % vs période précédente</div>`;
    }
  }

  const recentes = ventes.slice(0, 10);
  document.getElementById("detailContenu").innerHTML = `
    <div class="detail-head">
      <h2>${nom}</h2>
      <p>${fmtNb.format(ventes.length)} vente${ventes.length > 1 ? "s" : ""} ${labelPeriode(state.periode)} · ${nbAppart} appart. / ${nbMaison} maison${nbMaison > 1 ? "s" : ""}</p>
    </div>
    <div class="stat-tiles">
      <div class="stat-tile">
        <div class="val">${ppm2 ? fmtNb.format(Math.round(ppm2)) + " €/m²" : "—"}</div>
        <div class="lab">Prix médian au m² (la moitié des ventes est au-dessus, l'autre en dessous)</div>
        ${delta}
      </div>
      <div class="stat-tile">
        <div class="val">${prixMed ? fmtEuro.format(prixMed) : "—"}</div>
        <div class="lab">Prix de vente médian${surfMed ? " · surface médiane " + Math.round(surfMed) + " m²" : ""}</div>
      </div>
    </div>
    <div class="chart-block">
      <h3>Prix médian au m², année par année</h3>
      ${graphLigne(nom)}
    </div>
    <div class="chart-block">
      <h3>Nombre de ventes par année</h3>
      ${graphBarres(nom)}
    </div>
    <div class="ventes-recentes">
      <h3>Dernières ventes (cliquez pour voir sur la carte)</h3>
      <div id="listeVentesRecentes"></div>
    </div>`;

  const cont = document.getElementById("listeVentesRecentes");
  for (const v of recentes) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "vente-row";
    row.innerHTML = `
      <div><div class="adr">${v.adresse || v.type}</div>
      <div class="meta">${v.type}${v.pieces ? " " + v.pieces + " p." : ""} · ${v.surface} m² · ${fmtDate(v.date)}</div></div>
      <div style="text-align:right"><div class="prix">${fmtEuro.format(v.prix)}</div>
      <div class="ppm2">${fmtNb.format(v.ppm2)} €/m²</div></div>`;
    row.onclick = () => {
      map.setView([v.lat, v.lon], 17);
      L.popup().setLatLng([v.lat, v.lon]).setContent(popupVente(v)).openOn(map);
    };
    cont.appendChild(row);
  }
  brancheTooltipsGraphiques();
}

// ---------- Graphiques SVG ----------
function seriesAnnuelles(nom) {
  const annees = [];
  const a1 = parseInt(DATA.periode[0].slice(0, 4), 10);
  const a2 = parseInt(DATA.periode[1].slice(0, 4), 10);
  for (let a = a1; a <= a2; a++) {
    const ventes = ventesFiltrees([a + "-01-01", a + "-12-31"], state.type, nom);
    annees.push({ an: a, nb: ventes.length, ppm2: mediane(ventes.map((v) => v.ppm2)) });
  }
  return annees;
}

const G = { w: 360, h: 130, pad: { t: 14, r: 14, b: 22, l: 44 } };

function grille(min, max, yPix, format) {
  const pas = (max - min) / 3;
  let out = "";
  for (let i = 0; i <= 3; i++) {
    const val = min + pas * i;
    const y = yPix(val);
    out += `<line x1="${G.pad.l}" x2="${G.w - G.pad.r}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    out += `<text x="${G.pad.l - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${format(val)}</text>`;
  }
  return out;
}

function graphLigne(nom) {
  const serie = seriesAnnuelles(nom).filter((d) => d.ppm2);
  if (serie.length < 2) return `<p class="hint">Pas assez de données pour tracer une courbe.</p>`;
  const vals = serie.map((d) => d.ppm2);
  const min = Math.min(...vals) * 0.97, max = Math.max(...vals) * 1.03;
  const x = (i) => G.pad.l + (i / (serie.length - 1)) * (G.w - G.pad.l - G.pad.r);
  const y = (v) => G.pad.t + (1 - (v - min) / (max - min)) * (G.h - G.pad.t - G.pad.b);
  const chemin = serie.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.ppm2).toFixed(1)}`).join(" ");
  let pts = "", labels = "";
  serie.forEach((d, i) => {
    pts += `<circle cx="${x(i)}" cy="${y(d.ppm2)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"
      class="pt-hover" data-tip="${d.an} : ${fmtNb.format(Math.round(d.ppm2))} €/m²"/>`;
    labels += `<text x="${x(i)}" y="${G.h - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.an}</text>`;
  });
  const dernier = serie[serie.length - 1];
  const direct = `<text x="${x(serie.length - 1) - 6}" y="${y(dernier.ppm2) - 9}" text-anchor="end" font-size="10.5" font-weight="700" fill="var(--ink)">${fmtNb.format(Math.round(dernier.ppm2))} €/m²</text>`;
  return `<svg viewBox="0 0 ${G.w} ${G.h}" role="img" aria-label="Évolution du prix médian au m² à ${nom}">
    ${grille(min, max, y, (v) => fmtNb.format(Math.round(v / 100) * 100))}
    <path d="${chemin}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    ${pts}${labels}${direct}</svg>`;
}

function graphBarres(nom) {
  const serie = seriesAnnuelles(nom);
  const max = Math.max(1, ...serie.map((d) => d.nb));
  const zone = G.w - G.pad.l - G.pad.r;
  const bw = Math.min(34, (zone / serie.length) * 0.6);
  const y = (v) => G.pad.t + (1 - v / (max * 1.05)) * (G.h - G.pad.t - G.pad.b);
  const y0 = G.h - G.pad.b;
  let barres = "", labels = "";
  serie.forEach((d, i) => {
    const cx = G.pad.l + (i + 0.5) * (zone / serie.length);
    const h = Math.max(0, y0 - y(d.nb));
    barres += `<path d="M${cx - bw / 2},${y0} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z"
      fill="var(--accent)" class="pt-hover" data-tip="${d.an} : ${d.nb} vente${d.nb > 1 ? "s" : ""}"/>`;
    labels += `<text x="${cx}" y="${G.h - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.an}</text>`;
  });
  const derniere = serie[serie.length - 1];
  const cxD = G.pad.l + (serie.length - 0.5) * (zone / serie.length);
  const direct = derniere.nb ? `<text x="${cxD}" y="${y(derniere.nb) - 5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${derniere.nb}</text>` : "";
  return `<svg viewBox="0 0 ${G.w} ${G.h}" role="img" aria-label="Nombre de ventes par année à ${nom}">
    ${grille(0, max * 1.05, y, (v) => Math.round(v))}
    <line x1="${G.pad.l}" x2="${G.w - G.pad.r}" y1="${y0}" y2="${y0}" stroke="var(--baseline)" stroke-width="1"/>
    ${barres}${labels}${direct}</svg>`;
}

function brancheTooltipsGraphiques() {
  const tip = document.getElementById("chartTooltip");
  document.querySelectorAll(".pt-hover").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      tip.textContent = el.dataset.tip;
      tip.classList.remove("hidden");
      tip.style.left = e.clientX + 12 + "px";
      tip.style.top = e.clientY - 10 + "px";
    });
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}

// ---------- Annonces « à vendre » ----------
function litAnnonces() {
  try { return JSON.parse(localStorage.getItem("annonces") || "[]"); }
  catch { return []; }
}
function sauveAnnonces(a) { localStorage.setItem("annonces", JSON.stringify(a)); }

function verdict(annonce) {
  const bornes = bornesPeriode("12m");
  let comparables = ventesFiltrees(bornes, annonce.type, annonce.quartier);
  let base = `ventes réelles de ${annonce.type === "Maison" ? "maisons" : "d'appartements"} à ${annonce.quartier} sur les 12 derniers mois connus`;
  if (comparables.length < 5) {
    comparables = ventesFiltrees(bornes, "tous", annonce.quartier);
    base = `toutes ventes confondues à ${annonce.quartier} (peu de ventes du même type)`;
  }
  if (comparables.length < 3) return { texte: "Pas assez de ventes comparables", cls: "verdict-ok", icone: "question", detail: "" };
  const ref = mediane(comparables.map((v) => v.ppm2));
  const ecart = ((annonce.prix / annonce.surface - ref) / ref) * 100;
  const detail = `Annonce à <b>${fmtNb.format(Math.round(annonce.prix / annonce.surface))} €/m²</b>, contre <b>${fmtNb.format(Math.round(ref))} €/m²</b> (médiane des ${comparables.length} ${base}).`;
  if (ecart <= -10) return { texte: `Opportunité — ${Math.abs(ecart).toFixed(0)} % sous le marché`, cls: "verdict-good", icone: "ok", detail, ecart };
  if (ecart <= 5) return { texte: "Dans le prix du marché", cls: "verdict-ok", icone: "balance", detail, ecart };
  if (ecart <= 15) return { texte: `${ecart.toFixed(0)} % au-dessus du marché`, cls: "verdict-warning", icone: "attention", detail, ecart };
  return { texte: `${ecart.toFixed(0)} % au-dessus du marché`, cls: "verdict-serious", icone: "alerte", detail, ecart };
}

function afficheAnnonces() {
  const annonces = litAnnonces();
  const cont = document.getElementById("listeAnnonces");
  cont.innerHTML = annonces.length ? "" : `
    <div class="etat-vide">
      <div>${icone("tag").replace('class="icone"', 'class="icone" style="width:26px;height:26px"')}</div>
      Aucune annonce suivie pour l'instant.<br>
      Ajoutez-en une : elle sera comparée aux ventes réelles du quartier.
    </div>`;
  coucheAnnonces.clearLayers();
  for (const a of annonces) {
    const v = verdict(a);
    const carte = document.createElement("div");
    carte.className = "annonce-card";
    carte.innerHTML = `
      <div class="a-head">
        <span class="a-titre">${a.type}${a.pieces ? " " + a.pieces + " p." : ""} · ${a.surface} m²</span>
        <span class="a-prix">${fmtEuro.format(a.prix)}</span>
      </div>
      <div class="a-meta">${a.adresse ? a.adresse + " — " : ""}${a.quartier} · ajoutée le ${fmtDate(a.ajout)}</div>
      <div class="verdict ${v.cls}">${icone(v.icone)}${v.texte}</div>
      ${v.detail ? `<div class="a-detail">${v.detail}</div>` : ""}
      <div class="a-actions">
        ${a.lat ? `<button type="button" class="voir">${icone("epingle")}Voir sur la carte</button>` : ""}
        ${a.lien ? `<a href="${a.lien}" target="_blank" rel="noopener">${icone("lien")}Ouvrir l'annonce</a>` : ""}
        <button type="button" class="suppr">${icone("corbeille")}Supprimer</button>
      </div>`;
    if (a.lat) {
      carte.querySelector(".voir").onclick = () => map.setView([a.lat, a.lon], 17);
      const couleurPin = { "verdict-good": "var(--good)", "verdict-ok": "var(--muted)", "verdict-warning": "var(--warning)", "verdict-serious": "var(--serious)" }[v.cls];
      const pin = L.marker([a.lat, a.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div class="pin-annonce" style="background:${couleurPin}">${icone("tag")}</div>`,
          iconSize: [27, 27], iconAnchor: [0, 27],
        }),
      }).bindPopup(`<div class="popup-vente"><b>À vendre — ${a.type} ${a.surface} m²</b><br>
        <span class="pv-prix">${fmtEuro.format(a.prix)}</span><br>
        <span class="verdict ${v.cls}" style="margin-top:6px">${icone(v.icone)}${v.texte}</span><br>${a.adresse || a.quartier}</div>`);
      pin.addTo(coucheAnnonces);
    }
    carte.querySelector(".suppr").onclick = () => {
      if (confirm("Supprimer cette annonce ?")) {
        sauveAnnonces(annonces.filter((x) => x.id !== a.id));
        afficheAnnonces();
      }
    };
    cont.appendChild(carte);
  }
}

// Recherche d'adresse (Base Adresse Nationale, service public gratuit)
let timerAdresse = null;
function brancheAdresse() {
  const champ = document.getElementById("aAdresse");
  const sug = document.getElementById("aSuggestions");
  champ.addEventListener("input", () => {
    clearTimeout(timerAdresse);
    delete champ.dataset.lat;
    const q = champ.value.trim();
    if (q.length < 3) { sug.innerHTML = ""; return; }
    timerAdresse = setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q + " Versailles")}&lat=48.8035&lon=2.13&limit=4`);
        const j = await r.json();
        sug.innerHTML = "";
        for (const f of j.features || []) {
          const div = document.createElement("div");
          div.className = "suggestion";
          div.textContent = f.properties.label;
          div.onclick = () => {
            champ.value = f.properties.name || f.properties.label;
            champ.dataset.lat = f.geometry.coordinates[1];
            champ.dataset.lon = f.geometry.coordinates[0];
            sug.innerHTML = "";
            const q2 = quartierDuPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
            if (q2) document.getElementById("aQuartier").value = q2;
          };
          sug.appendChild(div);
        }
      } catch { sug.innerHTML = ""; }
    }, 250);
  });
}

function quartierDuPoint(lon, lat) {
  for (const f of QUARTIERS.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      if (pointDansAnneau(lon, lat, poly[0]) && !poly.slice(1).some((h) => pointDansAnneau(lon, lat, h)))
        return f.properties.nom;
    }
  }
  return null;
}
function pointDansAnneau(lon, lat, anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i], [xj, yj] = anneau[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function brancheFormulaireAnnonce() {
  const form = document.getElementById("formAnnonce");
  document.getElementById("btnAjoutAnnonce").onclick = () => form.classList.toggle("hidden");
  document.getElementById("btnAnnulerAnnonce").onclick = () => form.classList.add("hidden");
  form.onsubmit = (e) => {
    e.preventDefault();
    const champ = document.getElementById("aAdresse");
    const annonce = {
      id: Date.now(),
      ajout: new Date().toISOString().slice(0, 10),
      type: document.getElementById("aType").value,
      prix: parseFloat(document.getElementById("aPrix").value),
      surface: parseFloat(document.getElementById("aSurface").value),
      pieces: parseInt(document.getElementById("aPieces").value, 10) || null,
      quartier: document.getElementById("aQuartier").value,
      adresse: champ.value.trim() || null,
      lat: champ.dataset.lat ? parseFloat(champ.dataset.lat) : null,
      lon: champ.dataset.lon ? parseFloat(champ.dataset.lon) : null,
      lien: document.getElementById("aLien").value.trim() || null,
    };
    // Sans adresse précise, on épingle au centre du quartier
    if (!annonce.lat) {
      const feat = QUARTIERS.features.find((f) => f.properties.nom === annonce.quartier);
      const b = L.geoJSON(feat).getBounds().getCenter();
      annonce.lat = b.lat; annonce.lon = b.lng;
    }
    sauveAnnonces([annonce, ...litAnnonces()]);
    form.reset();
    delete champ.dataset.lat;
    form.classList.add("hidden");
    afficheAnnonces();
    map.setView([annonce.lat, annonce.lon], 16);
  };
}

// ---------- Onglets & filtres ----------
function activeOnglet(nom) {
  state.tab = nom;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === nom));
  document.getElementById("tab-marche").classList.toggle("hidden", nom !== "marche");
  document.getElementById("tab-annonces").classList.toggle("hidden", nom !== "annonces");
}

function rafraichitTout() {
  afficheListe();
  dessineQuartiers();
  dessinePoints();
  if (state.quartier) afficheDetail();
}

// ---------- Démarrage ----------
async function demarre() {
  try {
    const [rv, rq] = await Promise.all([fetch("data/ventes.json"), fetch("data/quartiers.geojson")]);
    DATA = await rv.json();
    QUARTIERS = await rq.json();
  } catch {
    document.getElementById("majBanner").textContent =
      "Impossible de charger les données — vérifiez la connexion, puis rechargez la page.";
    return;
  }

  // Bandeau de mise à jour
  document.getElementById("majBanner").textContent =
    `Ventes du ${fmtDate(DATA.periode[0])} au ${fmtDate(DATA.periode[1])} · données actualisées le ${fmtDate(DATA.maj)}`;

  // Choix de période
  const sel = document.getElementById("filtrePeriode");
  const a1 = parseInt(DATA.periode[0].slice(0, 4), 10);
  const a2 = parseInt(DATA.periode[1].slice(0, 4), 10);
  sel.innerHTML = `<option value="12m">12 derniers mois connus</option>`;
  for (let a = a2; a >= a1; a--) sel.innerHTML += `<option value="${a}">Année ${a}</option>`;
  sel.innerHTML += `<option value="all">Tout (${a1}-${a2})</option>`;

  const selQ = document.getElementById("aQuartier");
  for (const f of QUARTIERS.features) selQ.innerHTML += `<option>${f.properties.nom}</option>`;

  initCarte();
  dessineQuartiers();
  // Cadre la ville entière, et se recale tant que la page finit de s'installer
  const cadreVille = () => {
    if (state.quartier) return;
    map.invalidateSize();
    map.fitBounds(coucheQuartiers.getBounds(), { padding: [10, 10] });
  };
  cadreVille();
  const observateur = new ResizeObserver(cadreVille);
  observateur.observe(document.getElementById("map"));
  map.once("pointerdown mousedown touchstart", () => observateur.disconnect());
  setTimeout(() => observateur.disconnect(), 3000);
  afficheListe();
  afficheAnnonces();
  brancheFormulaireAnnonce();
  brancheAdresse();

  document.getElementById("filtreType").onchange = (e) => { state.type = e.target.value; rafraichitTout(); };
  sel.onchange = (e) => { state.periode = e.target.value; rafraichitTout(); };
  document.getElementById("btnRetour").onclick = fermeDetail;
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => activeOnglet(t.dataset.tab)));
  sombre.addEventListener("change", () => location.reload());
}

demarre();
