#!/usr/bin/env python3
"""Finds new publication candidates for publications.html (Python 3 standard library only).

Searches Europe PMC and Crossref for papers by the unit's staff (full name and
affiliation, no ORCID) and for papers whose author affiliations name the unit,
then removes everything already in assets/publications/publications.json or
listed in tools/publications/ignore.json. What is left is printed as a Markdown
report (and written to the GitHub Actions job summary) for a person to check;
nothing is added to the site automatically.

A staff member is matched when an author's family name is one of the
member's surnames (Zelinger-Reichert counts for Zelinger), the given name is
the member's first name or its initial, and the author's affiliation, where the
record carries one, names the unit, the faculty or the university. Each
candidate is labelled with how strong that evidence is:

  staff + affiliation    name matched and the author's affiliation names the unit/university
  staff, no affiliation  name matched; the record has no affiliation for that author
  unit affiliation       no staff author, but an affiliation names the unit itself
                         (a student or visitor listing the unit)

Name matches whose affiliation is elsewhere (namesakes) are listed separately
and are not candidates.

  python3 tools/publications/monitor.py [--since 2019-01-01] [--json out.json] [--md out.md]

Run monthly by .github/workflows/publications-monitor.yml, which opens (or
comments on) a GitHub issue labelled "publications" when candidates exist.
To silence a candidate that was checked and rejected, add its DOI (or PMID)
and the reason to ignore.json. To add one, see readme.md, "Publications page".
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'assets', 'publications', 'publications.json')
IGNORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ignore.json')
GALLERY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gallery.json')
UA = 'csi-microscopy-publications-monitor/1.0 (+https://github.com/CSI-Microscopy/csi-Microscopy.github.io)'
EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
CROSSREF = 'https://api.crossref.org/works'

# Staff: display name, first name, accepted family names (lower case).
STAFF = [
    {'name': 'Einat Zelinger', 'first': 'Einat', 'family': ['zelinger', 'zelinger-reichert', 'zelinger reichert']},
    {'name': 'Tally Kossovsky', 'first': 'Tally', 'family': ['kossovsky']},
    {'name': 'Daniel Waiger', 'first': 'Daniel', 'family': ['waiger']},
]
# Affiliation strings that name the unit itself (any author carrying one is a lead).
UNIT_RE = re.compile(r'scientific imaging|interdepartmental (equipment|core)|microscopy unit', re.I)
# Affiliation strings accepted for a name match: the unit, the faculty or the university.
AFFIL_RE = re.compile(r'hebrew univ|rehovot|smith faculty|faculty of agriculture|' + UNIT_RE.pattern, re.I)


def log(msg):
    print(msg, file=sys.stderr)


def get_json(url, tries=4):
    """GET a JSON document; retries 429 and 5xx with backoff. Raises on final failure."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    delay = 2
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                log(f'  HTTP {e.code} from {url.split("?")[0]}, retrying in {delay}s')
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries - 1:
                log(f'  {e} from {url.split("?")[0]}, retrying in {delay}s')
                time.sleep(delay)
                delay *= 2
                continue
            raise


def norm_doi(doi):
    doi = (doi or '').strip().lower()
    doi = re.sub(r'^(https?://(dx\.)?doi\.org/|doi:)', '', doi)
    return doi or None


def fold(s):
    """Lower-case, ASCII-ish form of a name for comparison (strips accents' marks loosely)."""
    s = (s or '').replace('‐', '-').replace('‑', '-').strip().lower()
    return re.sub(r'\s+', ' ', s)


def given_matches(given, first):
    """True when a given name/initials string fits the staff first name: 'Einat', 'E', 'E.', 'E Z'."""
    g = fold(given).replace('.', ' ').split()
    if not g:
        return False
    return g[0] == first.lower() or g[0] == first[0].lower()


def staff_for(family, given):
    fam = fold(family)
    for s in STAFF:
        if fam in s['family'] and given_matches(given, s['first']):
            return s
    return None


