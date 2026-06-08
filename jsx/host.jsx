/*
 * B-Roll Generator - ExtendScript host
 *
 * Runs inside Adobe Premiere Pro's scripting engine. The HTML panel
 * communicates with this file via __adobe_cep__.evalScript() and expects
 * every function to return a JSON-encoded string (success or {error}).
 *
 * Public functions:
 *   - pingHost()              -> {ok, version}
 *   - getSequenceTrackInfo()  -> {name, videoTrackCount, audioTrackCount}
 *   - generateBRoll(jsonStr)  -> {created, skipped, dstTrackIdx, warnings[]}
 */

// ---------------------------------------------------------------------
// Minimal JSON polyfill (older ExtendScript engines lack it).
// ---------------------------------------------------------------------
if (typeof JSON === 'undefined') { JSON = {}; }
if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function (obj) {
        var t = typeof obj;
        if (obj === null) return 'null';
        if (t === 'string') {
            return '"' + obj
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t') + '"';
        }
        if (t === 'number' || t === 'boolean') return String(obj);
        if (obj instanceof Array) {
            var parts = [];
            for (var i = 0; i < obj.length; i++) parts.push(JSON.stringify(obj[i]));
            return '[' + parts.join(',') + ']';
        }
        if (t === 'object') {
            var pairs = [];
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    pairs.push(JSON.stringify(k) + ':' + JSON.stringify(obj[k]));
                }
            }
            return '{' + pairs.join(',') + '}';
        }
        return 'null';
    };
}
if (typeof JSON.parse !== 'function') {
    JSON.parse = function (s) {
        // ExtendScript is a JS engine: eval is safe enough for our own payloads.
        return eval('(' + s + ')');
    };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Build a Premiere Time object from a value in seconds.
 */
function _timeFromSeconds(sec) {
    var t = new Time();
    t.seconds = sec;
    return t;
}

/**
 * Round to 4 decimals to mask sub-frame floating-point drift in logs.
 */
function _r(v) { return Math.round(v * 10000) / 10000; }

/**
 * Return a snapshot of every clip currently on a video track, sorted
 * by their position on the sequence. The snapshot is taken BEFORE we
 * modify any other track, so iterating through it stays stable even if
 * the destination track gains new clips during the run.
 */
function _snapshotClips(track) {
    var arr = [];
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        arr.push({
            ref: c,
            name: c.name,
            startSec: c.start.seconds,
            endSec: c.end.seconds,
            inPointSec: c.inPoint.seconds,
            outPointSec: c.outPoint.seconds,
            durationSec: c.duration.seconds,
            projectItem: c.projectItem
        });
    }
    arr.sort(function (a, b) { return a.startSec - b.startSec; });
    return arr;
}

/**
 * Locate a freshly-inserted track item by its expected start time.
 * Returns the trackItem or null. Tolerant to small floating-point drift.
 */
function _findClipAt(track, startSec, tolerance) {
    var tol = tolerance || 0.04; // ~1 frame at 25fps
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        if (Math.abs(c.start.seconds - startSec) < tol) return c;
    }
    return null;
}

/**
 * Ensure the destination video track index exists. If `desiredIdx` is
 * beyond the current count, append new empty tracks until it does.
 * Returns the resolved track index (always within bounds).
 *
 * Uses the QE DOM, which is the only reliable way to add tracks from
 * ExtendScript in Premiere Pro.
 */
function _ensureVideoTrack(seq, desiredIdx) {
    var current = seq.videoTracks.numTracks;
    if (desiredIdx < current) return desiredIdx;

    try { app.enableQE(); } catch (e) {}
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (e) {}
    if (!qeSeq) {
        // QE DOM unavailable: cannot create tracks, fall back to last existing.
        return current - 1;
    }

    var toAdd = desiredIdx - current + 1;
    // qeSeq.addTracks(videoCount, videoInsertIndex, audioCount, audioInsertIndex, audioType, submixCount, submixIndex)
    // videoInsertIndex = current count means "append at the top".
    qeSeq.addTracks(toAdd, current, 0, 0, 1, 0, 0);

    return desiredIdx;
}

/**
 * Read a trackItem's color label index (0-15). Returns -1 if unavailable.
 */
