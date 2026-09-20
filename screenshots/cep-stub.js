/*
 * Faux pont CEP — sert uniquement aux captures d'ecran du panneau en
 * dehors de Premiere Pro. Il est injecte a la volee par capture.mjs
 * juste avant js/main.js : aucun fichier du panneau n'est modifie.
 *
 * Il fournit :
 *   - window.__adobe_cep__.evalScript(script, cb), qui repond avec les
 *     memes formes JSON que jsx/host.jsx ;
 *   - un etat de depart dans localStorage (theme, langue, onglet,
 *     reglages, profils) pilote par la query string ;
 *   - un audit de mise en page (?audit=1) depose dans #__audit.
 *
 * Parametres d'URL : tab, theme, lang, sync, gaps, duration, position,
 * seq (ok | nosequence | noproject), audit.
 */
(function () {
  'use strict';

  var q = new URLSearchParams(window.location.search);
  function val(key, def) { var v = q.get(key); return v === null ? def : v; }

  // ------------------------------------------------------------------
  // 1. Etat de depart — main.js lit localStorage au demarrage
  // ------------------------------------------------------------------
  try {
    localStorage.clear();
    localStorage.setItem('visionext.prefs', JSON.stringify({
      theme:       val('theme', 'dark') === 'light' ? 'light' : 'dark',
      lang:        val('lang', 'fr'),
      tab:         val('tab', 'broll'),
      syncGaps:    val('sync', '1') !== '0',
      presetsOpen: val('presets', '0') === '1',
      gapsChecked: val('gaps', 'video:0,audio:0').split(',').filter(Boolean)
    }));
    localStorage.setItem('visionext.settings', JSON.stringify({
      'duration':       val('duration', '3'),
      'position':       val('position', 'middle'),
      'src-track':      '0',
      'dst-track':      '1',
      'opt-selected':   false,
      'opt-random':     true,
      'opt-zoom':       true,
      'opt-marker':     false,
      'opt-transition': false
    }));
    localStorage.setItem('visionext.presets', JSON.stringify({
      'Interview 2s':    { 'duration': '2', 'position': 'middle' },
      'Plans larges 5s': { 'duration': '5', 'position': 'start' }
    }));
  } catch (e) {}

  // ------------------------------------------------------------------
  // 2. Fixtures — memes clefs que les retours de jsx/host.jsx
  // ------------------------------------------------------------------
  var MODE = val('seq', 'ok');

  var TRACK_INFO = {
    name:            'Montage demo 4K',
    videoTrackCount: 3,
    audioTrackCount: 2,
    videoClips:      [12, 4, 0],
    audioClips:      [12, 3],
    totalClips:      31,
    durationSec:     754
  };

  var SEQUENCES = {
    sequences: [
      { index: 0, name: 'Montage demo 4K',  active: true  },
      { index: 1, name: 'Teaser reseaux',   active: false },
      { index: 2, name: 'Interview client', active: false },
      { index: 3, name: 'Chutier - rushes', active: false }
    ]
  };

  var DIAGNOSTIC = {
    ok: true,
    checks: [
      { label: 'Application',     value: 'Premiere Pro' },
      { label: 'Version',         value: '26.0.0 (fixture)' },
      { label: 'Projet ouvert',   value: 'oui' },
      { label: 'Time API',        value: 'oui' },
      { label: 'openUndoGroup',   value: 'oui' },
      { label: 'Sequence active', value: 'Montage demo 4K' },
      { label: 'Pistes video',    value: '3' },
      { label: 'Pistes audio',    value: '2' }
    ]
  };

  // Reponses aux fonctions hote, par nom.
  function respond(fnName) {
    switch (fnName) {
      case 'getSequenceTrackInfo':
        if (MODE === 'noproject')  return { error: 'Aucun projet ouvert.' };
        if (MODE === 'nosequence') return { error: 'Aucune sequence active.' };
        return TRACK_INFO;
      case 'getSequences':
        if (MODE === 'noproject')  return { error: 'Aucun projet ouvert.' };
        return SEQUENCES;
      case 'runDiagnostic': return DIAGNOSTIC;
      case 'pingHost':      return { ok: true, version: '26.0.0 (fixture)' };
      case 'doUndo':
      case 'doRedo':        return { ok: true };
      default:
        // Toute operation d'ecriture (generateBRoll, removeGaps, ...) est
        // refusee : une capture ne doit rien « produire ».
        return { error: 'Stub de capture : ' + fnName + ' hors Premiere.' };
    }
  }

  // Etat observable par capture.mjs : « ready » des que le panneau a recu
  // ses deux reponses de demarrage, ce qui evite d'attendre a l'aveugle.
  var STATE = { served: [], ready: false };
  window.__visionextStub = STATE;

  window.__adobe_cep__ = {
    evalScript: function (script, cb) {
      var name = String(script).replace(/\s*\(.*$/, '').trim();
      var res = JSON.stringify(respond(name));
      // Asynchrone, comme le vrai pont CEP.
      setTimeout(function () {
        if (cb) cb(res);
        STATE.served.push(name);
        STATE.ready = STATE.served.indexOf('getSequenceTrackInfo') !== -1
                   && STATE.served.indexOf('getSequences') !== -1;
      }, 0);
    }
  };

  // ------------------------------------------------------------------
  // 3. Audit de mise en page (?audit=1)
  // ------------------------------------------------------------------
  // Mesure la position reelle des elements une fois le panneau peuple et
  // depose le resultat en JSON dans <pre id="__audit">, que capture.mjs
  // recupere via --dump-dom.
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    var round = function (n) { return Math.round(n * 10) / 10; };
    return {
      x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height),
      right: round(r.right), bottom: round(r.bottom)
    };
  }

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    // Le contenu d'un <details> replie garde un rectangle mesurable alors
    // qu'il n'est pas peint (content-visibility) : sans ce test, il produit
    // de faux chevauchements avec ce qui le suit.
    if (el.closest('details:not([open])')) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    var st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  }

  function describe(el) {
    var id = el.id ? '#' + el.id : '';
    var cls = (!id && el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    var txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' [' + txt + ']' : '');
  }

  // Reperes structurels du panneau, de haut en bas.
  var LANDMARKS = [
    ['header',       'header'],
    ['onglets',      'nav.tabs'],
    ['barre-info',   '.info-bar'],
    ['contenu',      'main'],
    ['onglet-actif', '.tab-content:not(.hidden)'],
    ['journal',      '.log-area'],
    ['pied',         'footer']
  ];

  function audit() {
    var doc = document.documentElement;
    var vw = doc.clientWidth, vh = doc.clientHeight;
    var activeTab = document.querySelector('.tab.active');
    var out = {
      query:     window.location.search,
      viewport:  { w: vw, h: vh },
      page:      { scrollW: doc.scrollWidth, scrollH: doc.scrollHeight },
      theme:     doc.getAttribute('data-theme'),
      tab:       activeTab ? activeTab.textContent.trim() : null,
      seqLine:   (document.getElementById('seq-name') || {}).textContent || null,
      overflowX: doc.scrollWidth > vw + 1,
      landmarks: [],
      problems:  [],  // vrais defauts : ordre, debordement, chevauchement
      notes:     [],  // remarques : cibles tassees
      belowFold: []
    };

    LANDMARKS.forEach(function (pair) {
      var el = document.querySelector(pair[1]);
      if (el) out.landmarks.push({ role: pair[0], sel: pair[1], rect: rectOf(el) });
    });

    // Ordre vertical attendu : chaque repere commence sous le precedent.
    // Seuls les blocs de premier niveau sont compares ; « onglet-actif » et
    // « journal » vivent dans « contenu », qui defile sous le pied de page.
    var NIVEAU1 = out.landmarks.filter(function (l) {
      return l.role !== 'onglet-actif' && l.role !== 'journal';
    });
    for (var i = 1; i < NIVEAU1.length; i++) {
      var prev = NIVEAU1[i - 1], cur = NIVEAU1[i];
      if (cur.rect.y + 0.5 < prev.rect.y) {
        out.problems.push({
          kind: 'ordre',
          msg: cur.role + ' (y=' + cur.rect.y + ') remonte au-dessus de '
             + prev.role + ' (y=' + prev.rect.y + ')'
        });
      }
    }

    // Controles visibles : debordement, cibles minuscules, chevauchements.
    var ctrls = [].slice.call(document.querySelectorAll(
      '#app button, #app input, #app select, #app textarea')).filter(visible);

    ctrls.forEach(function (el) {
      var r = rectOf(el);
      if (r.right > vw + 0.5 || r.x < -0.5) {
        out.problems.push({
          kind: 'debordement-x', el: describe(el),
          msg: 'x=' + r.x + '..' + r.right + ' hors du panneau (largeur ' + vw + ')'
        });
      }
      // Les cases a cocher gardent leur taille native (14 px) : hors sujet.
      // Une cible tassee n'est pas un defaut d'affichage, juste une remarque
      // d'ergonomie : elle va dans « notes », pas dans « problems ».
      var natif = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
      if (!natif && (r.h < 14 || r.w < 14)) {
        out.notes.push({
          kind: 'cible-petite', el: describe(el),
          msg: Math.round(r.w) + 'x' + Math.round(r.h) + ' px'
        });
      }
      if (r.y > vh - 1) out.belowFold.push(describe(el) + ' (y=' + Math.round(r.y) + ')');
    });

    // Chevauchements : uniquement entre controles entierement visibles dans
    // le viewport, et appartenant a la meme zone. L'en-tete et le pied sont
    // colles et opaques : le contenu defile dessous par construction, les
    // comparer au contenu ne produirait que du bruit. Les vues « deroule »
    // amenent le bas des onglets dans le viewport pour qu'il soit audite.
    function zone(el) {
      if (el.closest('header')) return 'header';
      if (el.closest('footer')) return 'footer';
      return 'contenu';
    }
    var dansEcran = ctrls.filter(function (el) {
      var r = rectOf(el);
      return r.y >= -0.5 && r.bottom <= vh + 0.5;
    });
    for (var a = 0; a < dansEcran.length; a++) {
      for (var b = a + 1; b < dansEcran.length; b++) {
        if (zone(dansEcran[a]) !== zone(dansEcran[b])) continue;
        if (dansEcran[a].contains(dansEcran[b]) || dansEcran[b].contains(dansEcran[a])) continue;
        var ra = rectOf(dansEcran[a]), rb = rectOf(dansEcran[b]);
        var ox = Math.min(ra.right, rb.right) - Math.max(ra.x, rb.x);
        var oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.y, rb.y);
        if (ox > 1 && oy > 1) {
          out.problems.push({
            kind: 'chevauchement',
            el: describe(dansEcran[a]) + '  ++  ' + describe(dansEcran[b]),
            msg: Math.round(ox) + 'x' + Math.round(oy) + ' px communs'
          });
        }
      }
    }

    return out;
  }

  // Appele par capture.mjs via le protocole DevTools.
  window.__visionextAudit = audit;

  if (q.get('audit')) {
    window.addEventListener('load', function () {
      // Apres le refreshTracks() differe de 300 ms de main.js.
      setTimeout(function () {
        var pre = document.createElement('pre');
        pre.id = '__audit';
        pre.style.display = 'none';
        pre.textContent = JSON.stringify(audit());
        document.body.appendChild(pre);
      }, 800);
    });
  }
})();
