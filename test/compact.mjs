#!/usr/bin/env node
/*
 * Algorithm tests for the gap removal in jsx/host.jsx.
 *
 * jsx/host.jsx is loaded in a VM with a fake Premiere DOM (sequence, tracks,
 * clips, linked items, move()), so the compacting logic can be exercised
 * without Premiere Pro. Only the maths is checked here — the real host API
 * quirks (move() being a no-op on some builds, etc.) still need a live test.
 *
 * Scenario mirrors the reported bug: V1 carries several clips, A1 carries
 * audio under SOME of them only.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (m) => { console.error('FAIL : ' + m); failures++; };
const pass = (m) => console.log('ok   : ' + m);

// ------------------------------------------------------------------
// Fake Premiere DOM
// ------------------------------------------------------------------
function makeClip(name, start, dur) {
  const c = {
    name,
    _start: start,
    _dur: dur,
    linked: [],
    projectItem: { name },
    get start() { return { seconds: c._start }; },
    get end() { return { seconds: c._start + c._dur }; },
    get duration() { return { seconds: c._dur }; },
    get inPoint() { return { seconds: 0 }; },
    get outPoint() { return { seconds: c._dur }; },
    // Premiere drags linked items along with the clip being moved.
    move(time) {
      const d = time.seconds;
      c._start += d;
      for (const l of c.linked) l._start += d;
    }
  };
  return c;
}

function link(a, b) { a.linked.push(b); b.linked.push(a); }

function makeTrack(clips) {
  const list = clips.slice();
  list.numItems = list.length;
  return { clips: list };
}

function makeSequence(videoTracks, audioTracks) {
  const v = videoTracks.slice(); v.numTracks = v.length;
  const a = audioTracks.slice(); a.numTracks = a.length;
  return { name: 'Test', videoTracks: v, audioTracks: a };
}

// Load host.jsx into a sandbox and hand back its public functions.
function loadHost(seq) {
  const sandbox = {
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    isNaN,
    Time: function Time() { this.seconds = 0; },
    app: {
      version: '25.0 (fake)',
      project: { activeSequence: seq, openUndoGroup() {}, closeUndoGroup() {} },
      enableQE() {}
    }
  };
  vm.createContext(sandbox);
  new vm.Script(readFileSync(join(root, 'jsx/host.jsx'), 'utf8'), { filename: 'jsx/host.jsx' })
    .runInContext(sandbox);
  return sandbox;
}

// Compact textual view of a track: "name@start-end" per clip, sorted.
function layout(track) {
  return track.clips
    .slice()
    .sort((x, y) => x._start - y._start)
    .map((c) => `${c.name}@${round(c._start)}-${round(c._start + c._dur)}`)
    .join(' ');
}
const round = (v) => Math.round(v * 1000) / 1000;

function eq(label, got, want) {
  if (got === want) pass(`${label} → ${got}`);
  else fail(`${label}\n       attendu : ${want}\n       obtenu  : ${got}`);
}

// ------------------------------------------------------------------
// Scenario builder: V1 = 3 clips with gaps, A1 = audio under the 2nd only
// ------------------------------------------------------------------
function scenario() {
  const v1 = makeClip('A', 30, 5);
  const v2 = makeClip('B', 50, 5);
  const v3 = makeClip('C', 70, 5);
  const a2 = makeClip('B-audio', 50, 5);
  link(v2, a2);
  const seq = makeSequence([makeTrack([v1, v2, v3])], [makeTrack([a2])]);
  return { seq, V1: seq.videoTracks[0], A1: seq.audioTracks[0] };
}

const BOTH = [{ trackType: 'video', trackIdx: 0 }, { trackType: 'audio', trackIdx: 0 }];

// ---- 1) Synced mode keeps each audio under its own video ----
{
  const { seq, V1, A1 } = scenario();
  const host = loadHost(seq);
  const res = JSON.parse(host.removeGaps(JSON.stringify({ tracks: BOTH, synced: true })));

  eq('synchro V1', layout(V1), 'A@0-5 B@5-10 C@10-15');
  eq('synchro A1', layout(A1), 'B-audio@5-10');       // still under clip B
  if (res.gaps === 3) pass('synchro : 3 trous fermes'); else fail('synchro : gaps = ' + res.gaps);
  if (round(res.totalGapClosed) === 60) pass('synchro : 60s supprimees'); else fail('synchro : totalGapClosed = ' + res.totalGapClosed);
  if (!res.warnings.length) pass('synchro : aucun avertissement'); else fail('synchro : warnings ' + JSON.stringify(res.warnings));
}

// ---- 2) Per-track mode reproduces the reported bug ----
// V1 is compacted first, then A1 on its own: the audio slides to the head of
// the timeline AND drags its linked video along, dropping clip B on top of
// clip A. This is exactly what the synced mode above prevents.
{
  const { seq, V1, A1 } = scenario();
  const host = loadHost(seq);
  JSON.parse(host.removeGaps(JSON.stringify({ tracks: BOTH, synced: false })));

  eq('par piste V1 (bug connu)', layout(V1), 'A@0-5 B@0-5 C@10-15');
  eq('par piste A1 (bug connu)', layout(A1), 'B-audio@0-5');
}

// ---- 3) A single track gives the same result in both modes ----
{
  const a = scenario();
  const b = scenario();
  const ONE = [{ trackType: 'video', trackIdx: 0 }];
  loadHost(a.seq).removeGaps(JSON.stringify({ tracks: ONE, synced: true }));
  loadHost(b.seq).removeGaps(JSON.stringify({ tracks: ONE, synced: false }));
  eq('piste seule : modes identiques', layout(a.V1), layout(b.V1));
}

// ---- 4) Unchecked tracks holding clips are reported ----
{
  const { seq } = scenario();
  const host = loadHost(seq);
  const res = JSON.parse(host.removeGaps(JSON.stringify({
    tracks: [{ trackType: 'video', trackIdx: 0 }], synced: true
  })));
  const warned = res.warnings.some((w) => w.indexOf('A1') !== -1);
  if (warned) pass('avertissement sur la piste non cochee A1');
  else fail('aucun avertissement pour A1 non cochee : ' + JSON.stringify(res.warnings));
}

// ---- 5) Audio longer than its video extends the occupied interval ----
{
  const v = makeClip('A', 10, 5);
  const a = makeClip('A-audio', 10, 12); // runs 7s past the video
  link(v, a);
  const tail = makeClip('B', 40, 5);
  const seq = makeSequence([makeTrack([v, tail])], [makeTrack([a])]);
  const host = loadHost(seq);
  JSON.parse(host.removeGaps(JSON.stringify({ tracks: BOTH, synced: true })));

  eq('audio long V1', layout(seq.videoTracks[0]), 'A@0-5 B@12-17');
  eq('audio long A1', layout(seq.audioTracks[0]), 'A-audio@0-12');
}

// ---- 6) No gap at all: nothing moves ----
{
  const v1 = makeClip('A', 0, 5);
  const v2 = makeClip('B', 5, 5);
  const seq = makeSequence([makeTrack([v1, v2])], []);
  const host = loadHost(seq);
  const res = JSON.parse(host.removeGaps(JSON.stringify({
    tracks: [{ trackType: 'video', trackIdx: 0 }], synced: true
  })));
  eq('sans trou', layout(seq.videoTracks[0]), 'A@0-5 B@5-10');
  if (res.gaps === 0) pass('sans trou : 0 trou ferme'); else fail('sans trou : gaps = ' + res.gaps);
}

// ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} echec(s).`);
  process.exit(1);
}
console.log('\nCompactage : tous les controles sont passes.');