function _getColorLabel(trackItem) {
    try {
        if (typeof trackItem.getColorLabel === 'function') {
            var v = trackItem.getColorLabel();
            if (typeof v === 'number') return v;
        }
    } catch (e) {}
    return -1;
}

/**
 * Apply a color label index (0-15) to a trackItem. No-op on failure.
 */
function _setColorLabel(trackItem, idx) {
    if (idx < 0) return;
    try {
        if (typeof trackItem.setColorLabel === 'function') {
            trackItem.setColorLabel(idx);
        }
    } catch (e) {}
}

/**
 * Set a projectItem's source in/out points to [inSec, outSec] (source-media
 * seconds) BEFORE it gets inserted. overwriteClip/insertClip only lay down a
 * projectItem's current in/out range, so this is what makes the resulting
 * track item exactly (outSec - inSec) long — with the surrounding media kept
 * as handles on both sides so the user can still extend the cut afterwards.
 *
 * Trimming an ALREADY-inserted track item via its inPoint/outPoint instead
 * performs a slip (the clip keeps its full timeline length), which is why the
 * old approach left every extract at full length.
 *
 * Premiere's setInPoint/setOutPoint signature varies across versions (the
 * mediaType argument, and seconds-vs-ticks units), so we try the known
 * variants and verify the result by reading getInPoint() back.
 */
function _setProjItemIO(projItem, inSec, outSec, warnings, label) {
    if (typeof projItem.setInPoint !== 'function') {
        warnings.push('setInPoint indisponible (' + label + ').');
        return false;
    }

    function _sec(getter) {
        try {
            var g = projItem[getter]();
            if (g && typeof g.seconds === 'number') return g.seconds;
            if (typeof g === 'number') return g;
        } catch (e) {}
        return null;
    }

    // Verify BOTH ends landed: the clip's length depends on in AND out.
    function applied() {
        var gi = _sec('getInPoint');
        var go = _sec('getOutPoint');
        var inOk  = gi !== null && Math.abs(gi - inSec) < 0.25;
        var outOk = go === null || Math.abs(go - outSec) < 0.25; // tolerate no getter
        return inOk && outOk;
    }

    function _set(getterIn, getterOut, inVal, outVal, mt) {
        if (mt === null) { projItem[getterIn](inVal); projItem[getterOut](outVal); }
        else { projItem[getterIn](inVal, mt); projItem[getterOut](outVal, mt); }
    }

    function trySet(inVal, outVal, mt) {
        // Try in-then-out, then out-then-in. Ordering matters when the
        // item's previous range doesn't already bracket the new one
        // (e.g. the same source clip reused on the source track).
        try { _set('setInPoint', 'setOutPoint', inVal, outVal, mt); if (applied()) return true; } catch (e) {}
        try { _set('setOutPoint', 'setInPoint', outVal, inVal, mt); if (applied()) return true; } catch (e) {}
        return false;
    }

    // mediaType candidates: 4 = video+audio on most versions; then fallbacks.
    var mts = [4, 1, 2, 0, null];
    var k;
    for (k = 0; k < mts.length; k++) {
        if (trySet(inSec, outSec, mts[k])) return true;
    }
    // Some engines expect ticks instead of seconds (254016000000 ticks/sec).
    var TICKS = 254016000000;
    for (k = 0; k < mts.length; k++) {
        if (trySet(inSec * TICKS, outSec * TICKS, mts[k])) return true;
    }

    warnings.push('Decoupe in/out incertaine sur "' + label + '".');
    return false;
}

/**
 * Whether a track item is currently selected in the timeline. Tolerant to
 * the isSelected() method vs a `selected` property across versions.
 */
function _isSelected(trackItem) {
    try {
        if (typeof trackItem.isSelected === 'function') return !!trackItem.isSelected();
        if (typeof trackItem.selected !== 'undefined') return !!trackItem.selected;
    } catch (e) {}
    return false;
}

/**
 * Iterate every item linked to `trackItem` (its companion audio items
 * when a clip has both video and audio). Handles both array-like and
 * collection-like return values across Premiere versions.
 */
function _forEachLinked(trackItem, fn) {
    try {
        if (typeof trackItem.getLinkedItems !== 'function') return;
        var linked = trackItem.getLinkedItems();
        if (!linked) return;
        var count = linked.numItems;
        if (typeof count !== 'number') count = linked.length || 0;
        for (var i = 0; i < count; i++) {
            var it = linked[i];
            if (it) fn(it);
        }
    } catch (e) {}
}