# ── Europe PMC ───────────────────────────────────────────────────────────
def epmc_search(query, since):
    """All results (resultType=core) for a Europe PMC query, paged by cursorMark."""
    q = f'({query}) AND FIRST_PDATE:[{since} TO 2100-12-31]'
    out, cursor = [], '*'
    while True:
        url = EPMC + '?' + urllib.parse.urlencode({'query': q, 'resultType': 'core', 'format': 'json',
                                                   'pageSize': 100, 'cursorMark': cursor})
        d = get_json(url)
        res = d.get('resultList', {}).get('result', [])
        out.extend(res)
        nxt = d.get('nextCursorMark')
        if not res or not nxt or nxt == cursor:
            return out
        cursor = nxt
        time.sleep(0.5)


def epmc_authors(rec):
    """[(family, given, [affiliations])] for a Europe PMC core record."""
    out = []
    for a in rec.get('authorList', {}).get('author', []):
        affs = [x.get('affiliation', '') for x in a.get('authorAffiliationDetailsList', {}).get('authorAffiliation', [])]
        if not affs and a.get('affiliation'):
            affs = [a['affiliation']]
        out.append((a.get('lastName', ''), a.get('firstName') or a.get('initials', ''), [x for x in affs if x]))
    return out


def epmc_candidate(rec):
    """Build a candidate dict from a Europe PMC record, or None if it is not one."""
    paper_aff = rec.get('affiliation', '')  # legacy: first author's affiliation only
    return classify(
        {'source': 'Europe PMC', 'doi': norm_doi(rec.get('doi')), 'pmid': rec.get('pmid'),
         'id': rec.get('id'), 'title': rec.get('title', ''), 'journal': rec.get('journalInfo', {}).get('journal', {}).get('title', '') or rec.get('journalTitle', ''),
         'year': rec.get('pubYear', ''), 'type': ', '.join(rec.get('pubTypeList', {}).get('pubType', [])) or rec.get('source', ''),
         'authors': rec.get('authorString', '')},
        epmc_authors(rec), paper_aff)


# ── Crossref ─────────────────────────────────────────────────────────────
def crossref_search(author, since, rows=200, pages=3):
    out = []
    for p in range(pages):
        params = {'query.author': author, 'rows': rows, 'offset': p * rows,
                  'filter': f'from-pub-date:{since}',
                  'select': 'DOI,title,author,container-title,issued,type,published'}
        mailto = os.environ.get('CROSSREF_MAILTO')
        if mailto:
            params['mailto'] = mailto
        d = get_json(CROSSREF + '?' + urllib.parse.urlencode(params))
        items = d.get('message', {}).get('items', [])
        out.extend(items)
        if len(items) < rows:
            break
        time.sleep(1)
    return out


def crossref_candidate(it):
    authors = [(a.get('family', ''), a.get('given', ''), [x.get('name', '') for x in a.get('affiliation', []) if x.get('name')])
               for a in it.get('author', [])]
    year = ''
    for k in ('published', 'issued'):
        parts = it.get(k, {}).get('date-parts', [[None]])[0]
        if parts and parts[0]:
            year = parts[0]
            break
    return classify(
        {'source': 'Crossref', 'doi': norm_doi(it.get('DOI')), 'pmid': None, 'id': it.get('DOI'),
         'title': ' '.join(it.get('title', [])), 'journal': ' '.join(it.get('container-title', [])),
         'year': year, 'type': it.get('type', ''),
         'authors': ', '.join(f'{a.get("family", "")} {(a.get("given") or "")[:1]}'.strip() for a in it.get('author', []))},
        authors, '')


