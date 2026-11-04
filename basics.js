/*
 * CSI Microscopy — basics page: resolution and pixel-size calculator
 *
 * The formulas, in plain words (they are also explained on the page itself):
 *   lateral  = wavelength / (2 * NA)          Abbe's resolution limit in the image plane
 *   axial    = 2 * wavelength * n / NA^2      resolution along the focus axis
 *   pixel    = lateral / 2.3                  Nyquist sampling with a safety margin
 *   zstep    = axial / 2.3                    the same rule along z
 * Wavelength is entered in nanometres; results are shown in nm or µm.
 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const lambdaEl = $('c-lambda'), naEl = $('c-na'), nEl = $('c-n');
    if (!lambdaEl || !naEl || !nEl) return;

    const fmt = nm => nm >= 1000 ? (nm / 1000).toFixed(2) + ' µm' : Math.round(nm) + ' nm';

    function updateCalc() {
        const lambda = parseFloat(lambdaEl.value);   // nm
        const na     = parseFloat(naEl.value);
        const n      = parseFloat(nEl.value);
        const warn   = $('o-warn');

        if (!(lambda > 0) || !(na > 0)) {
            ['o-lateral', 'o-axial', 'o-pixel', 'o-zstep'].forEach(id => { $(id).textContent = '–'; });
            return;
        }
        if (na > n) {
            warn.textContent = `An NA of ${na} is impossible in a medium with n = ${n}. The NA can never be larger than the refractive index. Choose a different medium or a lower NA.`;
            warn.hidden = false;
            ['o-lateral', 'o-axial', 'o-pixel', 'o-zstep'].forEach(id => { $(id).textContent = '–'; });
            return;
        }
        warn.hidden = true;

        const lateral = lambda / (2 * na);          // nm
        const axial   = 2 * lambda * n / (na * na); // nm
        const pixel   = lateral / 2.3;              // nm
        const zstep   = axial / 2.3;                // nm

        $('o-lateral').textContent = fmt(lateral);
        $('o-axial').textContent   = fmt(axial);
        $('o-pixel').textContent   = fmt(pixel);
        $('o-zstep').textContent   = fmt(zstep);
    }

    [lambdaEl, naEl, nEl].forEach(el => el.addEventListener('input', updateCalc));
    updateCalc();
})();
