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

    // ── Theme toggle ────────────────────────────────────────────────────────
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.documentElement.dataset.theme === 'light';
            document.documentElement.dataset.theme = isLight ? 'dark' : 'light';
        });
    }

    // ── Navbar collapse ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const navbar = document.querySelector('.navbar');
        const collapseToggle = document.getElementById('collapse-toggle');
        if (!navbar || !collapseToggle) return;
        const toggleIcon = collapseToggle.querySelector('.toggle-icon');
        collapseToggle.addEventListener('click', () => {
            navbar.classList.toggle('collapsed');
            if (toggleIcon) {
                toggleIcon.classList.toggle('fa-angles-left');
                toggleIcon.classList.toggle('fa-angles-right');
            }
        });
    });

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
                    + `github.com/${ORG}/${repo}</a> &nbsp;·&nbsp; branch: <code>${branch}</code>`;
                metaEl.style.display = '';
            }
            if (bodyEl)   bodyEl.innerHTML = html;

        } catch (err) {
            if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> `
                + `Could not load the guide. `
                + `<a href="${repoUrl}" target="_blank" rel="noopener">Open directly on GitHub</a>.`
                + `<br><small style="opacity:0.5">${err.message}</small>`;
        }
    })();
})();
