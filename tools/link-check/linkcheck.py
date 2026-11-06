#!/usr/bin/env python3
"""Link check for the live CSI Microscopy sites (Python 3 standard library only).

Crawls https://csi-microscopy.github.io/ (home pages) and the five instrument
sites, starting from their entry pages and the pages listed in their
sitemap.xml, following internal pages to --depth (default 3). For every page
it checks each internal link, image, stylesheet, script and PDF (HTTP 200
after redirects) and each #anchor (the id or name exists in the target page).
External hosts are requested once each and only reported as warnings.

Exit status 1 when an internal target is missing or an anchor does not
exist; 0 otherwise. A summary table is printed and, in GitHub Actions,
written to the job summary ($GITHUB_STEP_SUMMARY).

  python3 tools/link-check/linkcheck.py [--depth 3] [--no-external] [--json report.json]

Known problems that cannot be fixed on this site (e.g. images missing from a
vendor document) are listed, one URL per line, in known-broken.txt next to
this script: they are reported but do not fail the check. Remove a line once
the problem is fixed; the check then reports it as fixed.

Run weekly by .github/workflows/link-check.yml.
"""
import argparse
import concurrent.futures
import html
import html.parser
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = 'https://csi-microscopy.github.io/'
REPOS = ['Skyscan-1272-MicroCT', 'EVOS-M7000-widefiled', 'Stellaris-STED-Confocal',
         'Luxendo-MuVi-SPIM-Light-Sheet', 'image-analysis-server']
SITES = {'home': SITE, **{r: SITE + r + '/' for r in REPOS}}
HOME_PAGES = [SITE, SITE + 'basics.html', SITE + 'modalities.html']
UA = 'csi-microscopy-link-check/1.0 (+https://github.com/CSI-Microscopy/csi-Microscopy.github.io)'
LINK_TAGS = {'a': 'href', 'img': 'src', 'script': 'src', 'source': 'src', 'iframe': 'src', 'link': 'href'}
SKIP_LINK_RELS = {'preconnect', 'dns-prefetch'}


def site_of(url):
    """Which site a URL belongs to: an instrument repo, 'home', or None (external)."""
    if not url.startswith(SITE):
        return None
    for r in REPOS:
        if url.startswith(SITES[r]):
            return r
    return 'home'


