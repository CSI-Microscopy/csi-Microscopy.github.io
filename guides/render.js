/*
 * CSI Microscopy — shared guide renderer
 * --------------------------------------
 * Fetches a Markdown file from a CSI-Microscopy repo and renders it with the
 * site's branding. Used by both:
 *   • guides/viewer.html        — config read from URL params (?repo=&branch=&path=&title=)
 *   • each repo's own index.html — config provided via a `window.GUIDE` object
 *
 * Maintained in ONE place (the csi-Microscopy.github.io repo). Per-repo pages
 * load it from https://csi-microscopy.github.io/guides/render.js, so fixes here
 * propagate to every guide page automatically.
 *
 * Requires marked.js (4.3.0) to be loaded first, and the page markup to contain:
 *   #status-message  #guide-title  #guide-meta  #markdown-body
 *
 * Public config (unchanged): window.GUIDE = { repo, branch, title, path }.
 * Query parameters: ?path= (any page), ?title= (any page), ?repo= and ?branch=
 * (viewer.html only; a per-repo page's own repo/branch always win).
 *
 * Version 2.1.0 (2026-11-06), routing phase 0 plus review fixes:
 *   - repo/branch/path are validated; viewer.html only shows the five
 *     instrument repos and named branches (no PR refs or SHAs); a rejected
 *     value shows an error instead of fetching; raw HTML is shown as text
 *     on unpublished branches
 *   - #hash in the address is scrolled to after rendering
 *   - title: ?title=, else the page's title for its default document, else
 *     the document's first H1 (not repeated in the body)
 *   - links: extension checked without #/?; fragments kept; relative links go
 *     to the instrument's Pages URL; PDFs open the same-site PDF in a new tab;
 *     new tabs only for other sites
 *   - old organisation name rewritten in links and images
 */
