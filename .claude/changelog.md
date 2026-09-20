# Changelog — Maxime Bodivit Vision Ext

Toutes les modifications notables de l'extension sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Dates au format AAAA-MM-JJ.

---

## [1.6.0] — 2026-09-20

### Corrigé

- **La barre d'info est traduite.** Elle était construite en dur
  (`'Sequence: ' + … + ' clips'`) et restait donc en anglais approximatif en
  ES et DE, alors que tout le reste du panneau était traduit. Elle passe
  maintenant par `t()` (`seq.line`, `clips.count`) et **suit le changement de
  langue à chaud**, sans attendre un rechargement des pistes.
- **Les boutons d'action du B-Roll ne sont plus hors écran.** À la taille par
  défaut du panneau (360×620, cf. `<Geometry>` du manifest), « Prévisualiser »
  et « Générer les extraits » tombaient sous la ligne de flottaison : il
  fallait faire défiler pour lancer une génération. Le bloc « Profils de
  réglages », qui occupait le haut de l'onglet, est désormais replié par
  défaut, ce qui ramène les boutons dans l'écran.
- **Les boutons du journal sont de vraies cibles.** Exporter / Diagnostic /
  Effacer faisaient 11 px de haut (texte nu, sans marge) ; ils ont maintenant
  un rembourrage et un fond au survol.
- Une erreur hôte (« Aucune séquence active ») remet à zéro la séquence
  mémorisée, pour ne plus reconstruire la barre d'info à partir de comptes
  périmés.

### Ajouté

- **Bloc « Profils de réglages » repliable**, fermé par défaut, état mémorisé
  entre les sessions (pref `presetsOpen`).
- **Nombre de clips par piste** dans la liste du Compactage (« V1 — 12 clip(s) »),
  et les **pistes vides** sont signalées en grisé italique : on voit d'un coup
  d'œil ce qu'on coche.
- **Focus clavier visible** (`:focus-visible`) sur les boutons, listes, champs
  et onglets — sans rien changer à la navigation à la souris.
- Rôles `tablist` / `tab` et `aria-selected` tenus à jour sur les onglets.
- **Captures d'écran automatisées** (`node screenshots/capture.mjs`) : le
  panneau est servi hors Premiere avec un faux pont CEP, rendu dans Chrome
  piloté par le protocole DevTools, puis photographié en 16 vues (3 onglets ×
  2 thèmes, tailles par défaut / minimale / large, 4 langues, cas sans
  séquence). Chaque exécution produit un dossier horodaté et un rapport qui
  mesure la position réelle des éléments (ordre des blocs, débordements,
  chevauchements, contrôles hors écran). Voir
  [screenshots/README.md](../screenshots/README.md).

### Modifié / Interne

- Nouvelles clés i18n `seq.line`, `clips.count`, `track.empty` dans les quatre
  langues (112 clés × 4).
- Version affichée : `v1.5.0` → `v1.6.0`.

---

## [1.5.0] — 2026-09-14

### Corrigé

- **Compactage : la synchro audio/vidéo est préservée.** Chaque piste cochée
  était compactée *indépendamment* : quand seules certaines vidéos portaient du
  son, les clips audio se retrouvaient collés au début de la timeline — et, les
  items étant liés, ils y ramenaient leur vidéo par-dessus le premier clip.

### Ajouté

- **Mode « compactage synchronisé »** (case cochée par défaut dans l'onglet
  Compactage, mémorisée) : les pistes cochées sont traitées comme un seul bloc.
  Seuls les trous **communs** à toutes sont fermés, et tout ce qui suit est
  décalé du **même delta** sur chaque piste, donc chaque audio reste exactement
  sous sa vidéo. Le trou de tête est fermé lui aussi.
- Côté hôte : `_unionOccupancy`, `_shiftTracksAfter`, `_compactTracksSynced` et
  `_warnUncheckedTracks` ; `removeGaps` route selon le flag `synced` et conserve
  l'ancien comportement piste par piste quand la case est décochée.
- **Avertissement** quand des pistes non cochées contiennent des clips : elles ne
  bougent pas, leur synchro avec le reste peut donc se rompre.
