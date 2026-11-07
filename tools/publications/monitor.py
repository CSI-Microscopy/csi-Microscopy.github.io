#!/usr/bin/env python3
"""Finds new publication candidates for publications.html (Python 3 standard library only).

Searches Europe PMC, Crossref, OpenAlex and Semantic Scholar for papers by the
unit's staff (full name and affiliation, no ORCID) and for papers whose author
affiliations name the unit, then removes everything already in assets/publications/publications.json or
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

Europe PMC and Crossref are required (the run fails if they cannot be read).
OpenAlex and Semantic Scholar are rate-limited per network address without a
key; when one answers 429 it is skipped and the report says so. Optional
environment variables: OPENALEX_API_KEY, S2_API_KEY (free keys), MONITOR_MAILTO
(a contact address for the Crossref and OpenAlex "polite" pools).
Google Scholar is not searched: it has no API and blocks automated requests.

Run monthly by .github/workflows/publications-monitor.yml, which opens (or
comments on) a GitHub issue labelled "publications" when candidates exist.
To silence a candidate that was checked and rejected, add its DOI (or PMID, or
for a record without either the source id shown in the report) and the reason
to ignore.json. To add one, see readme.md, "Publications page".
"""
import argparse
import datetime
import hashlib
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
OPENALEX = 'https://api.openalex.org'
S2 = 'https://api.semanticscholar.org/graph/v1'

# Staff: display name, first name, accepted family names (lower case).
STAFF = [
    {'name': 'Einat Zelinger', 'first': 'Einat', 'family': ['zelinger', 'zelinger-reichert', 'zelinger reichert']},
    {'name': 'Tally Kossovsky', 'first': 'Tally', 'family': ['kossovsky']},
    {'name': 'Daniel Waiger', 'first': 'Daniel', 'family': ['waiger']},
]
# Affiliation strings that name the unit itself (any author carrying one is a lead).
UNIT_RE = re.compile(r'scientific imaging|interdepartmental (equipment|core)', re.I)
# Affiliation strings accepted for a name match: the unit, the faculty or the university ...
AFFIL_RE = re.compile(r'hebrew univ|rehovoth?|smith faculty|faculty of agriculture|' + UNIT_RE.pattern, re.I)
# ... but not these, which also match the words above (Hadassah is the university's medical
# centre in Jerusalem; the Weizmann Institute is in Rehovot).
NOT_AFFIL_RE = re.compile(r'hadassah|weizmann', re.I)


def affil_ok(a):
    return bool(AFFIL_RE.search(a)) and not NOT_AFFIL_RE.search(a)


def log(msg):
    print(msg, file=sys.stderr)


def get_json(url, tries=4, headers=None, delay=2):
    """GET a JSON document; retries 429 and 5xx with backoff (delay, 2*delay, ...). Raises on final failure."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json', **(headers or {})})
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
    """Lower-case form of a name for comparison; Unicode hyphens and dashes become '-'."""
    s = (s or '').replace('‐', '-').replace('‑', '-').replace('–', '-').strip().lower()
    return re.sub(r'\s+', ' ', s)


def given_matches(given, first):
    """True when a given name/initials string fits the staff first name: 'Einat', 'E', 'E.', 'E Z', 'EZ'."""
    g = fold(given).replace('.', ' ').split()
    if not g:
        return False
    if g[0] == first.lower() or g[0] == first[0].lower():
        return True
    return len(g[0]) <= 3 and g[0].startswith(first[0].lower())  # run-together initials, 'EZ'


def staff_for(family, given):
    """Staff member for an author name, trying family/given as given and then swapped
    (some Crossref records have them the wrong way round)."""
    for fam, giv in ((fold(family), given), (fold(given), family)):
        for s in STAFF:
            if fam in s['family'] and given_matches(giv, s['first']):
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
def crossref_search(field, value, since, rows=200, pages=3):
    """Crossref works matching query.<field>=value (relevance-ranked, fuzzy), up to rows*pages
    items. Returns (items, total): total > len(items) means the search was cut off."""
    out, total = [], 0
    for p in range(pages):
        params = {'query.' + field: value, 'rows': rows, 'offset': p * rows,
                  'filter': f'from-pub-date:{since}',
                  'select': 'DOI,title,author,container-title,issued,type,published'}
        mailto = os.environ.get('MONITOR_MAILTO')
        if mailto:
            params['mailto'] = mailto
        d = get_json(CROSSREF + '?' + urllib.parse.urlencode(params))
        msg = d.get('message', {})
        items = msg.get('items', [])
        total = msg.get('total-results', 0)
        out.extend(items)
        if len(items) < rows:
            break
        time.sleep(1)
    return out, total


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


# ── OpenAlex ─────────────────────────────────────────────────────────────
def name_is_staff(name, staff):
    """True when a display name ("Einat Zelinger", "Zelinger, Einat", "E. Zelinger-Reichert")
    carries one of the staff member's family names and the first name or its initial."""
    toks = [t for t in re.split(r'[\s,]+', fold(name).replace('.', ' ')) if t]
    if not toks:
        return False
    fams = {f for f in staff['family']}
    # family name may be hyphenated ("zelinger-reichert") or split by a space
    joined = ' '.join(toks)
    has_family = any(f in toks or f in joined for f in fams)
    rest = [t for t in toks if t not in fams and not any(t in f.split('-') for f in fams)]
    return has_family and any(given_matches(t, staff['first']) for t in rest)


