/*
 * CSI Microscopy — Markdown core (md-core.js)
 * -------------------------------------------
 * The pure rendering logic shared by
 *   • guides/render.js         — the browser renderer (instrument shims, viewer.html);
 *                                render.js is GENERATED from this file plus
 *                                guides/render.src.js by tools/build-docs/bundle-render.js
 *   • tools/build-docs/build.js — the static build that pre-renders each
 *                                instrument repo for GitHub Pages
 *   • guides/pdf-viewer.html   — loads this file for the repo list and validators
 *
 * No DOM access. UMD: `window.CSIMd` in a browser, `module.exports` in Node.
 * Requires marked 4.3.0, passed in by the caller.
 *
 * Contents: repo list and validation, old-organisation rewrite, GitHub
 * callouts, the link / image / PDF rewrite rules (browser and static mode),
 * the marked renderer, and the title rule.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CSIMd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VERSION = '2.2.0';
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
    // Repos whose Pages site is built by the shared GitHub Actions workflow
    // (tools/build-docs), i.e. whose documents have clean URLs such as
    // /<Repo>/manuals/. Add a repo here only AFTER its Pages source has been
    // switched to "GitHub Actions" and the first build is live: viewer.html,
    // pdf-viewer.html and cross-repo links then use the clean URLs.
    const BUILT_REPOS = [];

    // ── Small helpers ────────────────────────────────────────────────────
    const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const decodeEntities = s => String(s)
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const plainText = html => decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const safeDecode = s => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    const encPath = p => p.split('/').map(encodeURIComponent).join('/');
    const escCode = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    // ── Validation (D1) ─────────────────────────────────────────────────────
    const NAME_RE   = /^[A-Za-z0-9._-]+$/;
    const validName = s => typeof s === 'string' && s.length <= 100 && NAME_RE.test(s) && s !== '.' && !s.includes('..');
    // Branch: one or more valid names separated by "/" (PR branches such as
    // "feature/x" stay previewable); no "." or "..", no empty segments.
    // raw.githubusercontent.com also serves pull-request refs and commits by
    // SHA (abbreviated to as few as 4 hex digits, and "<sha>/..."),
    // including commits from forks, which anyone can create: refuse those,
    // so only named branches (created by org members) are shown.
    const validBranch = s => typeof s === 'string' && s.length <= 200
        && !/^(refs|pull)(\/|$)/i.test(s) && !/^[0-9a-f]{4,40}(\/|$)/i.test(s)
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

    // ── Clean (built) URLs ──────────────────────────────────────────────────
    // Markdown path → path of its built page, relative to the repo root:
    //   README.md / readme.md → ""        manuals/readme.md → "manuals/"
    //   docs/x.md → "docs/x.html"         anything else → unchanged
    function docUrlPath(p) {
        if (/(^|\/)readme\.md$/i.test(p)) return p.replace(/readme\.md$/i, '');
        if (/\.md$/i.test(p)) return p.replace(/\.md$/i, '.html');
        return p;
    }
    const isBuilt = r => BUILT_REPOS.indexOf(r) >= 0;
    // Clean same-site URL of a document on a built repo's published branch,
    // else null. mdPath is a decoded repo-relative path (cleanPath output).
    function builtUrl(repo, branch, mdPath) {
        const r = canonicalRepo(repo);
        if (!r || !isBuilt(r) || KNOWN_REPOS[r] !== branch) return null;
        const p = cleanPath(mdPath || 'README.md');
        return p ? SITE + r + '/' + encPath(docUrlPath(p)) : null;
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
    // Old-organisation URLs in a source text (for build warnings)
    function findOldOrg(s) {
        return (String(s).match(/https?:\/\/[^\s)"'<>\]]+/g) || []).filter(u => fixOldOrg(u) !== u);
    }

    // Relative URL from a page in directory `dir` ("" or "a/b/") to the
    // repo-relative, URL-encoded `target` ("" = repo root, "x/" = folder).
    function relFrom(dir, target) {
        const d = dir ? dir.slice(0, -1).split('/') : [];
        const t = target.split('/');
        let i = 0;
        while (i < d.length && i < t.length - 1 && d[i] === t[i]) i++;
        return ('../'.repeat(d.length - i) + t.slice(i).join('/')) || './';
    }

    // ── Link rules ──────────────────────────────────────────────────────────
    // makeLinker(ctx) → { rewriteLink(href, text) → { href, newTab },
    //                     resolveAsset(src) → string, trustedHtml, repoUrl }
    // ctx: { repo, branch, mdPath, defaultPath, onRepoPage, guidesBase,
    //        mode: 'browser' (default) | 'static', hasPage(encPath) (static) }
    //
    // browser: links point at absolute Pages URLs (?path= for Markdown),
    //          images at raw.githubusercontent.com (works on any branch).
    // static:  the built site; links and images inside the repo stay
    //          relative, Markdown → clean page URL (x.md → x.html,
    //          dir/readme.md → dir/), PDFs → the same-site PDF in a new tab.
    function makeLinker(ctx) {
        const { repo, branch, mdPath, defaultPath } = ctx;
        const staticMode = ctx.mode === 'static';
        const onRepoPage = staticMode || !!ctx.onRepoPage;
        const guidesBase = ctx.guidesBase || SITE + 'guides/';
        const hasPage = ctx.hasPage || (() => false);
        const PDF_VIEWER   = guidesBase + 'pdf-viewer.html';
        const GUIDE_VIEWER = guidesBase + 'viewer.html';

        // Branch each repo's Pages site is published from; for a per-repo page
        // of a repo not in the list (or the repo being built), the page's own branch.
        const pagesBranchOf = r => (staticMode && r === repo ? branch : KNOWN_REPOS[r])
            || (onRepoPage && r === repo ? branch : null);
        const onPages = (r, b) => pagesBranchOf(r) === b;
        const pagesRootOf = r => r.toLowerCase() === 'csi-microscopy.github.io' ? SITE : SITE + r + '/';

        const rawBase  = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/`;
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
                return o === siteOrigin || o === new URL(guidesBase).origin;
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
        // A Markdown file in a CSI-Microscopy repo: on the published branch,
        // the clean URL for a built repo, else the instrument page with
        // ?path=; viewer.html for other branches of a known repo; otherwise
        // null (leave the link as it is).
        function mdHref(r, b, filePath, frag) {
            if (onPages(r, b)) {
                if (isBuilt(r)) return pagesRootOf(r) + encPath(docUrlPath(filePath)) + frag;
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

        // Static mode: a file of this repo (repo-relative, URL-encoded path)
        // as a link relative to the current page.
        function staticTarget(encFilePath, search, hash) {
            const ext = extOf(encFilePath);
            if (ext === 'pdf') return { href: relFrom(encDir, encFilePath) + hash, newTab: true };
            if (ext === 'md') {
                const p = cleanPath(safeDecode(encFilePath));
                if (p) return { href: relFrom(encDir, encPath(docUrlPath(p))) + hash, newTab: false };
            }
            if (encFilePath.endsWith('/') && !hasPage(encFilePath)) {
                // a folder without a page of its own: browse it on GitHub
                return { href: `${repoUrl}/tree/${branch}/${encFilePath}`, newTab: true };
            }
            return { href: relFrom(encDir, encFilePath) + search + hash, newTab: false };
        }

        // Returns { href, newTab }
        function rewriteLink(href, text) {
            // Browsers drop tabs and newlines anywhere in a URL and control
            // characters and spaces at either end ("java\tscript:",
            // "\u0001javascript:"), so do the same before the scheme check.
            href = fixOldOrg(String(href || '').replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, ''));
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
                    if (staticMode && r === repo && m[3] === branch && (ext === 'pdf' || ext === 'md')) {
                        const p = cleanPath(safeDecode(m[4]));
                        if (p) return staticTarget(encPath(p), '', u.hash);
                    }
                    const pdf = ext === 'pdf' && pdfHref(r, m[3], m[4], u.hash, labelFrom(text, m[4]));
                    if (pdf) return { href: pdf, newTab: true };
                    if (ext === 'md') {
                        const p = cleanPath(safeDecode(m[4]));
                        const h = p && mdHref(r, m[3], p, u.hash);
                        if (h) return { href: h, newTab: !isSameSite(h) };
                    }
                }
                // Static mode: a same-site URL into this repo's own site becomes relative
                if (staticMode && u.origin === siteOrigin && u.pathname.startsWith('/' + repo + '/')) {
                    const rest = u.pathname.slice(repo.length + 2);
                    const qp = rest === '' && u.searchParams.get('path');
                    if (qp) {
                        const p = cleanPath(qp);
                        if (p) return staticTarget(encPath(p), '', u.hash);
                    }
                    if (!rest.split('/').some(x => x === '..' || safeDecode(x) === '..')) return staticTarget(rest, u.search, u.hash);
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
            if (staticMode) return staticTarget(encFilePath, u.search, u.hash);
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
            src = String(src || '').replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
            if (!src || /^(\/\/|#)/.test(src)) return src;
            // Absolute: only http(s) and data:image/ sources
            if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return /^(https?:|data:image\/)/i.test(src) ? src : '';
            if (staticMode) {
                let u;
                try { u = new URL(src, 'https://repo.invalid/r/' + encDir); } catch (_) { return ''; }
                if (u.origin === 'https://repo.invalid' && u.pathname.startsWith('/r/')) {
                    return relFrom(encDir, u.pathname.slice(3)) + u.search + u.hash;
                }
                try { return new URL(src, pagesRoot + encDir).href; } catch (_) { return ''; }
            }
            try { return new URL(src, assetBase).href; } catch (_) { return ''; }
        }

        return { rewriteLink, resolveAsset, trustedHtml: onPages(repo, branch), repoUrl, staticMode };
    }

    // ── GitHub callouts (> [!NOTE] etc.) → styled divs ──────────────────────
    // Handles any casing (Note, NOTE, note) and both LF and CRLF line endings.
    const calloutMap = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'important', WARNING: 'caution', CAUTION: 'caution' };
    function convertCallouts(text) {
        return text.replace(
            /> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\r?\n((?:>[ \t]?[^\r\n]*\r?\n?)*)/gi,
            (_, type, body) => {
                const key   = type.toUpperCase();
                const cls   = calloutMap[key] || 'note';
                const label = key.charAt(0) + key.slice(1).toLowerCase();
                const inner = body.replace(/^>[ \t]?/gm, '').trim();
                return `<div class="callout callout-${cls}"><strong>${label}:</strong> ${inner}</div>\n\n`;
            }
        );
    }

    // ── Heading ids ─────────────────────────────────────────────────────────
    // marked's slug, then (static build only) without the symbols GitHub
    // also drops (e.g. "EVOS™ M7000" → "evos-m7000"), so built pages have the
    // same anchors as the README on GitHub. The browser renderer keeps
    // marked's ids unchanged.
    const githubSlug = (slugger, raw) => slugger.serialize(raw).replace(/[^\p{L}\p{M}\p{N}\p{Pc}-]/gu, '');

    // ── marked renderer ─────────────────────────────────────────────────────
    function createRenderer(marked, linker) {
        const renderer = new marked.Renderer();
        const { rewriteLink, resolveAsset, trustedHtml, repoUrl } = linker;

        if (linker.staticMode) {
            renderer.heading = function (text, level, raw, slugger) {
                if (!this.options.headerIds) return `<h${level}>${text}</h${level}>\n`;
                const id = this.options.headerPrefix + slugger.getNextSafeSlug(githubSlug(slugger, raw), false);
                return `<h${level} id="${id}">${text}</h${level}>\n`;
            };
        }

        renderer.image = (href, imgTitle, alt) => {
            // Skip private-user-images (JWT-gated, won't load without auth)
            if (href && href.includes('private-user-images.githubusercontent.com')) {
                return `<span class="image-note"><i class="fa-solid fa-image"></i> `
                    + `Screenshot — <a href="${repoUrl}#readme" target="_blank" rel="noopener">view on GitHub</a></span>`;
            }
            const titleAttr = imgTitle ? ` title="${escHtml(decodeEntities(imgTitle))}"` : '';
            return `<img src="${escHtml(resolveAsset(href))}" alt="${escHtml(decodeEntities(alt || ''))}"${titleAttr} loading="lazy">`;
        };

        // Raw HTML in the Markdown. On a published branch (the repo's own
        // content): passed through, with relative <img src> resolved like
        // Markdown images. On any other branch (viewer.html previews):
        // shown as text, except the callout wrappers made by
        // convertCallouts, so a preview can never run script on this origin.
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
                return `<div class="mermaid-block" data-src="${esc}" role="img" aria-label="Diagram"><pre><code>${escCode(code)}</code></pre></div>`;
            }
            const safe = escCode(code);
            const cls  = lang ? ` class="language-${lang.replace(/[^a-z0-9_-]/g, '')}"` : '';
            return `<pre><code${cls}>${safe}</code></pre>\n`;
        };

        renderer.link = (href, linkTitle, text) => {
            const r = rewriteLink(href, text);
            const titleAttr = linkTitle ? ` title="${escHtml(decodeEntities(linkTitle))}"` : '';
            const newTab    = r.newTab ? ' target="_blank" rel="noopener"' : '';
            return `<a href="${escHtml(r.href)}"${titleAttr}${newTab}>${text}</a>`;
        };
        return renderer;
    }

    // ── Render a document ───────────────────────────────────────────────────
    // opts: { linker, titleParam, fallbackTitle, isDefaultDoc }
    // Returns { html, title, h1Removed, h1Id, description, hasMermaid }.
    // Title rule (D8): ?title=; else the page's own title when showing its
    // default document; else the first H1, which is then not repeated at the
    // top of the body (when at most one block precedes it).
    function renderMarkdown(marked, source, opts) {
        const text = fixOldOrg(source);
        marked.setOptions({ gfm: true, breaks: true });
        const renderer = createRenderer(marked, opts.linker);
        const processed = convertCallouts(text);

        const tokens = marked.lexer(processed);
        let title = opts.titleParam || (opts.isDefaultDoc ? opts.fallbackTitle : '');
        let h1Removed = false, h1Id = '';
        const h1 = tokens.findIndex(t => t.type === 'heading' && t.depth === 1);
        if (!title && h1 >= 0) {
            let h1Text = '';
            try { h1Text = plainText(new marked.Parser().parseInline(tokens[h1].tokens, new marked.TextRenderer())); }
            catch (_) { h1Text = plainText(marked.parseInline(tokens[h1].text)); }
            if (h1Text) {
                title = h1Text;
                const before = tokens.slice(0, h1).filter(t => t.type !== 'space').length;
                if (before <= 1) {
                    // The id the heading would have had, so a static page can
                    // keep links to it working (e.g. a table of contents)
                    try {
                        const sl = new marked.Slugger();
                        const raw = decodeEntities(new marked.Parser().parseInline(tokens[h1].tokens, new marked.TextRenderer()));
                        h1Id = opts.linker.staticMode ? githubSlug(sl, raw) : sl.slug(raw);
                    }
                    catch (_) { h1Id = ''; }
                    tokens.splice(h1, 1); h1Removed = true;
                }
            }
        }
        title = title || opts.fallbackTitle;

        // First paragraph of reasonable length, as plain text (meta description)
        let description = '';
        for (const t of tokens) {
            if (t.type !== 'paragraph') continue;
            let s = '';
            try { s = plainText(new marked.Parser().parseInline(t.tokens, new marked.TextRenderer())); } catch (_) { s = plainText(t.text); }
            if (s.length >= 40) { description = s; break; }
        }

        const html = marked.parser(tokens, Object.assign({}, marked.defaults, { renderer }));
        return { html, title, h1Removed, h1Id, description, hasMermaid: html.includes('class="mermaid-block"') };
    }

    return {
        VERSION, ORG, OLD_ORG, SITE, KNOWN_REPOS, BUILT_REPOS,
        escHtml, decodeEntities, plainText, safeDecode, encPath,
        validName, validBranch, canonicalRepo, cleanPath,
        docUrlPath, isBuilt, builtUrl, fixOldOrg, findOldOrg, relFrom,
        makeLinker, convertCallouts, createRenderer, renderMarkdown,
    };
});
