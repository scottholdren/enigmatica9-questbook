#!/usr/bin/env python3
"""Build a web quest book from FTB Quests SNBT + mod assets."""
import json, os, re, sys, zipfile, io, base64, glob
from PIL import Image

INST = sys.argv[1]  # .../minecraft
OUT = sys.argv[2]
VANILLA = sys.argv[3]
QDIR = os.path.join(INST, 'config/ftbquests/quests')

# ---------------- SNBT parser ----------------
class P:
    def __init__(s, t): s.t = t; s.i = 0
    def ws(s):
        t = s.t
        while s.i < len(t) and (t[s.i] in ' \t\r\n,'): s.i += 1
    def val(s):
        s.ws(); c = s.t[s.i]
        if c == '{':
            s.i += 1; d = {}
            while True:
                s.ws()
                if s.t[s.i] == '}': s.i += 1; return d
                k = s.key(); s.ws()
                assert s.t[s.i] == ':', (s.i, s.t[s.i-30:s.i+30]); s.i += 1
                d[k] = s.val()
        if c == '[':
            s.i += 1; s.ws()
            if re.match(r'[BIL];', s.t[s.i:s.i+2]): s.i += 2
            a = []
            while True:
                s.ws()
                if s.t[s.i] == ']': s.i += 1; return a
                a.append(s.val())
        if c in '"\'': return s.string()
        m = re.compile(r'[^\s,\]\}:]+').match(s.t, s.i)
        w = m.group(0); s.i = m.end()
        if w == 'true': return True
        if w == 'false': return False
        mm = re.fullmatch(r'(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)([bBsSlLfFdD]?)', w)
        if mm:
            n = mm.group(1)
            return float(n) if ('.' in n or 'e' in n.lower() or mm.group(2) in 'fFdD' and mm.group(2)) else int(n)
        return w
    def key(s):
        if s.t[s.i] in '"\'': return s.string()
        m = re.compile(r'[^\s:]+').match(s.t, s.i); s.i = m.end(); return m.group(0)
    def string(s):
        q = s.t[s.i]; s.i += 1; out = []
        while True:
            c = s.t[s.i]
            if c == '\\': out.append(s.t[s.i+1]); s.i += 2; continue
            if c == q: s.i += 1; return ''.join(out)
            out.append(c); s.i += 1

def load(path):
    with open(path, encoding='utf-8') as f: return P(f.read()).val()

# ---------------- asset index ----------------
sources = []  # list of (kind, handle) ; earlier = higher priority
kjs = os.path.join(INST, 'kubejs')
jars = sorted(glob.glob(os.path.join(INST, 'mods/*.jar')))
index = {}  # path -> source
def add_dir(root):
    for dp, dn, fn in os.walk(root):
        for f in fn:
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            index.setdefault(rel, ('dir', full))
zips = {}
def add_zip(path):
    try: z = zipfile.ZipFile(path)
    except Exception: return
    zips[path] = z
    for n in z.namelist():
        if n.startswith(('assets/', 'data/')) and not n.endswith('/'):
            index.setdefault(n, ('zip', path, n))
add_dir(kjs)  # kubejs/assets/..., kubejs/data/...
for j in jars: add_zip(j)
add_zip(VANILLA)
print('indexed', len(index), file=sys.stderr)

def read(path):
    s = index.get(path)
    if not s: return None
    if s[0] == 'dir':
        with open(s[1], 'rb') as f: return f.read()
    return zips[s[1]].read(s[2])
def readjson(path):
    b = read(path)
    if b is None: return None
    try: return json.loads(b.decode('utf-8-sig'))
    except Exception:
        try: return json.loads(re.sub(r'//.*', '', b.decode('utf-8-sig', 'replace')))
        except Exception: return None

# ---------------- lang ----------------
lang = {}
for p in list(index):
    if re.fullmatch(r'assets/[^/]+/lang/en_us\.json', p):
        pass
