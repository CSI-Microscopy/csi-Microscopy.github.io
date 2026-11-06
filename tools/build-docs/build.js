#!/usr/bin/env node
/*
 * CSI Microscopy — static build for an instrument repo's GitHub Pages site.
 *
 *   node build.js --repo <Name> --src <dir> --out <dir> [--site <site.json>]
 *                 [--branch <b>] [--home <home repo dir>] [--json <report.json>] [--strict]
 *
 * Every README.md / readme.md becomes its folder's index.html, every other
 * .md becomes <name>.html; hand-written HTML, PDFs, images, scripts and other
 * files are copied as they are; raw .md files are not published (the
 * generated 404.html redirects them to their page). The root index.html of
 * the old scheme (a shim that loads guides/render.js, recognised by
 * `window.GUIDE`) and an existing 404.html are replaced by generated pages.
 *
 * Markdown is rendered with guides/md-core.js — the same code guides/render.js
 * runs in the browser — and marked 4.3.0, so pages look as they did. The CSS,
 * site.js and favicon are copied from the home repo into <out>/assets/, so a
 * built site does not depend on the home site at view time.
 *
 * Exit status: 0 (warnings are printed in the build report), 1 on a fatal
 * error, or with --strict when an internal link, image or anchor is missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── Arguments ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = { strict: false };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--strict') { a.strict = true; continue; }
        if (!/^--(repo|src|out|site|branch|home|json)$/.test(k) || i + 1 >= argv.length) {
            throw new Error(`unknown or incomplete argument: ${k}`);
        }
        a[k.slice(2)] = argv[++i];
    }
    for (const k of ['repo', 'src', 'out']) if (!a[k]) throw new Error(`--${k} is required`);
    return a;
}

let args;
try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error('build-docs: ' + e.message);
    console.error('usage: node build.js --repo <Name> --src <dir> --out <dir> [--site site.json] [--branch b] [--home dir] [--json file] [--strict]');
    process.exit(1);
}

const HOME = path.resolve(args.home || path.join(__dirname, '../..'));
const core = require(path.join(HOME, 'guides/md-core.js'));
const marked = require('marked');
const { SITE, ORG, KNOWN_REPOS, escHtml, encPath, docUrlPath, safeDecode } = core;

const REPO = args.repo;
if (!core.validName(REPO)) { console.error(`build-docs: invalid repo name "${REPO}"`); process.exit(1); }
const SRC = path.resolve(args.src);
const OUT = path.resolve(args.out);
if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) { console.error(`build-docs: --src ${SRC} is not a directory`); process.exit(1); }
if (OUT === SRC || (OUT.startsWith(SRC + path.sep) && !path.relative(SRC, OUT).startsWith('_'))) {
    // An output folder inside the source is fine only when it is excluded (_site)
    console.error('build-docs: --out must not be inside --src (except a folder whose name starts with "_")'); process.exit(1);
}

function gitBranch(dir) {
    try { return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (_) { return ''; }
}
const BRANCH = args.branch || KNOWN_REPOS[REPO] || (gitBranch(SRC) !== 'HEAD' && gitBranch(SRC)) || 'main';
if (!core.validBranch(BRANCH)) { console.error(`build-docs: invalid branch "${BRANCH}"`); process.exit(1); }

const warnings = [];
const warn = (kind, msg) => warnings.push({ kind, msg });
const toPosix = p => p.split(path.sep).join('/');

// ── site.json ───────────────────────────────────────────────────────────────
// { "name": "...", "short": "...", "menu": [{ "label", "href" }], "exclude": [globs],
//   "titles": { "<old ?title= value>": "<page path relative to the repo root>[#anchor]" } }
let siteFile = args.site ? path.resolve(args.site) : path.join(SRC, 'site.json');
let site = {};
if (fs.existsSync(siteFile)) {
    try { site = JSON.parse(fs.readFileSync(siteFile, 'utf8')); }
    catch (e) { console.error(`build-docs: ${siteFile}: ${e.message}`); process.exit(1); }
} else {
    if (args.site) { console.error(`build-docs: --site ${siteFile} not found`); process.exit(1); }
    siteFile = null;
}

// Old ?title= links that named a part of a document (report §6.2). Candidates
// are tried in order; the first page/anchor that exists in the output wins.
const KNOWN_TITLES = {
    'Stellaris-STED-Confocal': { 'Stellaris Confocal Data Tools': ['tools/', ''] },
    'Luxendo-MuVi-SPIM-Light-Sheet': { 'Luxendo h5 to TIFF Converter': ['#h5-to-tiff-converter', ''] },
    'Skyscan-1272-MicroCT': { 'Skyscan 1272 Manuals': ['manuals/'] },
};

// ── Collect source files ────────────────────────────────────────────────────
const ALWAYS_SKIP = new Set(['.git', '.github', 'node_modules', '_site', '_home']);
function globToRe(g) {
    let re = '';
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*' && g[i + 1] === '*') {
            i++;
            if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$');
}
const excludeRes = (Array.isArray(site.exclude) ? site.exclude : []).map(globToRe);
const isExcluded = rel => excludeRes.some(re => re.test(rel) || re.test(rel + '/'));

const files = [];      // repo-relative POSIX paths
const skipped = [];
(function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const abs = path.join(dir, ent.name);
        const rel = toPosix(path.relative(SRC, abs));
        if (ALWAYS_SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
        if (abs === OUT) continue;
        if (rel === 'site.json' || (siteFile && abs === siteFile)) continue;
        if (isExcluded(rel)) { skipped.push(rel + (ent.isDirectory() ? '/' : '') + ' (site.json exclude)'); continue; }
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile() || (ent.isSymbolicLink() && fs.statSync(abs).isFile())) files.push(rel);
    }
})(SRC);

const isMd = f => /\.md$/i.test(f);
const isHtml = f => /\.html?$/i.test(f);
const isShim = f => /(^|\/)index\.html?$/i.test(f) && /window\.GUIDE\s*=/.test(fs.readFileSync(path.join(SRC, f), 'utf8'));

// Display name: site.json, else the shim's title, else the repo name
let shimTitle = '';
for (const f of files) {
    if (f.toLowerCase() === 'index.html' && isShim(f)) {
        const m = fs.readFileSync(path.join(SRC, f), 'utf8').match(/window\.GUIDE\s*=\s*\{[^}]*?\btitle\s*:\s*(['"])(.*?)\1/);
        if (m) shimTitle = m[2];
    }
}
const NAME = site.name || shimTitle || REPO.replace(/[-_]+/g, ' ');
const SHORT = site.short || NAME;

// ── Plan the output ─────────────────────────────────────────────────────────
const pages = [];       // { src, out, urlPath }
const copies = [];      // repo-relative paths copied as they are
const handHtml = [];
const ignored = [];
const outSet = new Map();   // output path → what produced it
const claim = (out, by) => {
    if (outSet.has(out)) { warn('conflict', `${out}: produced by both ${outSet.get(out)} and ${by}; keeping ${outSet.get(out)}`); return false; }
    outSet.set(out, by); return true;
};

for (const f of files) {
    if (isHtml(f) && isShim(f)) { ignored.push(`${f} (render.js shim; replaced by the generated page)`); continue; }
    if (f.toLowerCase() === '404.html') { ignored.push(`${f} (replaced by the generated 404.html)`); continue; }
    if (isMd(f)) continue;
    if (claim(f, f)) { copies.push(f); if (isHtml(f)) handHtml.push(f); }
}
// Markdown after the copies, so a hand-written page of the same name wins
const mdFiles = files.filter(isMd).sort((a, b) => {
    // README.md before readme.md in the same folder
    const da = path.posix.dirname(a), db = path.posix.dirname(b);
    return da === db ? (a < b ? -1 : 1) : (a < b ? -1 : 1);
});
for (const f of mdFiles) {
    const urlPath = docUrlPath(f);
    const out = urlPath === '' || urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath;
    if (outSet.has(out)) {
        warn('conflict', `${f} not rendered: ${out} already comes from ${outSet.get(out)}`);
        continue;
    }
    claim(out, f);
    pages.push({ src: f, out, urlPath });
}
const GENERATED_ASSETS = {
    'assets/styles.css': path.join(HOME, 'styles.css'),
    'assets/guide.css': path.join(HOME, 'guides/guide.css'),
    'assets/site.js': path.join(HOME, 'site.js'),
    'assets/favicon.svg': path.join(HOME, 'assets/favicon.svg'),
};
for (const [out, from] of Object.entries(GENERATED_ASSETS)) {
    if (outSet.has(out)) { console.error(`build-docs: ${out} exists in the repo; it would be overwritten by the site's ${path.basename(from)}. Rename it.`); process.exit(1); }
    if (!fs.existsSync(from)) { console.error(`build-docs: missing ${from} in the home repo (--home ${HOME})`); process.exit(1); }
    outSet.set(out, 'home:' + toPosix(path.relative(HOME, from)));
}
outSet.set('404.html', 'generated');
const hasOut = p => outSet.has(p);
const hasPage = encFolder => hasOut(safeDecode(encFolder) + 'index.html');
const root = pages.find(p => p.out === 'index.html');
if (!root && !hasOut('index.html')) warn('no-index', 'no README.md / readme.md at the repo root and no index.html: the site has no home page');

// ── Render Markdown ─────────────────────────────────────────────────────────
const oldOrg = [];
const humanise = s => safeDecode(s).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
for (const p of pages) {
    const text = fs.readFileSync(path.join(SRC, p.src), 'utf8');
    for (const u of core.findOldOrg(text)) oldOrg.push({ file: p.src, url: u, to: core.fixOldOrg(u) });
    const linker = core.makeLinker({ mode: 'static', repo: REPO, branch: BRANCH, mdPath: p.src, defaultPath: 'README.md', hasPage });
    const isDefaultDoc = p.urlPath === '';
    const folder = p.src.includes('/') ? p.src.split('/').slice(-2, -1)[0] : '';
    const fallbackTitle = isDefaultDoc ? NAME : humanise(/^readme\.md$/i.test(path.posix.basename(p.src)) ? folder : path.posix.basename(p.src));
    const r = core.renderMarkdown(marked, text, { linker, titleParam: '', fallbackTitle, isDefaultDoc });
    Object.assign(p, r);
}
for (const o of oldOrg) warn('old-org', `${o.file}: ${o.url} (rewritten to ${o.to})`);

// ── Page assembly ───────────────────────────────────────────────────────────
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const jsonScript = obj => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const canonicalOf = urlPath => SITE + REPO + '/' + encPath(urlPath);
const dirOf = out => out.includes('/') ? out.slice(0, out.lastIndexOf('/') + 1) : '';
const relRootOf = out => '../'.repeat(dirOf(out).split('/').length - 1);

// Shared header: the .navbar of the home page, with its links made absolute
function navbarFromHome() {
    let html;
    try { html = fs.readFileSync(path.join(HOME, 'index.html'), 'utf8'); } catch (_) { return null; }
    const m = html.match(/<nav class="navbar[^"]*"[^>]*>[\s\S]*?<\/nav>/);
    if (!m) return null;
    return m[0]
        .replace(/\shref="#home"/, ` href="${SITE}"`)
        .replace(/\shref="([^"]*)"/g, (all, h) => {
            if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return all;
            try { return ` href="${new URL(h, SITE).href}"`; } catch (_) { return all; }
        })
        .replace(/\s(?:class="active"|aria-current="page")/g, '');
}
const NAVBAR = navbarFromHome();
if (!NAVBAR) warn('navbar', `could not find the .navbar in ${path.join(HOME, 'index.html')}; using the copy in template.html`);
const withNavbar = html => NAVBAR
    ? html.replace(/<!-- navbar:start[\s\S]*?<!-- navbar:end -->/, NAVBAR.replace(/\$/g, '$$$$'))
    : html;

// Instrument sub-menu: site.json, else the root guide plus every other page
function defaultMenu() {
    const items = [{ label: 'Guide', href: './' }];
    for (const p of pages) if (p.urlPath !== '') items.push({ label: p.title, href: p.urlPath });
    for (const h of handHtml) if (!h.includes('/') && !/^index\.html?$/i.test(h)) {
        const t = (fs.readFileSync(path.join(SRC, h), 'utf8').match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
        items.push({ label: t ? core.plainText(t).replace(/^CSI Microscopy\s*[—–-]\s*/, '').replace(/\s*[—–|-]\s*CSI Microscopy$/, '') : humanise(h.replace(/\.html?$/i, '')), href: h });
    }
    return items;
}
const MENU = Array.isArray(site.menu) && site.menu.length ? site.menu : defaultMenu();
// Repo-relative target of a menu href ("./" → "", "manuals/" → "manuals/"), or null if external
function menuTarget(href) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) {
        const pre = SITE + REPO + '/';
        return href.startsWith(pre) ? href.slice(pre.length) : null;
    }
    if (href.startsWith('/')) return href.startsWith('/' + REPO + '/') ? href.slice(REPO.length + 2) : null;
    const u = new URL(href, 'https://repo.invalid/r/');
    return u.origin === 'https://repo.invalid' && u.pathname.startsWith('/r/') ? u.pathname.slice(3) : null;
}
for (const it of MENU) {
    const t = menuTarget(String(it.href || ''));
    if (t === null) continue;
    const dec = safeDecode(t);
    if (!(dec === '' ? hasOut('index.html') : dec.endsWith('/') ? hasOut(dec + 'index.html') : hasOut(dec))) {
        warn('menu', `site.json menu "${it.label}" → ${it.href}: no such page in the output`);
    }
}
function subnavHtml(out, rootHref) {
    const here = out.replace(/(^|\/)index\.html$/, '$1');
    const lis = MENU.map(it => {
        const t = menuTarget(String(it.href || ''));
        let href = String(it.href || '');
        let current = false;
        if (t !== null) {
            href = rootHref === null ? core.relFrom(dirOf(out), t) : rootHref + t;
            current = safeDecode(t) === here;
        }
        const ext = t === null && /^https?:/i.test(href) && !href.startsWith(SITE) ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${escHtml(href)}"${current ? ' class="active" aria-current="page"' : ''}${ext}>${escHtml(it.label || '')}</a>`;
    });
    return `            <nav class="subnav" aria-label="${escHtml(SHORT)}">\n                <span class="subnav-name">${escHtml(SHORT)}</span>\n                `
        + lis.join('\n                ') + '\n            </nav>';
}

