# Features — Maxime Bodivit Vision Ext

Suivi des fonctionnalités de l'extension Premiere Pro.
Convention : `[ ]` = à faire / en cours · `[x]` = fait et fonctionnel.

> Mettre à jour ce fichier à chaque ajout ou modification de feature.

---

## Infrastructure / Socle

- [x] Manifest CEP (`CSXS/manifest.xml`) — panneau Premiere Pro 2025/2026 (PPRO 25–99)
- [x] Pont CEP ↔ ExtendScript via `__adobe_cep__.evalScript` ([js/main.js](js/main.js))
- [x] Polyfill `JSON.stringify` / `JSON.parse` pour ExtendScript ([jsx/host.jsx](jsx/host.jsx))
- [x] Fonction de diagnostic `pingHost()` (version de l'app)
- [x] Lecture des infos de séquence `getSequenceTrackInfo()` (nom, nb pistes V/A)
- [x] Regroupement des opérations en un seul Undo (`openUndoGroup` / `closeUndoGroup`)
- [x] Création automatique de pistes vidéo manquantes via QE DOM (`_ensureVideoTrack`)

## Interface (UI)

- [x] Navigation par onglets : B-Roll / Compactage
- [x] Barre d'info séquence active (nom + nb pistes)
- [x] Bouton de rafraîchissement des pistes
- [x] Journal d'événements (log) avec niveaux info/ok/warn/err
- [x] Bouton « Effacer » le journal
- [x] Rafraîchissement auto des pistes au chargement
- [x] Pied de page avec n° de version

## Onglet B-Roll

- [x] Saisie de la durée du segment (secondes)
- [x] Boutons presets de durée (1s / 2s / 3s / 5s)
- [x] Choix de la position dans le clip (début / milieu / fin)
- [x] Sélection de la piste source (V1…Vn)
- [x] Sélection de la piste destination (+ option « nouvelle piste »)
- [x] Génération des extraits sur la piste destination (`generateBRoll`)
- [x] Conservation des poignées (handles) des deux côtés pour réajuster au montage
- [x] Clamp de la durée si le clip est plus court que demandé (pas d'erreur)
- [x] Option : position aléatoire dans chaque clip
- [x] Option : zoom léger (scale 110% sur l'effet Motion/Trajectoire)
- [x] Option : ajout d'un marqueur sur chaque extrait
- [x] Report de l'étiquette couleur du clip source sur l'extrait
- [x] Application du trim aux pistes audio liées (linked items)
- [x] Validation : pistes source ≠ destination
- [x] Compte-rendu : nb créés / ignorés / warnings

## Onglet Compactage (suppression des trous)

- [x] Sélection de la piste à compacter (toutes pistes V + A)
- [x] Suppression de tous les trous entre clips (`removeGaps`)
- [x] Décalage des clips vers la gauche pour qu'ils se touchent
- [x] Déplacement des items liés (audio/vidéo synchronisés)
- [x] Compte-rendu : nb de clips déplacés + durée totale supprimée

## Idées / À venir (non implémenté)

- [ ] Persistance des réglages utilisateur entre sessions
- [ ] Annuler/rétablir dédié dans le panneau
- [ ] Prévisualisation avant génération B-Roll
- [ ] Compactage de plusieurs pistes en une seule action
- [ ] Génération B-Roll sur une sélection de clips uniquement (pas toute la piste)
- [ ] Transitions automatiques entre extraits
- [ ] Internationalisation (FR/EN) de l'interface
- [ ] Tests / vérification automatisée