class Page(html.parser.HTMLParser):
    """Collects link targets (tag, url) and element ids/names of one HTML page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.ids = [], set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k in ('id', 'name'):
            if a.get(k):
                self.ids.add(a[k])
        attr = LINK_TAGS.get(tag)
        if not attr or not a.get(attr):
            return
        if tag == 'link' and set((a.get('rel') or '').lower().split()) & SKIP_LINK_RELS:
            return
        self.links.append((tag, a[attr].strip()))


class Fetcher:
    def __init__(self, timeout=25):
        self.timeout = timeout
        self.cache = {}

    def _open(self, url, method):
        req = urllib.request.Request(url, method=method, headers={'User-Agent': UA, 'Accept': '*/*'})
        return urllib.request.urlopen(req, timeout=self.timeout)

    def get(self, url, method='GET', tries=2):
        """Returns (status, final_url, content_type, body or None). Status 0 = network error."""
        key = (url, method)
        if key in self.cache:
            return self.cache[key]
        res = None
        for attempt in range(tries):
            try:
                with self._open(url, method) as r:
                    ctype = r.headers.get('Content-Type', '')
                    body = r.read() if method == 'GET' and 'html' in ctype else None
                    res = (r.status, r.geturl(), ctype, body.decode('utf-8', 'replace') if body is not None else None)
            except urllib.error.HTTPError as e:
                res = (e.code, e.geturl() or url, e.headers.get('Content-Type', '') if e.headers else '', None)
                if method == 'HEAD' and e.code in (400, 403, 405, 501):   # server refuses HEAD: try GET
                    return self.get(url, 'GET', tries)
            except Exception as e:   # timeouts, DNS, TLS, resets
                res = (0, url, '', str(e))
            if res[0] and res[0] < 500:
                break
            time.sleep(2)
        self.cache[key] = res
        return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--depth', type=int, default=3, help='internal pages followed from the start pages (default 3)')
    ap.add_argument('--no-external', action='store_true', help='do not request external URLs')
    ap.add_argument('--json', help='write the full report to this file')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--known', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'known-broken.txt'),
                    help='file of known broken internal URLs (reported, not failing)')
    args = ap.parse_args()
    known = set()
    if os.path.exists(args.known):
        with open(args.known, encoding='utf-8') as fh:
            known = {l.strip() for l in fh if l.strip() and not l.lstrip().startswith('#')}

    f = Fetcher()
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=args.workers)

    # ── start pages: entry pages + every sitemap.xml ─────────────────────
    start = list(HOME_PAGES) + [SITES[r] for r in REPOS]
    for base in SITES.values():
        st, _, _, _ = f.get(base + 'sitemap.xml', 'HEAD')
        if st != 200:
            continue
        try:
            req = urllib.request.Request(base + 'sitemap.xml', headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                xml = r.read().decode('utf-8', 'replace')
            import xml.etree.ElementTree as ET
            ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
            for loc in ET.fromstring(xml).findall('s:url/s:loc', ns):
                u = (loc.text or '').strip()
                if site_of(u) and u not in start:
                    start.append(u)
        except Exception as e:
            print(f'warning: could not read {base}sitemap.xml: {e}', file=sys.stderr)

    # ── crawl internal HTML pages breadth-first ──────────────────────────
    pages = {}            # final url (no fragment) -> {'ids', 'links', 'status', 'site', 'depth'}
    refs = []             # (from_page, tag, raw, absolute url)
    queue, seen = [(u, 0) for u in start], set()
    while queue:
        batch = []
        for u, d in queue:
            u = urllib.parse.urldefrag(u)[0]
            if u not in seen:
                seen.add(u)
                batch.append((u, d))
        queue = []
        results = list(pool.map(lambda ud: (ud, f.get(ud[0])), batch))
        for (u, d), (st, final, ctype, body) in results:
            final = urllib.parse.urldefrag(final)[0]
            entry = {'status': st, 'site': site_of(u), 'depth': d, 'ids': set(), 'links': 0, 'final': final}
            pages[u] = entry
            if final != u:
                pages[final] = entry
            if st != 200 or body is None or 'html' not in ctype:
                continue
            p = Page()
            try:
                p.feed(body)
            except Exception:
                pass
            entry['ids'] = p.ids
            entry['links'] = len(p.links)
            for tag, raw in p.links:
                if not raw or raw.startswith(('mailto:', 'tel:', 'javascript:', 'data:')):
                    continue
                absu = urllib.parse.urljoin(final, html.unescape(raw))
                if not absu.startswith(('http://', 'https://')):
                    continue
                refs.append((u, tag, raw, absu))
                target = urllib.parse.urldefrag(absu)[0]
                if (tag == 'a' and site_of(target) and d + 1 <= args.depth and target not in seen
                        and not target.lower().endswith(('.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.zip', '.py', '.ico', '.txt', '.xml'))):
                    queue.append((target, d + 1))

    # ── check every referenced target ────────────────────────────────────
    internal = sorted({urllib.parse.urldefrag(a)[0] for _, _, _, a in refs if site_of(a)} - set(pages))
    external = sorted({urllib.parse.urldefrag(a)[0] for _, _, _, a in refs if not site_of(a)})
    status = {u: (pages[u]['status'], pages[u]['final']) for u in pages}
    for u, (st, final, _, _) in zip(internal, pool.map(lambda u: f.get(u, 'HEAD'), internal)):
        status[u] = (st, urllib.parse.urldefrag(final)[0])
    ext_status = {}
    if not args.no_external:
        # one host at a time per worker, with a pause between requests (some hosts rate-limit)
        by_host = {}
        for u in external:
            by_host.setdefault(urllib.parse.urlsplit(u).netloc, []).append(u)

        def check_host(urls):
            out = []
            for i, u in enumerate(urls):
                if i:
                    time.sleep(1.0)
                st, final, _, err = f.get(u, 'HEAD', tries=1)
                if st == 429:
                    time.sleep(10)
                    f.cache.pop((u, 'HEAD'), None)
                    f.cache.pop((u, 'GET'), None)
                    st, final, _, err = f.get(u, 'HEAD', tries=1)
                out.append((u, st, err if st == 0 else ''))
            return out
        for res in pool.map(check_host, by_host.values()):
            for u, st, err in res:
                ext_status[u] = (st, err)

    def ids_of(url):
        """ids of an internal HTML page (fetched on demand for pages beyond --depth)."""
        e = pages.get(url)
        if e is None:
            st, final, ctype, body = f.get(url)
            p = Page()
            if st == 200 and body:
                p.feed(body)
            e = pages[url] = {'status': st, 'site': site_of(url), 'depth': None, 'ids': p.ids, 'links': len(p.links), 'final': final}
        return e['ids']

    failures, warnings, known_seen = [], [], []
    per_site = {s: {'pages': 0, 'links': 0, 'targets': set(), 'anchors': 0, 'broken': 0, 'anchors_missing': 0, 'ext_warn': 0}
                for s in SITES}
    for u, e in pages.items():
        if e['site'] and e['status'] == 200 and e['final'] == u and e['depth'] is not None:
            per_site[e['site']]['pages'] += 1
    checked_ext = set()
    for frm, tag, raw, absu in refs:
        s = per_site[pages[frm]['site'] or 'home']
        s['links'] += 1
        target, frag = urllib.parse.urldefrag(absu)
        if site_of(target):
            s['targets'].add(target)
            st, final = status.get(target, (None, target))
            if st != 200:
                if target in known:
                    known_seen.append(f'{st or "ERR"} {absu}  (<{tag}> on {frm})')
                    continue
                s['broken'] += 1
                failures.append(f'{st or "ERR"} {absu}  (<{tag}> on {frm})')
                continue
            if frag and not frag.startswith('page=') and not final.lower().endswith('.pdf'):
                s['anchors'] += 1
                ids = ids_of(final)
                if urllib.parse.unquote(frag) not in ids and frag not in ids:
                    s['anchors_missing'] += 1
                    failures.append(f'missing anchor #{frag} in {final}  (<{tag}> on {frm})')
        elif not args.no_external and target not in checked_ext:
            checked_ext.add(target)
            st, err = ext_status.get(target, (None, ''))
            if not st or st >= 400:
                s['ext_warn'] += 1
                warnings.append(f'{st or "ERR"} {target}  (first seen on {frm}){" " + err[:80] if err else ""}')

    # ── report ───────────────────────────────────────────────────────────
    rows = []
    for name, s in per_site.items():
        rows.append((name, s['pages'], s['links'], len(s['targets']), s['anchors'], s['broken'], s['anchors_missing'], s['ext_warn']))
    head = ('site', 'pages crawled', 'links', 'internal targets', 'anchors', 'broken', 'missing anchors', 'external warnings')
    widths = [max(len(str(r[i])) for r in rows + [head]) for i in range(len(head))]
    fmt = lambda r: '  '.join(str(v).ljust(widths[i]) if i == 0 else str(v).rjust(widths[i]) for i, v in enumerate(r))
    out = [f'Link check of {SITE} and {len(REPOS)} instrument sites, depth {args.depth}, '
           f'{len(start)} start pages, {len(internal) + len(pages)} internal URLs, {len(external)} external URLs'
           + (' (not requested)' if args.no_external else ''), '', fmt(head)] + [fmt(r) for r in rows] + ['']
    out.append(f'FAILURES ({len(failures)})' if failures else 'No broken internal links or missing anchors.')
    out += ['  ' + x for x in failures]
    fixed = sorted(k for k in known if status.get(k, (None,))[0] == 200)
    if known_seen or fixed:
        out.append(f'Known broken, listed in {os.path.basename(args.known)} ({len(known_seen)}), not failing the check')
        out += ['  ' + x for x in known_seen]
        out += [f'  now fixed, remove from {os.path.basename(args.known)}: {k}' for k in fixed]
    out.append(f'Warnings: external links ({len(warnings)}), not failing the check' if warnings else 'External links: no problems' + (' (not checked)' if args.no_external else ''))
    out += ['  ' + x for x in warnings]
    print('\n'.join(out))

    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        md = ['## Link check', '', f'{"**FAILED:** " + str(len(failures)) + " problem(s)" if failures else "**OK:** no broken internal links or missing anchors"}', '',
              '| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
        md += ['| ' + ' | '.join(str(v) for v in r) + ' |' for r in rows]
        if failures:
            md += ['', '### Failures', ''] + [f'- `{x}`' for x in failures]
        if known_seen or fixed:
            md += ['', f'### Known broken ({os.path.basename(args.known)}, not failing)', ''] + [f'- `{x}`' for x in known_seen] \
                + [f'- now fixed, remove from the list: `{k}`' for k in fixed]
        if warnings:
            md += ['', '### External links (warnings only)', ''] + [f'- `{x}`' for x in warnings]
        with open(summary, 'a', encoding='utf-8') as fh:
            fh.write('\n'.join(md) + '\n')
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as fh:
            json.dump({'start': start, 'rows': rows, 'failures': failures, 'warnings': warnings, 'known': known_seen,
                       'pages': sorted(u for u, e in pages.items() if e['depth'] is not None)}, fh, indent=1)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
