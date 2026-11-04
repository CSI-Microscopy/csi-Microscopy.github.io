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
 * Requires marked.js to be loaded first, and the page markup to contain:
 *   #status-message  #guide-title  #guide-meta  #markdown-body
 */
(() => {
    'use strict';

    const ORG = 'CSI-Microscopy';

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

    // ── Resolve config: window.GUIDE (per-repo page) or URL params (viewer) ──
    function resolveConfig() {
        const params = new URLSearchParams(window.location.search);
        const g = window.GUIDE || {};
        const repo   = g.repo   || params.get('repo');
        const branch = g.branch || params.get('branch') || 'main';
        // ?path= always wins so a per-repo page can deep-link a sub-file
        const mdPath = params.get('path') || g.path || 'README.md';
        const title  = params.get('title') || g.title || repo;
        return { repo, branch, mdPath, title };
    }

    // ── Render ──────────────────────────────────────────────────────────────
    (async () => {
        const { repo, branch, mdPath, title } = resolveConfig();

        const statusEl = document.getElementById('status-message');
        const titleEl  = document.getElementById('guide-title');
        const metaEl   = document.getElementById('guide-meta');
        const bodyEl   = document.getElementById('markdown-body');

        if (!repo) {
            if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> '
                + `No repository specified. <a href="${HOME_URL}">Return home.</a>`;
            return;
        }

        document.title = `CSI Microscopy — ${title}`;

        const rawUrl  = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${mdPath}`;
        const repoUrl = `https://github.com/${ORG}/${repo}`;
        // baseUrl resolves relative assets (images etc.) relative to the file's own directory
        const fileDir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/') + 1) : '';
        const baseUrl = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${fileDir}`;

        try {
            let res = await fetch(rawUrl);
            // If the exact path 404s and we're using the default, try lowercase readme.md
            if (!res.ok && mdPath === 'README.md') {
                res = await fetch(rawUrl.replace('README.md', 'readme.md'));
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();

            // ── marked.js configuration ───────────────────────────────────
            marked.setOptions({ gfm: true, breaks: true });

            // Custom renderer: rewrite relative image/link paths → absolute GitHub raw URLs
            const renderer = new marked.Renderer();

            renderer.image = (href, imgTitle, alt) => {
                // Skip private-user-images (JWT-gated, won't load without auth)
                if (href && href.includes('private-user-images.githubusercontent.com')) {
                    return `<span class="image-note"><i class="fa-solid fa-image"></i> `
                        + `Screenshot — <a href="${repoUrl}#readme" target="_blank" rel="noopener">view on GitHub</a></span>`;
                }
                // Resolve relative URLs
                if (href && !href.startsWith('http') && !href.startsWith('//')) {
                    href = baseUrl + href;
                }
                const titleAttr = imgTitle ? ` title="${imgTitle}"` : '';
                return `<img src="${href}" alt="${alt || ''}"${titleAttr} loading="lazy">`;
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
                if (href) {
                    // Normalise old org name that may appear in repo-internal links
                    href = href.replace('Faculty-of-Agriculture-CSI-Microscopy', ORG);

                    const isPdf = /\.pdf$/i.test(href);
                    const isMd  = /\.md$/i.test(href);

                    if (!href.startsWith('http') && !href.startsWith('//') && !href.startsWith('#') && !href.startsWith('mailto:')) {
                        // Relative path — resolve against the current file's directory
                        const resolvedPath = fileDir + href;
                        if (isPdf) {
                            const rawHref = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${resolvedPath}`;
                            const label   = href.split('/').pop().replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                            href = `${PDF_VIEWER}?url=${encodeURIComponent(rawHref)}&title=${encodeURIComponent(label)}`;
                        } else if (isMd) {
                            // Open other .md files in this same viewer
                            const label = href.split('/').pop().replace(/\.md$/i, '').replace(/[-_]/g, ' ');
                            href = `${GUIDE_VIEWER}?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(resolvedPath)}&title=${encodeURIComponent(label)}`;
                        } else {
                            href = `https://github.com/${ORG}/${repo}/blob/${branch}/${resolvedPath}`;
                        }
                    } else if (href.includes('github.com') && href.includes('/blob/')) {
                        if (isPdf) {
                            // GitHub blob PDF → pdf-viewer
                            const rawHref = href
                                .replace('https://github.com/', 'https://raw.githubusercontent.com/')
                                .replace('/blob/', '/');
                            const label = href.split('/').pop().replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                            href = `${PDF_VIEWER}?url=${encodeURIComponent(rawHref)}&title=${encodeURIComponent(label)}`;
                        } else if (isMd) {
                            // GitHub blob .md link → viewer
                            // Extract path from URL: github.com/ORG/REPO/blob/BRANCH/PATH
                            const m = href.match(/github\.com\/[^/]+\/([^/]+)\/blob\/([^/]+)\/(.+)/);
                            if (m) {
                                const linkRepo   = m[1];
                                const linkBranch = m[2];
                                const linkPath   = m[3];
                                const label      = linkPath.split('/').pop().replace(/\.md$/i, '').replace(/[-_]/g, ' ');
                                href = `${GUIDE_VIEWER}?repo=${encodeURIComponent(linkRepo)}&branch=${encodeURIComponent(linkBranch)}&path=${encodeURIComponent(linkPath)}&title=${encodeURIComponent(label)}`;
                            }
                        }
                    }
                }
                const titleAttr = linkTitle ? ` title="${linkTitle}"` : '';
                const external  = href && href.startsWith('http') ? ' target="_blank" rel="noopener"' : '';
                return `<a href="${href}"${titleAttr}${external}>${text}</a>`;
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

            const html = marked.parse(processed, { renderer });

            if (statusEl) statusEl.style.display = 'none';
            if (titleEl)  { titleEl.textContent = title; titleEl.style.display = ''; }
            if (metaEl)   {
                metaEl.innerHTML = `Source: <a href="${repoUrl}" target="_blank" rel="noopener">`
                    + `github.com/${ORG}/${repo}</a> <span aria-hidden="true">·</span> branch <code>${branch}</code>`;
                metaEl.style.display = '';
            }
            if (bodyEl)   { bodyEl.innerHTML = html; renderMermaid(); }

        } catch (err) {
            if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> `
                + `Could not load the guide. `
                + `<a href="${repoUrl}" target="_blank" rel="noopener">Open directly on GitHub</a>.`
                + `<br><small style="opacity:0.5">${err.message}</small>`;
        }
    })();
})();