def openalex_headers():
    key = os.environ.get('OPENALEX_API_KEY')
    return {'Authorization': 'Bearer ' + key} if key else {}


def openalex_params(extra):
    mailto = os.environ.get('MONITOR_MAILTO')
    return {**extra, **({'mailto': mailto} if mailto else {})}


def openalex_works(staff, since):
    """Works of every OpenAlex author whose display name is the staff member's name."""
    url = OPENALEX + '/authors?' + urllib.parse.urlencode(openalex_params(
        {'search': staff['name'], 'per-page': 25, 'select': 'id,display_name,display_name_alternatives,works_count'}))
    authors = [a for a in get_json(url, headers=openalex_headers()).get('results', [])
               if name_is_staff(a.get('display_name', ''), staff)
               or any(name_is_staff(n, staff) for n in a.get('display_name_alternatives', []))]
    out = []
    for a in authors:
        aid = a['id'].rsplit('/', 1)[-1]
        cursor = '*'
        while cursor:
            url = OPENALEX + '/works?' + urllib.parse.urlencode(openalex_params(
                {'filter': f'authorships.author.id:{aid},from_publication_date:{since}', 'per-page': 200, 'cursor': cursor,
                 'select': 'id,doi,ids,title,publication_year,type,primary_location,authorships'}))
            d = get_json(url, headers=openalex_headers())
            out.extend(d.get('results', []))
            cursor = d.get('meta', {}).get('next_cursor')
            time.sleep(0.5)
    return out


def openalex_candidate(w):
    authors = []
    for au in w.get('authorships', []):
        name = (au.get('author') or {}).get('display_name', '')
        parts = name.split()
        family, given = (parts[-1], ' '.join(parts[:-1])) if len(parts) > 1 else (name, '')
        affs = [i.get('display_name', '') for i in au.get('institutions', [])] + list(au.get('raw_affiliation_strings', []))
        authors.append((family, given, [x for x in affs if x]))
    pmid = (w.get('ids') or {}).get('pmid', '')
    src = ((w.get('primary_location') or {}).get('source') or {}).get('display_name', '')
    return classify(
        {'source': 'OpenAlex', 'doi': norm_doi(w.get('doi')), 'pmid': pmid.rsplit('/', 1)[-1] if pmid else None,
         'id': w.get('id'), 'title': w.get('title') or '', 'journal': src or '', 'year': w.get('publication_year', ''),
         'type': w.get('type', ''),
         'authors': ', '.join((au.get('author') or {}).get('display_name', '') for au in w.get('authorships', []))},
        authors, '')


# ── Semantic Scholar ─────────────────────────────────────────────────────
def s2_headers():
    key = os.environ.get('S2_API_KEY')
    return {'x-api-key': key} if key else {}


