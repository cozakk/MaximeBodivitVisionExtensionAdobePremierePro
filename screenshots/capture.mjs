#!/usr/bin/env node
/*
 * Captures d'ecran du panneau, hors Premiere Pro.
 *
 * Principe : un petit serveur HTTP sert le dossier de l'extension et
 * injecte cep-stub.js juste avant js/main.js. Le panneau croit donc
 * parler a Premiere (sequence, pistes et sequences du projet sont des
 * fixtures) et s'affiche normalement dans Chrome, pilote en headless via
 * le protocole DevTools. Rien dans l'extension n'est modifie.
 *
 * Le pilotage passe par CDP (et non par --screenshot) pour imposer la
 * geometrie EXACTE du panneau : en headless, la fenetre de Chrome a une
 * largeur minimale (~500 px) et perd la hauteur de sa barre d'onglets,
 * ce qui fausse les mesures. Emulation.setDeviceMetricsOverride donne le
 * viewport demande au pixel pres, et l'audit mesure donc exactement ce
 * que montre le PNG.
 *
 * Usage :
 *   node screenshots/capture.mjs                 toutes les vues
 *   node screenshots/capture.mjs --only=gaps     les vues dont le nom contient « gaps »
 *   node screenshots/capture.mjs --list          liste les vues sans rien capturer
 *   node screenshots/capture.mjs --no-audit      PNG seulement, pas de rapport
 *   node screenshots/capture.mjs --serve         garde le serveur ouvert (mise au point)
 *
 * Sortie : screenshots/DDmmAAAA-hhmmss/*.png + layout-report.{md,json}
 * Chrome : detecte automatiquement, ou impose via CHROME_PATH=...
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STUB_URL = '/__cep-stub.js';

// ---------------------------------------------------------------------
// Les vues a capturer. Ajouter une ligne ici suffit.
//   q = query string lue par cep-stub.js (tab, theme, lang, seq, ...)
//   w/h = taille du panneau ; cf. Geometry dans CSXS/manifest.xml
//         (defaut 360x620, minimum 320x520, maximum 900x2000)
// Les vues « deroule » sont volontairement hautes : tout le contenu tient
// dans le viewport, ce qui permet d'auditer aussi le bas des onglets.
// ---------------------------------------------------------------------
const VIEWS = [
  { name: 'broll-sombre',       q: 'tab=broll',                w: 360, h: 620 },
  { name: 'compactage-sombre',  q: 'tab=gaps',                 w: 360, h: 620 },
  { name: 'batch-sombre',       q: 'tab=batch',                w: 360, h: 620 },
  { name: 'broll-clair',        q: 'tab=broll&theme=light',    w: 360, h: 620 },
  { name: 'compactage-clair',   q: 'tab=gaps&theme=light',     w: 360, h: 620 },
  { name: 'batch-clair',        q: 'tab=batch&theme=light',    w: 360, h: 620 },
  { name: 'broll-mini',         q: 'tab=broll',                w: 320, h: 520 },
  { name: 'compactage-mini',    q: 'tab=gaps',                 w: 320, h: 520 },
  { name: 'broll-large',        q: 'tab=broll',                w: 600, h: 900 },
  { name: 'broll-profils',      q: 'tab=broll&presets=1',      w: 360, h: 620 },
  { name: 'broll-anglais',      q: 'tab=broll&lang=en',        w: 360, h: 620 },
  { name: 'broll-allemand',     q: 'tab=broll&lang=de',        w: 360, h: 620 },
  { name: 'compactage-espagnol', q: 'tab=gaps&lang=es',        w: 360, h: 620 },
  { name: 'sans-sequence',      q: 'tab=broll&seq=nosequence', w: 360, h: 620 },
  { name: 'broll-deroule',      q: 'tab=broll',                w: 360, h: 1100 },
  { name: 'compactage-deroule', q: 'tab=gaps',                 w: 360, h: 900 },
];

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n) => {
  const a = argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=').slice(1).join('=') : null;
};

const only = opt('only');
const doAudit = !flag('no-audit');
const serveOnly = flag('serve');
const views = only ? VIEWS.filter((v) => v.name.includes(only) || v.q.includes(only)) : VIEWS;

if (flag('list')) {
  VIEWS.forEach((v) => console.log(`${v.name.padEnd(20)} ${v.w}x${v.h}  ?${v.q}`));
  process.exit(0);
}
if (!views.length) {
  console.error(`Aucune vue ne correspond a --only=${only}`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    console.error('Chrome introuvable. Installe Chrome ou Edge, ou lance avec CHROME_PATH=<chemin de chrome.exe>');
    process.exit(1);
  }
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lance Chrome headless et rend { child, port } une fois DevTools pret.
async function launchChrome(chrome, profile) {
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-features=Translate', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (port > 0) return { child, port };
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('Chrome n\'a pas ouvert son port DevTools.');
}

// Client CDP minimal (Node 22 fournit WebSocket et fetch nativement).
class CDP {
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Connexion DevTools impossible : ' + wsUrl));
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
    };
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Delai depasse : ' + method));
      }, 30_000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' : ' + expression);
    return r.result.value;
  }

  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------------
// Serveur : le dossier de l'extension + injection du stub
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.jsx': 'text/plain; charset=utf-8',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);

      if (path === STUB_URL) {
        const stub = await readFile(join(HERE, 'cep-stub.js'));
        res.writeHead(200, { 'content-type': MIME['.js'] });
        res.end(stub);
        return;
      }

      if (path === '/' || path === '/index.html') {
        const html = await readFile(join(ROOT, 'index.html'), 'utf8');
        // Le stub doit s'executer AVANT main.js : il pose localStorage et le pont.
        const injected = html.replace(
          /<script src="js\/main\.js"><\/script>/,
          `<script src="${STUB_URL}"></script>\n  <script src="js/main.js"></script>`);
        if (injected === html) {
          throw new Error('Balise <script src="js/main.js"> introuvable dans index.html : adapter capture.mjs.');
        }
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(injected);
        return;
      }

      // Fichiers du panneau, confines au dossier de l'extension.
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end('403'); return; }
      // Lire avant d'envoyer les en-tetes : un fichier absent doit pouvoir
      // partir en 404 propre.
      const body = await readFile(file);
      const ext = (file.match(/\.[a-z]+$/i) || [''])[0].toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end('404');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}`
       + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function toMarkdown(runDir, results) {
  const total = results.reduce((n, r) => n + (r.audit ? r.audit.problems.length : 0), 0);
  const notes = results.reduce((n, r) => n + (r.audit ? (r.audit.notes || []).length : 0), 0);
  const lines = [
    `# Rapport de mise en page — ${runDir}`, '',
    `Genere par \`node screenshots/capture.mjs\` le ${new Date().toLocaleString('fr-FR')}.`,
    'Positions mesurees dans le viewport exact du panneau, sur la page reelle',
    'peuplee par les fixtures de `cep-stub.js` (3 pistes video, 2 audio, 4 sequences).', '',
    total === 0
      ? `**Aucun probleme de position detecte** (${notes} remarque(s) d'ergonomie).`
      : `**${total} probleme(s)** et ${notes} remarque(s), detail par vue ci-dessous.`, '',
  ];

  for (const r of results) {
    lines.push(`## ${r.view.name} — ${r.view.w}x${r.view.h}`, '', `![${r.view.name}](${r.png})`, '');
    if (!r.audit) { lines.push('_Audit non execute._', ''); continue; }
    const a = r.audit;
    lines.push(`- Onglet : **${a.tab}** · theme : **${a.theme}** · \`?${r.view.q}\``);
    lines.push(`- Contenu : ${a.page.scrollW}x${a.page.scrollH} px dans un panneau de ${a.viewport.w}x${a.viewport.h}`);
    lines.push(`- Debordement horizontal : ${a.overflowX ? '**oui**' : 'non'}`);
    lines.push(`- Barre d'info : \`${(a.seqLine || '').trim()}\``, '');
    lines.push('| Repere | x | y | largeur | hauteur |', '|---|---|---|---|---|');
    a.landmarks.forEach((l) => lines.push(`| ${l.role} | ${l.rect.x} | ${l.rect.y} | ${l.rect.w} | ${l.rect.h} |`));
    lines.push('');
    if (a.problems.length) {
      lines.push('**Problemes**', '');
      a.problems.forEach((p) => lines.push(`- \`${p.kind}\` ${p.el ? '**' + p.el + '** — ' : ''}${p.msg}`));
    } else {
      lines.push('Pas de chevauchement, de debordement ni de repere dans le desordre.');
    }
    lines.push('');
    if ((a.notes || []).length) {
      lines.push('**Remarques**', '');
      a.notes.forEach((p) => lines.push(`- \`${p.kind}\` ${p.el ? '**' + p.el + '** — ' : ''}${p.msg}`));
      lines.push('');
    }
    if (a.belowFold.length) {
      lines.push(`**Hors ecran sans defilement** (${a.belowFold.length}) :`, '');
      a.belowFold.forEach((e) => lines.push(`- ${e}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------
const chrome = findChrome();
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}/`;

if (serveOnly) {
  console.log(`Serveur de capture : ${base}?tab=broll`);
  console.log('Parametres : tab, theme, lang, sync, gaps, duration, position, seq, audit.');
  console.log('Ctrl+C pour arreter.');
} else {
  const runDir = stamp();
  const outDir = join(HERE, runDir);
  await mkdir(outDir, { recursive: true });

  const profile = join(tmpdir(), 'visionext-shots-' + process.pid);
  const { child, port } = await launchChrome(chrome, profile);
  const results = [];

  console.log(`Chrome   : ${chrome}`);
  console.log(`Serveur  : ${base}`);
  console.log(`Sortie   : screenshots/${runDir}\n`);

  try {
    for (const [i, view] of views.entries()) {
      const url = `${base}?${view.q}`;
      const png = `${String(i + 1).padStart(2, '0')}-${view.name}-${view.w}x${view.h}.png`;

      const target = await (await fetch(
        `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
      const cdp = await CDP.open(target.webSocketDebuggerUrl);

      try {
        await cdp.send('Page.enable');
        // Viewport exact du panneau, sans barre d'onglets ni largeur minimale.
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: view.w, height: view.h, deviceScaleFactor: 1, mobile: false,
        });
        await cdp.send('Page.navigate', { url });

        // Le stub signale quand le panneau a recu ses deux reponses hote.
        let ready = false;
        for (let t = 0; t < 60 && !ready; t++) {
          await sleep(100);
          ready = await cdp.eval('!!(window.__visionextStub && window.__visionextStub.ready)')
            .catch(() => false);
        }
        if (!ready) console.warn(`  ! ${view.name} : le panneau n'a pas fini de se peupler`);
        await sleep(250); // laisse le DOM se stabiliser apres les reponses

        if (doAudit) {
          const raw = await cdp.eval('JSON.stringify(window.__visionextAudit())');
          results.push({ view, png, audit: JSON.parse(raw) });
        } else {
          results.push({ view, png, audit: null });
        }

        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(outDir, png), Buffer.from(shot.data, 'base64'));
      } finally {
        cdp.close();
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
      }

      const last = results[results.length - 1];
      const nb = last.audit
        ? `${last.audit.problems.length} probleme(s), ${(last.audit.notes || []).length} remarque(s)` : '';
      console.log(`  ${png.padEnd(40)} ${nb}`);
    }

    if (doAudit) {
      await writeFile(join(outDir, 'layout-report.json'), JSON.stringify(results, null, 2), 'utf8');
      await writeFile(join(outDir, 'layout-report.md'), toMarkdown(runDir, results), 'utf8');
      const total = results.reduce((n, r) => n + (r.audit ? r.audit.problems.length : 0), 0);
      console.log(`\n${total} probleme(s) au total — voir screenshots/${runDir}/layout-report.md`);
      if (total > 0) process.exitCode = 1;
    }
  } finally {
    child.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