/**
 * Apply a scale of 110% to the Motion effect of a track item, if found.
 * Failure is non-fatal — we just log a warning back via the return list.
 */
function _applyZoom(trackItem, warnings) {
    try {
        var comps = trackItem.components;
        for (var ci = 0; ci < comps.numItems; ci++) {
            var comp = comps[ci];
            // The Motion effect is named "Motion" in English and "Trajectoire" in French.
            var displayName = comp.displayName || '';
            if (displayName === 'Motion' || displayName === 'Trajectoire' || ci === 0) {
                for (var pi = 0; pi < comp.properties.numItems; pi++) {
                    var prop = comp.properties[pi];
                    var pname = prop.displayName || '';
                    if (pname === 'Scale' || pname === 'Echelle' || pname === 'Échelle') {
                        try { prop.setValue(110, 1); } // 1 = update UI
                        catch (e) { try { prop.setValue(110); } catch (e2) {} }
                        return true;
                    }
                }
                // Some versions expose Scale at a known index inside Motion.
                if (comp.properties.numItems > 1) {
                    try { comp.properties[1].setValue(110, 1); return true; } catch (e) {}
                }
            }
        }
        warnings.push("Zoom non applique sur \"" + trackItem.name + "\" (effet Motion introuvable).");
    } catch (e) {
        warnings.push("Zoom: exception sur \"" + trackItem.name + "\": " + e.toString());
    }
    return false;
}

/**
 * Best-effort: add a cross-dissolve at the head of every clip on the
 * destination video track, using the QE DOM. The QE addTransition API is
 * undocumented and varies between Premiere versions, so we try a couple of
 * known names/signatures and fail softly (warnings only). Handles preserved
 * by the B-Roll trim make the dissolve possible.
 *
 * Returns the number of transitions actually added.
 */