langpaths = [p for p in index if re.fullmatch(r'assets/[^/]+/lang/en_us\.json', p)]
# all sources, not just priority one, so mods that share a namespace merge
for j in [VANILLA] + jars:
    z = zips.get(j)
    if not z: continue
    for n in z.namelist():
        if re.fullmatch(r'assets/[^/]+/lang/en_us\.json', n):
            try: lang.update(json.loads(z.read(n).decode('utf-8-sig')))
            except Exception: pass
for p in glob.glob(os.path.join(kjs, 'assets/*/lang/en_us.json')):
    try: lang.update(json.load(open(p, encoding='utf-8-sig')))
    except Exception: pass

def item_name(iid):
    ns, _, n = iid.partition(':')
    for k in (f'item.{ns}.{n}', f'block.{ns}.{n}', f'fluid.{ns}.{n}', f'entity.{ns}.{n}'):
        if k in lang: return re.sub(r'§.', '', lang[k])
    return n.replace('_', ' ').title()

# ---------------- tags ----------------
def tag_items(tag, seen=None):
    seen = seen or set()
    if tag in seen: return []
    seen.add(tag)
    ns, _, p = tag.partition(':')
    out = []
    for folder in ('items', 'blocks'):
        d = readjson(f'data/{ns}/tags/{folder}/{p}.json')
        if d:
            for v in d.get('values', []):
                v = v['id'] if isinstance(v, dict) else v
                if v.startswith('#'): out += tag_items(v[1:], seen)
                else: out.append(v)
            if out: break
    return out

# ---------------- icons ----------------
def tex(ref):
    if not ref or ref.startswith('#'): return None
    if ':' not in ref: ref = 'minecraft:' + ref
    ns, _, p = ref.partition(':')
    b = read(f'assets/{ns}/textures/{p}.png')
    if not b: return None
    try:
        im = Image.open(io.BytesIO(b)).convert('RGBA')
    except Exception: return None
    w, h = im.size
    if h > w and h % w == 0: im = im.crop((0, 0, w, w))
    return im

def model_chain(ref, depth=0):
    """returns (textures dict, parents list, has_elements)"""
    if depth > 12 or not ref: return {}, [], False
    if ':' not in ref: ref = 'minecraft:' + ref
    ns, _, p = ref.partition(':')
    m = readjson(f'assets/{ns}/models/{p}.json')
    if m is None: return {}, [ref], False
    t, parents, el = {}, [ref], 'elements' in m
    if 'parent' in m:
        t, pp, pel = model_chain(m['parent'], depth + 1)
        parents += pp; el = el or pel
        t = dict(t)
    t.update(m.get('textures', {}))
    return t, parents, el

def resolve(t, k, n=0):
    v = t.get(k)
    while isinstance(v, str) and v.startswith('#') and n < 10:
        v = t.get(v[1:]); n += 1
    return v

S = 32
def iso(top, left, right):
    """isometric cube from three 16x16-ish textures"""
    out = Image.new('RGBA', (S, S))
    def face(img, coeffs, shade):
        img = img.resize((16, 16), Image.NEAREST)
        if shade < 1:
            px = img.load()
            for x in range(16):
                for y in range(16):
                    r, g, b, a = px[x, y]
                    px[x, y] = (int(r*shade), int(g*shade), int(b*shade), a)
        return img.transform((S, S), Image.AFFINE, coeffs, Image.NEAREST)
    # inverse affine maps output (X,Y) -> source (u,v)
    # top: diamond with corners (16,1) (31,8) (16,15) (1,8)
    def inv(a, b, c, d, e, f):
        # forward: X = a*u + b*v + c ; Y = d*u + e*v + f -> invert
        det = a*e - b*d
        ia, ib, id_, ie = e/det, -b/det, -d/det, a/det
        return (ia, ib, -(ia*c + ib*f), id_, ie, -(id_*c + ie*f))
    topf = face(top, inv(15/16, -15/16, 16, 7/16, 7/16, 1), 1.0)
    leftf = face(left, inv(15/16, 0, 1, 7/16, 16/16, 8), 0.8)
    rightf = face(right, inv(15/16, 0, 16, -7/16, 16/16, 15), 0.62)
    for f in (leftf, rightf, topf): out.alpha_composite(f)
    return out