# ── Classification ───────────────────────────────────────────────────────
def classify(cand, authors, paper_aff):
    """Decide whether (cand, authors) is a candidate; adds 'evidence', 'staff', 'affiliation'."""
    hits, elsewhere = [], []
    for family, given, affs in authors:
        s = staff_for(family, given)
        if not s:
            continue
        shown = f'{family} {given}'.strip()
        if affs:
            ok = [a for a in affs if AFFIL_RE.search(a)]
            if ok:
                hits.append((s['name'], 'staff + affiliation', shown, ok[0]))
            else:
                elsewhere.append((s['name'], shown, affs[0]))
        elif paper_aff and AFFIL_RE.search(paper_aff):
            hits.append((s['name'], 'staff + affiliation', shown, paper_aff + ' (first author)'))
        else:
            hits.append((s['name'], 'staff, no affiliation', shown, ''))
    unit = [a for _, _, affs in authors for a in affs if UNIT_RE.search(a)]
    if paper_aff and UNIT_RE.search(paper_aff):
        unit.append(paper_aff)
    if hits:
        strong = [h for h in hits if h[1] == 'staff + affiliation']
        best = strong[0] if strong else hits[0]
        cand.update(evidence=best[1], staff=sorted({h[0] for h in hits}), author=best[2], affiliation=best[3])
        return cand
    if unit:
        cand.update(evidence='unit affiliation', staff=[], author='', affiliation=unit[0])
        return cand
    if elsewhere:
        cand.update(evidence='namesake', staff=[e[0] for e in elsewhere], author=elsewhere[0][1], affiliation=elsewhere[0][2])
        return cand
    return None


# ── Main ─────────────────────────────────────────────────────────────────
def load_known():
    with open(DATA, encoding='utf-8') as f:
        pubs = json.load(f)
    dois = {norm_doi(p.get('doi')) for p in pubs if p.get('doi')}
    pmids = {str(p['pmid']) for p in pubs if p.get('pmid')}
    ignore = {'doi': {}, 'pmid': {}}
    if os.path.exists(IGNORE):
        with open(IGNORE, encoding='utf-8') as f:
            for e in json.load(f):
                if e.get('doi'):
                    ignore['doi'][norm_doi(e['doi'])] = e.get('reason', '')
                if e.get('pmid'):
                    ignore['pmid'][str(e['pmid'])] = e.get('reason', '')
    return dois, pmids, ignore


def default_since():
    try:
        with open(GALLERY, encoding='utf-8') as f:
            return f'{int(json.load(f).get("minYear", 2019))}-01-01'
    except (OSError, ValueError):
        return '2019-01-01'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--since', default=None, help='earliest publication date, YYYY-MM-DD (default: gallery.json minYear)')
    ap.add_argument('--json', help='write all findings (candidates, namesakes, known) to this file')
    ap.add_argument('--md', help='write the Markdown report to this file')
    args = ap.parse_args()
    since = args.since or default_since()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', since):
        ap.error('--since must be YYYY-MM-DD')

    known_dois, known_pmids, ignore = load_known()
    found = {}  # key -> candidate (merged over sources)

    def add(c):
        if not c:
            return
        key = c['doi'] or ('pmid:' + str(c['pmid']) if c['pmid'] else c['source'] + ':' + str(c['id']))
        if key in found:
            old = found[key]
            if old['evidence'] in ('staff, no affiliation', 'unit affiliation', 'namesake') and c['evidence'] == 'staff + affiliation':
                c['sources'] = old['sources'] + [c['source']]
                found[key] = c
            else:
                old['sources'].append(c['source'])
                old['pmid'] = old['pmid'] or c['pmid']
            return
        c['sources'] = [c['source']]
        found[key] = c

    queries = []
    for s in STAFF:
        fams = sorted({f for f in s['family']})
        terms = ' OR '.join(f'AUTH:"{f} {s["first"][0]}" OR AUTH:"{f} {s["first"]}" OR AUTH:"{s["first"]} {f}"' for f in fams)
        queries.append(terms)
    queries.append('AFF:"Scientific Imaging" AND AFF:Rehovot')
    queries.append('AFF:"Interdepartmental Equipment" AND AFF:Rehovot')
    for q in queries:
        log(f'Europe PMC: {q}')
        try:
            recs = epmc_search(q, since)
        except Exception as e:  # network: report and stop, do not pretend the search was complete
            log(f'error: Europe PMC query failed: {e}')
            return 2
        log(f'  {len(recs)} records')
        for r in recs:
            add(epmc_candidate(r))
        time.sleep(1)
    for s in STAFF:
        log(f'Crossref: query.author={s["name"]}')
        try:
            items = crossref_search(s['name'], since)
        except Exception as e:
            log(f'error: Crossref query failed: {e}')
            return 2
        log(f'  {len(items)} records')
        for it in items:
            add(crossref_candidate(it))
        time.sleep(1)

    new, namesakes, known, ignored = [], [], [], []
    for c in found.values():
        if (c['doi'] and c['doi'] in known_dois) or (c['pmid'] and str(c['pmid']) in known_pmids):
            known.append(c)
        elif (c['doi'] and c['doi'] in ignore['doi']) or (c['pmid'] and str(c['pmid']) in ignore['pmid']):
            c['ignore_reason'] = ignore['doi'].get(c['doi'] or '') or ignore['pmid'].get(str(c['pmid']))
            ignored.append(c)
        elif c['evidence'] == 'namesake':
            namesakes.append(c)
        else:
            new.append(c)
    order = {'staff + affiliation': 0, 'staff, no affiliation': 1, 'unit affiliation': 2}
    new.sort(key=lambda c: (order[c['evidence']], -int(c['year'] or 0), c['title']))

    md = report(new, namesakes, known, ignored, since)
    print(md)
    if args.md:
        with open(args.md, 'w', encoding='utf-8') as f:
            f.write(md)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write(md)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(f'count={len(new)}\n')
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({'since': since, 'date': datetime.date.today().isoformat(), 'candidates': new,
                       'namesakes': namesakes, 'ignored': ignored, 'known': known}, f, indent=1, ensure_ascii=False)
    return 0