- **Tests de l'algorithme** (`test/compact.mjs`) : host.jsx est chargé dans un VM
  avec une fausse séquence Premiere (pistes, clips, items liés, `move()`), ce qui
  couvre la synchro préservée, la reproduction du bug de l'ancien mode,
  l'équivalence sur une piste seule, l'avertissement des pistes non cochées,
  l'audio plus long que sa vidéo et l'absence de trou.

### Modifié / Interne

- Compte-rendu du compactage distinct selon le mode (trous fermés vs clips
  déplacés) ; le mode batch relaie le flag `synced`.
- `npm test` et la CI lancent aussi `test/compact.mjs`.
- Version affichée : `v1.4.0` → `v1.5.0`.

---

## [1.4.0] — 2026-06-09

### Ajouté

- **Journal traduit** : tous les messages du panneau passent par des clés de
  traduction paramétrées (`t(key, {…})`). Les messages renvoyés par l'hôte
  restent tels quels.
- **Langues ES et DE** en plus de FR/EN (sélecteur étendu).
- **Mode batch** (nouvel onglet) : applique le B-Roll ou le Compactage à
  plusieurs séquences cochées en une fois (`getSequences` / `batchOperation`
  côté hôte, qui active chaque séquence puis restaure l'active).
- **Tests automatisés + CI** : `test/check.mjs` (syntaxe JS + cohérence des
  tables i18n entre les 4 langues + clés UI), `package.json` (`npm test`) et un
  workflow GitHub Actions.

### Modifié / Interne

- `t()` gère les placeholders `{x}` ; `applyI18n` couvre déjà titres et
  placeholders.
- Version affichée : `v1.3.4` → `v1.4.0`.

---

## [1.3.4] — 2026-06-09

### Ajouté

- **Infos séquence** : la barre d'info affiche le nombre total de clips et la
  durée du contenu (`getSequenceTrackInfo` renvoie les comptes par piste).
- **Barre de progression** indéterminée pendant la génération, la
  prévisualisation et le compactage.
- **Confirmation** avant une opération touchant beaucoup de clips (seuil 25),
  basée sur les comptes de clips par piste.
- **Annuler la dernière génération** : un bouton retire les extraits créés par
  la dernière génération B-Roll (`removeBRollClips`, best-effort DOM/QE).
- **Export du journal** dans un fichier `visionext-journal.txt`.

---

## [1.3.3] — 2026-06-09

### Ajouté

- **Profils / presets de réglages nommés** : enregistrer le jeu de réglages
  B-Roll courant sous un nom, le recharger ou le supprimer depuis une liste
  déroulante (stockés dans localStorage).
- **Export / import des réglages en `.json`** : bouton d'export (téléchargement
  d'un fichier `visionext-reglages.json` contenant les réglages courants + tous
  les profils) et bouton d'import (fusionne les profils, applique les réglages).

### Modifié / Interne

- Persistance refactorisée : `collectSettings()` / `_applySettings()` partagés
  entre la sauvegarde auto, les profils et l'import/export.
- `applyI18n` gère désormais les placeholders (`data-i18n-ph`).
- Version affichée : `v1.3.2` → `v1.3.3`.

---

## [1.3.2] — 2026-06-09

### Ajouté

- **Thème clair en plus du thème sombre.** Le CSS passe par des variables et
  deux jeux de couleurs (`:root` / `[data-theme="dark"]` et `[data-theme="light"]`).
  Un bouton ☀/☽ dans le pied de page bascule le thème ; le choix est mémorisé
  (localStorage) et restauré au démarrage.

---

## [1.3.1] — 2026-06-09

### Ajouté

- **Conservation du libellé / nom du clip source** sur l'extrait B-Roll
  (`_setClipName`). Best-effort : `trackItem.name` étant en lecture seule sur
  certaines versions de Premiere, le résultat est vérifié et un avertissement
  est journalisé si le renommage n'est pas pris en compte. La couleur
  d'étiquette était déjà reportée — couleur + libellé sont des invariants.

---

## [1.3.0] — 2026-06-08

### Ajouté

- **Réglages persistants** : durée, position, pistes, options et onglet actif
  mémorisés entre les sessions (localStorage).
