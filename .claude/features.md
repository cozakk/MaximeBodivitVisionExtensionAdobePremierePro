# Features — Maxime Bodivit Vision Ext

Suivi des fonctionnalités de l'extension Premiere Pro.
Convention : `[ ]` = à faire / en cours · `[x]` = fait et fonctionnel.

> Mettre à jour ce fichier à chaque ajout ou modification de feature.
> Historique détaillé des corrections : voir [changelog.md](changelog.md).

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
- [x] Mémorisation des réglages entre sessions (localStorage) — v1.3.0
- [x] Internationalisation FR/EN de l'interface (sélecteur de langue) — v1.3.0
- [x] Boutons Annuler / Rétablir dans le panneau (best-effort — voir notes) — v1.3.0
- [x] Bouton Diagnostic / auto-test de l'hôte — v1.3.0

## Onglet B-Roll

- [x] Saisie de la durée du segment (secondes)
- [x] Boutons presets de durée (1s / 2s / 3s / 5s)
- [x] Choix de la position dans le clip (début / milieu / fin)
- [x] Sélection de la piste source (V1…Vn)
- [x] Sélection de la piste destination (+ option « nouvelle piste »)
- [x] Génération des extraits sur la piste destination (`generateBRoll`)
- [x] Découpe à la durée demandée (corrigé en v1.2.0 — était à pleine longueur)
- [x] Conservation des poignées (handles) des deux côtés pour réajuster au montage
- [x] Clamp de la durée si le clip est plus court que demandé (pas d'erreur)
- [x] Option : position aléatoire dans chaque clip
- [x] Option : zoom léger (scale 110% sur l'effet Motion/Trajectoire)
- [x] Option : ajout d'un marqueur sur chaque extrait
- [x] Report de l'étiquette couleur du clip source sur l'extrait
- [x] Application du trim aux pistes audio liées (linked items)
- [x] Validation : pistes source ≠ destination
- [x] Compte-rendu : nb créés / ignorés / warnings
- [x] Option : B-Roll uniquement sur les clips sélectionnés — v1.3.0
- [x] Option : transitions automatiques (fondu enchaîné, expérimental) — v1.3.0
- [x] Prévisualisation (dry-run) listant les extraits avant génération — v1.3.0

## Onglet Compactage (suppression des trous)

- [x] Sélection de la piste à compacter (toutes pistes V + A)
- [x] Suppression de **tous** les trous entre clips (corrigé en v1.2.0 — seul le 1er se fermait)
- [x] Décalage des clips vers la gauche pour qu'ils se touchent
- [x] Déplacement des items liés (audio/vidéo synchronisés)
- [x] Compte-rendu : nb de clips déplacés + durée totale supprimée
- [x] Compactage de plusieurs pistes en une seule action (cases à cocher + Tout/Aucune) — v1.3.0

## Notes sur certaines fonctions v1.3.0

- **Transitions automatiques** : expérimental — dépend du QE DOM (API non
  documentée). Si l'effet « Fondu enchaîné » est introuvable ou l'API
  incompatible, un avertissement est journalisé et rien n'est ajouté.
- **Annuler / Rétablir** : Premiere n'expose pas d'annulation fiable par
  script. Les boutons appellent `app.undo()` / `app.redo()` s'ils existent,
  sinon ils rappellent d'utiliser Ctrl+Z / Ctrl+Maj+Z.
- **Internationalisation** : couvre les libellés et infobulles de l'interface
  (les messages techniques du journal restent en français).

## Backlog d'idées (à planifier — non codé pour l'instant)

> Liste de fonctionnalités candidates dans lesquelles piocher. Cocher quand
> implémenté, ou déplacer vers les sections du haut.

### B-Roll
- [ ] Espacement régulier des extraits sur la timeline (au lieu de garder leur position d'origine)
- [ ] Durée aléatoire entre un min et un max (au lieu d'une durée fixe)
- [ ] Échantillonnage : ne traiter qu'un clip sur N
- [ ] Exclure les clips plus courts qu'un seuil configurable
- [ ] Répartir les extraits sur plusieurs pistes destination en alternance
- [ ] Génération B-Roll depuis plusieurs pistes source en une passe
- [ ] Vitesse de l'extrait (ralenti / accéléré, %) ou lecture inversée
- [ ] Préfixe de nommage configurable pour les extraits
- [ ] Copier les effets/attributs du clip source vers l'extrait
- [ ] Choix du type et de la durée de transition
- [ ] Générer les extraits dans une nouvelle séquence dédiée

### Compactage
- [ ] Compacter uniquement entre deux marqueurs ou une plage In/Out
- [ ] Conserver un espace fixe entre clips (au lieu de coller à zéro)
- [ ] Aperçu (dry-run) listant les trous avant suppression
- [ ] Fermer aussi le trou de tête commun en gardant la synchro inter-pistes
- [ ] Détecter et supprimer les clips vides / silences

### Interface & confort
- [ ] Profils / presets de réglages nommés (sauvegarder, charger)
- [ ] Export / import des réglages (fichier .json)
- [ ] Bouton « Annuler la dernière génération » (retire les extraits créés)
- [ ] Barre de progression pour les opérations longues
- [ ] Confirmation avant une opération qui modifie beaucoup de clips
- [ ] Affichage durée totale / nombre de clips de la séquence
- [ ] Export du journal dans un fichier texte
- [ ] Thème clair en plus du thème sombre

### Audio
- [ ] Compactage audio indépendant de la vidéo (délier avant)
- [ ] Normaliser / ajuster le gain des extraits
- [ ] Détection de silences pour découpe automatique

### Divers
- [ ] Internationalisation : traduire aussi les messages du journal
- [ ] Langues supplémentaires (ES, DE…)
- [ ] Mode batch sur plusieurs séquences
- [ ] Tests automatisés en CI (le bouton Diagnostic couvre un auto-test manuel)
