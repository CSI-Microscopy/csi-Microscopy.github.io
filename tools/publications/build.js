#!/usr/bin/env node
/*
 * Builds the generated parts of publications.html (publication list, gallery,
 * image credits, counts, JSON-LD) and the Publications teaser on index.html
 * from:
 *   assets/publications/publications.json  the publication data (one entry per paper)
 *   tools/publications/gallery.json        editorial data: scope, technique groups,
 *                                          exclusions, one-sentence figure descriptions
 *
 * Generated blocks sit between <!-- pub:NAME --> and <!-- /pub:NAME --> comments;
 * everything outside them is hand-written and left alone. Node 18+, no dependencies.
 *
 *   node tools/publications/build.js                 rebuild the pages
 *   node tools/publications/build.js --check         exit 1 if the pages are out of date
 *   node tools/publications/build.js --import DIR    first copy DIR/publications.json into
 *        assets/publications/ (figure paths rewritten to assets/publications/figures/<file>)
 *        and copy the gallery figures from DIR/figs/ (or the figure's own path under DIR),
 *        removing figure files the gallery no longer uses; then rebuild.
 *
 * Gallery rules (the site owner's): a figure is shown only if its paper is in scope
 * (in_scope, or year >= gallery.json minYear when the field is absent), has
 * provenance.status "confirmed", is licensed CC BY or CC BY-NC (any version, not ND
 * or SA), is not excluded in gallery.json, and has a gallery.json entry with a
 * description. The publication list shows every in-scope entry; errata are merged
 * into their parent paper as a note, conference abstracts get their own sub-list.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'assets', 'publications', 'publications.json');
const FIG_DIR = path.join(ROOT, 'assets', 'publications', 'figures');
const FIG_URL = 'assets/publications/figures/';
const GALLERY = path.join(__dirname, 'gallery.json');
const PAGE = path.join(ROOT, 'publications.html');
const INDEX = path.join(ROOT, 'index.html');
const SITE = 'https://csi-microscopy.github.io/';

const STAFF = [
    { name: 'Einat Zelinger', surname: 'Zelinger', id: 'ez' },
    { name: 'Tally Kossovsky', surname: 'Kossovsky', id: 'tk' },
    { name: 'Daniel Waiger', surname: 'Waiger', id: 'dw' },
];
const FIELD_LABELS = {
    'plant science': 'Plant science', 'entomology': 'Entomology', 'biochemistry': 'Biochemistry',
    'veterinary/animal': 'Veterinary and animal science', 'food science': 'Food science',
    'soil/environment': 'Soil and environment', 'methods': 'Methods', 'other': 'Other fields',
};

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const importIdx = args.indexOf('--import');
const IMPORT = importIdx >= 0 ? args[importIdx + 1] : null;
if (importIdx >= 0 && !IMPORT) die('--import needs a directory');

const warnings = [];
const warn = m => warnings.push(m);
function die(m) { console.error('error: ' + m); process.exit(2); }

// ── Helpers ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Titles from PubMed may carry <i>, <sub>, <sup> or <b>; keep those, escape the rest.
const richTitle = s => esc(s).replace(/&lt;(\/?)(i|sub|sup|b)&gt;/g, '<$1$2>');
const plain = s => String(s ?? '').replace(/<[^>]+>/g, '');
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const doiUrl = doi => 'https://doi.org/' + doi;
const base = f => path.basename(f);
const figId = f => 'fig-' + slug(base(f).replace(/\.[a-z]+$/i, ''));
const ext = (href, text, cls) => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;

const inScope = (e, minYear) => (typeof e.in_scope === 'boolean' ? e.in_scope : Number(e.year) >= minYear);
const firstSurname = e => {
    const a = displayAuthor((e.authors || [])[0] || '');
    // PubMed style "Itzhaik Alkotzer Y": drop the trailing initials. Full names "Einat Zelinger": last word.
    const parts = a.trim().split(/\s+/);
    if (parts.length > 1 && /^[A-Z][A-Z-]{0,3}$/.test(parts[parts.length - 1])) return parts.slice(0, -1).join(' ');
    return parts[parts.length - 1];
};
// Authors are shown PubMed style, "Surname Initials". Crossref-only entries carry full names
// ("Einat Zelinger", "Vasiliy V. Rosen"); for every such entry in the data the Crossref family
// name is the last word, so the last word is taken as the surname and the rest become initials.
const PUBMED_STYLE = /^\S.* [A-Z][A-Z-]{0,3}$/;
function displayAuthor(a) {
    const name = String(a).replace(/[\u2010\u2011]/g, '-').trim();
    if (PUBMED_STYLE.test(name)) return name;
    const parts = name.split(/\s+/);
    if (parts.length < 2) return name;
    const surname = parts.pop();
    const initials = parts.map(p => p.split('-').map(x => x.replace(/[^\p{L}]/gu, '').charAt(0).toUpperCase()).join('')).join('');
    return `${surname} ${initials}`;
}
const isCcByOrByNc = lic => {
    const name = (lic && lic.name) || '';
    const url = (lic && lic.url) || '';
    return /^CC BY(-NC)? \d(\.\d)?$/.test(name) && /creativecommons\.org\/licenses\/by(-nc)?\/\d/.test(url);
};
const isNc = name => /BY-NC/.test(name || '');
const dedupeAdjacent = list => list.filter((a, i) => i === 0 || a !== list[i - 1]);

function authorsHtml(e) {
    const staff = STAFF.filter(s => (e.staff || []).includes(s.name));
    const raw = (e.authors || []).map(displayAuthor);
    const list = dedupeAdjacent(raw);
    if (list.length !== raw.length) warn(`${e.doi}: repeated author name removed from display (${raw.join(', ')})`);
    const found = new Set();
    const out = list.map(a => {
        const hit = staff.find(s => new RegExp('\\b' + s.surname + '\\b').test(a));
        if (hit) { found.add(hit.id); return `<strong>${esc(a)}</strong>`; }
        return esc(a);
    });
    staff.forEach(s => { if (!found.has(s.id)) warn(`${e.doi}: staff member ${s.name} not found in the author list`); });
    return out.join(', ');
}

function metaHtml(e) {
    let cite = '';
    if (e.volume) cite += esc(e.volume) + (e.issue ? `(${esc(e.issue)})` : '');
    if (e.pages) cite += (cite ? ':' : '') + esc(e.pages);
    const links = [];
    if (e.pmid) links.push(ext(`https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/`, 'PubMed'));
    if (e.pmcid) links.push(ext(`https://pmc.ncbi.nlm.nih.gov/articles/${e.pmcid}/`, 'PMC full text'));
    return `<i>${esc(e.journal)}</i> (${esc(e.year)})${cite ? ' ' + cite : ''}${links.length ? ' · ' + links.join(' · ') : ''}`;
}

function licenceLink(name, url, rel = true) {
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener${rel ? ' license' : ''}">${esc(name)}</a>` : esc(name);
}

// ── Load ─────────────────────────────────────────────────────────────────
const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const MIN_YEAR = gallery.minYear || 2019;
const GROUPS = gallery.groups;
const groupById = Object.fromEntries(GROUPS.map(g => [g.id, g]));

const importSrc = IMPORT ? importData(IMPORT) : null;
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
if (!Array.isArray(data)) die('publications.json must be an array');

const scoped = data.filter(e => inScope(e, MIN_YEAR));
const articles = scoped.filter(e => e.type === 'journal article');
const abstracts = scoped.filter(e => e.type === 'conference abstract');
const errata = scoped.filter(e => e.type === 'erratum');
const others = scoped.filter(e => !['journal article', 'conference abstract', 'erratum'].includes(e.type));
others.forEach(e => { warn(`${e.doi}: type "${e.type}" listed with the journal articles`); articles.push(e); });

// Errata → parent note (matched by title after "Erratum to:" / "Corrigendum to:" / "Correction to:")
const notes = new Map();
for (const er of errata) {
    const m = plain(er.title).match(/^(Erratum|Corrigendum|Correction)\s+(?:to|for)\s*:?\s*(.+)$/i);
    const target = m && plain(m[2]).trim().toLowerCase();
    const parent = target && articles.find(a => plain(a.title).trim().toLowerCase() === target);
    if (!parent) { warn(`${er.doi}: erratum without a parent in the list; shown as its own entry`); articles.push(er); continue; }
    if (!notes.has(parent)) notes.set(parent, []);
    notes.get(parent).push({ kind: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), doi: er.doi, year: er.year });
}

// Gallery selection
function galleryFigures() {
    const shown = [];
    const excludedPapers = (gallery.exclude && gallery.exclude.papers) || {};
    const excludedFigs = (gallery.exclude && gallery.exclude.figures) || {};
    const report = { excluded: [], missingEntry: [] };
    for (const e of data) {
        for (const f of e.figures || []) {
            const b = base(f.file || '');
            const why = !inScope(e, MIN_YEAR) ? 'paper out of scope'
                : e.provenance?.status !== 'confirmed' ? `provenance "${e.provenance?.status}"`
                : !isCcByOrByNc({ name: f.license || e.license?.name, url: f.license_url || e.license?.url }) ? `licence "${f.license || e.license?.name}"`
                : excludedPapers[e.doi] ? 'paper excluded: ' + excludedPapers[e.doi]
                : excludedFigs[b] ? 'figure excluded: ' + excludedFigs[b]
                : null;
            if (why) { report.excluded.push(`${b}: ${why}`); continue; }
            const entry = gallery.figures[b];
            if (!entry || !entry.description) { report.missingEntry.push(b); continue; }
            const group = entry.group || (gallery.topicGroups || {})[String(f.topic || '').toLowerCase()] || 'other';
            if (!groupById[group]) die(`${b}: unknown group "${group}"`);
            const tags = [...new Set([group, ...(entry.tags || [])])];
            tags.forEach(t => { if (!groupById[t]) die(`${b}: unknown tag "${t}"`); });
            shown.push({ e, f, b, entry, group, tags });
        }
    }
    return { shown, report };
}

function importData(dir) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, 'publications.json'), 'utf8'));
    for (const e of src) for (const f of e.figures || []) { f._src = f.file; f.file = FIG_URL + base(f.file); }
    const saved = JSON.parse(JSON.stringify(src, (k, v) => (k === '_src' ? undefined : v)));
    fs.writeFileSync(DATA, JSON.stringify(saved, null, 1) + '\n');
    console.log(`imported ${src.length} entries from ${path.join(dir, 'publications.json')}`);
    return src;
}

// ── Render: gallery ─────────────────────────────────────────────────────
const { shown, report } = galleryFigures();

if (IMPORT) {
    // Copy the figures the gallery shows; remove files it no longer uses.
    fs.mkdirSync(FIG_DIR, { recursive: true });
    const srcByBase = new Map();
    for (const e of importSrc) for (const f of e.figures || []) srcByBase.set(base(f.file), f._src);
    const keep = new Set(shown.map(s => s.b));
    for (const b of keep) {
        const cands = [path.join(IMPORT, 'figs', b), path.join(IMPORT, srcByBase.get(b) || b)];
        const from = cands.find(p => fs.existsSync(p));
        if (!from) die(`figure file not found for ${b} (looked in ${cands.join(', ')})`);
        fs.copyFileSync(from, path.join(FIG_DIR, b));
    }
    for (const b of fs.readdirSync(FIG_DIR)) if (!keep.has(b)) { fs.unlinkSync(path.join(FIG_DIR, b)); console.log('removed unused figure ' + b); }
}

function jpegSize(file) {
    // Width and height from a JPEG or PNG header, so <img> gets width/height attributes.
    const buf = fs.readFileSync(file);
    if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + len;
    }
    return null;
}

const paperLabel = e => `${esc(firstSurname(e))} et al., <i>${esc(e.journal)}</i> (${esc(e.year)})`;
const figLabel = f => `Figure ${esc(f.figure_number)}`;
function changeNote(f) {
    const n = f.notes || '';
    const out = [];
    // Only explicit statements count: "stacked" in the notes, and cropped: true on the figure
    // (notes such as "histology crops" describe panels, not a crop of the figure).
    if (/\bstacked\b/i.test(n)) out.push('The publisher split this figure into two image files; they are stacked here, one above the other, without cropping.');
    if (f.cropped === true) out.push('Cropped.');
    if (f.web_px && f.source_px && (f.web_px[0] !== f.source_px[0] || f.web_px[1] !== f.source_px[1])) out.push('Resized for the web.');
    return out.join(' ');
}
function creditHtml(s, withSource) {
    const { e, f } = s;
    const lic = f.license || e.license.name;
    const licUrl = f.license_url || e.license.url;
    let h = `${figLabel(f)} from ${paperLabel(e)}: <a href="${esc(doiUrl(e.doi))}" target="_blank" rel="noopener">${richTitle(e.title)}</a>. Licence: ${licenceLink(lic, licUrl)}${isNc(lic) ? ' (non-commercial licence)' : ''}.`;
    const extra = (gallery.creditNotes || {})[e.doi];
    if (extra) h += ` ${esc(extra)}`;
    const note = changeNote(f);
    if (note) h += ` <span class="pub-change">${esc(note)}</span>`;
    if (withSource) {
        const url = (String(f.source || '').match(/https?:\/\/\S+/) || [''])[0];
        if (/pmc-oa-opendata/.test(url) && e.pmcid) h += ` Source: ${ext(`https://pmc.ncbi.nlm.nih.gov/articles/${e.pmcid}/`, esc(e.pmcid))} (PMC Open Access subset).`;
        else if (url) h += ` Source: ${ext(url, "the publisher's high-resolution file")}.`;
    }
    return h;
}

function card(s) {
    const { e, f, b, entry, tags } = s;
    const file = path.join(FIG_DIR, b);
    if (!fs.existsSync(file)) die(`figure file missing: ${path.relative(ROOT, file)} (run with --import)`);
    const size = jpegSize(file);
    const src = FIG_URL + b;
    const chips = tags.map(t => `<span class="pub-chip-tag">${esc(groupById[t].chip)}</span>`).join('');
    return `<figure class="pub-fig" id="${figId(b)}" data-tags="${esc(tags.join(' '))}" data-doi="${esc(e.doi)}" data-title="${esc(`Figure ${f.figure_number} · ${firstSurname(e)} et al. (${e.year})`)}" data-technique="${esc(f.technique || '')}">
    <a class="pub-thumb" href="${esc(src)}" title="Enlarge figure"><img src="${esc(src)}" alt="${esc(`Figure ${f.figure_number} from ${firstSurname(e)} et al. (${e.year}), enlarge`)}"${size ? ` width="${size[0]}" height="${size[1]}"` : ''} loading="lazy" decoding="async"></a>
    <figcaption>
        <span class="pub-chips">${chips}</span>
        <p class="pub-desc">${esc(entry.description)}</p>
        <p class="pub-credit">${creditHtml(s, false)}</p>
        <details class="pub-caption"><summary>Original caption</summary><p>${esc(f.caption)}</p></details>
    </figcaption>
</figure>`;
}

function renderGallery() {
    const used = GROUPS.filter(g => shown.some(s => s.tags.includes(g.id)));
    const n = shown.length;
    const chips = [`<button type="button" class="pub-chip" data-value="" aria-pressed="true">All <span class="pub-n">${n}</span></button>`]
        .concat(used.map(g => `<button type="button" class="pub-chip" data-value="${g.id}" aria-pressed="false">${esc(g.chip)} <span class="pub-n">${shown.filter(s => s.tags.includes(g.id)).length}</span></button>`));
    const groups = GROUPS.filter(g => shown.some(s => s.group === g.id)).map(g => {
        const cards = shown.filter(s => s.group === g.id);
        return `<div class="pub-group" data-group="${g.id}">
<h3 class="subhead">${esc(g.label)}</h3>
<div class="pub-grid">
${cards.map(card).join('\n')}
</div>
</div>`;
    });
    return `<div class="pub-filters" id="gallery-filters" data-filters="gallery" hidden>
<div class="pub-filter-group" role="group" aria-label="Filter figures by technique"><span class="pub-filter-label">Technique</span>${chips.join('')}</div>
<p class="pub-count" aria-live="polite"><strong data-count>${n}</strong> of ${n} figures shown</p>
</div>
<div class="pub-gallery" id="gallery-grid">
${groups.join('\n')}
</div>`;
}

// ── Render: publication list ─────────────────────────────────────────────
const unitInstruments = e => (e.provenance?.instruments || []).filter(i => !/not unit/i.test(i));
function item(e) {
    const staff = STAFF.filter(s => (e.staff || []).includes(s.name)).map(s => s.id);
    const oa = !!e.open_access;
    const unit = e.provenance?.status === 'confirmed';
    const badges = [];
    if (oa) badges.push(`<span class="pub-badge pub-badge-oa">Open access · ${licenceLink(e.license?.name || 'licence not stated', e.license?.url)}</span>`);
    if (unit) {
        const inst = unitInstruments(e);
        const instText = inst.length ? inst.join('; ') : 'not named in the paper';
        badges.push(`<details class="pub-unit"><summary class="pub-badge pub-badge-unit" title="${esc('Instruments named in the paper: ' + instText)}">Imaged at the unit</summary><span class="pub-unit-body">Instruments named in the paper: ${esc(instText)}</span></details>`);
    }
    const figs = shown.filter(s => s.e === e);
    if (figs.length) badges.push(`<a class="pub-badge pub-badge-fig" href="#${figId(figs[0].b)}">${figs.length === 1 ? '1 figure' : figs.length + ' figures'} in the gallery</a>`);
    const note = (notes.get(e) || []).map(n => `${n.kind} (${esc(n.year)}): <a href="${esc(doiUrl(n.doi))}" target="_blank" rel="noopener">${esc(n.doi)}</a>`).join('; ');
    return `<li class="pub-item" id="pub-${slug(e.doi)}" data-staff="${staff.join(' ')}" data-field="${slug(e.field || 'other')}" data-oa="${oa ? 1 : 0}" data-unit="${unit ? 1 : 0}">
    <p class="pub-title"><a href="${esc(doiUrl(e.doi))}" target="_blank" rel="noopener">${richTitle(e.title)}</a></p>
    <p class="pub-authors">${authorsHtml(e)}</p>
    <p class="pub-meta">${metaHtml(e)}</p>${badges.length ? `\n    <div class="pub-badges">${badges.join(' ')}</div>` : ''}${note ? `\n    <p class="pub-note">${note}</p>` : ''}
</li>`;
}

const byTitle = (a, b) => plain(a.title).localeCompare(plain(b.title));
function renderList() {
    const years = [...new Set(articles.map(e => e.year))].sort((a, b) => b - a);
    const all = articles.concat(abstracts);
    const staffChips = STAFF.filter(s => all.some(e => (e.staff || []).includes(s.name)))
        .map(s => `<button type="button" class="pub-chip" data-key="staff" data-value="${s.id}" aria-pressed="false">${esc(s.name)} <span class="pub-n">${articles.filter(e => (e.staff || []).includes(s.name)).length}</span></button>`);
    const fields = Object.keys(FIELD_LABELS).filter(f => articles.some(e => (e.field || 'other') === f));
    articles.forEach(e => { if (!FIELD_LABELS[e.field || 'other']) { warn(`${e.doi}: unknown field "${e.field}"`); } });
    fields.sort((a, b) => (a === 'other') - (b === 'other') || articles.filter(e => e.field === b).length - articles.filter(e => e.field === a).length || a.localeCompare(b));
    const fieldChips = fields.map(f => `<button type="button" class="pub-chip" data-key="field" data-value="${slug(f)}" aria-pressed="false">${esc(FIELD_LABELS[f])} <span class="pub-n">${articles.filter(e => e.field === f).length}</span></button>`);
    const allChip = key => `<button type="button" class="pub-chip" data-key="${key}" data-value="" aria-pressed="true">All</button>`;
    const nOa = articles.filter(e => e.open_access).length;
    const nUnit = articles.filter(e => e.provenance?.status === 'confirmed').length;
    const filters = `<div class="pub-filters" id="list-filters" data-filters="list" hidden>
<div class="pub-filter-group" role="group" aria-label="Filter by staff member"><span class="pub-filter-label">Staff</span>${allChip('staff')}${staffChips.join('')}</div>
<div class="pub-filter-group" role="group" aria-label="Filter by field"><span class="pub-filter-label">Field</span>${allChip('field')}${fieldChips.join('')}</div>
<div class="pub-filter-group" role="group" aria-label="Show only"><span class="pub-filter-label">Show only</span><button type="button" class="pub-chip" data-key="oa" data-value="1" aria-pressed="false">Open access <span class="pub-n">${nOa}</span></button><button type="button" class="pub-chip" data-key="unit" data-value="1" aria-pressed="false">Imaged at the unit <span class="pub-n">${nUnit}</span></button></div>
<p class="pub-count" aria-live="polite"><strong data-count>${articles.length}</strong> of ${articles.length} papers shown</p>
</div>`;
    const blocks = years.map(y => `<div class="pub-year" data-year="${y}">
<h3 class="subhead" id="year-${y}">${y}</h3>
<ol class="pub-list">
${articles.filter(e => e.year === y).sort(byTitle).map(item).join('\n')}
</ol>
</div>`);
    const abs = abstracts.length ? `<div class="pub-abstracts" id="pub-abstracts">
<h3 class="subhead" id="conference-abstracts">Conference abstracts</h3>
<ul class="pub-list">
${abstracts.sort((a, b) => b.year - a.year || byTitle(a, b)).map(item).join('\n')}
</ul>
</div>` : '';
    return `${filters}
<div class="pub-years" id="pub-years">
${blocks.join('\n')}
<p class="pub-empty" id="pub-empty" hidden>No papers match these filters.</p>
</div>
${abs}`;
}

// ── Render: credits, stats, JSON-LD, index teaser ────────────────────────
function renderCredits() {
    return `<ol class="mod-credits-list pub-credits">
${shown.map(s => `<li id="credit-${figId(s.b).slice(4)}">${creditHtml(s, true)} <a href="#${figId(s.b)}">See it in the gallery</a>.</li>`).join('\n')}
</ol>`;
}

function renderStats() {
    const papersWithFigs = new Set(shown.map(s => s.e.doi)).size;
    const stat = (n, label, small) => `<div class="pub-stat"><dt>${label}</dt><dd>${n}${small ? ` <small>${small}</small>` : ''}</dd></div>`;
    return `<aside class="pub-stats-wrap" aria-label="This page in numbers">
<dl class="pub-stats">
${stat(articles.length, `Journal articles since ${MIN_YEAR}`)}
${stat(articles.filter(e => e.open_access).length, 'Open access')}
${stat(articles.filter(e => e.provenance?.status === 'confirmed').length, 'Imaged at the unit, as stated in the paper')}
${stat(shown.length, `Figures in the gallery, from ${papersWithFigs} papers`)}
</dl>
</aside>`;
}

function renderJsonLd() {
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Publications and images',
        description: `Papers co-authored by the staff of the Faculty of Agriculture CSI Microscopy unit (Hebrew University, Rehovot) from ${MIN_YEAR} onwards, compiled from PubMed, Europe PMC and Crossref, with a gallery of openly licensed figures imaged at the unit.`,
        url: SITE + 'publications.html',
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: 'Faculty of Agriculture CSI Microscopy', url: SITE },
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: articles.length,
            itemListElement: articles.slice().sort((a, b) => b.year - a.year || byTitle(a, b)).map((e, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                item: {
                    '@type': 'ScholarlyArticle',
                    headline: plain(e.title),
                    datePublished: String(e.year),
                    url: doiUrl(e.doi),
                    identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: e.doi },
                    isPartOf: { '@type': 'Periodical', name: e.journal },
                },
            })),
        },
    };
    return `<script type="application/ld+json">\n${JSON.stringify(ld, null, 1).replace(/</g, '\\u003c')}\n</script>`;
}

function renderTeaser() {
    let picks = shown.filter(s => s.entry.teaser);
    if (picks.length < 3) picks = picks.concat(shown.filter(s => !picks.includes(s))).slice(0, 3);
    return `<ul class="pub-teaser">
${picks.slice(0, 3).map(s => {
        const size = jpegSize(path.join(FIG_DIR, s.b));
        return `<li><figure class="pub-fig">
    <a class="pub-thumb" href="publications.html#${figId(s.b)}"><img src="${FIG_URL + s.b}" alt="${esc(`Figure ${s.f.figure_number} from ${firstSurname(s.e)} et al. (${s.e.year}), in the gallery`)}"${size ? ` width="${size[0]}" height="${size[1]}"` : ''} loading="lazy" decoding="async"></a>
    <figcaption>
        <p class="pub-desc">${esc(s.entry.description)}</p>
        <p class="pub-credit">${creditHtml(s, false)}</p>
    </figcaption>
</figure></li>`;
    }).join('\n')}
</ul>`;
}

// ── Write ────────────────────────────────────────────────────────────────
function fill(html, name, content, file) {
    const re = new RegExp(`([ \\t]*)<!-- pub:${name} -->[\\s\\S]*?<!-- /pub:${name} -->`);
    const m = html.match(re);
    if (!m) die(`marker <!-- pub:${name} --> not found in ${path.basename(file)}`);
    const ind = m[1];
    const body = content.split('\n').map(l => (l ? ind + l : l)).join('\n');
    return html.replace(re, () => `${ind}<!-- pub:${name} -->\n${body}\n${ind}<!-- /pub:${name} -->`);
}

let changed = 0;
function update(file, blocks) {
    const before = fs.readFileSync(file, 'utf8');
    let html = before;
    for (const [name, content] of Object.entries(blocks)) html = fill(html, name, content, file);
    if (html !== before) {
        changed++;
        if (CHECK) console.error(`out of date: ${path.relative(ROOT, file)}`);
        else { fs.writeFileSync(file, html); console.log(`wrote ${path.relative(ROOT, file)}`); }
    }
}

update(PAGE, { jsonld: renderJsonLd(), stats: renderStats(), gallery: renderGallery(), list: renderList(), credits: renderCredits() });
update(INDEX, { teaser: renderTeaser() });

// Unused figure files (only reported; --import removes them)
if (fs.existsSync(FIG_DIR)) {
    const keep = new Set(shown.map(s => s.b));
    fs.readdirSync(FIG_DIR).filter(b => !keep.has(b)).forEach(b => warn(`unused figure file assets/publications/figures/${b}`));
}

const groupCounts = GROUPS.map(g => `${g.id} ${shown.filter(s => s.group === g.id).length}`).join(', ');
console.log(`in scope: ${scoped.length} entries (${articles.length} listed papers, ${abstracts.length} conference abstracts, ${errata.length} errata merged as notes); ${data.length - scoped.length} entries out of scope`);
console.log(`gallery: ${shown.length} figures (by group: ${groupCounts}); ${report.excluded.length} excluded`);
report.excluded.forEach(x => console.log('  excluded ' + x));
report.missingEntry.forEach(b => warn(`figure ${b} meets the gallery rules but needs a gallery.json entry (group, description)`));
warnings.forEach(w => console.log('warning: ' + w));
if (CHECK && changed) process.exit(1);
