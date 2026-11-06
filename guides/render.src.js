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
 * Built from guides/md-core.js (shared with the static build in
 * tools/build-docs) and guides/render.src.js by
 * tools/build-docs/bundle-render.js. Edit those two files, then run
 *   node tools/build-docs/bundle-render.js
 * CI (.github/workflows/check-render-bundle.yml) fails if render.js is stale.
 *
 * Version 2.2.0 (2026-11-06), routing phase 1: rendering logic moved to
 * md-core.js (output unchanged); viewer.html redirects to the clean built
 * page for repos in CSIMd.BUILT_REPOS (none yet).
 * Version 2.1.1 (2026-11-06), routing phase 0 plus review fixes:
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

    const M = CSIMd;   // defined by md-core.js, bundled above
    const { SITE, ORG, KNOWN_REPOS, escHtml, safeDecode, encPath, validName, validBranch, canonicalRepo, cleanPath } = M;

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
        // viewer.html: a built repo's published branch has a clean static
        // page (or same-site file); go there instead of rendering here.
        if (!onRepoPage) {
            const built = M.builtUrl(repo, branch, mdPath);
            if (built) return { redirect: built };
        }
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
        if (cfg.redirect) { window.location.replace(cfg.redirect + window.location.hash); return; }

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

        const rawBase  = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/`;
        const rawUrl   = rawBase + encPath(mdPath);
        const repoUrl  = `https://github.com/${ORG}/${repo}`;
        const linker   = M.makeLinker({ repo, branch, mdPath, defaultPath, onRepoPage, guidesBase: GUIDES_BASE });

        try {
            let res = await fetch(rawUrl);
            // README.md / readme.md: repos disagree on the case, try the other one
            if (!res.ok && /(^|\/)readme\.md$/i.test(mdPath)) {
                const alt = mdPath.replace(/readme\.md$/i, m => m === 'README.md' ? 'readme.md' : 'README.md');
                res = await fetch(rawBase + encPath(alt));
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();

            const rootReadme = /^readme\.md$/i;
            const isDefaultDoc = mdPath === defaultPath || (rootReadme.test(mdPath) && rootReadme.test(defaultPath));
            const { html, title } = M.renderMarkdown(marked, text, { linker, titleParam, fallbackTitle, isDefaultDoc });

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
