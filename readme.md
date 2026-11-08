# CSI Microscopy Website

This repository contains the source for the **CSI Microscopy** website, built with GitHub Pages.

## Overview

The site is designed to present CSI Microscopy information in a clean, responsive format.

## Project Structure

- `index.html` – main website page
- `styles.css` – site-wide design tokens, header, cards and layout (also loaded by every per-repo guide page)
- `basics.html`, `basics.js` – plain-language microscopy guide for new users, with inline SVG figures and a resolution / pixel-size calculator
- `modalities.html` – "Choosing a microscope": when to choose each imaging technique the unit offers (histology, light, X-ray and electron microscopy) and what each can show, with inline SVG infographics and a comparison table
- `publications.html`, `publications.js` – "Publications and images": papers from 2019 onwards co-authored by the unit's staff (grouped by year, with staff, field, open-access and "imaged at the unit" filters) and a gallery of openly licensed figures imaged at the unit, with an in-page lightbox and an image-credits list. The list, gallery, credits, counts and JSON-LD are **generated** (see "Publications page" below); the home page's Publications teaser is generated too
- `assets/publications/` – `publications.json` (the publication data: one entry per paper with authors, staff, field, licence, provenance of the imaging and figure captions; figure paths point to `assets/publications/figures/`) and `figures/` (the gallery figures, as downloaded from the PMC Open Access subset or the publisher's file)
- `tools/publications/` – `build.js` (Node, no dependencies) writes the generated blocks into `publications.html` and `index.html`; `gallery.json` holds the editorial part: scope (`minYear`), technique groups, exclusions, credit notes and the one-sentence description of each gallery figure; `monitor.py` (Python standard library only) searches Europe PMC, Crossref, OpenAlex and Semantic Scholar for new papers by the staff and reports candidates (see "Publications monitor" below); `ignore.json` lists candidates that were checked and rejected, with the reason
- `assets/examples/` – example images from the unit's own data (fly microCT slice from the SkyScan 1272 repo)
- `assets/modalities/` – example images for `modalities.html`, re-encoded from Wikimedia Commons; each is credited on the page (author, source page, licence) and listed in its Image credits section
- `site.js` – theme toggle (persisted, respects system preference), the grouped menu (three groups, Get started, Resources and The unit: a click-to-open drop-down on desktop, an accordion in the phone menu that opens on the group of the current page; Escape or a click outside closes it), and the section indicator on every page with the header, including the built instrument sites: the name of the section being read next to the logo (hidden when the desktop bar is full), the highlighted nav link on the home page, and a scroll-progress line under the bar. Phones get a 48 px bar
- `guides/md-core.js` – the Markdown rendering rules shared by the browser renderer and the static build (repo list, path/branch validation, old-organisation rewrite, callouts, link/image/PDF rules, title rule, and `BUILT_REPOS`, the repos already on the static build)
- `guides/render.js`, `guides/guide.css` – shared Markdown guide renderer and styles, loaded by every instrument repo's `index.html`. `render.js` is **generated** from `guides/md-core.js` + `guides/render.src.js` by `node tools/build-docs/bundle-render.js`: edit those two files, never `render.js` (CI fails if it is stale). Configuration: `window.GUIDE = { repo, branch, title, path }`; `?path=` and `?title=` in the address override path and title). It accepts only plain repo names, named branches (no pull-request refs or commit SHAs) and paths inside the repo, shows raw HTML as text on unpublished branches, scrolls to `#hash` after rendering, and links PDFs and other files to the instrument's own Pages URL. Title: `?title=`, else the page's own title for its default document, else the first `# H1` of a `?path=` document
- `guides/viewer.html` – preview page for the five instrument repos (`?repo=&branch=&path=`), e.g. a branch before merging; not indexed. For a repo in `BUILT_REPOS` on its published branch it redirects to the built page instead
- `guides/pdf-viewer.html` – PDF viewer kept for older links; accepts only CSI-Microscopy files and shows the same-site copy (for a repo in `BUILT_REPOS` it redirects to the PDF itself)
- `tools/build-docs/` – the static build for the instrument sites (see below); `.github/workflows/build-instrument-site.yml` is the shared workflow that runs it, `.github/workflows/check-render-bundle.yml` the CI for this repo
- `404.html` – branded not-found page; before showing it, redirects wrong-case instrument names, `/EVOS-M7000-widefield/`, `/Stellaris-STED/`, the short aliases `/microct/`, `/evos/`, `/stellaris/`, `/lightsheet/`, `/data/`, `/manuals/`, and `README.md`/`readme.md` paths. GitHub Pages serves it only for paths outside the instrument repos' own sites; each instrument site has its own generated `404.html` for wrong paths inside it (tools/build-docs)
- `sitemap.xml`, `robots.txt` – the home sitemap (home pages and the five instrument entry pages); `robots.txt` lists it and each instrument site's own `sitemap.xml` (generated by the build), since crawlers read `robots.txt` only at the host root
- `tools/project-form/` – `Code.gs`, a Google Apps Script for the Project Initiation Form's responses sheet. On each response it emails the user and PI a confirmation with the next steps, and emails all staff the answers and their next steps. A Status column emails the user and PI as the project moves on. Not part of the website: it is pasted into the sheet's Apps Script editor; setup steps are in its `README.md`
- `tools/link-check/` – `linkcheck.py` (Python standard library only) crawls the live home and instrument sites to depth 3 and fails on broken internal links, images, PDFs or `#anchors`; external links are warnings; `known-broken.txt` lists known problems that cannot be fixed here. Run weekly by `.github/workflows/link-check.yml` (and on demand: Actions → Link check → Run workflow); locally: `python3 tools/link-check/linkcheck.py`
- `assets/favicon.svg`, `assets/favicon-32.png`, `assets/apple-touch-icon.png` – site icons: the CSI logo mark on a white tile (the SVG wraps a 64 px PNG). The build copies all three into each instrument site
- `assets/brand/` – the CSI logo, generated from the original artwork: `csi-mark.png` (letters and leaf, 120 px high; the header logo on every page and instrument site), `csi-logo.png` (full logo with "Center for Scientific Imaging", 800 px wide; the home page hero), `csi-og.png` (1200 × 630 link preview, `og:image`), `csi-avatar.png` (500 × 500, for the GitHub organisation picture). Also the parent logos, `faculty-agriculture.png` (The Robert H Smith Faculty of Agriculture, Food and Environment) and `huji.png` (The Hebrew University of Jerusalem), 240 px high with the white background made transparent. They appear beside the CSI logo in the home page hero, at about half its height (on phones too, wrapping under it below 360 px), and in the footer logo row on every page and instrument site, never larger than the CSI mark. The logo has black outlines, so on the dark theme it sits on a white tile (`styles.css`). The build makes the header logo's `src` absolute, like the header links
- `readme.md` – project documentation

## Instrument sites: static build (GitHub Actions)

Each instrument repository (SkyScan, EVOS, Stellaris, Luxendo, image-analysis-server) publishes its Markdown as ready-made HTML pages, built by GitHub Actions (until routing phase 1 an `index.html` shim rendered the README in the browser with `guides/render.js`). The team keeps editing Markdown on GitHub; about a minute after a push the site is rebuilt.

**How it works**

- The instrument repo has `.github/workflows/pages.yml`, which calls the shared workflow `CSI-Microscopy/csi-Microscopy.github.io/.github/workflows/build-instrument-site.yml@v1` on every push to its published branch, on demand (Actions → Pages → Run workflow), and once a week. It passes `repo:` and `branch:` (the published branch, `main` or `master`); the deploy job runs only for that branch, so a manual run on another branch builds without deploying. Also restrict each instrument repo's `github-pages` environment to that branch (Settings → Environments → github-pages → Deployment branches and tags → Selected branches).
- **Versions:** callers use `v1`, which is a **branch** (not a tag), and the shared workflow checks out this repo's build tool, `md-core.js` and CSS at the same ref (input `tool-ref`, default `v1`). Pushing to `main` therefore changes no instrument site. A release is a deliberate fast-forward of the `v1` branch to a tested commit of `main` (`git push origin <commit>:refs/heads/v1`); the next push or weekly run of each instrument repo then picks it up, or run each repo's Pages workflow by hand (Actions → Pages → Run workflow). Do not create a tag named `v1`: a tag and a branch with the same name make the ref ambiguous. An incompatible change gets a new branch (`v2`) and callers move one by one.
- The shared workflow checks out the instrument repo and this repo (both without persisted credentials), installs `tools/build-docs` (Node 20, `marked` 4.3.0 pinned in `package-lock.json`), runs `build.js`, and deploys the result with `actions/deploy-pages`. The build report is shown in the run's summary.
- `build.js` renders every `README.md` / `readme.md` to its folder's `index.html` and every other `.md` to `<name>.html` with `guides/md-core.js` (the same code as the browser renderer, so pages look the same), adds the site header, a breadcrumb, the instrument menu, canonical URL, description, "Source on GitHub" and "Edit this page" links, copies hand-written HTML, PDFs, images and other files as they are, and copies `styles.css`, `guides/guide.css`, `site.js` and the favicon into the site's `assets/`. Raw `.md` files are not published. It also generates `404.html` (redirects for old and mistyped addresses), `sitemap.xml` (every page, with the last commit date of its source as `lastmod`) and `robots.txt`. An old shim `index.html` (one with `window.GUIDE`) or a hand-written `404.html`, `sitemap.xml` or `robots.txt` in the repo is replaced.
- Links: `x.md` → `x.html`, `dir/readme.md` → `dir/`, PDFs → the same-site PDF in a new tab, other links into the repo stay relative, old-organisation URLs are rewritten (with a warning). Heading ids match GitHub's.
- Old addresses keep working: every built page carries a small script that sends `?path=X/readme.md` to `X/`, `?path=X.md` to `X.html` and the two old `?title=` links to their documents, and removes any other query from the address bar. The generated `404.html` redirects `readme.md`/`README.md` to the folder, `.md` to `.html`, and any wrong-case or extensionless address of a published file to the right one, always within the repo.
- The build report lists the pages, the copied files and warnings: old-organisation URLs, and links, images or `#anchors` that point at nothing (an internal link check over the output). Warnings do not stop the deployment.

**Optional `site.json`** at the instrument repo's root:

```json
{
  "name": "SkyScan 1272 Micro-CT",
  "short": "SkyScan 1272",
  "description": "Meta description of the guide's home page",
  "menu": [{ "label": "Guide", "href": "./" }, { "label": "Manuals", "href": "manuals/" }, { "label": "Phase retrieval", "href": "phase-retrieval.html" }],
  "exclude": ["h5-converter-old/**"],
  "titles": { "Old ?title= value": "page.html#anchor" }
}
```

Without it the name comes from the old shim's title and the menu lists the guide plus every other page. Without `description` the home page uses its first paragraph. Menu links may be relative paths, `/` paths or `http(s)` URLs; other entries are dropped with a warning. `exclude` leaves files out of the site (they then stop being served). Symbolic links in a repo are never followed or published.

**Roll-out status** (built = Pages source is "GitHub Actions" and the repo is in `BUILT_REPOS`)

| Repo | Published branch | Built |
|---|---|---|
| Skyscan-1272-MicroCT | main | yes |
| EVOS-M7000-widefiled | master | yes |
| Stellaris-STED-Confocal | main | yes |
| Luxendo-MuVi-SPIM-Light-Sheet | master | yes |
| image-analysis-server | main | yes |

All five instrument sites are served from the static build. The old shims (`index.html` with `window.GUIDE`, SkyScan's hand-written `404.html`) and `.nojekyll` have been removed from the repos (routing phase 2); the build ignored them already. A new instrument repo follows the steps below, then gets a row here and an entry in `BUILT_REPOS`.

**Adding an instrument repo (merge order)**

1. Home repo: merge the pull request that changes the build (this repo's `main`).
2. Release it: fast-forward the `v1` branch to that commit of `main` (first time: create it). Instrument repos only see changes once `v1` points at them.
3. Instrument repo: merge the pull request that adds `.github/workflows/pages.yml` (copied from `Skyscan-1272-MicroCT`, with `repo:` and `branch:` changed; EVOS and Luxendo publish from `master`) and, optionally, `site.json`. Restrict its `github-pages` environment to that branch.
4. Check the build: Actions → the "Pages" run → build job summary (the build report). The deploy job fails until step 5; the current branch-served site is unaffected.
5. **One manual step (repo admin): Settings → Pages → Build and deployment → Source: "GitHub Actions".**
6. Re-run the workflow (Actions → Pages → Run workflow on the published branch). From then on the built site replaces the branch-served one; a failed build leaves the last deployment live. Check the live site (pages, old `?path=` links, PDFs, a `README.md` address).
7. Add the repo to `BUILT_REPOS` in `guides/md-core.js`, run `node tools/build-docs/bundle-render.js`, commit and merge (no tag needed: `viewer.html` and `pdf-viewer.html` are served from `main`): they and links from other guides then use the clean URLs.

A broken build leaves the last deployment live; fix forward, or re-run an earlier successful run of the Pages workflow. (Switching the Pages source back to "Deploy from a branch" no longer gives a working site, because the shims are gone: it would serve the raw files.)

**Local build and tests**

```bash
cd tools/build-docs && npm ci
node build.js --repo Skyscan-1272-MicroCT --src ../../../Skyscan-1272-MicroCT --out /tmp/site/Skyscan-1272-MicroCT
node bundle-render.js --check && node test.js
```

**Routing phase 2 status**

| Item | Status |
|---|---|
| Sitemaps: one per instrument site (generated), home `sitemap.xml`, `robots.txt` listing all six | done in the build; instrument sitemaps go live when the `v1` branch is moved to include it and each site rebuilds (weekly, or Run workflow) |
| Weekly link check of the live sites (`link-check.yml`) | done |
| Home page: Luxendo Image Processor guide linked (instrument card and Guides list) | done |
| SkyScan `phase-retrieval.html`: shared header, breadcrumb, menu; 390 px overflow fixed | done (in the SkyScan repo) |
| Old shims removed from the five instrument repos | done |
| Stellaris `tools/README.md` (draft from the code, to be checked by the unit's staff); menu and home links point to `Stellaris-STED-Confocal/tools/` | done |

**Hand-copied header:** `Skyscan-1272-MicroCT/phase-retrieval.html` carries its own copy of the site header CSS (navbar, breadcrumb and menu rules from `styles.css` and `guides/guide.css`, scoped to `.csi-site`, including the `.nav-long` breakpoints, which were 1409 px and 1239 px for nine links). When the header in `styles.css` (or the `.navbar` markup in `index.html`) changes, update that copy by hand. **Pending:** the home nav now has ten links (Publications added) and `styles.css` moved the `.nav-long` breakpoints to 1487 px and 1307 px (and the short-nav ones to 1243 px and 1079 px); the SkyScan copy is updated to match in its own repo (branch `claude/youthful-keller-nwwqcd`) and should be merged with this change.

## Publications page

`publications.html` is hand-written except the blocks between `<!-- pub:NAME -->` and `<!-- /pub:NAME -->` comments (and the `pub:teaser` block in `index.html`), which `tools/publications/build.js` regenerates:

```bash
node tools/publications/build.js                 # rebuild from assets/publications/publications.json + tools/publications/gallery.json
node tools/publications/build.js --check         # exit 1 if the pages are out of date
node tools/publications/build.js --import DIR    # take DIR/publications.json and DIR/figs/ from a new literature search, then rebuild
```

- **Scope:** entries with `in_scope: true` (or, without that field, `year >= minYear` in `gallery.json`, 2019). Out-of-scope entries stay in the JSON but are not shown.
- **List:** every in-scope journal article, grouped by year; errata are merged into their parent as a note (matched by "Erratum to: <title>"); conference abstracts get their own sub-list. Staff names are bold. "Open access · licence" when `open_access`; "Imaged at the unit" only when `provenance.status` is `confirmed` (the paper credits staff for the imaging, acknowledges the unit, or names a unit instrument with a staff co-author), with the instruments on hover and on click. Nothing is said for `likely` or `unknown`.
- **Gallery rules:** a figure is shown only if its paper is in scope, `confirmed`, licensed CC BY or CC BY-NC (any version; not ND or SA), not excluded in `gallery.json`, and has a `gallery.json` entry with a group and a plain-language description (for mixed figures, the description says which panels are the unit's microscopy). Multi-panel figures are never cropped. Every image carries its credit (figure number, first author, journal, year, title linked to the DOI, licence linked; "non-commercial licence" for CC BY-NC; stacking or resizing noted; "Cropped" only for a figure with `"cropped": true` in the JSON, which none has), and the full original caption is shown verbatim in the card and the lightbox. `--import` copies only the figures that pass and removes unused files; the build lists figures that pass the rules but still need a `gallery.json` entry.
- To add a missing paper by hand: add an entry to `assets/publications/publications.json` (same fields as the others) and re-run the build.

### Publications monitor

`.github/workflows/publications-monitor.yml` runs `tools/publications/monitor.py` on the 2nd of each month (and on demand: Actions → Publications monitor → Run workflow). The script searches Europe PMC, Crossref, OpenAlex and Semantic Scholar for papers from `minYear` on by the three staff members (full name, no ORCID) and for author affiliations that name the unit, drops everything already in `publications.json` or `ignore.json`, and reports the rest as candidates with the evidence it found:

- **staff + affiliation** – the name matched and that author's affiliation names the unit, the faculty or the university
- **staff, no affiliation** – the name matched but the record carries no affiliation for that author (common in Crossref)
- **unit affiliation** – no staff author, but an affiliation names the unit (note that "Interdepartmental Equipment Unit/Facility" also covers non-microscopy services)

The Crossref author search is fuzzy and relevance-ranked; only the 600 best matches per name are read, and the report notes when more existed. Affiliations that mention Hadassah or the Weizmann Institute are not accepted as the university's.

Europe PMC and Crossref need no key and the run fails if they cannot be read. OpenAlex and Semantic Scholar limit unauthenticated requests per network address; when one answers 429 it is skipped and the report says so. Free keys remove that limit: add them as repository secrets `OPENALEX_API_KEY` (https://help.openalex.org/api/authentication) and `S2_API_KEY` (https://www.semanticscholar.org/product/api#api-key-form); `MONITOR_MAILTO` (a contact address) puts Crossref and OpenAlex requests in their "polite" pools. Semantic Scholar has no per-paper affiliations, so its matches use the author profile's affiliation (marked "(profile)"). Google Scholar is not searched: it has no API, blocks automated requests, and its terms forbid scraping; the supported way to watch it is the "Follow" e-mail alert on each staff member's Scholar profile.

Name matches with an affiliation elsewhere are listed as namesakes, not candidates. When there are candidates the workflow opens a GitHub issue labelled `publications` (or comments on the open one, and only when the set of candidates changed since the last post). When no candidates remain, the open issue is closed with a note. GitHub switches scheduled workflows off after 60 days without commits to the repository (this applies to the link check too); the Actions tab then shows a button to re-enable them. Nothing is added to the site automatically: check each candidate (is it the staff member, was the imaging done at the unit, licence of any figure), then add an entry to `publications.json` and rebuild, or add the DOI (or PMID, or for a record without either the source id shown in the report, as `id`) and the reason to `ignore.json`. Locally:

```bash
python3 tools/publications/monitor.py                      # report to stdout (about a minute)
python3 tools/publications/monitor.py --json out.json      # also the full findings, including known and ignored records
```

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