function _addTransitions(seq, dstIdx, warnings) {
    var added = 0;
    try {
        app.enableQE();
        var qeSeq = (typeof qe !== 'undefined' && qe.project) ? qe.project.getActiveSequence() : null;
        if (!qeSeq) { warnings.push('Transitions: QE DOM indisponible.'); return 0; }

        var qeTrack = qeSeq.getVideoTrackAt(dstIdx);
        if (!qeTrack) { warnings.push('Transitions: piste QE V' + (dstIdx + 1) + ' introuvable.'); return 0; }

        // Locate a cross-dissolve by its common English/French names.
        var trans = null;
        var names = ['Cross Dissolve', 'Fondu enchaine', 'Fondu enchaîné', 'Dissolve'];
        for (var n = 0; n < names.length && !trans; n++) {
            try { trans = qe.project.getVideoTransitionByName(names[n]); } catch (e) {}
        }
        if (!trans) { warnings.push('Transitions: effet "Fondu enchaine" introuvable.'); return 0; }

        var numItems = qeTrack.numItems;
        for (var i = 0; i < numItems; i++) {
            var qeClip = null;
            try { qeClip = qeTrack.getItemAt(i); } catch (e) { continue; }
            if (!qeClip) continue;
            // Skip empty gaps (QE exposes them as items named "" / "Empty").
            var nm = '';
            try { nm = qeClip.name || ''; } catch (e) {}
            if (nm === '' || nm === 'Empty') continue;

            try {
                qeClip.addTransition(trans, true);   // addToStart = true (head)
                added++;
            } catch (e) {
                try { qeClip.addTransition(trans, true, '00;00;01;00'); added++; }
                catch (e2) { /* per-clip failure, keep going */ }
            }
        }
        if (added === 0) warnings.push('Transitions: aucune ajoutee (API addTransition incompatible avec cette version).');
    } catch (e) {
        warnings.push('Transitions: exception ' + e.toString());
    }
    return added;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

function pingHost() {
    try {
        return JSON.stringify({ ok: true, app: 'Premiere Pro', version: app.version });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

/**
 * Undo / redo. Premiere Pro does NOT expose a reliable scripting undo, so we
 * only call app.undo()/app.redo() if a given build happens to provide them
 * (checked via typeof — safe), and otherwise return an informative message
 * pointing at the native Ctrl+Z / Ctrl+Shift+Z shortcuts. We never guess
 * menu-command ids, which could trigger unrelated (destructive) actions.
 */
function doUndo() {
    try {
        if (app && typeof app.undo === 'function') { app.undo(); return JSON.stringify({ ok: true }); }
    } catch (e) {}
    return JSON.stringify({ ok: false, message: 'Annulation par script non disponible sur cette version. Utilise Ctrl+Z dans Premiere.' });
}

function doRedo() {
    try {
        if (app && typeof app.redo === 'function') { app.redo(); return JSON.stringify({ ok: true }); }
    } catch (e) {}
    return JSON.stringify({ ok: false, message: 'Retablissement par script non disponible sur cette version. Utilise Ctrl+Maj+Z dans Premiere.' });
}

/**
 * Self-test: report the host environment and whether the APIs the panel
 * relies on are present. Read-only — changes nothing in the project.
 */
function runDiagnostic() {
    var report = { ok: true, checks: [] };
    function add(label, value) { report.checks.push({ label: label, value: String(value) }); }

    try {
        add('Application', app ? 'Premiere Pro' : 'absente');
        try { add('Version', app.version); } catch (e) { add('Version', 'inconnue'); }

        var proj = app.project;
        add('Projet ouvert', proj ? 'oui' : 'non');
        add('Time API', (typeof Time !== 'undefined') ? 'oui' : 'non');
        add('openUndoGroup', (proj && typeof proj.openUndoGroup === 'function') ? 'oui' : 'non');

        if (proj) {
            var seq = proj.activeSequence;
            add('Sequence active', seq ? seq.name : 'aucune');
            if (seq) {
                add('Pistes video', seq.videoTracks.numTracks);
                add('Pistes audio', seq.audioTracks.numTracks);

                if (seq.videoTracks.numTracks > 0) {
                    var t = seq.videoTracks[0];
                    add('overwriteClip', (typeof t.overwriteClip === 'function') ? 'oui' : 'non');
                    if (t.clips.numItems > 0) {
                        var c = t.clips[0];
                        add('clip.move', (typeof c.move === 'function') ? 'oui' : 'non');
                        add('clip.isSelected', (typeof c.isSelected === 'function') ? 'oui' : 'non');
                        add('projectItem.setInPoint', (c.projectItem && typeof c.projectItem.setInPoint === 'function') ? 'oui' : 'non');
                    } else {
                        add('Clips V1', 'aucun (ouvre une sequence avec des clips pour tester move/trim)');
                    }
                }
            }
        }

        // QE DOM (needed for new tracks + transitions)
        var qeOk = false;
        try { app.enableQE(); qeOk = (typeof qe !== 'undefined' && !!qe.project); } catch (e) {}
        add('QE DOM', qeOk ? 'disponible' : 'indisponible');

    } catch (e) {
        report.ok = false;
        report.error = e.toString();
    }
    return JSON.stringify(report);
}

function getSequenceTrackInfo() {
    try {
        if (!app.project) return JSON.stringify({ error: 'Aucun projet ouvert.' });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: 'Aucune sequence active.' });

        return JSON.stringify({
            name: seq.name,
            videoTrackCount: seq.videoTracks.numTracks,
            audioTrackCount: seq.audioTracks.numTracks
        });
    } catch (e) {
        return JSON.stringify({ error: 'Exception: ' + e.toString() });
    }
}

/**
 * Generate B-Roll extracts according to user parameters.
 *
 * Algorithm (per source clip):
 *   1. Compute the on-timeline window we want the extract to occupy:
 *        - segmentDuration = min(requested, clip duration)
 *        - offset within the source clip depends on `position`:
 *            start  -> 0
 *            middle -> (clipDur - segDur) / 2
 *            end    -> clipDur - segDur
 *            random -> uniform in [0, clipDur - segDur]
 *        - destStart  = srcClip.start + offset
 *        - destEnd    = destStart + segmentDuration
 *   2. Compute the corresponding window in source-media coordinates:
 *        - mediaIn  = srcClip.inPoint + offset
 *        - mediaOut = mediaIn + segmentDuration
 *   3. Insert the projectItem on the destination track AT destStart.
 *      This creates a new track item playing from the start of the media.
 *   4. Slip its `inPoint` to `mediaIn`, then trim its `end` so the
 *      visible window is exactly [destStart, destEnd].
 *
 * @param {string} jsonStr JSON payload from the panel.
 */
function generateBRoll(jsonStr) {
    var warnings = [];
    try {
        var p = JSON.parse(jsonStr);

        if (!app.project) return JSON.stringify({ error: 'Aucun projet ouvert.' });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: 'Aucune sequence active.' });

        // ----- Validate source track -----
        if (p.srcTrackIdx < 0 || p.srcTrackIdx >= seq.videoTracks.numTracks) {
            return JSON.stringify({ error: 'Piste source V' + (p.srcTrackIdx + 1) + ' inexistante.' });
        }
        var srcTrack = seq.videoTracks[p.srcTrackIdx];

        // ----- Snapshot source clips BEFORE we touch anything -----
        // Reading them up front guarantees we never modify the source
        // track (one of the user's explicit constraints) and lets us
        // iterate safely while the destination track changes.
        var srcClips = _snapshotClips(srcTrack);
        if (srcClips.length === 0) {
            return JSON.stringify({ error: 'La piste V' + (p.srcTrackIdx + 1) + ' est vide.' });
        }

        // ----- Optional: restrict to the clips selected in the timeline -----
        if (p.onlySelected) {
            var sel = [];
            for (var s = 0; s < srcClips.length; s++) {
                if (_isSelected(srcClips[s].ref)) sel.push(srcClips[s]);
            }
            srcClips = sel;
            if (srcClips.length === 0) {
                return JSON.stringify({ error: 'Aucun clip selectionne sur la piste source V' + (p.srcTrackIdx + 1) + '.' });
            }
        }

        // ----- Resolve destination track -----
        // In dry-run we never create tracks (no side effects); dstIdx is
        // then purely informational.
        var dstIdx, dstTrack;
        if (p.dryRun) {
            dstIdx = p.dstTrackIdx;
            dstTrack = null;
        } else {
            dstIdx = _ensureVideoTrack(seq, p.dstTrackIdx);
            if (dstIdx >= seq.videoTracks.numTracks) {
                return JSON.stringify({ error: 'Impossible de creer la piste destination V' + (p.dstTrackIdx + 1) + '. QE DOM indisponible.' });
            }
            dstTrack = seq.videoTracks[dstIdx];
        }

        // ----- Begin undo group so the whole operation is one Ctrl+Z -----
        // openUndoGroup is the Premiere Pro idiomatic way; if missing we
        // fall back silently. Skipped in dry-run (nothing changes).
        if (!p.dryRun) {
            var undoOpen = false;
            try { app.project.openUndoGroup && app.project.openUndoGroup('Generate B-Roll'); undoOpen = true; } catch (e) {}
            if (!undoOpen) {
                try { app.enableQE(); qe.project.getActiveSequence().openUndoGroup && qe.project.getActiveSequence().openUndoGroup('Generate B-Roll'); undoOpen = true; } catch (e) {}
            }
        }

        var created = 0;
        var skipped = 0;
        var preview = [];
        var requested = p.duration;

        for (var i = 0; i < srcClips.length; i++) {
            var src = srcClips[i];
            if (!src.projectItem) {
                warnings.push('Clip "' + src.name + '" sans projectItem (clip genere ?), ignore.');
                skipped++;
                continue;
            }

            var clipDur = src.endSec - src.startSec;

            // ----- Clamp duration to the clip itself (constraint: never
            //       generate an error for too-short clips, use the full
            //       length instead).
            var segDur = (requested > clipDur) ? clipDur : requested;
            if (segDur <= 0) { skipped++; continue; }

            // ----- Compute offset inside the source clip -----
            var maxOffset = clipDur - segDur;
            var offset;
            if (p.random) {
                offset = (maxOffset > 0) ? (Math.random() * maxOffset) : 0;
            } else {
                switch (p.position) {
                    case 'start':  offset = 0; break;
                    case 'end':    offset = maxOffset; break;
                    case 'middle':
                    default:       offset = maxOffset / 2; break;
                }
            }

            // ----- Project (sequence time) and media coordinates -----
            var destStart = src.startSec + offset;
            var destEnd   = destStart + segDur;
            var mediaIn   = src.inPointSec + offset;
            var mediaOut  = mediaIn + segDur;

            // ----- Dry-run: record the plan and change nothing -----
            if (p.dryRun) {
                preview.push({ name: src.name, startSec: _r(destStart), durationSec: _r(segDur) });
                created++;
                continue;
            }

            // ----- Capture the source clip's color label so we can mirror it -----
            var srcColor = _getColorLabel(src.ref);

            // ----- Pre-trim the projectItem, THEN insert -----
            // overwriteClip only lays down the projectItem's CURRENT in/out
            // range, so trimming the projectItem to [mediaIn, mediaOut] up
            // front yields a clip that is exactly segDur long, placed at
            // destStart, with the rest of the source media kept as handles
            // on both sides (the user can still extend the cut by dragging).
            //
            // This replaces the old "insert full clip then set inPoint/
            // outPoint" approach, which only slipped the content and left
            // every extract at full length.
            _setProjItemIO(src.projectItem, mediaIn, mediaOut, warnings, src.name);

            try {
                dstTrack.overwriteClip(src.projectItem, destStart);
            } catch (e) {
                warnings.push('Echec insertion pour "' + src.name + '": ' + e.toString());
                skipped++;
                continue;
            }

            // ----- Locate the freshly-inserted track item at destStart -----
            var newClip = _findClipAt(dstTrack, destStart);
            if (!newClip) newClip = _findClipAt(dstTrack, destStart, 0.2);
            if (!newClip) {
                warnings.push('Clip insere introuvable pour "' + src.name + '" a t=' + _r(destStart) + 's.');
                skipped++;
                continue;
            }

            // ----- Mirror the source color onto the new clip + linked audio -----
            // overwriteClip placed audio companions when the projectItem had
            // audio; they already share the pre-trimmed in/out window.
            _setColorLabel(newClip, srcColor);
            _forEachLinked(newClip, function (linked) {
                _setColorLabel(linked, srcColor);
            });

            // ----- Optional zoom (video only) -----
            if (p.zoom) _applyZoom(newClip, warnings);

            // ----- Optional sequence marker at the extract's start -----
            if (p.marker) {
                try {
                    var mk = seq.markers.createMarker(destStart);
                    mk.name = 'B-Roll: ' + src.name;
                    mk.comments = 'Extrait genere automatiquement (duree ' + _r(segDur) + 's)';
                } catch (e) {
                    warnings.push('Marqueur a echoue pour "' + src.name + '": ' + e.toString());
                }
            }

            created++;
        }

        // ----- Optional cross-dissolve transitions on the new extracts -----
        var transitionsAdded = 0;
        if (p.transition && created > 0) {
            transitionsAdded = _addTransitions(seq, dstIdx, warnings);
        }

        // ----- Close undo group -----
        if (!p.dryRun) {
            try { app.project.closeUndoGroup && app.project.closeUndoGroup(); } catch (e) {}
        }

        if (p.dryRun) {
            return JSON.stringify({
                ok: true,
                dryRun: true,
                count: preview.length,
                preview: preview,
                dstTrackIdx: dstIdx,
                warnings: warnings
            });
        }

        return JSON.stringify({
            created: created,
            skipped: skipped,
            dstTrackIdx: dstIdx,
            transitions: transitionsAdded,
            warnings: warnings
        });

    } catch (err) {
        try { app.project.closeUndoGroup && app.project.closeUndoGroup(); } catch (e) {}
        return JSON.stringify({ error: 'Exception fatale: ' + err.toString(), warnings: warnings });
    }
}