// Breadcrumb: Home › Guides › <Instrument> › <Document>; plus BreadcrumbList JSON-LD
function breadcrumb(out, docTitle, rootHref) {
    const relRoot = rootHref === null ? (relRootOf(out) || './') : rootHref;
    const trail = [
        { name: 'Home', href: SITE, abs: SITE },
        { name: 'Guides', href: SITE + '#startup-shutdown-guides', abs: SITE + '#startup-shutdown-guides' },
        { name: SHORT, href: relRoot, abs: SITE + REPO + '/' },
    ];
    if (docTitle) trail.push({ name: docTitle, href: null, abs: canonicalOf(out.replace(/(^|\/)index\.html$/, '$1')) });
    const last = trail.length - 1;
    const lis = trail.map((c, i) => i === last
        ? `                    <li><span aria-current="page">${escHtml(c.name)}</span></li>`
        : `                    <li><a href="${escHtml(c.href)}">${escHtml(c.name)}</a></li>`);
    const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.abs })) };
    return { html: lis.join('\n'), jsonLd: `    <script type="application/ld+json">${jsonScript(ld)}</script>` };
}

// Inline compatibility script for every built page (runs before first paint):
//   ?path=X/readme.md → X/   ?path=X.md → X.html   (".." refused; #hash kept)
//   ?title=<known value> → the document/anchor it named
//   any other query → removed from the address bar
const titleTable = {};
const titleCandidates = Object.assign({}, KNOWN_TITLES[REPO] || {}, site.titles || {});
for (const [t, cands] of Object.entries(titleCandidates)) {
    for (const c of [].concat(cands)) {
        const [p, h] = String(c).split('#');
        const dec = safeDecode(p);
        const exists = dec === '' ? hasOut('index.html') : dec.endsWith('/') ? hasOut(dec + 'index.html') : hasOut(dec);
        let anchorOk = true;
        if (h && exists) {
            const pg = pages.find(x => x.out === (dec === '' || dec.endsWith('/') ? dec + 'index.html' : dec));
            anchorOk = !pg || pg.html.includes(` id="${h}"`);
        }
        if (exists && anchorOk) { titleTable[t.trim().toLowerCase()] = encPath(dec) + (h ? '#' + h : ''); break; }
    }
}
function compatScript(out) {
    const R = relRootOf(out);
    return `
        (function () {
            var R = ${JSON.stringify(R)}, T = ${jsonScript(titleTable)};
            var l = window.location, q = new URLSearchParams(l.search), to = null;
            if (!l.search) return;
            var p = q.get('path'), t = (q.get('title') || '').replace(/^\\s+|\\s+$/g, '').toLowerCase();
            if (p) {
                var s = p.split('/').filter(function (x) { return x !== '' && x !== '.'; });
                if (s.length && !/\\\\|^[a-z][a-z0-9+.-]*:|[\\u0000-\\u001f]/i.test(p) && s.indexOf('..') < 0)
                    to = R + s.join('/').replace(/(^|\\/)readme\\.md$/i, '$1').replace(/\\.md$/i, '.html').split('/').map(encodeURIComponent).join('/');
            } else if (t && Object.prototype.hasOwnProperty.call(T, t)) to = R + T[t];
            if (to !== null) {
                if (to.indexOf('#') < 0 || l.hash) to = to.split('#')[0] + l.hash;
                document.documentElement.style.visibility = 'hidden';
                l.replace(to.charAt(0) === '#' ? './' + to : to || './');
            } else if (window.history && history.replaceState) history.replaceState(null, '', l.pathname + l.hash);
        })();
    `;
}