def flat(im):
    im = im.resize((S, S), Image.NEAREST) if im.size[0] <= S else im.resize((S, S), Image.LANCZOS)
    return im

texnames = {}
for p in index:
    m = re.fullmatch(r'assets/([^/]+)/textures/((?:item|block|items|blocks|part)/.*)\.png', p)
    if m: texnames.setdefault(m.group(1), []).append(m.group(2))

def blockstate_model(ns, n):
    bs = readjson(f'assets/{ns}/blockstates/{n}.json')
    if not bs: return None
    def pick(v):
        if isinstance(v, list): v = v[0] if v else {}
        return v.get('model') if isinstance(v, dict) else None
    if 'variants' in bs and bs['variants']:
        vs = bs['variants']
        key = next((k for k in vs if 'facing=south' in k or 'facing=north' in k), next(iter(vs)))
        return pick(vs[key])
    if 'multipart' in bs and bs['multipart']:
        return pick(bs['multipart'][0].get('apply'))
    return None

def render_item(iid):
    r = render_item0(iid)
    if r is not None: return r
    ns, _, n = iid.partition(':')
    m = blockstate_model(ns, n)
    if m:
        r = render_model(*model_chain(m), ns, n)
        if r is not None: return r
    cands = sorted((p for p in texnames.get(ns, []) if p.split('/')[-1].startswith(n)), key=len)
    if cands: return flat(tex(f'{ns}:{cands[0]}'))
    return None

def render_item0(iid):
    ns, _, n = iid.partition(':')
    t, parents, el = model_chain(f'{ns}:item/{n}')
    if not parents or len(parents) == 1 and not t:
        t, parents, el = model_chain(f'{ns}:block/{n}')
    return render_model(t, parents, el, ns, n)

def render_model(t, parents, el, ns, n):
    pset = ' '.join(parents)
    if 'layer0' in t and ('generated' in pset or 'handheld' in pset or not el):
        base = None
        for i in range(5):
            im = tex(resolve(t, f'layer{i}'))
            if im is None: continue
            im = im.resize((16, 16), Image.NEAREST) if im.size != (16, 16) and im.size[0] < 16 else im
            if base is None: base = im.copy()
            else:
                if im.size != base.size: im = im.resize(base.size, Image.NEAREST)
                base.alpha_composite(im)
        if base: return flat(base)
    get = lambda *ks: next((tex(resolve(t, k)) for k in ks if resolve(t, k) and tex(resolve(t, k))), None)
    is_cubeish = any(x in pset for x in ('block/cube', 'cube_all', 'cube_column', 'orientable', 'cube_bottom_top', 'leaves', 'block/block')) and 'elements' not in pset
    top = get('top', 'up', 'end', 'all', 'texture', 'side', 'particle')
    side = get('side', 'north', 'front', 'all', 'texture', 'south', 'particle')
    front = get('front', 'north', 'side', 'all', 'texture', 'particle') or side
    if top is not None and side is not None and (is_cubeish or not el or len(t) >= 2):
        return iso(top, front, side)
    p = get('particle', 'all', 'texture', 'side', 'top', 'layer0')
    if p is not None: return flat(p)
    for c in (f'{ns}:item/{n}', f'{ns}:block/{n}', f'{ns}:block/{n}_side', f'{ns}:block/{n}_top'):
        im = tex(c)
        if im is not None: return flat(im)
    return None

