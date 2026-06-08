# Maxime Bodivit Vision Ext

Extension **CEP** pour **Adobe Premiere Pro** (2025 / 2026) qui automatise deux
opérations de montage répétitives, directement depuis un panneau intégré :

- **B-Roll** — génère des extraits courts à partir des clips d'une piste source
  et les place sur une piste destination, en conservant le média de chaque côté
  comme poignées (extension possible à la souris).
- **Compactage** — supprime tous les trous entre les clips d'une piste en les
  décalant vers la gauche pour qu'ils se touchent.

> Version actuelle : **v1.2.0** — voir [.claude/changelog.md](.claude/changelog.md).

---

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Utilisation](#utilisation)
  - [Onglet B-Roll](#onglet-b-roll)
  - [Onglet Compactage](#onglet-compactage)
- [Structure du projet](#structure-du-projet)
- [Fonctionnement technique](#fonctionnement-technique)
- [Dépannage](#dépannage)
- [Suivi & historique](#suivi--historique)

---

## Prérequis

- **Adobe Premiere Pro 2025 (25.x) ou 2026 (26.x)** — voir la plage de versions
  dans [CSXS/manifest.xml](CSXS/manifest.xml).
- Une **séquence active** contenant au moins une piste vidéo avec des clips.

## Installation

L'extension se place dans le dossier d'extensions CEP de l'utilisateur :

```
%APPDATA%\Adobe\CEP\extensions\com.maximebodivit.visionext   (Windows)
~/Library/Application Support/Adobe/CEP/extensions/...        (macOS)
```

Comme l'extension n'est pas signée, il faut activer le **mode debug CEP** une
seule fois :

- **Windows** — dans `HKEY_CURRENT_USER\Software\Adobe\CSXS.9`, créer une valeur
  chaîne `PlayerDebugMode` = `1`.
- **macOS** — `defaults write com.adobe.CSXS.9 PlayerDebugMode 1`

Puis redémarrer Premiere Pro. Le panneau apparaît dans le menu
**Fenêtre → Extensions → Maxime Bodivit Vision Ext**.

## Utilisation

Le panneau détecte automatiquement la séquence active et liste ses pistes.
Le bouton **↻** en haut à droite recharge les pistes si besoin.
Toutes les opérations sont regroupées en **une seule annulation** (Ctrl+Z).

### Onglet B-Roll

1. **Durée du segment** — en secondes (presets 1/2/3/5 s disponibles).
   Si un clip est plus court que la durée demandée, l'extrait prend toute sa
   longueur (pas d'erreur).
2. **Position dans le clip** — début, milieu ou fin.
3. **Piste source** — la piste vidéo dont on extrait les segments (jamais
   modifiée).
4. **Piste destination** — où sont posés les extraits ; une nouvelle piste est
   créée si nécessaire.
5. **Options**
   - *Position aléatoire* dans chaque clip ;
   - *Zoom léger* (échelle 110 %) ;
   - *Marqueur* sur chaque extrait.
6. **Générer les extraits**.

L'étiquette couleur du clip source est reportée sur l'extrait (et son audio lié).

### Onglet Compactage

1. **Piste à compacter** — n'importe quelle piste vidéo ou audio.
2. **Supprimer les trous** — tous les espaces vides entre clips sont fermés ;
   les éléments liés (audio/vidéo) se déplacent ensemble.

## Structure du projet

```
com.maximebodivit.visionext/
├── CSXS/manifest.xml      Déclaration de l'extension (hôte, taille, panneau)
├── index.html             Interface du panneau
├── css/style.css          Styles
├── js/main.js             Logique panneau + pont CEP → ExtendScript
├── jsx/host.jsx           Code ExtendScript exécuté dans Premiere Pro
├── README.md              Ce fichier
└── .claude/
    ├── features.md        Suivi des fonctionnalités ([ ] / [x])
    └── changelog.md       Historique des versions
```

## Fonctionnement technique

- Le panneau (HTML/JS) communique avec Premiere via
  `__adobe_cep__.evalScript`. Chaque fonction de [jsx/host.jsx](jsx/host.jsx)
  renvoie une chaîne JSON (`{...}` ou `{error}`).
- **B-Roll** : le `projectItem` source est pré-rogné à la fenêtre voulue
  *avant* l'insertion (`overwriteClip`), ce qui garantit la bonne durée tout en
  laissant des poignées de chaque côté.
- **Compactage** : les trous sont fermés un par un, en re-capturant la piste
  après chaque déplacement (les références de clips deviennent invalides après
  un `move()`).
- Création de pistes vidéo via le **QE DOM** (`qe.project`).

## Dépannage

- **« Aucune séquence active »** — ouvrir/sélectionner une séquence puis cliquer
  sur **↻**.
- **Le panneau n'apparaît pas** — vérifier `PlayerDebugMode` et le nom du dossier
  (`com.maximebodivit.visionext`), puis redémarrer Premiere.
- Consulter le **Journal** en bas du panneau : il affiche les avertissements
  détaillés (ex. clip introuvable, déplacement échoué).

## Suivi & historique

- Fonctionnalités et reste à faire : [.claude/features.md](.claude/features.md)
- Journal des modifications : [.claude/changelog.md](.claude/changelog.md)

---

*Auteur : Maxime Bodivit.*
