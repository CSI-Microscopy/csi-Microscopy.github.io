#!/usr/bin/env node
/*
 * Tests for guides/md-core.js and the static build (run in CI by
 * .github/workflows/check-render-bundle.yml):  node tools/build-docs/test.js
 * Builds test/_fixture (one of every link form) into a temporary folder and
 * checks the pages, the link rules, the inline ?path=/?title= script and the
 * generated 404.html redirects.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');

const HOME = path.resolve(__dirname, '../..');
const core = require(path.join(HOME, 'guides/md-core.js'));
const S = core.SITE;
let passes = 0, fails = 0;
const ok = (cond, msg, extra) => {
    if (cond) passes++;
    else { fails++; console.log('  FAIL', msg, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); }
};
const eq = (a, b, msg) => ok(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// ── md-core ─────────────────────────────────────────────────────────────────
console.log('== md-core');
for (const b of ['main', 'master', 'feature/x', 'heads/main']) ok(core.validBranch(b), `branch ${b} accepted`);
for (const b of ['refs/pull/1/head', 'pull/1/head', '7044a8', '0123456789abcdef0123456789abcdef01234567', 'a/../b', '.', 'a b']) ok(!core.validBranch(b), `branch ${b} refused`);
for (const p of ['../x', 'a/../../b', '%2e%2e/x', '/etc/passwd', 'https://x/y.md', 'a\\b']) eq(core.cleanPath(p), null, `cleanPath ${p}`);
eq(core.cleanPath('./manuals/./readme.md'), 'manuals/readme.md', 'cleanPath normalises ./');
eq(core.docUrlPath('README.md'), '', 'docUrlPath README.md');
eq(core.docUrlPath('manuals/readme.md'), 'manuals/', 'docUrlPath manuals/readme.md');
eq(core.docUrlPath('docs/x.md'), 'docs/x.html', 'docUrlPath x.md');
eq(core.docUrlPath('a.pdf'), 'a.pdf', 'docUrlPath other');
eq(core.canonicalRepo('skyscan-1272-MICROCT'), 'Skyscan-1272-MicroCT', 'canonicalRepo');
eq(core.relFrom('', ''), './', 'relFrom root→root');
eq(core.relFrom('manuals/', ''), '../', 'relFrom manuals→root');
eq(core.relFrom('manuals/', 'manuals/x.pdf'), 'x.pdf', 'relFrom same dir');
eq(core.relFrom('a/b/', 'a/c/d.png'), '../c/d.png', 'relFrom sibling dir');
eq(core.relFrom('', 'docs/sub/'), 'docs/sub/', 'relFrom folder');
eq(core.BUILT_REPOS.length, 0, 'BUILT_REPOS is empty until a repo is switched to the build');
eq(core.builtUrl('Skyscan-1272-MicroCT', 'main', 'manuals/readme.md'), null, 'builtUrl: not built yet');
core.BUILT_REPOS.push('Skyscan-1272-MicroCT');
eq(core.builtUrl('skyscan-1272-microct', 'main', 'manuals/readme.md'), S + 'Skyscan-1272-MicroCT/manuals/', 'builtUrl: built repo, published branch');
eq(core.builtUrl('Skyscan-1272-MicroCT', 'main', 'docs/a b.md'), S + 'Skyscan-1272-MicroCT/docs/a%20b.html', 'builtUrl: .md → .html, encoded');
eq(core.builtUrl('Skyscan-1272-MicroCT', 'feature-x', 'README.md'), null, 'builtUrl: other branch → preview');
eq(core.builtUrl('Skyscan-1272-MicroCT', 'main', '../x.md'), null, 'builtUrl: .. refused');
{
    const l = core.makeLinker({ repo: 'Stellaris-STED-Confocal', branch: 'main', mdPath: 'README.md', defaultPath: 'README.md', onRepoPage: true });
    eq(l.rewriteLink('https://github.com/CSI-Microscopy/Skyscan-1272-MicroCT/blob/main/manuals/readme.md', 'x').href, S + 'Skyscan-1272-MicroCT/manuals/', 'browser link to a built repo → clean URL');
}
core.BUILT_REPOS.pop();
eq(core.findOldOrg('see ![x](https://github.com/Faculty-of-Agriculture-CSI-Microscopy/R/assets/1/a) and https://github.com/CSI-Microscopy/Stellaris-STED/x').length, 2, 'findOldOrg finds both forms');
{
    // browser mode (render.js): the Phase 0 rules
    const l = core.makeLinker({ repo: 'Skyscan-1272-MicroCT', branch: 'main', mdPath: 'docs/test.md', defaultPath: 'README.md', onRepoPage: true });
    eq(l.rewriteLink('b.md#sec', 'b').href, S + 'Skyscan-1272-MicroCT/?path=docs/b.md#sec', 'browser: md → ?path=');
    eq(l.rewriteLink('sub/x%20y.pdf#page=3', 'x').href, S + 'Skyscan-1272-MicroCT/docs/sub/x%20y.pdf#page=3', 'browser: pdf → Pages URL');
    eq(l.resolveAsset('img/d.png'), 'https://raw.githubusercontent.com/CSI-Microscopy/Skyscan-1272-MicroCT/main/docs/img/d.png', 'browser: image → raw');
    eq(l.rewriteLink('java\tscript:alert(1)', 'x').href, '#', 'browser: javascript: → #');
}

// ── Build the fixture ───────────────────────────────────────────────────────
console.log('== build test/_fixture');
const FIX = path.join(__dirname, 'test/_fixture');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-docs-test-'));
const OUT = path.join(tmp, 'Test-Repo');
const JSON_OUT = path.join(tmp, 'report.json');
const BUILD = path.join(__dirname, 'build.js');
const stdout = execFileSync(process.execPath, [BUILD, '--repo', 'Test-Repo', '--src', FIX, '--out', OUT, '--branch', 'main', '--json', JSON_OUT], { encoding: 'utf8' });
const rep = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
const read = rel => fs.readFileSync(path.join(OUT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(OUT, rel));

ok(/pages generated \(4\)/.test(stdout) && /internal link check/.test(stdout), 'build report printed', stdout.slice(0, 200));
eq(JSON.stringify(rep.pages.map(p => [p.src, p.out]).sort()), JSON.stringify([
    ['README.md', 'index.html'], ['docs/guide.md', 'docs/guide.html'], ['docs/sub/readme.md', 'docs/sub/index.html'], ['manuals/readme.md', 'manuals/index.html']]), 'Markdown → pages');
for (const f of ['page.html', 'tools/script.py', 'manuals/a b.pdf', 'assets/logo.png', '.nojekyll', '404.html',
                 'assets/styles.css', 'assets/guide.css', 'assets/site.js', 'assets/favicon.svg']) ok(exists(f), `output has ${f}`);
for (const f of ['README.md', 'docs/guide.md', 'manuals/readme.md', 'old/legacy.py', 'site.json']) ok(!exists(f), `output has no ${f}`);
ok(!/window\.GUIDE/.test(read('index.html')), 'shim index.html replaced by the generated page');
ok(!/old 404/.test(read('404.html')), 'old 404.html replaced');
eq(fs.readFileSync(path.join(OUT, 'assets/styles.css'), 'utf8'), fs.readFileSync(path.join(HOME, 'styles.css'), 'utf8'), 'styles.css copied from the home repo');

const idx = read('index.html');
const hrefs = [...idx.split('id="markdown-body"')[1].split('</section>')[0].matchAll(/<(a|img)\b([^>]*)>/g)].map(m => {
    const v = (m[2].match(/\b(?:href|src)="([^"]*)"/) || [])[1];
    return [m[1], core.decodeEntities(v), /target="_blank"/.test(m[2])];
});
const want = [
    ['a', 'manuals/', false], ['a', 'manuals/#pdfs', false],
    ['a', 'docs/guide.html#setup', false], ['a', 'docs/guide.html', false],
    ['a', 'manuals/a%20b.pdf', true], ['a', 'manuals/a%20b.pdf#page=2', true],
    ['a', 'page.html#part', false], ['a', 'docs/guide.html', false],
    ['a', 'docs/sub/', false], ['a', 'https://github.com/CSI-Microscopy/Test-Repo/tree/main/assets/', true],
    ['a', S + 'Stellaris-STED-Confocal/', false], ['a', S + 'Skyscan-1272-MicroCT/?path=manuals/readme.md', false],
    ['a', 'https://example.org', true], ['a', 'mailto:a@b.c', false], ['a', '#', false],
    ['img', 'assets/logo.png', false], ['img', 'https://github.com/CSI-Microscopy/Test-Repo/assets/1/abc', false],
];
eq(hrefs.length, want.length, 'README link count');
want.forEach((w, i) => ok(JSON.stringify(hrefs[i]) === JSON.stringify(w), `README link ${i}: ${w.join(' ')}`, hrefs[i]));
ok(/<div class="callout callout-note"><strong>Note:<\/strong> A note\.<\/div>/.test(idx), 'callout rendered');
ok(idx.includes('<title>CSI Microscopy — Test Instrument</title>') && idx.includes('<h1 id="guide-title">Test Instrument</h1>') && /<h1 id="test-instrument">/.test(idx), 'root: site.json name as title, README H1 kept');
ok(idx.includes('<link rel="canonical" href="https://csi-microscopy.github.io/Test-Repo/">'), 'root canonical');
ok(idx.includes('<meta name="description" content="Fixture for tools/build-docs/test.js: one of every link form the build rewrites.">'), 'meta description = first paragraph');
ok(!/mermaid/.test(idx), 'no Mermaid on a page without a diagram');
ok(/<a class="brand" href="https:\/\/csi-microscopy\.github\.io\/">/.test(idx) && /id="theme-toggle"/.test(idx) && /id="nav-toggle"/.test(idx), 'shared header');
ok(/class="subnav"[\s\S]*href="\.\/" class="active" aria-current="page">Guide<[\s\S]*href="manuals\/">Manuals<[\s\S]*href="page.html">Explainer</.test(idx), 'sub-menu from site.json, current page marked');

const guide = read('docs/guide.html');
ok(guide.includes('<title>CSI Microscopy — Setup guide</title>') && guide.includes('<h1 id="guide-title"><span id="setup-guide"></span>Setup guide</h1>') && !/<h1 id="setup-guide">/.test(guide), 'sub-page: H1 is the title, its id kept as an anchor');
ok(/href="\.\.\/"[^>]*>start</.test(guide) && /href="\.\.\/manuals\/#pdfs">manuals</.test(guide) && /src="img\/none\.png"/.test(guide), 'sub-page relative links');
ok(/mermaid\.min\.js/.test(guide) && /class="mermaid-block"/.test(guide), 'Mermaid loaded on the page with a diagram');
const ld = JSON.parse(guide.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
eq(ld.itemListElement.map(i => i.name).join(' › '), 'Home › Guides › Test › Setup guide', 'BreadcrumbList');
ok(/<a href="\.\.\/">Test<\/a>/.test(guide) && /<span aria-current="page">Setup guide<\/span>/.test(guide), 'breadcrumb links');
ok(/href="https:\/\/github\.com\/CSI-Microscopy\/Test-Repo\/edit\/main\/docs\/guide\.md"/.test(guide) && /blob\/main\/docs\/guide\.md/.test(guide), 'Source / Edit links');
ok(/href="\.\.\/manuals\/">Manuals</.test(guide), 'sub-menu links relative to the page');
ok(/<h2 id="café-beta">Café™ \(beta\)<\/h2>/.test(read('docs/sub/index.html')), 'heading ids as on GitHub (symbols dropped)');

const kinds = rep.warnings.map(w => w.kind + ' ' + w.msg);
ok(kinds.some(k => /^old-org README\.md: https:\/\/github\.com\/Faculty-of-Agriculture/.test(k)), 'old-org URL warned', kinds);
ok(kinds.some(k => /^missing-link docs\/guide\.html: nope\.html/.test(k)), 'missing page warned', kinds);
ok(kinds.some(k => /^missing-image docs\/guide\.html: img\/none\.png/.test(k)), 'missing image warned', kinds);
eq(rep.warnings.filter(w => /^missing-/.test(w.kind)).length, 2, 'no other missing targets (anchors #setup, #pdfs, #part, #sub-folder resolve)');
eq(spawnSync(process.execPath, [BUILD, '--repo', 'Test-Repo', '--src', FIX, '--out', path.join(tmp, 'strict'), '--strict']).status, 1, '--strict fails on missing targets');

// ── Inline compatibility script (old ?path= / ?title= links) ───────────────
console.log('== inline ?path= / ?title= script');
function runEarly(html, pathname, search, hash) {
    const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const res = { replaced: null, state: null };
    const location = { pathname, search, hash, replace: t => { res.replaced = t; } };
    const ctx = { window: { location, history: null }, location, URLSearchParams, document: { documentElement: { style: {} } } };
    ctx.history = { replaceState: (a, b, u) => { res.state = u; } };
    ctx.window.history = ctx.history;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return res;
}
const R = '/Test-Repo/';
const cases = [
    ['index.html', R, '?path=manuals/readme.md&title=Skyscan%201272%20Manuals', '', { replaced: 'manuals/' }],
    ['index.html', R, '?path=manuals/README.md', '#pdfs', { replaced: 'manuals/#pdfs' }],
    ['index.html', R, '?path=docs/guide.md', '', { replaced: 'docs/guide.html' }],
    ['index.html', R, '?path=./docs//sub/readme.md', '', { replaced: 'docs/sub/' }],
    ['index.html', R, '?path=README.md', '', { replaced: './' }],
    ['index.html', R, '?path=manuals/a%20b.pdf', '', { replaced: 'manuals/a%20b.pdf' }],
    ['index.html', R, '?path=../../x/y.md', '#h', { state: R + '#h' }],
    ['index.html', R, '?path=%2e%2e/x.md', '', { state: R }],
    ['index.html', R, '?path=https://evil.example/x.md', '', { state: R }],
    ['index.html', R, '?title=Test%20Setup', '', { replaced: 'docs/guide.html#setup' }],
    ['index.html', R, '?title=test%20setup', '#other', { replaced: 'docs/guide.html#other' }],
    ['index.html', R, '?title=Unknown', '#x', { state: R + '#x' }],
    ['index.html', R, '', '#x', {}],
    ['docs/guide.html', R + 'docs/guide.html', '?path=README.md', '', { replaced: '../' }],
    ['docs/guide.html', R + 'docs/guide.html', '?utm=1', '', { state: R + 'docs/guide.html' }],
];
for (const [file, pn, qs, h, w] of cases) {
    const r = runEarly(read(file), pn, qs, h);
    ok((r.replaced || null) === (w.replaced || null) && (r.state || null) === (w.state || null), `${pn}${qs}${h} → ${JSON.stringify(w)}`, r);
}

// ── Generated 404.html ──────────────────────────────────────────────────────
console.log('== 404.html redirects');
const nf = read('404.html');
const nfCases = [
    ['/Test-Repo/README.md', '/Test-Repo/'], ['/Test-Repo/readme.md', '/Test-Repo/'],
    ['/Test-Repo/manuals/readme.md', '/Test-Repo/manuals/'], ['/Test-Repo/Manuals', '/Test-Repo/manuals/'],
    ['/Test-Repo/MANUALS/', '/Test-Repo/manuals/'], ['/Test-Repo/manuals/index.htm', '/Test-Repo/manuals/'],
    ['/Test-Repo/docs/guide.md', '/Test-Repo/docs/guide.html'], ['/Test-Repo/docs/guide', '/Test-Repo/docs/guide.html'],
    ['/Test-Repo/PAGE.HTML', '/Test-Repo/page.html'], ['/Test-Repo/manuals/A%20B.pdf', '/Test-Repo/manuals/a%20b.pdf'],
    ['/test-repo/docs/sub/README.md', '/Test-Repo/docs/sub/'],
    ['/Test-Repo/nope', null], ['/Test-Repo/', null], ['/Test-Repo/page.html', null],
    ['/Test-Repo/%2e%2e/README.md', null], ['/Test-Repo/a%2Fb/readme.md', null], ['/Other/readme.md', null], ['//evil.example/README.md', null],
];
for (const [from, want] of nfCases) {
    const r = runEarly(nf, from, '', '#h');
    const got = r.replaced;
    const w = want === null ? null : want + '#h';
    ok(got === w && (got === null || got.startsWith('/Test-Repo/')), `404 ${from} → ${want}`, got);
}
ok(nf.includes('<meta name="robots" content="noindex">') && nf.includes('href="/Test-Repo/assets/styles.css"'), '404: noindex, root-relative assets');

// ── Bundle ──────────────────────────────────────────────────────────────────
console.log('== guides/render.js bundle');
eq(spawnSync(process.execPath, [path.join(__dirname, 'bundle-render.js'), '--check']).status, 0, 'guides/render.js is up to date');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
