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
- [x] Tests automatisés (syntaxe JS + cohérence i18n) + workflow CI GitHub Actions — v1.4.0

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
- [x] Thème clair / sombre (sélecteur dans le pied de page, mémorisé) — v1.3.2
- [x] Profils / presets de réglages nommés (enregistrer, charger, supprimer) — v1.3.3
- [x] Export / import des réglages (fichier .json) — v1.3.3
- [x] Affichage du nombre de clips et de la durée de la séquence — v1.3.4
- [x] Barre de progression (indéterminée) pendant les opérations longues — v1.3.4
- [x] Confirmation avant une opération touchant beaucoup de clips — v1.3.4
- [x] Bouton « Annuler la dernière génération » (retire les extraits, best-effort) — v1.3.4
- [x] Export du journal dans un fichier texte — v1.3.4
- [x] Traduction des messages du journal (i18n paramétrée) — v1.4.0
- [x] Langues supplémentaires : Espagnol et Allemand (FR/EN/ES/DE) — v1.4.0

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
- [x] Report de l'étiquette **couleur** du clip source sur l'extrait — ⚠️ invariant à conserver
- [x] Report du **libellé / nom** du clip source sur l'extrait (best-effort) — ⚠️ invariant à conserver — v1.3.1
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
- [ ] **Compactage synchronisé V/A** — garder chaque audio sous sa vidéo (voir spec ci-dessous) — ⚠️ bug actuel

### Spec — Compactage synchronisé (à implémenter)

**Problème constaté.** `_compactTrack()` traite chaque piste cochée
*indépendamment* : V1 se compacte de son côté, A1 du sien. Comme l'audio n'est
présent que sous *certains* clips vidéo, les clips A1 se retrouvent tous collés
bout à bout au début de la timeline, désynchronisés de leur vidéo. Cocher V1
seule ne suffit pas non plus : seuls les items *liés* suivent, l'audio délié ou
orphelin reste sur place.

**Comportement voulu.** Les pistes cochées sont compactées **ensemble**, comme
un seul bloc : seuls les trous **communs à toutes les pistes cochées** sont
fermés, et tout ce qui se trouve après un trou est décalé du **même delta** sur
toutes les pistes. Les positions relatives audio ↔ vidéo sont donc préservées à
la frame près.

**Algorithme (`_compactTracksSynced(tracks, warnings)`)**

1. Snapshot de chaque piste cochée → liste d'intervalles `[startSec, endSec]`.
2. **Union** de tous ces intervalles, toutes pistes confondues (fusion des
   chevauchements et des intervalles contigus) → liste d'occupation globale.
3. **Trous communs** = complément de cette union :
   - trou de tête `[0, premierStart]` s'il dépasse la tolérance ;
   - entre deux intervalles fusionnés consécutifs `[fin(i), début(i+1)]` ;
   - la queue après le dernier clip est ignorée.
4. Fermer le **premier** trou commun : `delta = largeur du trou`. Déplacer de
   `-delta` **tous** les clips de **toutes** les pistes cochées dont
   `start >= fin du trou`, traités de gauche à droite (la place devant est libre
   par construction).
5. **Anti-double-déplacement des items liés** : `move()` sur un clip vidéo
   déplace déjà son audio lié. Avant chaque `move()`, re-snapshot puis chercher
   le clip à sa position attendue `start` ; s'il n'y est plus mais qu'un clip de
   même durée occupe `start - delta`, il a déjà été déplacé par son lié → passer
   au suivant sans le déplacer une seconde fois.
6. **Garde-fou** avant chaque `move()` : la zone `[start-delta, end-delta]` de la
   piste cible doit être libre, sinon warning et ce clip est laissé en place.
7. Re-calculer les trous communs et recommencer ; boucle bornée par
   `(nb total de clips des pistes cochées) + 2` passes, comme `_compactTrack`.

**Tolérances** — reprendre celles du code actuel : `0.001 s` pour détecter un
trou, `0.02 s` pour vérifier qu'un `move()` a bien eu lieu.

**Interface**

- [ ] Case à cocher `opt-sync-gaps` dans l'onglet Compactage, **cochée par
      défaut**, libellé « Garder la synchro audio/vidéo (compacter les pistes
      ensemble) » + hint expliquant que seuls les trous communs sont fermés.
- [ ] État mémorisé dans les prefs (`savePref` / `getPref`), comme `gapsChecked`.
- [ ] Décochée → comportement historique piste par piste (`_compactTrack`) conservé.
- [ ] Clés i18n FR/EN/ES/DE pour le libellé, le hint et le compte-rendu
      (la parité des 4 tables est vérifiée par `test/check.mjs`).

**Côté hôte**

- [ ] `removeGaps()` route vers `_compactTracksSynced()` ou `_compactTrack()`
      selon le flag `p.synced` du payload ; un seul `openUndoGroup` pour
      l'ensemble dans les deux cas.
- [ ] Compte-rendu : nb de trous fermés, nb de clips déplacés, durée totale
      supprimée.
- [ ] Le mode batch suit automatiquement (`batchOperation` relaie `params` tel quel).

**Cas limites à traiter**

- [ ] Pistes **non cochées** : elles ne sont pas déplacées. Journaliser un
      avertissement si l'une d'elles contient des clips après le premier trou
      fermé (risque de désynchro avec V2/V3).
- [ ] **Trou de tête** : fermé lui aussi, en décalant toutes les pistes cochées
      du même delta (absorbe l'item de backlog correspondant).
- [ ] Une **seule piste** cochée : le résultat est identique au compactage actuel
      (l'union se réduit à cette piste) — à vérifier en non-régression.
- [ ] Audio **plus long** que sa vidéo (ou décalé) : géré nativement par l'union,
      l'intervalle occupé s'étend jusqu'à la fin de l'audio.

## Onglet Batch

- [x] Application de B-Roll ou Compactage à plusieurs séquences en une fois — v1.4.0
- [x] Liste des séquences du projet (cases à cocher + Tout/Aucune/Recharger) — v1.4.0
- [x] Compte-rendu par séquence dans le journal — v1.4.0

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
- [ ] ~~Fermer aussi le trou de tête commun en gardant la synchro inter-pistes~~ → couvert par la spec « Compactage synchronisé » ci-dessus
- [ ] Détecter et supprimer les clips vides / silences

### Audio
- [ ] Compactage audio indépendant de la vidéo (délier avant)
- [ ] Normaliser / ajuster le gain des extraits
- [ ] Détection de silences pour découpe automatique