def link(c):
    if c['doi']:
        return f'[{c["doi"]}](https://doi.org/{c["doi"]})'
    if c['pmid']:
        return f'[PMID {c["pmid"]}](https://europepmc.org/abstract/MED/{c["pmid"]})'
    return c['id'] or ''


def row(c, extra=''):
    title = re.sub(r'<[^>]+>', '', c['title']).replace('|', '\\|')
    aff = (c['affiliation'] or '').replace('|', '\\|')
    return f'| {link(c)} | {c["year"]} | {title} | {c["journal"]} | {", ".join(c["staff"]) or "—"} | {c["evidence"]}{extra} | {aff} |'


def report(new, namesakes, known, ignored, since):
    head = '| DOI | Year | Title | Journal | Staff | Evidence | Affiliation seen |\n|---|---|---|---|---|---|---|'
    lines = [f'## Publication candidates ({datetime.date.today().isoformat()})', '',
             f'Searched Europe PMC and Crossref for papers from {since} by the unit\'s staff (full name and '
             f'affiliation) and for affiliations naming the unit. Already listed: {len(known)}. Ignored by '
             f'ignore.json: {len(ignored)}. Namesakes (other affiliation): {len(namesakes)}.', '']
    if new:
        lines += [f'### {len(new)} new candidate(s) to check', '', head] + [row(c) for c in new]
        lines += ['', 'For each: confirm the author is the staff member and that the imaging was done at the unit, '
                  'then add the entry to `assets/publications/publications.json` and run `node tools/publications/build.js`, '
                  'or add the DOI to `tools/publications/ignore.json` with the reason.']
    else:
        lines += ['**No new candidates.**']
    if namesakes:
        lines += ['', '<details><summary>Namesakes screened out (name matched, affiliation elsewhere)</summary>', '', head]
        lines += [row(c) for c in sorted(namesakes, key=lambda c: -int(c['year'] or 0))]
        lines += ['', '</details>']
    if ignored:
        lines += ['', '<details><summary>Ignored (listed in ignore.json)</summary>', '', head]
        lines += [row(c, ': ' + (c.get('ignore_reason') or '')) for c in ignored]
        lines += ['', '</details>']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    sys.exit(main())
