# Changelog — Maxime Bodivit Vision Ext

Toutes les modifications notables de l'extension sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Dates au format AAAA-MM-JJ.

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