/**
 * Compact ONE track: close every gap between its clips, gap-at-a-time,
 * re-snapshotting after each move.
 *
 *   1. Snapshot the track, sorted by start time.
 *   2. Find the FIRST clip whose start lies after where it should sit
 *      (the running end of the previous clip).
 *   3. move() that clip (and its linked items) left to close the gap.
 *   4. Re-snapshot and repeat until no gaps remain.
 *
 * Why one-at-a-time + re-snapshot: moving a track item invalidates the
 * cached TrackItem references of the other clips, so moving from a single
 * up-front snapshot only ever closed the first gap. Re-querying the track
 * after each move keeps every reference live. Bounded by the clip count so
 * a no-op move() can never loop forever.
 *
 * move() takes a Time RELATIVE to the clip's current position (negative =
 * earlier). Linked audio/video items move together (Premiere's default).
 *
 * Returns { shifted, totalGapClosed }.
 */
function _compactTrack(track, warnings, label) {
    var initial = _snapshotClips(track);
    if (initial.length === 0) return { shifted: 0, totalGapClosed: 0 };

    var shifted = 0;
    var totalGapClosed = 0;
    var maxPasses = initial.length + 2;
    var pass = 0;

    while (pass++ < maxPasses) {
        var clips = _snapshotClips(track);

        // Find the first clip that starts after where it should.
        var prevEnd = 0;
        var target = null;
        var gap = 0;
        for (var i = 0; i < clips.length; i++) {
            var c = clips[i];
            if (c.startSec > prevEnd + 0.001) { target = c; gap = c.startSec - prevEnd; break; }
            prevEnd = c.startSec + c.durationSec;
        }
        if (!target) break; // no gaps left — done

        // Shift it (and its linked items) left to butt against prevEnd.
        try {
            target.ref.move(_timeFromSeconds(-gap));
        } catch (e) {
            warnings.push('Deplacement a echoue (' + label + ') pour "' + target.name + '": ' + e.toString());
            break;
        }

        // Verify the move actually happened: a clip of the same duration
        // should now sit at prevEnd. If not, move() is a no-op on this
        // Premiere version — stop instead of looping pointlessly.
        var after = _snapshotClips(track);
        var moved = false;
        for (var j = 0; j < after.length; j++) {
            if (Math.abs(after[j].startSec - prevEnd) < 0.02 &&
                Math.abs(after[j].durationSec - target.durationSec) < 0.02) { moved = true; break; }
        }
        if (!moved) {
            warnings.push('Le clip "' + target.name + '" ne s\'est pas deplace (' + label + '; move() sans effet sur cette version).');
            break;
        }

        totalGapClosed += gap;
        shifted++;
    }

    return { shifted: shifted, totalGapClosed: totalGapClosed };
}

