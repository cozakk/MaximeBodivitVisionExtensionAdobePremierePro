# Captures d'écran du panneau

Ce dossier contient de quoi **photographier le panneau et vérifier la position
de ses éléments sans ouvrir Premiere Pro**, de façon reproductible.

```bash
node screenshots/capture.mjs
```

Chaque exécution crée un dossier horodaté `DDmmAAAA-hhmmss/` contenant les PNG
et un rapport de mise en page. Rien dans l'extension n'est modifié : le panneau
est servi tel quel, seul un faux pont CEP est injecté au vol.

---

## Sommaire

- [Prérequis](#prérequis)
- [Utilisation](#utilisation)
- [Ce que produit une exécution](#ce-que-produit-une-exécution)
- [Ce que vérifie le rapport](#ce-que-vérifie-le-rapport)
- [Ajouter ou modifier une vue](#ajouter-ou-modifier-une-vue)
- [Changer les données affichées](#changer-les-données-affichées)
- [Inspecter le panneau à la main](#inspecter-le-panneau-à-la-main)
- [Comment ça marche](#comment-ça-marche)
- [Limites](#limites)

## Prérequis

- **Node 22+** (le script utilise `fetch` et `WebSocket` natifs, sans dépendance).
- **Google Chrome** ou **Edge**, détecté automatiquement. Pour imposer un
  binaire : `CHROME_PATH="C:\chemin\vers\chrome.exe" node screenshots/capture.mjs`.

Aucun `npm install` : le dossier ne tire aucune bibliothèque.

## Utilisation

```bash
node screenshots/capture.mjs                  # toutes les vues
node screenshots/capture.mjs --list           # liste les vues, ne capture rien
node screenshots/capture.mjs --only=gaps      # vues dont le nom ou la query contient « gaps »
node screenshots/capture.mjs --no-audit       # PNG seulement, sans rapport
node screenshots/capture.mjs --serve          # ouvre le panneau dans ton navigateur
```

Le script sort en code 1 si un **problème** de position est détecté, ce qui
permet de le brancher sur la CI si besoin (les *remarques* n'échouent pas).

## Ce que produit une exécution

```
screenshots/
├── capture.mjs                 le script
├── cep-stub.js                 faux pont CEP + fixtures + audit
├── README.md                   ce fichier
└── 20092026-122747/            un dossier par exécution (DDmmAAAA-hhmmss)
    ├── 01-broll-sombre-360x620.png
    ├── …
    ├── layout-report.md        rapport lisible, images incluses
    └── layout-report.json      mêmes mesures, brutes
```

Les PNG font **exactement** la taille du panneau annoncée dans leur nom.
Les dossiers horodatés s'accumulent : ce sont des artefacts, supprime les
anciens quand ils ne servent plus (ils ne sont pas destinés à être versionnés).

## Ce que vérifie le rapport

Pour chaque vue, les mesures sont prises **dans la page réelle**, une fois le
panneau peuplé, via `getBoundingClientRect()`.

| Contrôle | Ce qui est signalé |
|---|---|
| `ordre` | un repère structurel (en-tête, onglets, barre d'info, contenu, pied) qui remonte au-dessus du précédent |
| `debordement-x` | un contrôle qui sort du panneau à gauche ou à droite |
| `chevauchement` | deux contrôles visibles de la même zone qui se recouvrent |
| `cible-petite` | *(remarque)* un bouton de moins de 14 px de côté |
| hors écran | les contrôles qu'il faut faire défiler pour atteindre |

Le rapport donne aussi, par vue, le tableau des repères avec leurs coordonnées,
la présence d'un défilement horizontal et le texte de la barre d'info.

Deux choix volontaires, pour éviter le bruit :

- les **cases à cocher** ne sont pas mesurées comme « cibles petites » : 14 px
  est leur taille native ;
- l'en-tête et le pied de page sont **collants et opaques**, le contenu défile
  dessous par construction : un recouvrement entre ces zones et le contenu
  n'est pas compté comme chevauchement. Les vues `*-deroule` existent pour
  amener le bas des onglets dans le viewport et l'auditer quand même.

## Ajouter ou modifier une vue

Tout est dans le tableau `VIEWS` en haut de [capture.mjs](capture.mjs) :

```js
{ name: 'compactage-clair', q: 'tab=gaps&theme=light', w: 360, h: 620 },
```

- `name` — sert au nom de fichier et à `--only` ;
- `q` — paramètres lus par `cep-stub.js` (voir ci-dessous) ;
- `w`/`h` — taille du panneau. Les tailles utiles viennent de la balise
  `<Geometry>` de [../CSXS/manifest.xml](../CSXS/manifest.xml) : **360×620** par
  défaut, **320×520** au minimum, 900×2000 au maximum.

Paramètres d'URL reconnus :

| Paramètre | Valeurs | Défaut |
|---|---|---|
| `tab` | `broll`, `gaps`, `batch` | `broll` |
| `theme` | `dark`, `light` | `dark` |
| `lang` | `fr`, `en`, `es`, `de` | `fr` |
| `sync` | `1`, `0` (case « garder la synchro ») | `1` |
| `gaps` | pistes cochées, ex. `video:0,audio:0` | `video:0,audio:0` |
| `presets` | `1` pour déplier le bloc « Profils de réglages » | `0` |
| `duration`, `position` | réglages B-Roll | `3`, `middle` |
| `seq` | `ok`, `nosequence`, `noproject` | `ok` |
| `audit` | `1` pour déposer l'audit dans `#__audit` | — |

## Changer les données affichées

La séquence, les pistes et la liste des séquences du projet sont des fixtures
dans [cep-stub.js](cep-stub.js) : `TRACK_INFO`, `SEQUENCES`, `DIAGNOSTIC`. Elles
reprennent **exactement les clés renvoyées par [../jsx/host.jsx](../jsx/host.jsx)**.
Si une fonction hôte change de forme, c'est là qu'il faut suivre.

Les opérations d'écriture (`generateBRoll`, `removeGaps`, `batchOperation`, …)
répondent volontairement une erreur : une capture ne doit rien « produire ».
Pour photographier un compte-rendu d'exécution, il faudrait leur donner une
réponse de succès dans `respond()`.

## Inspecter le panneau à la main

```bash
node screenshots/capture.mjs --serve
```

affiche une URL locale à ouvrir dans le navigateur. On peut alors naviguer dans
le panneau, changer d'onglet, ouvrir les outils de développement, et jouer avec
les paramètres ci-dessus :

```
http://127.0.0.1:PORT/?tab=gaps&theme=light&lang=de&seq=nosequence
```

Dans la console, `window.__visionextAudit()` renvoie les mesures de la vue
courante, et `window.__visionextStub.served` la liste des appels hôte reçus.

## Comment ça marche

1. `capture.mjs` démarre un serveur HTTP local sur le dossier de l'extension.
2. Pour `index.html`, il insère `<script src="/__cep-stub.js">` **juste avant**
   `js/main.js` — le seul changement, et il n'est jamais écrit sur disque.
3. `cep-stub.js` pose l'état de départ dans `localStorage` (thème, langue,
   onglet, réglages, profils) puis installe `window.__adobe_cep__.evalScript`,
   qui répond avec les mêmes JSON que l'hôte ExtendScript.
4. Chrome est lancé en *headless* et piloté par le **protocole DevTools** :
   `Emulation.setDeviceMetricsOverride` impose le viewport exact, puis
   `Runtime.evaluate` récupère l'audit et `Page.captureScreenshot` le PNG.

> **Pourquoi pas simplement `chrome --screenshot` ?** Le PNG sort à la bonne
> taille, mais la page, elle, est rendue dans une fenêtre d'au moins ~500 px de
> large et amputée de la hauteur de la barre d'onglets. Les mesures ne
> correspondent alors pas à l'image. Avec DevTools, l'audit et la capture
> portent sur le même viewport, au pixel près.

## Limites

- On photographie **l'interface**, pas Premiere : tout ce qui dépend
  réellement du montage (`generateBRoll`, `removeGaps`, QE DOM…) ne peut être
  validé que dans Premiere, ou par `npm test` côté algorithme.
- Le rendu utilise le Chrome installé sur la machine ; CEP embarque sa propre
  version de Chromium. Les écarts sont minimes (polices, épaisseurs d'un
  pixel), mais une capture n'est pas une preuve au pixel près de ce
  qu'affichera Premiere.
- L'audit ne juge ni les couleurs, ni les contrastes, ni la lisibilité : il
  mesure des positions.
