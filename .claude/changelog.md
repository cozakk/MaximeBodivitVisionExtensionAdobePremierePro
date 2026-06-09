# Changelog — Maxime Bodivit Vision Ext

Toutes les modifications notables de l'extension sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Dates au format AAAA-MM-JJ.

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