def s2_authors(staff):
    """Semantic Scholar author profiles matching the staff member's name, with their papers."""
    url = S2 + '/author/search?' + urllib.parse.urlencode(
        {'query': staff['name'], 'limit': 10,
         'fields': 'name,affiliations,paperCount,papers.externalIds,papers.title,papers.year,papers.venue,papers.authors'})
    # Unauthenticated Semantic Scholar requests share one small rate limit: go slowly and back off longer.
    time.sleep(0 if os.environ.get('S2_API_KEY') else 5)
    return [a for a in get_json(url, headers=s2_headers(), delay=10).get('data', []) if name_is_staff(a.get('name', ''), staff)]


def s2_candidate(author, paper, staff, since_year):
    """A Semantic Scholar paper of a matched author profile. S2 has no per-paper affiliation;
    the profile's affiliations are used instead and only count when they name the unit/university."""
    year = paper.get('year')
    if year and int(year) < since_year:
        return None
    ids = paper.get('externalIds') or {}
    affs = [a for a in (author.get('affiliations') or []) if affil_ok(a)]
    evidence = 'staff + affiliation' if affs else 'staff, no affiliation'
    names = [a.get('name', '') for a in paper.get('authors') or []]
    staff_here = sorted({st['name'] for st in STAFF if any(name_is_staff(n, st) for n in names)} | {staff['name']})
    return {'source': 'Semantic Scholar', 'doi': norm_doi(ids.get('DOI')), 'pmid': ids.get('PubMed'),
            'id': paper.get('paperId'), 'title': paper.get('title') or '', 'journal': paper.get('venue') or '',
            'year': year or '', 'type': '',
            'authors': ', '.join(a.get('name', '') for a in paper.get('authors') or []),
            'evidence': evidence, 'staff': staff_here, 'author': author.get('name', ''),
            'affiliation': (affs[0] + ' (profile)') if affs else ''}


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
            ok = [a for a in affs if affil_ok(a)]
            if ok:
                hits.append((s['name'], 'staff + affiliation', shown, ok[0]))
            else:
                elsewhere.append((s['name'], shown, affs[0]))
        elif paper_aff and affil_ok(paper_aff):
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
    ignore = {'doi': {}, 'pmid': {}, 'id': {}}  # id: a source record id (e.g. a Semantic Scholar paper id) when there is no DOI or PMID
    if os.path.exists(IGNORE):
        with open(IGNORE, encoding='utf-8') as f:
            for e in json.load(f):
                if e.get('doi'):
                    ignore['doi'][norm_doi(e['doi'])] = e.get('reason', '')
                if e.get('pmid'):
                    ignore['pmid'][str(e['pmid'])] = e.get('reason', '')
                if e.get('id'):
                    ignore['id'][str(e['id'])] = e.get('reason', '')
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
    ap.add_argument('--issue', help='write the candidates-only report (for the GitHub issue) to this file')
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
                c['pmid'] = c['pmid'] or old['pmid']
                c['staff'] = sorted(set(c['staff']) | set(old['staff']))
                found[key] = c
            else:
                old['sources'].append(c['source'])
                old['pmid'] = old['pmid'] or c['pmid']
                old['staff'] = sorted(set(old['staff']) | set(c['staff']))
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
    notes = []
    # No Crossref affiliation search: query.affiliation is fuzzy over every word and returned
    # millions of matches and nothing new in testing; Europe PMC covers the unit affiliation.
    crossref_queries = [('author', s['name']) for s in STAFF]
    for field, value in crossref_queries:
        log(f'Crossref: query.{field}={value}')
        try:
            items, total = crossref_search(field, value, since)
        except Exception as e:
            log(f'error: Crossref query failed: {e}')
            return 2
        log(f'  {len(items)} of {total} records')
        if total > len(items):
            notes.append(f'Crossref `query.{field}={value}`: {total} fuzzy matches, the {len(items)} most relevant read; '
                         f'a paper of the staff member ranked lower than that would be missed.')
        for it in items:
            add(crossref_candidate(it))
        time.sleep(1)

    for s in STAFF:
        log(f'OpenAlex: authors search={s["name"]}')
        try:
            works = openalex_works(s, since)
            log(f'  {len(works)} works')
            for w in works:
                add(openalex_candidate(w))
        except Exception as e:
            log(f'  skipped: {e}')
            notes.append(f'OpenAlex search for {s["name"]} skipped ({str(e)[:80]}); set OPENALEX_API_KEY to avoid the shared rate limit.')
        time.sleep(1)
    for s in STAFF:
        log(f'Semantic Scholar: author search={s["name"]}')
        try:
            profiles = s2_authors(s)
            n = 0
            for a in profiles:
                for paper in a.get('papers') or []:
                    c = s2_candidate(a, paper, s, int(since[:4]))
                    if c:
                        n += 1
                        add(c)
            log(f'  {len(profiles)} profiles, {n} papers')
        except Exception as e:
            log(f'  skipped: {e}')
            notes.append(f'Semantic Scholar search for {s["name"]} skipped ({str(e)[:80]}); set S2_API_KEY to avoid the shared rate limit.')
        time.sleep(1)

    new, namesakes, known, ignored = [], [], [], []
    for c in found.values():
        if (c['doi'] and c['doi'] in known_dois) or (c['pmid'] and str(c['pmid']) in known_pmids):
            known.append(c)
        elif (c['doi'] and c['doi'] in ignore['doi']) or (c['pmid'] and str(c['pmid']) in ignore['pmid']) \
                or (c['id'] and str(c['id']) in ignore['id']):
            c['ignore_reason'] = ignore['doi'].get(c['doi'] or '') or ignore['pmid'].get(str(c['pmid'])) or ignore['id'].get(str(c['id']))
            ignored.append(c)
        elif c['evidence'] == 'namesake':
            namesakes.append(c)
        else:
            new.append(c)
    order = {'staff + affiliation': 0, 'staff, no affiliation': 1, 'unit affiliation': 2}
    new.sort(key=lambda c: (order[c['evidence']], -int(c['year'] or 0), c['title']))

    md = report(new, namesakes, known, ignored, since, notes)
    print(md)
    if args.md:
        with open(args.md, 'w', encoding='utf-8') as f:
            f.write(md)
    if args.issue:
        # Candidates only (no namesake/ignored details), with a fingerprint of the candidate set
        # so the workflow can skip posting when nothing changed since the last post.
        fp = hashlib.sha1('\n'.join(sorted(link(c) for c in new)).encode()).hexdigest()[:16]
        with open(args.issue, 'w', encoding='utf-8') as f:
            f.write(report(new, [], known, ignored, since, notes) + f'\n<!-- candidates:{fp} -->\n')
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
    i = str(c['id'] or '')
    if c['source'] == 'Semantic Scholar' and re.fullmatch(r'[0-9a-f]{40}', i):
        return f'[S2 {i[:8]}](https://www.semanticscholar.org/paper/{i})'
    if i.startswith('https://'):
        return f'[{i.rsplit("/", 1)[-1]}]({i})'
    return i


def row(c, extra=''):
    title = re.sub(r'<[^>]+>', '', c['title']).replace('|', '\\|')
    aff = (c['affiliation'] or '').replace('|', '\\|')
    return f'| {link(c)} | {c["year"]} | {title} | {c["journal"]} | {", ".join(c["staff"]) or "—"} | {c["evidence"]}{extra} | {aff} |'


def report(new, namesakes, known, ignored, since, notes=()):
    head = '| DOI | Year | Title | Journal | Staff | Evidence | Affiliation seen |\n|---|---|---|---|---|---|---|'
    lines = [f'## Publication candidates ({datetime.date.today().isoformat()})', '',
             f'Searched Europe PMC, Crossref, OpenAlex and Semantic Scholar for papers from {since} by the unit\'s staff (full name and '
             f'affiliation) and for affiliations naming the unit. Already listed: {len(known)}. Ignored by '
             f'ignore.json: {len(ignored)}. Namesakes (other affiliation): {len(namesakes)}.', '']
    for n in notes:
        lines.append(f'- Note: {n}')
    if notes:
        lines.append('')
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
