/*
 * CSI Microscopy — shared header behaviour
 * Theme toggle (persisted, respects system preference), mobile nav toggle,
 * and the section indicator (current section on phones, highlighted link on
 * the home page, scroll progress line). Loaded by index.html and the
 * guide viewer; per-repo pages get the same theme logic from guides/render.js.
 */
(() => {
    'use strict';
    const root = document.documentElement;
    const KEY  = 'csi-theme';

    // ── Theme ────────────────────────────────────────────────────────────
    const applyTheme = t => { if (t) root.dataset.theme = t; else delete root.dataset.theme; };
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) { /* storage blocked */ }
    applyTheme(saved === 'dark' || saved === 'light' ? saved : null);

    const current = () => root.dataset.theme
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        const syncLabel = () => {
            const dark = current() === 'dark';
            toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
            toggle.title = toggle.getAttribute('aria-label');
        };
        syncLabel();
        toggle.addEventListener('click', () => {
            const next = current() === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try { localStorage.setItem(KEY, next); } catch (_) { /* ignore */ }
            syncLabel();
        });
    }

    // ── Mobile nav ───────────────────────────────────────────────────────
    const navbar    = document.querySelector('.navbar');
    const navToggle = document.getElementById('nav-toggle');
    const setOpen = open => {
        if (!navbar || !navToggle) return;
        navbar.classList.toggle('open', open);
        navToggle.setAttribute('aria-expanded', String(open));
        navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        const icon = navToggle.querySelector('i');
        if (icon) { icon.classList.toggle('fa-bars', !open); icon.classList.toggle('fa-xmark', open); }
    };
    if (navbar && navToggle) {
        navToggle.addEventListener('click', () => setOpen(!navbar.classList.contains('open')));
        navbar.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
        // A tap anywhere outside the bar closes the open menu.
        document.addEventListener('click', e => {
            if (navbar.classList.contains('open') && !navbar.contains(e.target)) setOpen(false);
        });
    }

    // ── Section indicator ────────────────────────────────────────────────
    // Works on every page that has the .navbar: the home page, basics,
    // modalities, publications and the built instrument guides.
    //  - Phones: the bar shows the name of the section being read (.nav-current).
    //  - Home page: the nav link of that section is highlighted.
    //  - All widths: a thin line under the bar shows how far down the page you are.
    if (!navbar) return;
    const main = document.querySelector('main');
    if (!main) return;

    // Targets: each h2 in <main>. Its anchor is the enclosing section when the
    // h2 is that section's first h2 (home, basics, modalities, publications),
    // otherwise the h2 itself (Markdown guides, where headings carry the ids).
    const clean = el => {
        if (!el) return '';
        const c = el.cloneNode(true);
        c.querySelectorAll('.mod-tag, .visually-hidden, .sr-only').forEach(n => n.remove());
        return c.textContent.replace(/\s+/g, ' ').trim();
    };
    const labelFor = (h2, section) => {
        const heading = clean(h2);
        const short = heading.split(':')[0].trim();
        const eyebrow = section ? clean(section.querySelector('.section-head .eyebrow, .eyebrow')) : '';
        const num = eyebrow.match(/^(\d+)\s*·/);
        if (num) return num[1] + ' · ' + short;            // "4 · Confocal"
        if (eyebrow && eyebrow !== 'Reference') return eyebrow; // "Start here"
        return short;                                       // "Glossary"
    };
    const targets = [];
    main.querySelectorAll('h2').forEach(h2 => {
        if (h2.closest('.hero, [hidden]')) return;
        const section = h2.closest('section[id]');
        const isFirst = section && section.querySelector('h2') === h2;
        const anchor = isFirst ? section : (h2.id ? h2 : null);
        if (!anchor || targets.some(t => t.el === anchor)) return;
        targets.push({ el: anchor, id: anchor.id, label: labelFor(h2, isFirst ? section : null) });
    });

    let label = navbar.querySelector('.nav-current');
    if (!label) {
        label = document.createElement('span');
        label.className = 'nav-current';
        label.setAttribute('aria-hidden', 'true');   // the headings themselves are the accessible source
        const brand = navbar.querySelector('.brand');
        if (brand) brand.after(label); else navbar.prepend(label);
    }
    // Tapping the section name opens the menu, like the menu button.
    label.addEventListener('click', () => setOpen(!navbar.classList.contains('open')));

    const links = [...navbar.querySelectorAll('.nav-links a[href^="#"]')];
    const linkById = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));

    // On a full desktop bar the label would shrink to a stub (its border and
    // padding cannot shrink) and squeeze the theme toggle; hide it instead.
    const fit = () => {
        navbar.classList.remove('nav-current-off');
        if (!navbar.classList.contains('has-current')) return;
        if (label.clientWidth < 48 && label.scrollWidth > label.clientWidth) navbar.classList.add('nav-current-off');
    };

    let shown = null;
    const update = () => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        navbar.style.setProperty('--scroll-progress', progress.toFixed(4));
        navbar.classList.toggle('scrolled', window.scrollY > 4);

        // The current section is the last one whose top has passed a line a
        // quarter of the way down the screen (below the bar). At the very
        // bottom of the page the last section counts, even if it is short.
        const line = navbar.offsetHeight + window.innerHeight * 0.25;
        let pick = null;
        for (const t of targets) { if (t.el.getBoundingClientRect().top <= line) pick = t; else break; }
        if (max > 0 && window.scrollY >= max - 2 && targets.length) pick = targets[targets.length - 1];
        if (pick === shown) return;
        shown = pick;

        label.textContent = pick ? pick.label : '';
        label.title = pick ? pick.label : '';
        navbar.classList.toggle('has-current', !!pick);
        fit();
        links.forEach(a => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        const link = pick && linkById.get(pick.id);
        if (link) { link.classList.add('active'); link.setAttribute('aria-current', 'location'); }
    };
    let queued = false;
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { fit(); onScroll(); });
    window.addEventListener('load', update);
    update();
})();
