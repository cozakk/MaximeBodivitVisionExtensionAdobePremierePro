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
  const refreshBtn  = document.getElementById('refresh-btn');
  const logEl       = document.getElementById('log');
  const clearLogBtn = document.getElementById('clear-log');
  const tabBtns     = document.querySelectorAll('.tab');
  const tabPanels   = document.querySelectorAll('.tab-content');

  // B-Roll tab
  const durationEl  = document.getElementById('duration');
  const positionEl  = document.getElementById('position');
  const srcTrackEl  = document.getElementById('src-track');
  const dstTrackEl  = document.getElementById('dst-track');
  const optRandom   = document.getElementById('opt-random');
  const optZoom     = document.getElementById('opt-zoom');
  const optMarker   = document.getElementById('opt-marker');
  const generateBtn = document.getElementById('generate-btn');
  const presetBtns  = document.querySelectorAll('.preset');

  // Gaps tab
  const gapsTracksEl = document.getElementById('gaps-tracks');
  const gapsAllBtn   = document.getElementById('gaps-all');
  const gapsNoneBtn  = document.getElementById('gaps-none');
  const gapsBtn      = document.getElementById('gaps-btn');

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
    'opt-random', 'opt-zoom', 'opt-marker'
  ];
  const LS_SETTINGS = 'visionext.settings';
  const LS_PREFS    = 'visionext.prefs';

  function _lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function _lsSet(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  function saveSettings() {
    const data = {};
    PERSIST_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      data[id] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    _lsSet(LS_SETTINGS, data);
  }

  function restoreSettings() {
    const data = _lsGet(LS_SETTINGS);
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

  // ------------------------------------------------------------------
  // Track list refresh - populates B-Roll selects AND gaps select.
  // ------------------------------------------------------------------
  async function refreshTracks() {
    const raw = await evalScript('getSequenceTrackInfo()');
    let info;
    try { info = JSON.parse(raw); }
    catch (e) {
      log('err', 'Reponse invalide du host: ' + raw);
      return;
    }

    if (info.error) {
      seqNameEl.textContent = info.error;
      log('warn', info.error);
      return;
    }

    const vCount = info.videoTrackCount;
    const aCount = info.audioTrackCount;
    seqNameEl.textContent = 'Sequence: ' + info.name + ' (' + vCount + 'V / ' + aCount + 'A)';

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
    log('info', 'Pistes rafraichies (' + vCount + 'V / ' + aCount + 'A).');
  }

  // ------------------------------------------------------------------
  // B-Roll generation
  // ------------------------------------------------------------------
  async function generate() {
    const params = {
      duration:    parseFloat(durationEl.value),
      position:    positionEl.value,
      srcTrackIdx: parseInt(srcTrackEl.value, 10),
      dstTrackIdx: parseInt(dstTrackEl.value, 10),
      random:      optRandom.checked,
      zoom:        optZoom.checked,
      marker:      optMarker.checked
    };

    if (!params.duration || params.duration <= 0) {
      log('err', 'Duree invalide.');
      return;
    }
    if (isNaN(params.srcTrackIdx) || isNaN(params.dstTrackIdx)) {
      log('err', 'Pistes source/destination invalides.');
      return;
    }
    if (params.srcTrackIdx === params.dstTrackIdx) {
      log('err', 'Les pistes source et destination doivent etre differentes.');
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generation en cours...';
    log('info', 'B-Roll: duree=' + params.duration + 's, position=' + params.position +
        ', src=V' + (params.srcTrackIdx + 1) + ', dst=V' + (params.dstTrackIdx + 1) +
        (params.random ? ', random' : '') +
        (params.zoom ? ', zoom' : '') +
        (params.marker ? ', marqueurs' : ''));

    const payload = JSON.stringify(params);
    const raw = await evalScript("generateBRoll('" + jsString(payload) + "')");

    let result;
    try { result = JSON.parse(raw); }
    catch (e) {
      log('err', 'Reponse invalide du host: ' + raw);
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generer les extraits';
      return;
    }

    if (result.error) {
      log('err', result.error);
    } else {
      log('ok', 'Termine. ' + result.created + ' extrait(s) cree(s) sur V' + (result.dstTrackIdx + 1) +
          '. Ignores: ' + (result.skipped || 0) + '.');
      if (result.warnings && result.warnings.length) {
        for (let i = 0; i < result.warnings.length; i++) {
          log('warn', result.warnings[i]);
        }
      }
    }

    generateBtn.disabled = false;
    generateBtn.textContent = 'Generer les extraits';
    await refreshTracks();
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
    if (!keys.length) { log('err', 'Aucune piste cochee.'); return; }

    const tracks = keys.map((k) => {
      const parts = k.split(':');
      return { trackType: parts[0], trackIdx: parseInt(parts[1], 10) };
    });

    gapsBtn.disabled = true;
    gapsBtn.textContent = 'Compactage en cours...';
    log('info', 'Compactage de ' + tracks.length + ' piste(s): ' + keys.map(prettyTrack).join(', '));

    const payload = JSON.stringify({ tracks: tracks });
    const raw = await evalScript("removeGaps('" + jsString(payload) + "')");

    let result;
    try { result = JSON.parse(raw); }
    catch (e) {
      log('err', 'Reponse invalide du host: ' + raw);
      gapsBtn.disabled = false;
      gapsBtn.textContent = 'Supprimer les trous';
      return;
    }

    if (result.error) {
      log('err', result.error);
    } else {
      log('ok', 'Termine. ' + (result.shifted || 0) + ' clip(s) deplace(s) sur ' +
          (result.tracks || tracks.length) + ' piste(s). Total supprime: ' +
          (result.totalGapClosed || 0) + 's.');
      if (result.warnings && result.warnings.length) {
        for (let i = 0; i < result.warnings.length; i++) {
          log('warn', result.warnings[i]);
        }
      }
    }

    gapsBtn.disabled = false;
    gapsBtn.textContent = 'Supprimer les trous';
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------
  refreshBtn.addEventListener('click', refreshTracks);
  generateBtn.addEventListener('click', generate);
  gapsBtn.addEventListener('click', removeGaps);
  gapsAllBtn.addEventListener('click', () => setAllGaps(true));
  gapsNoneBtn.addEventListener('click', () => setAllGaps(false));
  clearLogBtn.addEventListener('click', () => { logEl.innerHTML = ''; });

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
  restoreTab();
  restoreSettings();
  wirePersistence();
  log('info', 'Extension chargee. Choisis un onglet et clique sur le bouton de rafraichissement si besoin.');
  setTimeout(refreshTracks, 300);
})();
