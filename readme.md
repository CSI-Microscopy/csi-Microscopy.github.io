# CSI Microscopy Website

This repository contains the source for the **CSI Microscopy** website, built with GitHub Pages.

## Overview

The site is designed to present CSI Microscopy information in a clean, responsive format.

## Project Structure

- `index.html` – main website page
- `styles.css` – site-wide design tokens, header, cards and layout (also loaded by every per-repo guide page)
- `basics.html`, `basics.js` – plain-language microscopy guide for new users, with inline SVG figures and a resolution / pixel-size calculator
- `modalities.html` – "Choosing a microscope": when to choose each imaging technique the unit offers (light, X-ray and electron microscopy) and what each can show, with inline SVG infographics and a comparison table
- `assets/examples/` – example images from the unit's own data (fly microCT slice from the SkyScan 1272 repo)
- `assets/modalities/` – example images for `modalities.html`, re-encoded from Wikimedia Commons; each is credited on the page (author, source page, licence) and listed in its Image credits section
- `site.js` – theme toggle (persisted, respects system preference), mobile menu, section highlighting
- `guides/viewer.html`, `guides/render.js`, `guides/guide.css` – shared Markdown guide renderer used by the instrument repos
- `guides/pdf-viewer.html` – inline PDF viewer for manuals
- `assets/favicon.svg` – site icon
- `readme.md` – project documentation

## Design

Typography is IBM Plex (Sans, Sans Condensed for headings, Mono for labels), matching the SkyScan phase-retrieval page. Colours are defined once as CSS custom properties in `styles.css`; dark mode follows the system preference and can be overridden with the header toggle, which is remembered in `localStorage` under `csi-theme`.

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/CSI-Microscopy/csi-Microscopy.github.io.git
   ```
2. Open the project locally.
3. Edit HTML/CSS files as needed.
4. Commit and push your changes.

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch:
   ```bash
   git checkout -b feature/my-update
   ```
3. Commit your changes:
   ```bash
   git commit -m "Improve site content"
   ```
4. Push the branch and open a pull request.

## License

This project is licensed under the MIT License.
