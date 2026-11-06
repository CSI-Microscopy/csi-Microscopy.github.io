# CSI Microscopy Website

This repository contains the source for the **CSI Microscopy** website, built with GitHub Pages.

## Overview

The site is designed to present CSI Microscopy information in a clean, responsive format.

## Project Structure

- `index.html` – main website page
- `styles.css` – site-wide design tokens, header, cards and layout (also loaded by every per-repo guide page)
- `basics.html`, `basics.js` – plain-language microscopy guide for new users, with inline SVG figures and a resolution / pixel-size calculator
- `modalities.html` – "Choosing a microscope": when to choose each imaging technique the unit offers (histology, light, X-ray and electron microscopy) and what each can show, with inline SVG infographics and a comparison table
- `assets/examples/` – example images from the unit's own data (fly microCT slice from the SkyScan 1272 repo)
- `assets/modalities/` – example images for `modalities.html`, re-encoded from Wikimedia Commons; each is credited on the page (author, source page, licence) and listed in its Image credits section
- `site.js` – theme toggle (persisted, respects system preference), mobile menu, section highlighting
- `guides/render.js`, `guides/guide.css` – shared Markdown guide renderer and styles, loaded by every instrument repo's `index.html` (`window.GUIDE = { repo, branch, title, path }`; `?path=` and `?title=` in the address override path and title). It accepts only plain repo/branch names and paths inside the repo, scrolls to `#hash` after rendering, uses the document's first `# H1` as the title, and links PDFs and other files to the instrument's own Pages URL
- `guides/viewer.html` – preview page for the five instrument repos (`?repo=&branch=&path=`), e.g. a branch before merging; not indexed
- `guides/pdf-viewer.html` – PDF viewer kept for older links; accepts only CSI-Microscopy files and shows the same-site copy
- `404.html` – branded not-found page; before showing it, redirects wrong-case instrument names, `/EVOS-M7000-widefield/`, `/Stellaris-STED/`, the short aliases `/microct/`, `/evos/`, `/stellaris/`, `/lightsheet/`, `/data/`, and `/manuals/`
- `sitemap.xml`, `robots.txt` – home pages and the five instrument entry pages, for search engines
- `assets/favicon.svg` – site icon
- `assets/logos/` – third-party logo source files (not used by the pages)
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