icons = {}
def icon_for(iid):
    if iid in icons: return iid if icons[iid] else None
    try: im = render_item(iid)
    except Exception as e:
        print('icon err', iid, e, file=sys.stderr); im = None
    if im is None:
        icons[iid] = None; return None
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    icons[iid] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    return iid

# ---------------- item stacks ----------------
def stack(v):
    """normalize item/icon value -> {id, name, count, icon, alts?}"""
    if v is None: return None
    if isinstance(v, str): v = {'id': v}
    iid = v.get('id', 'minecraft:air'); cnt = v.get('Count', v.get('count', 1)); tag = v.get('tag') or {}
    if iid == 'itemfilters:or':
        alts = [stack(x) for x in tag.get('items', [])]
        alts = [a for a in alts if a]
        r = {'id': iid, 'name': ' / '.join(a['name'] for a in alts[:4]) + (' …' if len(alts) > 4 else ''),
             'any': True, 'alts': alts, 'count': cnt}
        r['icon'] = next((a.get('icon') for a in alts if a.get('icon')), None)
        return r
    if iid == 'itemfilters:tag':
        tg = tag.get('value', '')
        its = tag_items(tg)
        r = {'id': iid, 'name': f'Any #{tg}', 'tag': tg, 'count': cnt}
        for x in its[:10]:
            if icon_for(x): r['icon'] = x; break
        return r
    if iid in ('itemfilters:id_regex', 'itemfilters:mod'):
        return {'id': iid, 'name': f"Any item matching {tag.get('value', '')}", 'count': cnt}
    name = item_name(iid)
    disp = (tag.get('display') or {}).get('Name') if isinstance(tag, dict) else None
    if disp:
        try:
            dj = json.loads(disp); name = dj.get('text', name) if isinstance(dj, dict) else name
        except Exception: pass
    if isinstance(tag, dict) and 'patchouli:book' in tag:
        bk = tag['patchouli:book'].split(':')[-1].replace('_', ' ').title()
        name = bk
    return {'id': iid, 'name': name, 'count': cnt, 'icon': icon_for(iid)}

# ---------------- quests ----------------
data = load(os.path.join(QDIR, 'data.snbt'))
groups = load(os.path.join(QDIR, 'chapter_groups.snbt'))['chapter_groups']
EXPERT_Q, NORMAL_Q = '2CCCDD05AED3153F', '0E45018D600614BA'

def conv_task(t):
    ty = t.get('type'); o = {'type': ty, 'title': t.get('title')}
    if ty == 'item':
        o['item'] = stack(t.get('item')); o['count'] = t.get('count', 1)
        if t.get('consume_items'): o['consume'] = True
    elif ty == 'advancement': o['advancement'] = t.get('advancement')
    elif ty == 'dimension': o['dimension'] = t.get('dimension')
    elif ty == 'observation': o['observe'] = t.get('to_observe')
    elif ty == 'stat': o['stat'] = t.get('stat'); o['value'] = t.get('value')
    elif ty == 'gamestage': o['stage'] = t.get('stage')
    if t.get('optional_task'): o['optional'] = True
    if 'icon' in t: o['icon'] = stack(t['icon'])
    return o

def conv_reward(r):
    ty = r.get('type'); o = {'type': ty, 'title': r.get('title')}
    if ty == 'item': o['item'] = stack(r.get('item')); o['count'] = r.get('count', 1)
    elif ty in ('xp', 'xp_levels'): o['xp'] = r.get('xp', r.get('xp_levels'))
    elif ty == 'command':
        cmd = r.get('command', '')
        m = re.search(r'loot (?:give|spawn) .* loot (\S+)', cmd)
        if m: o['loot'] = m.group(1)
    elif ty in ('random', 'choice', 'loot'): o['table'] = r.get('table_id')
    if 'icon' in r: o['icon'] = stack(r['icon'])
    return o