const MERMAID = `    <script>
        // Mermaid diagrams: loaded only on pages that have one; re-rendered on theme change
        (function () {
            var blocks = [].slice.call(document.querySelectorAll('.mermaid-block'));
            if (!blocks.length) return;
            var root = document.documentElement, ready = null;
            function load() {
                return ready || (ready = new Promise(function (resolve, reject) {
                    if (window.mermaid) return resolve(window.mermaid);
                    var s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';
                    s.onload = function () { resolve(window.mermaid); };
                    s.onerror = function () { reject(new Error('mermaid failed to load')); };
                    document.head.appendChild(s);
                }));
            }
            var esc = function (s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
            async function render() {
                var mermaid;
                try { mermaid = await load(); } catch (e) { return; }   // leave the source visible
                var dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
                mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict' });
                for (var i = 0; i < blocks.length; i++) {
                    var src = blocks[i].dataset.src;
                    try { blocks[i].innerHTML = (await mermaid.render('mmd-' + Date.now() + '-' + i, src)).svg; blocks[i].classList.add('is-rendered'); }
                    catch (e) { blocks[i].innerHTML = '<pre><code>' + esc(src) + '</code></pre>'; }
                }
            }
            var y = window.scrollY;
            render().then(function () {
                var el = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
                if (el && Math.abs(window.scrollY - y) < 2) el.scrollIntoView();
            });
            var tg = document.getElementById('theme-toggle');
            if (tg) tg.addEventListener('click', function () { render(); });
        })();
    </script>`;