/**
 * Remove all gaps on one OR several tracks of the active sequence.
 *
 * @param {string} jsonStr JSON, either:
 *   { tracks: [ { trackType:'video'|'audio', trackIdx:int }, ... ] }   (multi)
 *   { trackType:'video'|'audio', trackIdx:int }                        (single, back-compat)
 */
function removeGaps(jsonStr) {
    var warnings = [];
    try {
        var p = JSON.parse(jsonStr);

        // Normalise to a list of { trackType, trackIdx }.
        var list = p.tracks;
        if (!list || !list.length) {
            if (typeof p.trackType !== 'undefined') {
                list = [{ trackType: p.trackType, trackIdx: p.trackIdx }];
            } else {
                return JSON.stringify({ error: 'Aucune piste selectionnee.' });
            }
        }

        if (!app.project) return JSON.stringify({ error: 'Aucun projet ouvert.' });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: 'Aucune sequence active.' });

        // ----- One undo group for the WHOLE multi-track operation -----
        try { app.project.openUndoGroup && app.project.openUndoGroup('Supprimer les trous'); } catch (e) {}

        var totalShifted = 0;
        var totalGapClosed = 0;
        var processed = 0;

        for (var k = 0; k < list.length; k++) {
            var item = list[k];
            var trackType = (item.trackType === 'audio') ? 'audio' : 'video';
            var tracks = (trackType === 'audio') ? seq.audioTracks : seq.videoTracks;
            var label = (trackType === 'audio' ? 'A' : 'V') + (item.trackIdx + 1);

            if (item.trackIdx < 0 || item.trackIdx >= tracks.numTracks) {
                warnings.push('Piste ' + label + ' inexistante, ignoree.');
                continue;
            }

            var res = _compactTrack(tracks[item.trackIdx], warnings, label);
            totalShifted += res.shifted;
            totalGapClosed += res.totalGapClosed;
            processed++;
        }

        try { app.project.closeUndoGroup && app.project.closeUndoGroup(); } catch (e) {}

        return JSON.stringify({
            ok: true,
            tracks: processed,
            shifted: totalShifted,
            totalGapClosed: _r(totalGapClosed),
            warnings: warnings
        });

    } catch (err) {
        try { app.project.closeUndoGroup && app.project.closeUndoGroup(); } catch (e) {}
        return JSON.stringify({ error: 'Exception: ' + err.toString(), warnings: warnings });
    }
}
