/*
 * publications.html: filters for the gallery and the publication list, and the
 * figure lightbox. Without JavaScript the page still reads in full: the filter
 * bars stay hidden and each thumbnail links to the full image file.
 */
(() => {
    'use strict';

    const setPressed = (group, btn) => group.querySelectorAll('.pub-chip').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));

    // ── Gallery filter (one technique at a time) ─────────────────────────
    const gFilters = document.getElementById('gallery-filters');
    const figs = [...document.querySelectorAll('#gallery-grid .pub-fig')];
    if (gFilters && figs.length) {
        gFilters.hidden = false;
        const count = gFilters.querySelector('[data-count]');
        gFilters.addEventListener('click', ev => {
            const btn = ev.target.closest('.pub-chip');
            if (!btn) return;
            setPressed(gFilters, btn);
            const tag = btn.dataset.value;
            let n = 0;
            figs.forEach(f => {
                const show = !tag || f.dataset.tags.split(' ').includes(tag);
                f.hidden = !show;
                if (show) n++;
            });
            document.querySelectorAll('#gallery-grid .pub-group').forEach(g => {
                g.hidden = !g.querySelector('.pub-fig:not([hidden])');
            });
            count.textContent = n;
        });
    }

    // ── Publication list filters ─────────────────────────────────────────
    const lFilters = document.getElementById('list-filters');
    if (lFilters) {
        lFilters.hidden = false;
        const state = { staff: '', field: '', oa: '', unit: '' };
        const items = [...document.querySelectorAll('#pub-years .pub-item')];
        const absItems = [...document.querySelectorAll('#pub-abstracts .pub-item')];
        const count = lFilters.querySelector('[data-count]');
        const empty = document.getElementById('pub-empty');
        const abs = document.getElementById('pub-abstracts');
        const matches = li =>
            (!state.staff || li.dataset.staff.split(' ').includes(state.staff)) &&
            (!state.field || li.dataset.field === state.field) &&
            (!state.oa || li.dataset.oa === '1') &&
            (!state.unit || li.dataset.unit === '1');
        const apply = () => {
            let n = 0;
            items.forEach(li => { const s = matches(li); li.hidden = !s; if (s) n++; });
            document.querySelectorAll('#pub-years .pub-year').forEach(y => { y.hidden = !y.querySelector('.pub-item:not([hidden])'); });
            let a = 0;
            absItems.forEach(li => { const s = matches(li); li.hidden = !s; if (s) a++; });
            if (abs) abs.hidden = a === 0;
            count.textContent = n;
            if (empty) empty.hidden = n > 0;
        };
        lFilters.addEventListener('click', ev => {
            const btn = ev.target.closest('.pub-chip');
            if (!btn) return;
            const key = btn.dataset.key;
            if (key === 'oa' || key === 'unit') {
                const on = btn.getAttribute('aria-pressed') !== 'true';
                btn.setAttribute('aria-pressed', String(on));
                state[key] = on ? '1' : '';
            } else {
                setPressed(btn.closest('.pub-filter-group'), btn);
                state[key] = btn.dataset.value;
            }
            apply();
        });
    }

    // ── Lightbox ─────────────────────────────────────────────────────────
    const dlg = document.getElementById('pub-lb');
    if (!dlg || typeof dlg.showModal !== 'function' || !figs.length) return;
    const $ = id => document.getElementById(id);
    const img = $('pub-lb-img');
    let current = -1;
    let opener = null;

    const visible = () => figs.filter(f => !f.hidden);
    const show = fig => {
        const list = visible();
        current = list.indexOf(fig);
        const thumb = fig.querySelector('.pub-thumb');
        const thumbImg = thumb.querySelector('img');
        img.src = thumb.getAttribute('href');
        img.alt = fig.querySelector('.pub-desc').textContent;
        if (thumbImg.getAttribute('width')) { img.width = +thumbImg.getAttribute('width'); img.height = +thumbImg.getAttribute('height'); }
        $('pub-lb-title').textContent = fig.dataset.title;
        $('pub-lb-pos').textContent = `${current + 1} / ${list.length}`;
        $('pub-lb-desc').textContent = fig.querySelector('.pub-desc').textContent;
        const tech = fig.dataset.technique;
        $('pub-lb-tech').textContent = tech ? 'Technique, as stated in the paper: ' + tech : '';
        $('pub-lb-tech').hidden = !tech;
        $('pub-lb-credit').innerHTML = fig.querySelector('.pub-credit').innerHTML;
        $('pub-lb-caption').textContent = fig.querySelector('.pub-caption p').textContent;
        $('pub-lb-open').href = 'https://doi.org/' + fig.dataset.doi;
        $('pub-lb-full').href = thumb.getAttribute('href');
        const single = list.length < 2;
        dlg.querySelectorAll('[data-lb="prev"], [data-lb="next"]').forEach(b => { b.disabled = single; });
        dlg.querySelector('.pub-lb-text').scrollTop = 0;
    };
    const step = d => {
        const list = visible();
        if (list.length < 2) return;
        show(list[(current + d + list.length) % list.length]);
    };
    const close = () => { if (dlg.open) dlg.close(); };

    figs.forEach(fig => {
        fig.querySelector('.pub-thumb').addEventListener('click', ev => {
            if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
            ev.preventDefault();
            opener = ev.currentTarget;
            show(fig);
            dlg.showModal();
            dlg.querySelector('[data-lb="close"]').focus();
        });
    });
    dlg.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-lb]');
        if (btn) {
            if (btn.dataset.lb === 'close') close();
            else step(btn.dataset.lb === 'next' ? 1 : -1);
        } else if (ev.target === dlg) close();   // click on the backdrop
    });
    dlg.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    });
    dlg.addEventListener('close', () => {
        img.src = 'data:,';
        // Return focus to the thumbnail of the figure last shown (it may differ from the one opened).
        const list = visible();
        const last = list[current];
        const target = (last && last.querySelector('.pub-thumb')) || opener;
        if (target) target.focus();
    });
})();