function footerLinks(srcPath) {
    const gh = `https://github.com/${ORG}/${REPO}`;
    const links = srcPath
        ? [[`${gh}/blob/${BRANCH}/${encPath(srcPath)}`, '<i class="fa-brands fa-github" aria-hidden="true"></i> Source on GitHub'],
           [`${gh}/edit/${BRANCH}/${encPath(srcPath)}`, '<i class="fa-solid fa-pen" aria-hidden="true"></i> Edit this page']]
        : [[gh, '<i class="fa-brands fa-github" aria-hidden="true"></i> Source on GitHub']];
    return links.map(([h, t]) => `                <a href="${escHtml(h)}" target="_blank" rel="noopener">${t}</a>`)
        .concat([`                <a href="${SITE}#contact">Contact</a>`]).join('\n');
}

function pageHtml(p) {
    const docTitle = p.urlPath === '' ? null : p.title;
    const bc = breadcrumb(p.out, docTitle, null);
    const canonical = canonicalOf(p.urlPath);
    let description = p.description || `${p.title} — ${NAME} guide from the Faculty of Agriculture CSI Microscopy unit.`;
    if (description.length > 200) description = description.slice(0, 199).replace(/\s+\S*$/, '') + '…';
    const headMeta = [
        `    <link rel="canonical" href="${escHtml(canonical)}">`,
        `    <meta property="og:type" content="article">`,
        `    <meta property="og:site_name" content="CSI Microscopy">`,
        `    <meta property="og:title" content="${escHtml(p.title)}">`,
        `    <meta property="og:description" content="${escHtml(description)}">`,
        `    <meta property="og:url" content="${escHtml(canonical)}">`,
    ].join('\n');
    // An H1 shown as the page title keeps its own id as an anchor inside it
    const anchor = p.h1Removed && p.h1Id ? `<span id="${escHtml(p.h1Id)}"></span>` : '';
    const content = `            <h1 id="guide-title">${anchor}${escHtml(p.title)}</h1>\n            <div id="markdown-body">\n${p.html}\n            </div>`;
    return withNavbar(fill(TEMPLATE, {
        pageTitle: escHtml(`CSI Microscopy — ${p.title}`),
        description: escHtml(description),
        headMeta,
        earlyScript: compatScript(p.out),
        root: relRootOf(p.out),
        jsonLd: bc.jsonLd,
        breadcrumb: bc.html,
        subnav: subnavHtml(p.out, null),
        content,
        footerLinks: footerLinks(p.src),
        bodyEnd: p.hasMermaid ? MERMAID : '',
    }));
}