quest_icons_needed = []
chapters = []
allq = {}
for f in sorted(glob.glob(os.path.join(QDIR, 'chapters/*.snbt'))):
    c = load(f)
    ch = {'id': c['id'], 'file': c['filename'], 'title': c.get('title', c['filename']),
          'subtitle': c.get('subtitle'), 'group': c.get('group', ''), 'order': c.get('order_index', 0),
          'icon': stack(c.get('icon')), 'hidden': bool(c.get('always_invisible')),
          'default_shape': c.get('default_quest_shape') or data.get('default_quest_shape', 'circle'),
          'quests': [], 'links': []}
    for q in c.get('quests', []):
        tasks = [conv_task(t) for t in q.get('tasks', [])]
        title = q.get('title')
        if not title and tasks:
            t0 = tasks[0]
            title = t0.get('title') or (t0.get('item') or {}).get('name') or t0.get('type', '').title()
        icon = stack(q['icon']) if 'icon' in q else None
        if not icon or not icon.get('icon'):
            for t in tasks:
                cand = t.get('icon') or t.get('item')
                if cand and cand.get('icon'): icon = cand; break
        qo = {'id': q['id'], 'title': title or '', 'subtitle': q.get('subtitle'),
              'desc': q.get('description', []), 'x': q.get('x', 0), 'y': q.get('y', 0),
              'size': q.get('size', 1), 'shape': q.get('shape') or ch['default_shape'],
              'deps': q.get('dependencies', []), 'dep_req': q.get('dependency_requirement'),
              'hide_lines': q.get('hide_dependency_lines', c.get('default_hide_dependency_lines', False)),
              'hidden': bool(q.get('hide')), 'optional': bool(q.get('optional')),
              'tasks': tasks, 'rewards': [conv_reward(r) for r in q.get('rewards', [])],
              'icon': icon and icon.get('icon'), 'chapter': c['id']}
        ch['quests'].append(qo); allq[q['id']] = qo
    for l in c.get('quest_links', []):
        ch['links'].append({'id': l.get('id'), 'linked': l.get('linked_quest'), 'x': l.get('x', 0), 'y': l.get('y', 0),
                            'size': l.get('size', 1), 'shape': l.get('shape')})
    chapters.append(ch)

# pack mode: chapter mode = which mode-gate quest its quests depend on
for ch in chapters:
    modes = set()
    for q in ch['quests']:
        if EXPERT_Q in q['deps']: modes.add('expert')
        if NORMAL_Q in q['deps']: modes.add('normal')
        q['deps'] = [d for d in q['deps'] if d not in (EXPERT_Q, NORMAL_Q)]
    ch['mode'] = 'both' if len(modes) != 1 else modes.pop()
    if ch['file'] == 'hidden_quests': ch['hidden'] = True
    if ch['group'] == '2FE70BF4886F08F4': ch['mode'] = 'expert'  # "Expert" chapter group

reward_tables = {}
for f in glob.glob(os.path.join(QDIR, 'reward_tables/*.snbt')):
    t = load(f)
    reward_tables[t.get('id', os.path.basename(f))] = {
        'title': t.get('title', os.path.basename(f)[:-5].replace('_', ' ').title()),
        'items': [dict(stack(r.get('item')) or {}, weight=r.get('weight', 1)) for r in t.get('rewards', []) if r.get('item')]}

missing = sorted(k for k, v in icons.items() if v is None)
print('icons', len(icons), 'missing', len(missing), file=sys.stderr)
open(os.path.join(os.path.dirname(OUT), 'missing_icons.txt'), 'w').write('\n'.join(missing))

out = {'title': data.get('title', 'Quests'), 'groups': groups, 'chapters': chapters,
       'icons': {k: v for k, v in icons.items() if v}, 'reward_tables': reward_tables,
       'questIndex': {k: v['chapter'] for k, v in allq.items()}}
with open(OUT, 'w') as f: json.dump(out, f, separators=(',', ':'))
print('wrote', OUT, os.path.getsize(OUT), file=sys.stderr)