- **Compactage multi-pistes** : sélection par cases à cocher (toutes pistes
  V + A) avec boutons « Tout » / « Aucune » ; tout est compacté en une seule
  annulation. Côté host, `removeGaps` accepte une liste de pistes et factorise
  `_compactTrack()`.
- **B-Roll sur la sélection** : option pour ne traiter que les clips
  sélectionnés dans la timeline (`_isSelected`).
- **Prévisualisation (dry-run)** : bouton « Prévisualiser » qui liste les
  extraits (nom, position, durée) sans rien modifier ni créer de piste
  (mode `dryRun` côté host).
- **Transitions automatiques** (expérimental) : fondu enchaîné en tête de
  chaque extrait via le QE DOM, best-effort avec avertissements si indisponible.
- **Annuler / Rétablir** : boutons d'en-tête (relayés à `app.undo()`/`redo()`
  si disponibles, sinon rappel de Ctrl+Z — limitation Premiere par script).
- **Diagnostic** : bouton d'auto-test en lecture seule (version, projet,
  séquence, nb pistes, QE DOM, présence des API clés).
- **Internationalisation FR/EN** : sélecteur de langue, libellés et infobulles
  traduits, langue mémorisée.

### Modifié / Interne

- Refactor `generateBRoll` : extraction de `buildBRollParams` côté panneau,
  mode `dryRun`, helpers `_isSelected` / `_addTransitions` côté host.
- Version affichée dans le pied de page : `v1.2.0` → `v1.3.0`.

---

## [1.2.0] — 2026-06-08

### Corrigé

- **B-Roll : les extraits n'étaient pas découpés à la durée demandée.**
  Les clips générés sur la piste destination restaient à pleine longueur
  (identiques au clip source). Cause : le clip était inséré entier puis on
  tentait de le rogner via `trackItem.inPoint` / `outPoint`, ce qui réalise
  un *slip* (décalage du média visible) et non un *trim* (la durée timeline
  ne changeait pas).
  Correction : le `projectItem` est désormais pré-rogné à la fenêtre
  `[mediaIn, mediaOut]` **avant** l'insertion (`overwriteClip` ne pose que la
  plage in/out courante). Le clip fait donc exactement la durée demandée, en
  conservant le média de chaque côté comme poignées (extension possible à la
  souris). Voir `_setProjItemIO` dans [jsx/host.jsx](../jsx/host.jsx).
  - Robustesse : `_setProjItemIO` essaie plusieurs variantes de l'API
    Premiere (argument `mediaType` 4/1/2/0, unités secondes puis ticks) et
    **vérifie** le résultat via `getInPoint()`/`getOutPoint()` ; tente aussi
    l'ordre in→out puis out→in (utile si un même média est réutilisé).

- **Compactage : seul le 1er trou (entre la 1ère et la 2ème vidéo) était
  supprimé ; l'audio lié ne suivait pas non plus.**
  Cause : après le 1er `move()`, Premiere invalide les références (`c.ref`)
  des autres clips capturées dans l'instantané initial → les déplacements
  suivants échouaient en silence (et l'audio lié, ne suivant que le clip
  vidéo déplacé, restait désynchronisé).
  Correction : les trous sont maintenant fermés **un par un en re-capturant
  la piste après chaque déplacement**, garantissant des références toujours
  valides. Ajout d'une détection de progression : si `move()` est sans effet
  sur la version de Premiere, l'opération s'arrête avec un avertissement
  explicite au lieu de boucler. Boucle bornée par le nombre de clips.

### Modifié / Interne

- Suppression de la fonction `_trimAndColor` (rognage post-insertion devenu
  inutile) ; ajout de `_setProjItemIO`.
- Couleur d'étiquette du clip source toujours reportée sur l'extrait et son
  audio lié.
- Mise à jour des commentaires de doc de `generateBRoll` et `removeGaps`.
- Version affichée dans le pied de page : `v1.1.0` → `v1.2.0`.

### Documentation

- Ajout de [.claude/features.md](features.md) (suivi des fonctionnalités).
- Ajout de ce fichier [.claude/changelog.md](changelog.md).

---

## [1.1.0] — antérieur

- Version de base : onglets B-Roll et Compactage, journal, rafraîchissement
  des pistes. (Le découpage B-Roll et le compactage multi-trous présentaient
  les bugs corrigés en 1.2.0.)