// Generated 404.html: GitHub Pages serves it, at any depth, for every missing
// path under /<Repo>/, so all its URLs are root-relative. Redirects (before
// first paint, keeping ?query and #hash; only ever within /<Repo>/):
//   */readme.md, */README.md      → that folder
//   x.md                          → x.html
//   manuals, Manuals/, x/index.html, wrong case of any published path
//                                 → the published path
function notFoundHtml() {
    const ROOT = '/' + REPO + '/';
    const map = {};
    for (const o of [...outSet.keys()].sort()) {
        if (o === '404.html') continue;
        const k = o.toLowerCase();
        if (k in map) { if (map[k] !== o) warn('case', `${o} and ${map[k]} differ only in case; the 404 page redirects to ${map[k]}`); continue; }
        map[k] = o;
    }
    const early = `
        (function () {
            var REPO = ${JSON.stringify(REPO)}, ROOT = '/' + REPO + '/';
            var FILES = ${jsonScript(map)};
            function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
            function has(k) { return Object.prototype.hasOwnProperty.call(FILES, k); }
            // Returns the path to redirect to, or null
            function target(pathname) {
                var segs = String(pathname || '').split('/').slice(1);
                if (!segs.length || dec(segs[0]).toLowerCase() !== REPO.toLowerCase()) return null;
                var rest = segs.slice(1).map(dec), i;
                for (i = 0; i < rest.length; i++) if (rest[i] === '.' || rest[i] === '..' || /[\\/\\\\]/.test(rest[i])) return null;
                var lc = rest.join('/').toLowerCase(), c = [lc];
                if (/(^|\\/)readme\\.md$/.test(lc)) c.push(lc.replace(/readme\\.md$/, '') + 'index.html');
                else if (/\\.md$/.test(lc)) c.push(lc.replace(/\\.md$/, '.html'));
                if (/(^|\\/)index\\.html?$/.test(lc)) c.push(lc.replace(/index\\.html?$/, '') + 'index.html');
                else if (lc === '' || /\\/$/.test(lc)) c.push(lc + 'index.html');
                else c.push(lc + '/index.html', lc + '.html');
                for (i = 0; i < c.length; i++) if (has(c[i])) {
                    var t = ROOT + FILES[c[i]].replace(/(^|\\/)index\\.html$/, '$1').split('/').map(encodeURIComponent).join('/');
                    return dec(t) === dec(pathname) ? null : t;
                }
                return null;
            }
            window.csiNotFoundTarget = target;
            var l = window.location, t = target(l.pathname);
            if (t) {
                document.documentElement.style.visibility = 'hidden';
                l.replace(t + l.search + l.hash);
            }
        })();
    `;
    const bc = breadcrumb('404.html', 'Page not found', ROOT);
    const content = `            <span class="eyebrow">Error 404</span>
            <h1 id="guide-title">Page not found</h1>
            <div id="markdown-body">
                <p>There is no page at this address in the ${escHtml(NAME)} guide. It may have moved, or the link may have a typo.</p>
                <p class="nf-path"><code id="nf-path"></code></p>
            </div>
            <div class="hero-actions">
                <a class="btn btn-primary" href="${escHtml(ROOT)}"><i class="fa-solid fa-book" aria-hidden="true"></i> ${escHtml(SHORT)} guide</a>
                <a class="btn" href="${SITE}"><i class="fa-solid fa-house" aria-hidden="true"></i> CSI Microscopy home</a>
                <a class="btn" href="${SITE}#contact"><i class="fa-solid fa-envelope" aria-hidden="true"></i> Contact the unit</a>
            </div>`;
    return withNavbar(fill(TEMPLATE, {
        pageTitle: escHtml(`Page not found — ${NAME} — CSI Microscopy`),
        description: escHtml(`Page not found — ${NAME}, Faculty of Agriculture CSI Microscopy.`),
        headMeta: '    <meta name="robots" content="noindex">',
        earlyScript: early,
        root: ROOT,
        jsonLd: '',
        breadcrumb: bc.html,
        subnav: subnavHtml('404.html', ROOT),
        content,
        footerLinks: footerLinks(null),
        bodyEnd: `    <script>document.getElementById('nf-path').textContent = decodeURI(location.pathname);</script>`,
    }));
}

