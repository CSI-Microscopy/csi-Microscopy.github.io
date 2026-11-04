/*
 * CSI Microscopy — shared header behaviour
 * Theme toggle (persisted, respects system preference), mobile nav toggle,
 * and section highlighting on the home page. Loaded by index.html and the
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
    if (navbar && navToggle) {
        const setOpen = open => {
            navbar.classList.toggle('open', open);
            navToggle.setAttribute('aria-expanded', String(open));
            const icon = navToggle.querySelector('i');
            if (icon) { icon.classList.toggle('fa-bars', !open); icon.classList.toggle('fa-xmark', open); }
        };
        navToggle.addEventListener('click', () => setOpen(!navbar.classList.contains('open')));
        navbar.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    }

    // ── Section highlighting (home page only) ────────────────────────────
    const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
    if (links.length && 'IntersectionObserver' in window) {
        const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
        const sections = [...byId.keys()].map(id => document.getElementById(id)).filter(Boolean);
        const visible = new Map();
        const io = new IntersectionObserver(entries => {
            entries.forEach(e => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
            let best = null, bestRatio = 0;
            visible.forEach((r, id) => { if (r > bestRatio) { bestRatio = r; best = id; } });
            links.forEach(a => a.classList.toggle('active', best !== null && a === byId.get(best)));
        }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.1, 0.25, 0.5, 1] });
        sections.forEach(s => io.observe(s));
    }
})();
