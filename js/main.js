/*
 * Maxime Bodivit Vision Ext - Panel logic
 *
 * Communicates with the Premiere Pro host application via the CEP
 * `__adobe_cep__.evalScript` bridge. All timeline manipulation happens
 * in ExtendScript (see jsx/host.jsx).
 *
 * Two tabs:
 *   - B-Roll : extract portions from a source video track into a
 *              destination track, with full handles on each new clip.
 *   - Compactage : remove all gaps between clips on a chosen track.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // DOM references
  // ------------------------------------------------------------------
  // Common
  const seqNameEl   = document.getElementById('seq-name');
  const progressEl  = document.getElementById('progress');
  const refreshBtn  = document.getElementById('refresh-btn');
  const undoBtn     = document.getElementById('undo-btn');
  const redoBtn     = document.getElementById('redo-btn');
  const logEl       = document.getElementById('log');
  const clearLogBtn = document.getElementById('clear-log');
  const diagBtn     = document.getElementById('diag-btn');
  const logExportBtn = document.getElementById('log-export');
  const langSelect  = document.getElementById('lang-select');
  const themeBtn    = document.getElementById('theme-btn');
  const tabBtns     = document.querySelectorAll('.tab');
  const tabPanels   = document.querySelectorAll('.tab-content');

  // B-Roll tab
  const durationEl  = document.getElementById('duration');
  const positionEl  = document.getElementById('position');
  const srcTrackEl  = document.getElementById('src-track');
  const dstTrackEl  = document.getElementById('dst-track');
  const optSelected = document.getElementById('opt-selected');
  const optRandom   = document.getElementById('opt-random');
  const optZoom     = document.getElementById('opt-zoom');
  const optMarker   = document.getElementById('opt-marker');
  const optTransition = document.getElementById('opt-transition');
  const generateBtn = document.getElementById('generate-btn');
  const previewBtn  = document.getElementById('preview-btn');
  const undoGenBtn  = document.getElementById('undo-gen-btn');
  const presetBtns  = document.querySelectorAll('.preset');

  // Settings profiles / import-export
  const presetSelect   = document.getElementById('preset-select');
  const presetNameEl   = document.getElementById('preset-name');
  const presetLoadBtn  = document.getElementById('preset-load');
  const presetSaveBtn  = document.getElementById('preset-save');
  const presetDelBtn   = document.getElementById('preset-delete');
  const exportBtn      = document.getElementById('settings-export');
  const importBtn      = document.getElementById('settings-import');
  const settingsFileEl = document.getElementById('settings-file');

  // Gaps tab
  const gapsTracksEl = document.getElementById('gaps-tracks');
  const gapsAllBtn   = document.getElementById('gaps-all');
  const gapsNoneBtn  = document.getElementById('gaps-none');
  const gapsBtn      = document.getElementById('gaps-btn');

  // Cached sequence info (clip counts per track, duration) from last refresh.
  let seqInfo = null;
  // Last B-Roll generation, so it can be undone: { dstIdx, starts: [sec,...] }.
  let lastGeneration = null;

  // ------------------------------------------------------------------
  // ExtendScript bridge
  // ------------------------------------------------------------------
  function evalScript(script) {
    return new Promise((resolve) => {
      if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
        window.__adobe_cep__.evalScript(script, (res) => resolve(res));
      } else {
        resolve(JSON.stringify({ error: 'CEP bridge unavailable' }));
      }
    });
  }

  function showProgress() { if (progressEl) progressEl.classList.remove('hidden'); }
  function hideProgress() { if (progressEl) progressEl.classList.add('hidden'); }

  // evalScript variant that shows the indeterminate progress bar while the
  // host call is running (for the longer operations).
  async function evalScriptP(script) {
    showProgress();
    try { return await evalScript(script); }
    finally { hideProgress(); }
  }

  // Ask for confirmation before an operation that touches many clips.
  const CONFIRM_THRESHOLD = 25;
  function askConfirm(msg) {
    try { return window.confirm(msg); } catch (e) { return true; }
  }

  function jsString(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  // ------------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------------
  function log(level, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + level;
    const stamp = new Date().toTimeString().slice(0, 8);
    line.textContent = '[' + stamp + '] ' + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ------------------------------------------------------------------
  // Settings persistence (localStorage)
  // ------------------------------------------------------------------
  // Form controls whose value is remembered between sessions. Features
  // that add new controls simply append their id here.
  const PERSIST_IDS = [
    'duration', 'position', 'src-track', 'dst-track',
    'opt-selected', 'opt-random', 'opt-zoom', 'opt-marker', 'opt-transition'
  ];
  const LS_SETTINGS = 'visionext.settings';
  const LS_PREFS    = 'visionext.prefs';

  function _lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function _lsSet(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  const LS_PRESETS  = 'visionext.presets';

  // Snapshot the persistent controls into a plain object.
  function collectSettings() {
    const data = {};
    PERSIST_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      data[id] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    return data;
  }

  // Apply a settings object onto the controls (does not persist by itself).
  function _applySettings(data) {
    if (!data) return;
    PERSIST_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || !(id in data)) return;
      if (el.type === 'checkbox') {
        el.checked = !!data[id];
      } else if (el.tagName === 'SELECT') {
        // Only apply if the option exists (track lists vary per sequence).
        const v = String(data[id]).replace(/"/g, '\\"');
        if (el.querySelector('option[value="' + v + '"]')) el.value = data[id];
      } else {
        el.value = data[id];
      }
    });
  }

  function saveSettings() { _lsSet(LS_SETTINGS, collectSettings()); }
  function restoreSettings() { _applySettings(_lsGet(LS_SETTINGS)); }

  function savePref(key, value) {
    const prefs = _lsGet(LS_PREFS) || {};
    prefs[key] = value;
    _lsSet(LS_PREFS, prefs);
  }
  function getPref(key, fallback) {
    const prefs = _lsGet(LS_PREFS) || {};
    return (key in prefs) ? prefs[key] : fallback;
  }

  // Save on any control change (programmatic .value sets don't fire these,
  // so preset buttons call saveSettings() explicitly).
  function wirePersistence() {
    document.querySelectorAll('#app input, #app select').forEach((el) => {
      el.addEventListener('change', saveSettings);
      el.addEventListener('input', saveSettings);
    });
  }

  function restoreTab() {
    const tab = getPref('tab', 'broll');
    const btn = document.querySelector('.tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  // ------------------------------------------------------------------
  // Internationalisation (FR / EN / ES / DE) — UI labels AND log messages.
  // Templates may use {placeholders} filled by t(key, params).
  // ------------------------------------------------------------------
  const I18N = {
    fr: {
      'tab.gaps': 'Compactage',
      'seq.none': 'Aucune sequence detectee',
      'broll.duration': 'Duree du segment (secondes)',
      'broll.position': 'Position dans le clip',
      'pos.start': 'Debut du clip',
      'pos.middle': 'Milieu du clip',
      'pos.end': 'Fin du clip',
      'broll.src': 'Piste source',
      'broll.dst': 'Piste destination',
      'broll.dstHint': "La piste sera creee automatiquement si elle n'existe pas.",
      'options': 'Options',
      'opt.selected': 'Seulement les clips selectionnes (sinon toute la piste)',
      'opt.random': 'Position aleatoire dans chaque clip',
      'opt.zoom': 'Ajouter un zoom leger (scale 110%)',
      'opt.marker': 'Ajouter un marqueur sur chaque extrait',
      'opt.transition': 'Ajouter des transitions (fondu enchaine, experimental)',
      'btn.preview': 'Previsualiser',
      'btn.generate': 'Generer les extraits',
      'btn.undoGen': 'Annuler la derniere generation',
      'gaps.tracks': 'Pistes a compacter',
      'gaps.all': 'Tout',
      'gaps.none': 'Aucune',
      'gaps.hint': "Coche une ou plusieurs pistes. Tous les trous entre clips de chaque piste cochee sont supprimes (clips decales vers la gauche). L'ensemble compte comme une seule annulation.",
      'btn.gaps': 'Supprimer les trous',
      'log.title': 'Journal',
      'log.diag': 'Diagnostic',
      'log.clear': 'Effacer',
      'log.export': 'Exporter',
      'tip.undo': 'Annuler (Ctrl+Z)',
      'tip.redo': 'Retablir (Ctrl+Maj+Z)',
      'tip.refresh': 'Recharger les pistes de la sequence active',
      'tip.theme': 'Theme clair / sombre',
      'presets.label': 'Profils de reglages',
      'presets.none': '— Profils —',
      'presets.load': 'Charger',
      'presets.save': 'Enregistrer',
      'presets.delete': 'Suppr.',
      'presets.export': 'Exporter .json',
      'presets.import': 'Importer .json',
      'presets.name': 'Nom du profil',
      'busy.generating': 'Generation en cours...',
      'busy.preview': 'Calcul...',
      'busy.compacting': 'Compactage en cours...',
      'flag.selection': 'selection',
      'flag.random': 'aleatoire',
      'flag.zoom': 'zoom',
      'flag.markers': 'marqueurs',
      'flag.transitions': 'transitions',
      'msg.badResponse': 'Reponse invalide du host : {raw}',
      'msg.tracksRefreshed': 'Pistes rafraichies ({v}V / {a}A).',
      'msg.loaded': 'Extension chargee. Choisis un onglet et rafraichis les pistes si besoin.',
      'broll.badDuration': 'Duree invalide.',
      'broll.badTracks': 'Pistes source/destination invalides.',
      'broll.sameTrack': 'Les pistes source et destination doivent etre differentes.',
      'broll.genCancelled': 'Generation annulee.',
      'broll.genConfirm': "Cette generation peut traiter jusqu'a {n} clips de la piste V{track}. Continuer ?",
      'broll.genStart': 'B-Roll : duree {d}s, position {pos}, V{src} -> V{dst}{flags}',
      'broll.done': 'Termine. {n} extrait(s) cree(s) sur V{track}. Ignores : {skip}.',
      'broll.transitionsAdded': '{n} transition(s) ajoutee(s).',
      'preview.start': 'Previsualisation B-Roll (aucune modification de la timeline)...',
      'preview.summary': 'Apercu : {n} extrait(s) seraient crees sur V{track}.',
      'preview.item': '  - {name} @ {start}s (duree {dur}s)',
      'undogen.none': 'Aucune generation a annuler.',
      'undogen.confirm': 'Retirer les {n} extrait(s) de la derniere generation ?',
      'undogen.start': 'Annulation de la derniere generation...',
      'undogen.done': '{n} extrait(s) retire(s).',
      'gaps.noTrack': 'Aucune piste cochee.',
      'gaps.cancelled': 'Compactage annule.',
      'gaps.confirm': 'Le compactage va traiter environ {n} clips. Continuer ?',
      'gaps.start': 'Compactage de {n} piste(s) : {list}',
      'gaps.done': 'Termine. {n} clip(s) deplace(s) sur {t} piste(s). Total supprime : {sec}s.',
      'preset.needName': "Donne un nom au profil avant d'enregistrer.",
      'preset.saved': 'Profil enregistre : "{name}".',
      'preset.pick': 'Choisis un profil dans la liste.',
      'preset.missing': 'Profil introuvable.',
      'preset.loaded': 'Profil charge : "{name}".',
      'preset.pickDel': 'Choisis un profil a supprimer.',
      'preset.deleted': 'Profil supprime : "{name}".',
      'settings.exported': 'Reglages exportes (visionext-reglages.json).',
      'settings.exportFail': 'Export impossible : {msg}',
      'settings.importBad': 'Import impossible : fichier JSON invalide.',
      'settings.imported': 'Reglages importes.',
      'settings.importNone': 'Aucun reglage reconnu dans le fichier.',
      'logmsg.empty': 'Journal vide.',
      'logmsg.exported': 'Journal exporte (visionext-journal.txt).',
      'logmsg.exportFail': 'Export du journal impossible : {msg}',
      'diag.start': 'Diagnostic en cours...',
      'diag.error': 'Diagnostic : {msg}',
      'diag.done': 'Diagnostic termine.',
      'undo.done': 'Annule.',
      'redo.done': 'Retabli.',
      'op.unavailable': 'Operation non disponible.'
    },
    en: {
      'tab.gaps': 'Compacting',
      'seq.none': 'No sequence detected',
      'broll.duration': 'Segment duration (seconds)',
      'broll.position': 'Position within the clip',
      'pos.start': 'Clip start',
      'pos.middle': 'Clip middle',
      'pos.end': 'Clip end',
      'broll.src': 'Source track',
      'broll.dst': 'Destination track',
      'broll.dstHint': "The track is created automatically if it doesn't exist.",
      'options': 'Options',
      'opt.selected': 'Selected clips only (otherwise the whole track)',
      'opt.random': 'Random position within each clip',
      'opt.zoom': 'Add a slight zoom (scale 110%)',
      'opt.marker': 'Add a marker on each extract',
      'opt.transition': 'Add transitions (cross dissolve, experimental)',
      'btn.preview': 'Preview',
      'btn.generate': 'Generate extracts',
      'btn.undoGen': 'Undo last generation',
      'gaps.tracks': 'Tracks to compact',
      'gaps.all': 'All',
      'gaps.none': 'None',
      'gaps.hint': 'Tick one or more tracks. All gaps between clips of each ticked track are removed (clips shifted left). The whole run counts as a single undo.',
      'btn.gaps': 'Remove gaps',
      'log.title': 'Log',
      'log.diag': 'Diagnostic',
      'log.clear': 'Clear',
      'log.export': 'Export',
      'tip.undo': 'Undo (Ctrl+Z)',
      'tip.redo': 'Redo (Ctrl+Shift+Z)',
      'tip.refresh': 'Reload the active sequence tracks',
      'tip.theme': 'Light / dark theme',
      'presets.label': 'Settings profiles',
      'presets.none': '— Profiles —',
      'presets.load': 'Load',
      'presets.save': 'Save',
      'presets.delete': 'Delete',
      'presets.export': 'Export .json',
      'presets.import': 'Import .json',
      'presets.name': 'Profile name',
      'busy.generating': 'Generating...',
      'busy.preview': 'Computing...',
      'busy.compacting': 'Compacting...',
      'flag.selection': 'selection',
      'flag.random': 'random',
      'flag.zoom': 'zoom',
      'flag.markers': 'markers',
      'flag.transitions': 'transitions',
      'msg.badResponse': 'Invalid host response: {raw}',
      'msg.tracksRefreshed': 'Tracks refreshed ({v}V / {a}A).',
      'msg.loaded': 'Extension loaded. Pick a tab and refresh the tracks if needed.',
      'broll.badDuration': 'Invalid duration.',
      'broll.badTracks': 'Invalid source/destination tracks.',
      'broll.sameTrack': 'Source and destination tracks must be different.',
      'broll.genCancelled': 'Generation cancelled.',
      'broll.genConfirm': 'This generation may process up to {n} clips on track V{track}. Continue?',
      'broll.genStart': 'B-Roll: duration {d}s, position {pos}, V{src} -> V{dst}{flags}',
      'broll.done': 'Done. {n} extract(s) created on V{track}. Skipped: {skip}.',
      'broll.transitionsAdded': '{n} transition(s) added.',
      'preview.start': 'B-Roll preview (no timeline change)...',
      'preview.summary': 'Preview: {n} extract(s) would be created on V{track}.',
      'preview.item': '  - {name} @ {start}s (duration {dur}s)',
      'undogen.none': 'Nothing to undo.',
      'undogen.confirm': 'Remove the {n} extract(s) from the last generation?',
      'undogen.start': 'Undoing the last generation...',
      'undogen.done': '{n} extract(s) removed.',
      'gaps.noTrack': 'No track ticked.',
      'gaps.cancelled': 'Compacting cancelled.',
      'gaps.confirm': 'Compacting will process about {n} clips. Continue?',
      'gaps.start': 'Compacting {n} track(s): {list}',
      'gaps.done': 'Done. {n} clip(s) shifted across {t} track(s). Total removed: {sec}s.',
      'preset.needName': 'Name the profile before saving.',
      'preset.saved': 'Profile saved: "{name}".',
      'preset.pick': 'Pick a profile from the list.',
      'preset.missing': 'Profile not found.',
      'preset.loaded': 'Profile loaded: "{name}".',
      'preset.pickDel': 'Pick a profile to delete.',
      'preset.deleted': 'Profile deleted: "{name}".',
      'settings.exported': 'Settings exported (visionext-reglages.json).',
      'settings.exportFail': 'Export failed: {msg}',
      'settings.importBad': 'Import failed: invalid JSON file.',
      'settings.imported': 'Settings imported.',
      'settings.importNone': 'No recognised settings in the file.',
      'logmsg.empty': 'Log is empty.',
      'logmsg.exported': 'Log exported (visionext-journal.txt).',
      'logmsg.exportFail': 'Log export failed: {msg}',
      'diag.start': 'Diagnostic running...',
      'diag.error': 'Diagnostic: {msg}',
      'diag.done': 'Diagnostic finished.',
      'undo.done': 'Undone.',
      'redo.done': 'Redone.',
      'op.unavailable': 'Operation unavailable.'
    },
    es: {
      'tab.gaps': 'Compactar',
      'seq.none': 'Ninguna secuencia detectada',
      'broll.duration': 'Duracion del segmento (segundos)',
      'broll.position': 'Posicion en el clip',
      'pos.start': 'Inicio del clip',
      'pos.middle': 'Centro del clip',
      'pos.end': 'Final del clip',
      'broll.src': 'Pista de origen',
      'broll.dst': 'Pista de destino',
      'broll.dstHint': 'La pista se crea automaticamente si no existe.',
      'options': 'Opciones',
      'opt.selected': 'Solo los clips seleccionados (si no, toda la pista)',
      'opt.random': 'Posicion aleatoria en cada clip',
      'opt.zoom': 'Anadir un ligero zoom (escala 110%)',
      'opt.marker': 'Anadir un marcador en cada extracto',
      'opt.transition': 'Anadir transiciones (fundido encadenado, experimental)',
      'btn.preview': 'Previsualizar',
      'btn.generate': 'Generar extractos',
      'btn.undoGen': 'Deshacer la ultima generacion',
      'gaps.tracks': 'Pistas a compactar',
      'gaps.all': 'Todo',
      'gaps.none': 'Ninguna',
      'gaps.hint': 'Marca una o varias pistas. Se eliminan todos los huecos entre clips de cada pista marcada (los clips se desplazan a la izquierda). Todo cuenta como una sola anulacion.',
      'btn.gaps': 'Eliminar los huecos',
      'log.title': 'Registro',
      'log.diag': 'Diagnostico',
      'log.clear': 'Borrar',
      'log.export': 'Exportar',
      'tip.undo': 'Deshacer (Ctrl+Z)',
      'tip.redo': 'Rehacer (Ctrl+Mayus+Z)',
      'tip.refresh': 'Recargar las pistas de la secuencia activa',
      'tip.theme': 'Tema claro / oscuro',
      'presets.label': 'Perfiles de ajustes',
      'presets.none': '— Perfiles —',
      'presets.load': 'Cargar',
      'presets.save': 'Guardar',
      'presets.delete': 'Eliminar',
      'presets.export': 'Exportar .json',
      'presets.import': 'Importar .json',
      'presets.name': 'Nombre del perfil',
      'busy.generating': 'Generando...',
      'busy.preview': 'Calculando...',
      'busy.compacting': 'Compactando...',
      'flag.selection': 'seleccion',
      'flag.random': 'aleatorio',
      'flag.zoom': 'zoom',
      'flag.markers': 'marcadores',
      'flag.transitions': 'transiciones',
      'msg.badResponse': 'Respuesta del host no valida: {raw}',
      'msg.tracksRefreshed': 'Pistas recargadas ({v}V / {a}A).',
      'msg.loaded': 'Extension cargada. Elige una pestana y recarga las pistas si hace falta.',
      'broll.badDuration': 'Duracion no valida.',
      'broll.badTracks': 'Pistas de origen/destino no validas.',
      'broll.sameTrack': 'Las pistas de origen y destino deben ser diferentes.',
      'broll.genCancelled': 'Generacion cancelada.',
      'broll.genConfirm': 'Esta generacion puede procesar hasta {n} clips de la pista V{track}. Continuar?',
      'broll.genStart': 'B-Roll: duracion {d}s, posicion {pos}, V{src} -> V{dst}{flags}',
      'broll.done': 'Hecho. {n} extracto(s) creado(s) en V{track}. Omitidos: {skip}.',
      'broll.transitionsAdded': '{n} transicion(es) anadida(s).',
      'preview.start': 'Previsualizacion B-Roll (sin cambios en la linea de tiempo)...',
      'preview.summary': 'Vista previa: se crearian {n} extracto(s) en V{track}.',
      'preview.item': '  - {name} @ {start}s (duracion {dur}s)',
      'undogen.none': 'Nada que deshacer.',
      'undogen.confirm': 'Quitar los {n} extracto(s) de la ultima generacion?',
      'undogen.start': 'Deshaciendo la ultima generacion...',
      'undogen.done': '{n} extracto(s) eliminado(s).',
      'gaps.noTrack': 'Ninguna pista marcada.',
      'gaps.cancelled': 'Compactado cancelado.',
      'gaps.confirm': 'El compactado procesara unos {n} clips. Continuar?',
      'gaps.start': 'Compactando {n} pista(s): {list}',
      'gaps.done': 'Hecho. {n} clip(s) desplazado(s) en {t} pista(s). Total eliminado: {sec}s.',
      'preset.needName': 'Da un nombre al perfil antes de guardar.',
      'preset.saved': 'Perfil guardado: "{name}".',
      'preset.pick': 'Elige un perfil de la lista.',
      'preset.missing': 'Perfil no encontrado.',
      'preset.loaded': 'Perfil cargado: "{name}".',
      'preset.pickDel': 'Elige un perfil para eliminar.',
      'preset.deleted': 'Perfil eliminado: "{name}".',
      'settings.exported': 'Ajustes exportados (visionext-reglages.json).',
      'settings.exportFail': 'Exportacion imposible: {msg}',
      'settings.importBad': 'Importacion imposible: archivo JSON no valido.',
      'settings.imported': 'Ajustes importados.',
      'settings.importNone': 'Ningun ajuste reconocido en el archivo.',
      'logmsg.empty': 'Registro vacio.',
      'logmsg.exported': 'Registro exportado (visionext-journal.txt).',
      'logmsg.exportFail': 'Exportacion del registro imposible: {msg}',
      'diag.start': 'Diagnostico en curso...',
      'diag.error': 'Diagnostico: {msg}',
      'diag.done': 'Diagnostico finalizado.',
      'undo.done': 'Deshecho.',
      'redo.done': 'Rehecho.',
      'op.unavailable': 'Operacion no disponible.'
    },
    de: {
      'tab.gaps': 'Verdichten',
      'seq.none': 'Keine Sequenz erkannt',
      'broll.duration': 'Segmentdauer (Sekunden)',
      'broll.position': 'Position im Clip',
      'pos.start': 'Clip-Anfang',
      'pos.middle': 'Clip-Mitte',
      'pos.end': 'Clip-Ende',
      'broll.src': 'Quellspur',
      'broll.dst': 'Zielspur',
      'broll.dstHint': 'Die Spur wird automatisch erstellt, falls sie nicht existiert.',
      'options': 'Optionen',
      'opt.selected': 'Nur ausgewahlte Clips (sonst die ganze Spur)',
      'opt.random': 'Zufallige Position in jedem Clip',
      'opt.zoom': 'Leichten Zoom hinzufugen (Skalierung 110%)',
      'opt.marker': 'Marke an jedem Ausschnitt hinzufugen',
      'opt.transition': 'Ubergange hinzufugen (Weiche Blende, experimentell)',
      'btn.preview': 'Vorschau',
      'btn.generate': 'Ausschnitte erzeugen',
      'btn.undoGen': 'Letzte Erzeugung ruckgangig',
      'gaps.tracks': 'Zu verdichtende Spuren',
      'gaps.all': 'Alle',
      'gaps.none': 'Keine',
      'gaps.hint': 'Eine oder mehrere Spuren ankreuzen. Alle Lucken zwischen Clips jeder Spur werden entfernt (Clips nach links geruckt). Alles zahlt als ein einziges Ruckgangig.',
      'btn.gaps': 'Lucken entfernen',
      'log.title': 'Protokoll',
      'log.diag': 'Diagnose',
      'log.clear': 'Loschen',
      'log.export': 'Exportieren',
      'tip.undo': 'Ruckgangig (Strg+Z)',
      'tip.redo': 'Wiederholen (Strg+Umschalt+Z)',
      'tip.refresh': 'Spuren der aktiven Sequenz neu laden',
      'tip.theme': 'Helles / dunkles Thema',
      'presets.label': 'Einstellungsprofile',
      'presets.none': '— Profile —',
      'presets.load': 'Laden',
      'presets.save': 'Speichern',
      'presets.delete': 'Loschen',
      'presets.export': '.json exportieren',
      'presets.import': '.json importieren',
      'presets.name': 'Profilname',
      'busy.generating': 'Wird erzeugt...',
      'busy.preview': 'Berechnung...',
      'busy.compacting': 'Wird verdichtet...',
      'flag.selection': 'Auswahl',
      'flag.random': 'zufallig',
      'flag.zoom': 'Zoom',
      'flag.markers': 'Marken',
      'flag.transitions': 'Ubergange',
      'msg.badResponse': 'Ungultige Host-Antwort: {raw}',
      'msg.tracksRefreshed': 'Spuren neu geladen ({v}V / {a}A).',
      'msg.loaded': 'Erweiterung geladen. Tab wahlen und Spuren bei Bedarf neu laden.',
      'broll.badDuration': 'Ungultige Dauer.',
      'broll.badTracks': 'Ungultige Quell-/Zielspuren.',
      'broll.sameTrack': 'Quell- und Zielspur mussen unterschiedlich sein.',
      'broll.genCancelled': 'Erzeugung abgebrochen.',
      'broll.genConfirm': 'Diese Erzeugung kann bis zu {n} Clips auf Spur V{track} verarbeiten. Fortfahren?',
      'broll.genStart': 'B-Roll: Dauer {d}s, Position {pos}, V{src} -> V{dst}{flags}',
      'broll.done': 'Fertig. {n} Ausschnitt(e) auf V{track} erstellt. Ubersprungen: {skip}.',
      'broll.transitionsAdded': '{n} Ubergang(e) hinzugefugt.',
      'preview.start': 'B-Roll-Vorschau (keine Anderung der Timeline)...',
      'preview.summary': 'Vorschau: {n} Ausschnitt(e) wurden auf V{track} erstellt.',
      'preview.item': '  - {name} @ {start}s (Dauer {dur}s)',
      'undogen.none': 'Nichts ruckgangig zu machen.',
      'undogen.confirm': 'Die {n} Ausschnitt(e) der letzten Erzeugung entfernen?',
      'undogen.start': 'Letzte Erzeugung wird ruckgangig gemacht...',
      'undogen.done': '{n} Ausschnitt(e) entfernt.',
      'gaps.noTrack': 'Keine Spur angekreuzt.',
      'gaps.cancelled': 'Verdichten abgebrochen.',
      'gaps.confirm': 'Das Verdichten verarbeitet etwa {n} Clips. Fortfahren?',
      'gaps.start': 'Verdichte {n} Spur(en): {list}',
      'gaps.done': 'Fertig. {n} Clip(s) auf {t} Spur(en) verschoben. Insgesamt entfernt: {sec}s.',
      'preset.needName': 'Profil vor dem Speichern benennen.',
      'preset.saved': 'Profil gespeichert: "{name}".',
      'preset.pick': 'Ein Profil aus der Liste wahlen.',
      'preset.missing': 'Profil nicht gefunden.',
      'preset.loaded': 'Profil geladen: "{name}".',
      'preset.pickDel': 'Ein Profil zum Loschen wahlen.',
      'preset.deleted': 'Profil geloscht: "{name}".',
      'settings.exported': 'Einstellungen exportiert (visionext-reglages.json).',
      'settings.exportFail': 'Export nicht moglich: {msg}',
      'settings.importBad': 'Import nicht moglich: ungultige JSON-Datei.',
      'settings.imported': 'Einstellungen importiert.',
      'settings.importNone': 'Keine erkannten Einstellungen in der Datei.',
      'logmsg.empty': 'Protokoll leer.',
      'logmsg.exported': 'Protokoll exportiert (visionext-journal.txt).',
      'logmsg.exportFail': 'Protokoll-Export nicht moglich: {msg}',
      'diag.start': 'Diagnose lauft...',
      'diag.error': 'Diagnose: {msg}',
      'diag.done': 'Diagnose abgeschlossen.',
      'undo.done': 'Ruckgangig gemacht.',
      'redo.done': 'Wiederholt.',
      'op.unavailable': 'Vorgang nicht verfugbar.'
    }
  };
  const LANGS = ['fr', 'en', 'es', 'de'];
  let LANG = 'fr';

  // Translate a key, filling {placeholders} from params if given.
  function t(key, params) {
    const dict = I18N[LANG] || I18N.fr;
    let s = (dict[key] != null) ? dict[key] : (I18N.fr[key] != null ? I18N.fr[key] : key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
    }
    return s;
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    document.documentElement.lang = LANG;
  }

  function setLang(lang) {
    LANG = (LANGS.indexOf(lang) !== -1) ? lang : 'fr';
    savePref('lang', LANG);
    applyI18n();
    refreshPresetList(); // re-translate the "— Profils —" placeholder
  }

  // ------------------------------------------------------------------
  // Theme (dark / light)
  // ------------------------------------------------------------------
  let THEME = 'dark';
  function applyTheme(theme) {
    THEME = (theme === 'light') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', THEME);
    // Show the icon of the theme you would switch TO.
    if (themeBtn) themeBtn.innerHTML = (THEME === 'dark') ? '☀' : '☽';
  }
  function setTheme(theme) {
    applyTheme(theme);
    savePref('theme', THEME);
  }
  function toggleTheme() { setTheme(THEME === 'dark' ? 'light' : 'dark'); }

  // ------------------------------------------------------------------
  // Settings profiles (named presets) + import / export
  // ------------------------------------------------------------------
  function getPresets() { return _lsGet(LS_PRESETS) || {}; }
  function setPresets(obj) { _lsSet(LS_PRESETS, obj); }

  function refreshPresetList() {
    if (!presetSelect) return;
    const presets = getPresets();
    const names = Object.keys(presets).sort();
    const cur = presetSelect.value;
    presetSelect.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = t('presets.none');
    presetSelect.appendChild(ph);
    names.forEach((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      presetSelect.appendChild(o);
    });
    if (names.indexOf(cur) !== -1) presetSelect.value = cur;
  }

  function savePreset() {
    const name = (presetNameEl.value || '').trim();
    if (!name) { log('warn', t('preset.needName')); return; }
    const presets = getPresets();
    presets[name] = collectSettings();
    setPresets(presets);
    refreshPresetList();
    presetSelect.value = name;
    presetNameEl.value = '';
    log('ok', t('preset.saved', { name: name }));
  }

  function loadPreset() {
    const name = presetSelect.value;
    if (!name) { log('warn', t('preset.pick')); return; }
    const presets = getPresets();
    if (!presets[name]) { log('err', t('preset.missing')); refreshPresetList(); return; }
    _applySettings(presets[name]);
    saveSettings();
    log('ok', t('preset.loaded', { name: name }));
  }

  function deletePreset() {
    const name = presetSelect.value;
    if (!name) { log('warn', t('preset.pickDel')); return; }
    const presets = getPresets();
    delete presets[name];
    setPresets(presets);
    refreshPresetList();
    log('ok', t('preset.deleted', { name: name }));
  }

  // Export current settings + all presets as a downloadable .json file.
  function exportSettings() {
    const payload = {
      app: 'com.maximebodivit.visionext',
      kind: 'settings',
      settings: collectSettings(),
      presets: getPresets()
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visionext-reglages.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log('ok', t('settings.exported'));
    } catch (e) {
      log('err', t('settings.exportFail', { msg: e.message }));
    }
  }

  // Open the file picker; the change handler (wired below) does the import.
  function importSettings() {
    if (!settingsFileEl) return;
    settingsFileEl.value = '';
    settingsFileEl.click();
  }

  function handleSettingsFile() {
    const f = settingsFileEl.files && settingsFileEl.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { log('err', t('settings.importBad')); return; }

      let didSomething = false;
      if (data.settings && typeof data.settings === 'object') {
        _applySettings(data.settings);
        saveSettings();
        didSomething = true;
      }
      if (data.presets && typeof data.presets === 'object') {
        setPresets(Object.assign(getPresets(), data.presets));
        refreshPresetList();
        didSomething = true;
      }
      log(didSomething ? 'ok' : 'warn',
        didSomething ? t('settings.imported') : t('settings.importNone'));
    };
    reader.readAsText(f);
  }

  // ------------------------------------------------------------------
  // Export the journal to a .txt file
  // ------------------------------------------------------------------
  function exportLog() {
    const lines = Array.prototype.slice.call(logEl.querySelectorAll('.log-line')).map((d) => d.textContent);
    if (!lines.length) { log('warn', t('logmsg.empty')); return; }
    try {
      const blob = new Blob([lines.join('\r\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visionext-journal.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log('ok', t('logmsg.exported'));
    } catch (e) {
      log('err', t('logmsg.exportFail', { msg: e.message }));
    }
  }

  // ------------------------------------------------------------------
  // Tab switching
  // ------------------------------------------------------------------
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      tabPanels.forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
      savePref('tab', tab);
    });
  });

  // Format seconds as mm:ss.
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ------------------------------------------------------------------
  // Track list refresh - populates B-Roll selects AND gaps select.
  // ------------------------------------------------------------------
  async function refreshTracks() {
    const raw = await evalScript('getSequenceTrackInfo()');
    let info;
    try { info = JSON.parse(raw); }
    catch (e) {
      log('err', t('msg.badResponse', { raw: raw }));
      return;
    }

    if (info.error) {
      seqNameEl.textContent = info.error;
      log('warn', info.error);
      return;
    }

    const vCount = info.videoTrackCount;
    const aCount = info.audioTrackCount;
    seqInfo = info;
    let infoTxt = 'Sequence: ' + info.name + ' (' + vCount + 'V / ' + aCount + 'A)';
    if (typeof info.totalClips === 'number') infoTxt += ' - ' + info.totalClips + ' clips';
    if (typeof info.durationSec === 'number') infoTxt += ' - ' + fmtDuration(info.durationSec);
    seqNameEl.textContent = infoTxt;

    // ----- B-Roll source dropdown : existing video tracks -----
    const prevSrc = parseInt(srcTrackEl.value, 10);
    srcTrackEl.innerHTML = '';
    for (let i = 0; i < vCount; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'V' + (i + 1);
      srcTrackEl.appendChild(opt);
    }
    srcTrackEl.value = (!isNaN(prevSrc) && prevSrc < vCount) ? String(prevSrc) : '0';

    // ----- B-Roll destination dropdown : V2..Vn + virtual "new" slot -----
    const prevDst = parseInt(dstTrackEl.value, 10);
    dstTrackEl.innerHTML = '';
    for (let i = 1; i < vCount; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'V' + (i + 1);
      dstTrackEl.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = String(vCount); // out-of-range => create new
    newOpt.textContent = 'V' + (vCount + 1) + ' (nouvelle piste)';
    dstTrackEl.appendChild(newOpt);
    if (!isNaN(prevDst) && prevDst <= vCount) {
      dstTrackEl.value = String(prevDst);
    } else {
      dstTrackEl.value = '1';
    }

    // ----- Gaps checklist : ALL video tracks + ALL audio tracks -----
    buildGapsChecklist(vCount, aCount);

    // Re-apply persisted selections now that the track options exist.
    restoreSettings();
    log('info', t('msg.tracksRefreshed', { v: vCount, a: aCount }));
  }

  // ------------------------------------------------------------------
  // B-Roll generation
  // ------------------------------------------------------------------
  function buildBRollParams() {
    const params = {
      duration:    parseFloat(durationEl.value),
      position:    positionEl.value,
      srcTrackIdx: parseInt(srcTrackEl.value, 10),
      dstTrackIdx: parseInt(dstTrackEl.value, 10),
      random:      optRandom.checked,
      zoom:        optZoom.checked,
      marker:      optMarker.checked,
      onlySelected: optSelected.checked,
      transition:  optTransition.checked
    };
    if (!params.duration || params.duration <= 0) {
      log('err', t('broll.badDuration'));
      return null;
    }
    if (isNaN(params.srcTrackIdx) || isNaN(params.dstTrackIdx)) {
      log('err', t('broll.badTracks'));
      return null;
    }
    if (params.srcTrackIdx === params.dstTrackIdx) {
      log('err', t('broll.sameTrack'));
      return null;
    }
    return params;
  }

  async function generate() {
    const params = buildBRollParams();
    if (!params) return;

    const srcCount = (seqInfo && seqInfo.videoClips) ? (seqInfo.videoClips[params.srcTrackIdx] || 0) : 0;
    if (!params.onlySelected && srcCount > CONFIRM_THRESHOLD) {
      if (!askConfirm(t('broll.genConfirm', { n: srcCount, track: params.srcTrackIdx + 1 }))) {
        log('info', t('broll.genCancelled'));
        return;
      }
    }

    generateBtn.disabled = true;
    generateBtn.textContent = t('busy.generating');
    const flags = [];
    if (params.onlySelected) flags.push(t('flag.selection'));
    if (params.random) flags.push(t('flag.random'));
    if (params.zoom) flags.push(t('flag.zoom'));
    if (params.marker) flags.push(t('flag.markers'));
    if (params.transition) flags.push(t('flag.transitions'));
    log('info', t('broll.genStart', {
      d: params.duration,
      pos: params.position,
      src: params.srcTrackIdx + 1,
      dst: params.dstTrackIdx + 1,
      flags: flags.length ? ' [' + flags.join(', ') + ']' : ''
    }));

    const payload = JSON.stringify(params);
    const raw = await evalScriptP("generateBRoll('" + jsString(payload) + "')");

    let result;
    try { result = JSON.parse(raw); }
    catch (e) {
      log('err', t('msg.badResponse', { raw: raw }));
      generateBtn.disabled = false;
      generateBtn.textContent = t('btn.generate');
      return;
    }

    if (result.error) {
      log('err', result.error);
    } else {
      log('ok', t('broll.done', { n: result.created, track: result.dstTrackIdx + 1, skip: result.skipped || 0 }));
      if (result.transitions) log('info', t('broll.transitionsAdded', { n: result.transitions }));
      if (result.starts && result.starts.length) {
        lastGeneration = { dstIdx: result.dstTrackIdx, starts: result.starts };
        if (undoGenBtn) undoGenBtn.disabled = false;
      }
      if (result.warnings && result.warnings.length) {
        for (let i = 0; i < result.warnings.length; i++) {
          log('warn', result.warnings[i]);
        }
      }
    }

    generateBtn.disabled = false;
    generateBtn.textContent = t('btn.generate');
    await refreshTracks();
  }

  // ------------------------------------------------------------------
  // B-Roll dry-run preview (changes nothing in the timeline)
  // ------------------------------------------------------------------
  async function preview() {
    const params = buildBRollParams();
    if (!params) return;
    params.dryRun = true;

    previewBtn.disabled = true;
    previewBtn.textContent = t('busy.preview');
    log('info', t('preview.start'));

    const payload = JSON.stringify(params);
    const raw = await evalScriptP("generateBRoll('" + jsString(payload) + "')");

    let result;
    try { result = JSON.parse(raw); }
    catch (e) {
      log('err', t('msg.badResponse', { raw: raw }));
      previewBtn.disabled = false;
      previewBtn.textContent = t('btn.preview');
      return;
    }

    if (result.error) {
      log('err', result.error);
    } else {
      log('ok', t('preview.summary', { n: result.count, track: result.dstTrackIdx + 1 }));
      const list = result.preview || [];
      for (let i = 0; i < list.length; i++) {
        log('info', t('preview.item', { name: list[i].name, start: list[i].startSec, dur: list[i].durationSec }));
      }
      if (result.warnings && result.warnings.length) {
        for (let i = 0; i < result.warnings.length; i++) log('warn', result.warnings[i]);
      }
    }

    previewBtn.disabled = false;
    previewBtn.textContent = t('btn.preview');
  }

  // ------------------------------------------------------------------
  // Undo the last B-Roll generation (remove the extracts it created)
  // ------------------------------------------------------------------
  async function undoLastGeneration() {
    if (!lastGeneration || !lastGeneration.starts || !lastGeneration.starts.length) {
      log('warn', t('undogen.none'));
      return;
    }
    if (!askConfirm(t('undogen.confirm', { n: lastGeneration.starts.length }))) return;

    undoGenBtn.disabled = true;
    log('info', t('undogen.start'));
    const payload = JSON.stringify(lastGeneration);
    const raw = await evalScriptP("removeBRollClips('" + jsString(payload) + "')");

    let r;
    try { r = JSON.parse(raw); }
    catch (e) { log('err', t('msg.badResponse', { raw: raw })); undoGenBtn.disabled = false; return; }

    if (r.error) {
      log('err', r.error);
      undoGenBtn.disabled = false;
    } else {
      log('ok', t('undogen.done', { n: r.removed || 0 }));
      if (r.warnings && r.warnings.length) {
        for (let i = 0; i < r.warnings.length; i++) log('warn', r.warnings[i]);
      }
      lastGeneration = null;
      await refreshTracks();
    }
  }

  // ------------------------------------------------------------------
  // Gap removal (one or several tracks)
  // ------------------------------------------------------------------
  // Build the checkbox list of every video + audio track. Track key is
  // "video:N" / "audio:N" so the host can route each one.
  function buildGapsChecklist(vCount, aCount) {
    const saved = getPref('gapsChecked', null); // array of keys, or null
    gapsTracksEl.innerHTML = '';

    const addRow = (key, labelTxt) => {
      const lbl = document.createElement('label');
      lbl.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'gaps-cb';
      cb.value = key;
      cb.checked = saved ? (saved.indexOf(key) !== -1) : (key === 'video:0');
      cb.addEventListener('change', saveGapsChecked);
      const span = document.createElement('span');
      span.textContent = labelTxt;
      lbl.appendChild(cb);
      lbl.appendChild(span);
      gapsTracksEl.appendChild(lbl);
    };

    for (let i = 0; i < vCount; i++) addRow('video:' + i, 'V' + (i + 1));
    for (let i = 0; i < aCount; i++) addRow('audio:' + i, 'A' + (i + 1));

    if (vCount + aCount === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Aucune piste.';
      gapsTracksEl.appendChild(e);
    }
  }

  function checkedGapsKeys() {
    return Array.prototype.slice.call(gapsTracksEl.querySelectorAll('.gaps-cb'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }
  function saveGapsChecked() { savePref('gapsChecked', checkedGapsKeys()); }
  function setAllGaps(state) {
    gapsTracksEl.querySelectorAll('.gaps-cb').forEach((cb) => { cb.checked = state; });
    saveGapsChecked();
  }
  function prettyTrack(key) {
    const parts = key.split(':');
    return (parts[0] === 'audio' ? 'A' : 'V') + (parseInt(parts[1], 10) + 1);
  }

  async function removeGaps() {
    const keys = checkedGapsKeys();
    if (!keys.length) { log('err', t('gaps.noTrack')); return; }

    const tracks = keys.map((k) => {
      const parts = k.split(':');
      return { trackType: parts[0], trackIdx: parseInt(parts[1], 10) };
    });

    let affected = 0;
    if (seqInfo) {
      tracks.forEach((tk) => {
        const arr = (tk.trackType === 'audio') ? seqInfo.audioClips : seqInfo.videoClips;
        if (arr && typeof arr[tk.trackIdx] === 'number') affected += arr[tk.trackIdx];
      });
    }
    if (affected > CONFIRM_THRESHOLD) {
      if (!askConfirm(t('gaps.confirm', { n: affected }))) {
        log('info', t('gaps.cancelled'));
        return;
      }
    }

    gapsBtn.disabled = true;
    gapsBtn.textContent = t('busy.compacting');
    log('info', t('gaps.start', { n: tracks.length, list: keys.map(prettyTrack).join(', ') }));

    const payload = JSON.stringify({ tracks: tracks });
    const raw = await evalScriptP("removeGaps('" + jsString(payload) + "')");

    let result;
    try { result = JSON.parse(raw); }
    catch (e) {
      log('err', t('msg.badResponse', { raw: raw }));
      gapsBtn.disabled = false;
      gapsBtn.textContent = t('btn.gaps');
      return;
    }

    if (result.error) {
      log('err', result.error);
    } else {
      log('ok', t('gaps.done', { n: result.shifted || 0, t: result.tracks || tracks.length, sec: result.totalGapClosed || 0 }));
      if (result.warnings && result.warnings.length) {
        for (let i = 0; i < result.warnings.length; i++) {
          log('warn', result.warnings[i]);
        }
      }
    }

    gapsBtn.disabled = false;
    gapsBtn.textContent = t('btn.gaps');
  }

  // ------------------------------------------------------------------
  // Undo / redo (relays to the host; Premiere scripting has no reliable
  // undo, so this usually just reminds the user of Ctrl+Z).
  // ------------------------------------------------------------------
  async function hostUndoRedo(fn) {
    const raw = await evalScript(fn + '()');
    let r;
    try { r = JSON.parse(raw); }
    catch (e) { log('err', t('msg.badResponse', { raw: raw })); return; }
    if (r.ok) {
      log('ok', fn === 'doUndo' ? t('undo.done') : t('redo.done'));
      await refreshTracks();
    } else {
      log('warn', r.message || t('op.unavailable'));
    }
  }

  // ------------------------------------------------------------------
  // Diagnostic / self-test (read-only host report)
  // ------------------------------------------------------------------
  async function diagnostic() {
    log('info', t('diag.start'));
    const raw = await evalScript('runDiagnostic()');
    let r;
    try { r = JSON.parse(raw); }
    catch (e) { log('err', t('msg.badResponse', { raw: raw })); return; }
    if (r.error) log('err', t('diag.error', { msg: r.error }));
    const checks = r.checks || [];
    for (let i = 0; i < checks.length; i++) {
      log('info', '  ' + checks[i].label + ' : ' + checks[i].value);
    }
    log('ok', t('diag.done'));
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------
  refreshBtn.addEventListener('click', refreshTracks);
  undoBtn.addEventListener('click', () => hostUndoRedo('doUndo'));
  redoBtn.addEventListener('click', () => hostUndoRedo('doRedo'));
  diagBtn.addEventListener('click', diagnostic);
  generateBtn.addEventListener('click', generate);
  previewBtn.addEventListener('click', preview);
  undoGenBtn.addEventListener('click', undoLastGeneration);
  gapsBtn.addEventListener('click', removeGaps);
  gapsAllBtn.addEventListener('click', () => setAllGaps(true));
  gapsNoneBtn.addEventListener('click', () => setAllGaps(false));
  clearLogBtn.addEventListener('click', () => { logEl.innerHTML = ''; });
  if (logExportBtn) logExportBtn.addEventListener('click', exportLog);
  presetLoadBtn.addEventListener('click', loadPreset);
  presetSaveBtn.addEventListener('click', savePreset);
  presetDelBtn.addEventListener('click', deletePreset);
  exportBtn.addEventListener('click', exportSettings);
  importBtn.addEventListener('click', importSettings);
  if (settingsFileEl) settingsFileEl.addEventListener('change', handleSettingsFile);

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      durationEl.value = btn.getAttribute('data-val');
      presetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettings();
    });
  });

  durationEl.addEventListener('input', () => {
    presetBtns.forEach((b) => b.classList.remove('active'));
  });

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  applyTheme(getPref('theme', 'dark'));
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  LANG = getPref('lang', 'fr');
  if (langSelect) {
    langSelect.value = LANG;
    langSelect.addEventListener('change', () => setLang(langSelect.value));
  }
  applyI18n();
  seqNameEl.textContent = t('seq.none');
  restoreTab();
  restoreSettings();
  wirePersistence();
  refreshPresetList();
  log('info', t('msg.loaded'));
  setTimeout(refreshTracks, 300);
})();