// ── Write ───────────────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
let bytes = 0;
for (const f of copies) {
    const to = path.join(OUT, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(SRC, f), to);
    bytes += fs.statSync(to).size;
}
for (const [out, from] of Object.entries(GENERATED_ASSETS)) write(out, fs.readFileSync(from));
const outputs = {};
for (const p of pages) { outputs[p.out] = pageHtml(p); write(p.out, outputs[p.out]); }
outputs['404.html'] = notFoundHtml();
write('404.html', outputs['404.html']);
write('.nojekyll', '');

// ── Internal link check over the output ─────────────────────────────────────
const idCache = new Map();
function idsOf(rel) {
    if (!idCache.has(rel)) {
        const html = outputs[rel] || (fs.existsSync(path.join(OUT, rel)) ? fs.readFileSync(path.join(OUT, rel), 'utf8') : '');
        idCache.set(rel, new Set([...html.matchAll(/\s(?:id|name)\s*=\s*["']([^"']+)["']/g)].map(m => core.decodeEntities(m[1]))));
    }
    return idCache.get(rel);
}
const checked = { links: 0, missing: 0 };
const checkPages = [...pages.map(p => p.out), ...handHtml];
for (const page of checkPages) {
    const html = outputs[page] || fs.readFileSync(path.join(OUT, page), 'utf8');
    // Pages live under /R/ here, so a link that climbs out of the repo
    // (e.g. "../" to the home site) is recognised and not checked
    const pageUrl = new URL('https://out.invalid/R/' + encPath(page));
    const seen = new Set();
    for (const m of html.matchAll(/<(a|img|link|script|source|iframe)\b[^>]*?\s(href|src)\s*=\s*(["'])(.*?)\3/gi)) {
        const tag = m[1].toLowerCase();
        const raw = core.decodeEntities(m[4]).trim();
        if (!raw || /^(data|mailto|tel|javascript):/i.test(raw)) continue;
        let abs = null;
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw)) {
            if (!raw.startsWith(SITE + REPO + '/') && !raw.startsWith(SITE.replace(/^https?:/, '') + REPO + '/')) continue;   // other site
            abs = new URL(raw.replace(/^(https?:)?\/\/csi-microscopy\.github\.io\/[^/]+\//, 'https://out.invalid/R/'));
        } else if (raw.startsWith('/')) {
            if (!raw.startsWith('/' + REPO + '/')) continue;
            abs = new URL(raw.slice(REPO.length + 1), 'https://out.invalid/R/');
        } else {
            try { abs = new URL(raw, pageUrl); } catch (_) { warn('bad-url', `${page}: ${raw}`); continue; }
            if (abs.origin !== 'https://out.invalid' || !abs.pathname.startsWith('/R/')) continue;   // leaves the repo's site
        }
        const key = tag + ' ' + abs.pathname + abs.hash;
        if (seen.has(key)) continue;
        seen.add(key);
        checked.links++;
        let target = safeDecode(abs.pathname.slice(3));
        if (target === '' || target.endsWith('/')) target += 'index.html';
        const kind = tag === 'img' || tag === 'source' ? 'missing-image' : 'missing-link';
        if (!hasOut(target)) { checked.missing++; warn(kind, `${page}: ${raw}`); continue; }
        if (abs.hash.length > 1 && /\.html?$/i.test(target)) {
            const id = safeDecode(abs.hash.slice(1));
            if (!idsOf(target).has(id)) { checked.missing++; warn('missing-anchor', `${page}: ${raw} (no id "${id}" in ${target})`); }
        }
    }
}

// ── Report ──────────────────────────────────────────────────────────────────
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const lines = [];
lines.push(`build-docs: ${REPO} (branch ${BRANCH}) ${SRC} -> ${OUT}`);
lines.push(`  site: "${NAME}" (short "${SHORT}"), ${siteFile ? 'site.json ' + siteFile : 'no site.json (defaults)'}; md-core ${core.VERSION}, marked ${require('marked/package.json').version}`);
lines.push(`  pages generated (${pages.length}):`);
for (const p of pages) lines.push(`    ${p.src} -> ${p.out}  "${p.title}"${p.hasMermaid ? ' [mermaid]' : ''}`);
lines.push(`  hand-written HTML copied (${handHtml.length}): ${handHtml.join(', ') || '-'}`);
lines.push(`  files copied: ${copies.length} (${mb(bytes)})`);
lines.push(`  generated: 404.html (${outSet.size - 1} paths in its redirect table), ${Object.keys(GENERATED_ASSETS).join(', ')}, .nojekyll`);
lines.push(`  menu: ${MENU.map(i => `${i.label} -> ${i.href}`).join(' · ')}`);
lines.push(`  ?title= redirects: ${Object.keys(titleTable).length ? Object.entries(titleTable).map(([k, v]) => `"${k}" -> ${v || './'}`).join(', ') : '-'}`);
if (ignored.length) lines.push(`  ignored: ${ignored.join('; ')}`);
if (skipped.length) lines.push(`  excluded: ${skipped.join('; ')}`);
lines.push(`  internal link check: ${checked.links} links/images/anchors checked, ${checked.missing} missing`);
lines.push(`  warnings (${warnings.length}):`);
for (const w of warnings) lines.push(`    [${w.kind}] ${w.msg}`);
console.log(lines.join('\n'));
if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({
        repo: REPO, branch: BRANCH, name: NAME, short: SHORT,
        pages: pages.map(p => ({ src: p.src, out: p.out, urlPath: p.urlPath, title: p.title, h1Removed: p.h1Removed, hasMermaid: p.hasMermaid })),
        handHtml, copies, outputs: [...outSet.keys()].sort(), titleTable, menu: MENU, warnings, checked,
    }, null, 1));
}
if (args.strict && warnings.some(w => /^missing-/.test(w.kind))) process.exit(1);