(() => {
    'use strict';

    const ORG     = 'CSI-Microscopy';
    const OLD_ORG = 'Faculty-of-Agriculture-CSI-Microscopy';
    const SITE    = 'https://csi-microscopy.github.io/';
    // Instrument repos with a GitHub Pages site, and the branch each site is
    // published from. viewer.html?repo= accepts only these.
    const KNOWN_REPOS = {
        'Skyscan-1272-MicroCT':          'main',
        'EVOS-M7000-widefiled':          'master',
        'Stellaris-STED-Confocal':       'main',
        'Luxendo-MuVi-SPIM-Light-Sheet': 'master',
        'image-analysis-server':         'main',
    };

    // ── Resolve helper-page URLs from this script's own <src> ────────────────
    // Works whether loaded by the main viewer (relative) or a per-repo page
    // (absolute https://csi-microscopy.github.io/guides/render.js), so links
    // always point back to the main site.
    const GUIDES_BASE = (() => {
        const self = document.currentScript
            || [...document.scripts].find(s => /render\.js(\?|$)/.test(s.src));
        if (self && self.src) return self.src.replace(/render\.js(\?.*)?$/, '');
        return 'https://csi-microscopy.github.io/guides/';
    })();
    const PDF_VIEWER   = GUIDES_BASE + 'pdf-viewer.html';
    const GUIDE_VIEWER = GUIDES_BASE + 'viewer.html';
    const HOME_URL     = GUIDES_BASE.replace(/guides\/?$/, '') + 'index.html';

    // ── Theme: persisted choice, else system preference ─────────────────
    // Per-repo pages may still hard-code data-theme="light" in their markup;
    // clearing it lets the prefers-color-scheme rules in styles.css apply.
    const THEME_KEY = 'csi-theme';
    const root = document.documentElement;
    const applyTheme = t => { if (t) root.dataset.theme = t; else delete root.dataset.theme; };
    let savedTheme = null;
    try { savedTheme = localStorage.getItem(THEME_KEY); } catch (_) { /* storage blocked */ }
    applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : null);
    const currentTheme = () => root.dataset.theme
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const syncLabel = () => {
            themeToggle.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
            themeToggle.title = themeToggle.getAttribute('aria-label');
        };
        syncLabel();
        themeToggle.addEventListener('click', () => {
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
            syncLabel();
        });
    }

    // Google Fonts for pages that only link styles.css (per-repo guide pages)
    if (!document.querySelector('link[href*="fonts.googleapis.com/css2"]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap';
        document.head.appendChild(l);
    }

    // ── Mermaid diagrams (```mermaid fences in README files) ─────────────
    // Loaded on demand from cdnjs; rendered with a theme that matches the
    // site theme, and re-rendered when the user toggles the theme.
    let mermaidReady = null;
    function loadMermaid() {
        if (mermaidReady) return mermaidReady;
        mermaidReady = new Promise((resolve, reject) => {
            if (window.mermaid) return resolve(window.mermaid);
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';
            s.onload = () => resolve(window.mermaid);
            s.onerror = () => reject(new Error('mermaid failed to load'));
            document.head.appendChild(s);
        });
        return mermaidReady;
    }
    async function renderMermaid() {
        const blocks = [...document.querySelectorAll('.mermaid-block')];
        if (!blocks.length) return;
        let mermaid;
        try { mermaid = await loadMermaid(); } catch (_) { return; } // leave the source visible
        const dark = (root.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict' });
        for (const [i, block] of blocks.entries()) {
            const src = block.dataset.src;
            try {
                const { svg } = await mermaid.render(`mmd-${Date.now()}-${i}`, src);
                block.innerHTML = svg;
                block.classList.add('is-rendered');
            } catch (_) {
                block.innerHTML = '<pre><code>' + src.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</code></pre>';
            }
        }
    }
    if (themeToggle) themeToggle.addEventListener('click', () => { renderMermaid(); });

    // ── Small helpers ────────────────────────────────────────────────────
    const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const decodeEntities = s => String(s)
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const plainText = html => decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const safeDecode = s => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    const encPath = p => p.split('/').map(encodeURIComponent).join('/');

    // ── Validation (D1) ─────────────────────────────────────────────────────
    const NAME_RE   = /^[A-Za-z0-9._-]+$/;
    const validName = s => typeof s === 'string' && s.length <= 100 && NAME_RE.test(s) && s !== '.' && !s.includes('..');
    // Branch: one or more valid names separated by "/" (PR branches such as
    // "feature/x" stay previewable); no "." or "..", no empty segments.
    // raw.githubusercontent.com also serves pull-request refs and commits by
    // SHA, including commits from forks, which anyone can create: refuse
    // those, so only named branches (created by org members) are shown.
    const validBranch = s => typeof s === 'string' && s.length <= 200
        && !/^(refs|pull)(\/|$)/i.test(s) && !/^[0-9a-f]{7,40}$/i.test(s)
        && s.split('/').every(validName);
    // Case-insensitive match of a known repo name → canonical spelling, else null
    const canonicalRepo = s => {
        if (typeof s !== 'string') return null;
        const lc = s.toLowerCase();
        return Object.keys(KNOWN_REPOS).find(r => r.toLowerCase() === lc) || null;
    };
    // Document path inside a repo: no "..", no backslash, no leading "/", no
    // scheme, no control characters; "./" and empty segments are dropped.
    // Returns the normalised (decoded) path, or null if rejected.
    function cleanPath(p) {
        if (typeof p !== 'string' || !p || p.length > 500) return null;
        if (p.includes('\\') || p.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(p) || /[\u0000-\u001f\u007f]/.test(p)) return null;
        const segs = [];
        for (const seg of p.split('/')) {
            if (seg === '' || seg === '.') continue;
            const dec = safeDecode(seg);
            if (seg === '..' || dec === '..' || dec === '.' || dec.includes('/') || dec.includes('\\')) return null;
            segs.push(seg);
        }
        return segs.length ? segs.join('/') : null;
    }

    // Old organisation name (and old Stellaris repo name) in GitHub URLs.
    // Applied to the whole Markdown source, so links, Markdown images and raw
    // HTML <img src> all load from the current organisation.
    function fixOldOrg(s) {
        return String(s)
            .replace(new RegExp('(github\\.com|githubusercontent\\.com|cdn\\.jsdelivr\\.net/gh)/' + OLD_ORG + '/', 'gi'), '$1/' + ORG + '/')
            .replace(new RegExp(OLD_ORG + '\\.github\\.io', 'gi'), 'csi-microscopy.github.io')
            .replace(new RegExp('((?:github\\.com|githubusercontent\\.com)/' + ORG + '/)Stellaris-STED(?=[/?#"\'\\s)]|$)', 'g'), '$1Stellaris-STED-Confocal');
    }

    // ── Resolve config: window.GUIDE (per-repo page) or URL params (viewer) ──
    function resolveConfig() {
        const params = new URLSearchParams(window.location.search);
        const g = window.GUIDE || {};
        const onRepoPage = !!g.repo;
        let repo;
        if (onRepoPage) {
            repo = g.repo;
            if (!validName(repo)) return { error: 'repo', value: repo };
        } else {
            const q = params.get('repo');
            if (!q) return { error: 'norepo' };
            repo = canonicalRepo(q);
            if (!repo) return { error: 'repo', value: q };
        }
        const branch = g.branch || params.get('branch') || KNOWN_REPOS[repo] || 'main';
        if (!validBranch(branch)) return { error: 'branch', value: branch, repo };
        // ?path= always wins so a per-repo page can deep-link a sub-file
        const rawPath = params.get('path') || g.path || 'README.md';
        const mdPath  = cleanPath(rawPath);
        if (!mdPath) return { error: 'path', value: rawPath, repo };
        return {
            repo, branch, mdPath, onRepoPage,
            defaultPath: cleanPath(g.path || 'README.md'),
            titleParam: (params.get('title') || '').slice(0, 120),
            fallbackTitle: g.title || repo,
        };
    }

    // ── Render ──────────────────────────────────────────────────────────────
    (async () => {
        const cfg = resolveConfig();

        const statusEl = document.getElementById('status-message');
        const titleEl  = document.getElementById('guide-title');
        const metaEl   = document.getElementById('guide-meta');
        const bodyEl   = document.getElementById('markdown-body');
        const warn     = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ';

        if (cfg.error) {
            const what = { norepo: 'No repository specified', repo: 'Unknown repository', branch: 'Invalid branch name', path: 'Invalid document path' }[cfg.error];
            const back = cfg.repo && cfg.error !== 'repo' && KNOWN_REPOS[cfg.repo] ? SITE + cfg.repo + '/' : HOME_URL;
            document.title = 'CSI Microscopy — Guide not found';
            if (statusEl) statusEl.innerHTML = warn + what
                + (cfg.value ? `: <code>${escHtml(String(cfg.value).slice(0, 200))}</code>` : '') + '. '
                + 'This page only shows documents from the CSI Microscopy instrument repositories. '
                + `<a href="${escHtml(back)}">${back === HOME_URL ? 'Return home' : 'Open the instrument guide'}</a>.`;
            return;
        }

        const { repo, branch, mdPath, onRepoPage, defaultPath, titleParam, fallbackTitle } = cfg;
        if (titleParam) document.title = `CSI Microscopy — ${titleParam}`;

        // Branch each repo's Pages site is published from; for a per-repo page
        // of a repo not in the list, the page's own branch.
        const pagesBranchOf = r => KNOWN_REPOS[r] || (onRepoPage && r === repo ? branch : null);
        const onPages = (r, b) => pagesBranchOf(r) === b;
        const pagesRootOf = r => r.toLowerCase() === 'csi-microscopy.github.io' ? SITE : SITE + r + '/';

        const rawBase  = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/`;
        const rawUrl   = rawBase + encPath(mdPath);
        const repoUrl  = `https://github.com/${ORG}/${repo}`;
        // Relative paths resolve against the current file's own directory
        const fileDir  = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/') + 1) : '';
        const encDir   = fileDir ? encPath(fileDir.slice(0, -1)) + '/' : '';
        const assetBase = rawBase + encDir;            // images: raw (works on any branch)
        const pagesRoot = pagesRootOf(repo);

        const siteOrigin = new URL(SITE).origin;
        const isSameSite = h => {
            if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(h)) return true; // relative
            try {
                const o = new URL(h).origin;
                return o === siteOrigin || o === new URL(GUIDES_BASE).origin;
            } catch (_) { return false; }
        };

        // A PDF in a CSI-Microscopy repo: the same-site Pages URL (served as
        // application/pdf) when that branch is the published one; otherwise
        // (branch previews) the PDF viewer with the raw URL; null if neither applies.
        function pdfHref(r, b, encFilePath, frag, label) {
            if (onPages(r, b)) return pagesRootOf(r) + encFilePath + frag;
            if (!KNOWN_REPOS[r] || !validBranch(b)) return null;   // pdf-viewer would refuse it
            const raw = `https://raw.githubusercontent.com/${ORG}/${r}/${b}/${encFilePath}${frag}`;
            return `${PDF_VIEWER}?url=${encodeURIComponent(raw)}&title=${encodeURIComponent(label)}`;
        }
        // A Markdown file in a CSI-Microscopy repo: the instrument page with
        // ?path= on the published branch; viewer.html for other branches of a
        // known repo; otherwise null (leave the link as it is).
        function mdHref(r, b, filePath, frag) {
            if (onPages(r, b)) {
                const rootReadme = /^readme\.md$/i;
                const isDefault = r === repo
                    ? filePath === defaultPath || (rootReadme.test(filePath) && rootReadme.test(defaultPath))
                    : rootReadme.test(filePath);
                if (isDefault) return pagesRootOf(r) + frag;
                return pagesRootOf(r) + '?path=' + encodeURIComponent(filePath).replace(/%2F/g, '/') + frag;
            }
            if (KNOWN_REPOS[r] && validBranch(b)) {
                return `${GUIDE_VIEWER}?repo=${encodeURIComponent(r)}&branch=${encodeURIComponent(b)}&path=${encodeURIComponent(filePath).replace(/%2F/g, '/')}${frag}`;
            }
            return null;
        }
        const extOf = pathname => { const m = safeDecode(pathname).match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; };
        const labelFrom = (text, encFilePath) => plainText(text)
            || safeDecode(encFilePath.split('/').pop()).replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

        // Returns { href, newTab }
        function rewriteLink(href, text) {
            // Browsers ignore control characters and spaces in a URL scheme
            // ("java\tscript:"), so drop them before looking at the scheme.
            href = fixOldOrg(String(href || '').replace(/[\u0000- \u007f]/g, ''));
            if (!href || href.startsWith('#')) return { href, newTab: false };
            if (href.startsWith('//')) href = 'https:' + href;
            const scheme = (href.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1];
            if (scheme) {
                const s = scheme.toLowerCase();
                if (s === 'mailto' || s === 'tel') return { href, newTab: false };
                if (s !== 'http' && s !== 'https') return { href: '#', newTab: false }; // javascript:, data: …
                let u;
                try { u = new URL(href); } catch (_) { return { href, newTab: true }; }
                // github.com/ORG/REPO/blob|raw/BRANCH/PATH  or  raw.githubusercontent.com/ORG/REPO/BRANCH/PATH
                let m = null;
                if (u.hostname === 'github.com') m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
                else if (u.hostname === 'raw.githubusercontent.com') m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
                if (m && m[1].toLowerCase() === ORG.toLowerCase()) {
                    const r = canonicalRepo(m[2]) || m[2];
                    const ext = extOf(m[4]);
                    const pdf = ext === 'pdf' && pdfHref(r, m[3], m[4], u.hash, labelFrom(text, m[4]));
                    if (pdf) return { href: pdf, newTab: true };
                    if (ext === 'md') {
                        const p = cleanPath(safeDecode(m[4]));
                        const h = p && mdHref(r, m[3], p, u.hash);
                        if (h) return { href: h, newTab: !isSameSite(h) };
                    }
                }
                return { href, newTab: !isSameSite(href) };
            }

            // Relative path — resolve against the current file's directory
            const BASE = 'https://repo.invalid/r/';
            let u;
            try { u = new URL(href, BASE + encDir); } catch (_) { return { href, newTab: false }; }
            if (u.origin !== 'https://repo.invalid' || !u.pathname.startsWith('/r/')) {
                // Climbs out of the repo (e.g. ../Other-Repo/): resolve against the site
                let abs;
                try { abs = new URL(href, pagesRoot + encDir); } catch (_) { return { href: '#', newTab: false }; }
                if (!/^https?:$/.test(abs.protocol)) return { href: '#', newTab: false };
                return { href: abs.href, newTab: !isSameSite(abs.href) };
            }
            const encFilePath = u.pathname.slice(3);         // repo-relative, URL-encoded
            const ext = extOf(encFilePath);
            const pdf = ext === 'pdf' && pdfHref(repo, branch, encFilePath, u.hash, labelFrom(text, encFilePath));
            if (pdf) return { href: pdf, newTab: true };
            if (ext === 'md') {
                const p = cleanPath(safeDecode(encFilePath));
                const h = p && mdHref(repo, branch, p, u.hash);
                if (h) return { href: h, newTab: !isSameSite(h) };
            }
            if (onPages(repo, branch)) {
                // Folders have no index page on Pages (except the repo root)
                if (encFilePath === '') return { href: pagesRoot + u.search + u.hash, newTab: false };
                if (encFilePath.endsWith('/')) return { href: `${repoUrl}/tree/${branch}/${encFilePath}`, newTab: true };
                return { href: pagesRoot + encFilePath + u.search + u.hash, newTab: false };
            }
            // Branch preview: the file only exists on GitHub at that branch
            return { href: `${repoUrl}/${encFilePath.endsWith('/') || !encFilePath ? 'tree' : 'blob'}/${branch}/${encFilePath}${u.search}${u.hash}`, newTab: true };
        }

        function resolveAsset(src) {
            src = String(src || '').replace(/[\u0000- \u007f]/g, '');
            if (!src || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return src;
            try { return new URL(src, assetBase).href; } catch (_) { return src; }
        }

        try {
            let res = await fetch(rawUrl);
            // README.md / readme.md: repos disagree on the case, try the other one
            if (!res.ok && /(^|\/)readme\.md$/i.test(mdPath)) {
                const alt = mdPath.replace(/readme\.md$/i, m => m === 'README.md' ? 'readme.md' : 'README.md');
                res = await fetch(rawBase + encPath(alt));
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = fixOldOrg(await res.text());

            // ── marked.js configuration ───────────────────────────────────
            marked.setOptions({ gfm: true, breaks: true });
            const renderer = new marked.Renderer();

            renderer.image = (href, imgTitle, alt) => {
                // Skip private-user-images (JWT-gated, won't load without auth)
                if (href && href.includes('private-user-images.githubusercontent.com')) {
                    return `<span class="image-note"><i class="fa-solid fa-image"></i> `
                        + `Screenshot — <a href="${repoUrl}#readme" target="_blank" rel="noopener">view on GitHub</a></span>`;
                }
                const titleAttr = imgTitle ? ` title="${escHtml(imgTitle)}"` : '';
                return `<img src="${escHtml(resolveAsset(href))}" alt="${escHtml(alt || '')}"${titleAttr} loading="lazy">`;
            };

            // Raw HTML in the Markdown. On a published branch (the repo's own
            // content): passed through, with relative <img src> resolved like
            // Markdown images. On any other branch (viewer.html previews):
            // shown as text, except the callout wrappers made below, so a
            // preview can never run script on this origin.
            const trustedHtml = onPages(repo, branch);
            const CALLOUT_RE = /^<div class="callout callout-(note|tip|important|caution)"><strong>(Note|Tip|Important|Warning|Caution):<\/strong> ([\s\S]*)<\/div>\s*$/;
            renderer.html = html => {
                html = String(html);
                if (trustedHtml) return html.replace(
                    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi,
                    (_, pre, q, src) => pre + q + resolveAsset(src) + q);
                const c = html.match(CALLOUT_RE);
                if (c) return `<div class="callout callout-${c[1]}"><strong>${c[2]}:</strong> ${escHtml(c[3])}</div>\n`;
                return escHtml(html);
            };

            renderer.code = (code, infostring) => {
                const lang = (infostring || '').trim().toLowerCase();
                if (lang === 'mermaid') {
                    const esc = code.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    return `<div class="mermaid-block" data-src="${esc}" role="img" aria-label="Diagram"><pre><code>${code.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code></pre></div>`;
                }
                const safe = code.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                const cls  = lang ? ` class="language-${lang.replace(/[^a-z0-9_-]/g, '')}"` : '';
                return `<pre><code${cls}>${safe}</code></pre>\n`;
            };

            renderer.link = (href, linkTitle, text) => {
                const r = rewriteLink(href, text);
                const titleAttr = linkTitle ? ` title="${escHtml(linkTitle)}"` : '';
                const newTab    = r.newTab ? ' target="_blank" rel="noopener"' : '';
                return `<a href="${escHtml(r.href)}"${titleAttr}${newTab}>${text}</a>`;
            };

            // Convert GitHub callout syntax (> [!NOTE] etc.) to styled divs
            // Handles any casing (Note, NOTE, note) and both LF and CRLF line endings.
            const calloutMap = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'important', WARNING: 'caution', CAUTION: 'caution' };

            const processed = text.replace(
                /> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\r?\n((?:>[ \t]?[^\r\n]*\r?\n?)*)/gi,
                (_, type, body) => {
                    const key   = type.toUpperCase();
                    const cls   = calloutMap[key] || 'note';
                    const label = key.charAt(0) + key.slice(1).toLowerCase();
                    const inner = body.replace(/^>[ \t]?/gm, '').trim();
                    return `<div class="callout callout-${cls}"><strong>${label}:</strong> ${inner}</div>\n\n`;
                }
            );

            // ── Title (D8): ?title=; else the page's own title when showing
            // its default document; else (a ?path= document) the first H1,
            // which is then not repeated at the top of the body.
            const tokens = marked.lexer(processed);
            const rootReadme = /^readme\.md$/i;
            const isDefaultDoc = mdPath === defaultPath || (rootReadme.test(mdPath) && rootReadme.test(defaultPath));
            let title = titleParam || (isDefaultDoc ? fallbackTitle : '');
            const h1 = tokens.findIndex(t => t.type === 'heading' && t.depth === 1);
            if (!title && h1 >= 0) {
                let h1Text = '';
                try { h1Text = plainText(new marked.Parser().parseInline(tokens[h1].tokens, new marked.TextRenderer())); }
                catch (_) { h1Text = plainText(marked.parseInline(tokens[h1].text)); }
                if (h1Text) {
                    title = h1Text;
                    const before = tokens.slice(0, h1).filter(t => t.type !== 'space').length;
                    if (before <= 1) tokens.splice(h1, 1);
                }
            }
            title = title || fallbackTitle;

            const html = marked.parser(tokens, Object.assign({}, marked.defaults, { renderer }));

            document.title = `CSI Microscopy — ${title}`;
            if (statusEl) statusEl.style.display = 'none';
            if (titleEl)  { titleEl.textContent = title; titleEl.style.display = ''; }
            if (metaEl)   {
                metaEl.innerHTML = `Source: <a href="${repoUrl}" target="_blank" rel="noopener">`
                    + `github.com/${ORG}/${repo}</a> <span aria-hidden="true">·</span> branch <code>${escHtml(branch)}</code>`;
                metaEl.style.display = '';
            }
            if (bodyEl) {
                bodyEl.innerHTML = html;
                // Content arrives after load, so the browser's own jump to
                // #hash found nothing: scroll now (D11), and again after
                // diagrams change the layout unless the reader has scrolled.
                const y = scrollToHash();
                const p = renderMermaid();
                if (y !== null && p && p.then) p.then(() => {
                    if (Math.abs((window.scrollY || 0) - y) < 2) scrollToHash();
                });
            }

        } catch (err) {
            if (statusEl) statusEl.innerHTML = warn
                + `Could not load the guide. `
                + `<a href="${repoUrl}" target="_blank" rel="noopener">Open directly on GitHub</a>.`
                + `<br><small style="opacity:0.5">${escHtml(err.message)}</small>`;
        }
    })();

    // Scroll to the element named by location.hash; returns the new scrollY,
    // or null when there is nothing to scroll to.
    function scrollToHash() {
        const h = window.location.hash;
        if (!h || h.length < 2) return null;
        const el = document.getElementById(safeDecode(h.slice(1)));
        if (!el || typeof el.scrollIntoView !== 'function') return null;
        // Jump, don't animate: styles.css sets scroll-behavior: smooth
        const st = root.style;
        const prev = st ? st.scrollBehavior : '';
        if (st) st.scrollBehavior = 'auto';
        el.scrollIntoView();
        if (st) st.scrollBehavior = prev;
        return window.scrollY || 0;
    }
})();
