(() => {
  const U = 52; // px per quest grid unit
  const BASE = 40; // node px at size 1
  const $ = (s) => document.querySelector(s);
  let D, mode = 'expert', chapter = null, sel = null;
  let view = { x: 0, y: 0, k: 1 };
  const qById = new Map(), chById = new Map();
  const dependents = new Map();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function iconHTML(id, label, cls = '') {
    const src = id && D.icons[id];
    if (src) return `<img class="mc ${cls}" src="${src}" alt="" loading="lazy">`;
    const l = (label || id || '?').replace(/^.*:/, '').replace(/[^a-z0-9]/gi, '').slice(0, 2);
    return `<span class="ph ${cls}">${esc(l)}</span>`;
  }

  // ---------- Minecraft text formatting ----------
  const COLORS = { black: 0, dark_blue: 1, dark_green: 2, dark_aqua: 3, dark_red: 4, dark_purple: 5, gold: 6, gray: 7, dark_gray: 8, blue: 9, green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f' };
  function fmtLegacy(s) {
    let out = '', open = 0, st = {};
    const parts = String(s).split(/[&§]([0-9a-fk-or])/i);
    const flush = () => { while (open) { out += '</span>'; open--; } };
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { out += esc(parts[i]); continue; }
      const c = parts[i].toLowerCase();
      if (c === 'r') { flush(); continue; }
      if (/[0-9a-f]/.test(c)) { flush(); out += `<span style="color:var(--mc-${c})">`; open++; }
      else if (c === 'n') { out += '<span class="mc-u">'; open++; }
      else if (c === 'o') { out += '<span class="mc-i">'; open++; }
      else if (c === 'l') { out += '<span class="mc-b">'; open++; }
      else if (c === 'm') { out += '<span class="mc-s">'; open++; }
    }
    flush();
    return out;
  }
  function fmtJson(j) {
    if (typeof j === 'string') return fmtLegacy(j);
    if (Array.isArray(j)) return j.map(fmtJson).join('');
    let inner = fmtLegacy(j.text ?? (j.translate ?? '')) + (j.extra ? fmtJson(j.extra) : '');
    const style = [];
    if (j.color) style.push(`color:${j.color in COLORS ? `var(--mc-${COLORS[j.color]})` : esc(j.color)}`);
    const cls = [j.underlined && j.underlined !== 'false' ? 'mc-u' : '', j.bold && j.bold !== 'false' ? 'mc-b' : '', j.italic && j.italic !== 'false' ? 'mc-i' : ''].join(' ');
    inner = `<span class="${cls}" style="${style.join(';')}">${inner}</span>`;
    const ce = j.clickEvent;
    if (ce && ce.action === 'open_url' && /^https?:/.test(ce.value)) inner = `<a href="${esc(ce.value)}" target="_blank" rel="noopener">${inner}</a>`;
    return inner;
  }
  function fmtLine(line) {
    const t = line.trim();
    if (t === '{@pagebreak}') return '<hr>';
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return `<p>${fmtJson(JSON.parse(t))}</p>`; } catch {}
    }
    return `<p>${fmtLegacy(line) || '&nbsp;'}</p>`;
  }
  const plain = (s) => String(s ?? '').replace(/[&§][0-9a-fk-or]/gi, '');

  // ---------- data ----------
  fetch('quests.json').then((r) => r.json()).then((d) => {
    D = d;
    $('#pack-title').textContent = d.title;
    for (const ch of d.chapters) {
      chById.set(ch.id, ch);
      for (const q of ch.quests) {
        qById.set(q.id, q);
        for (const dep of q.deps) {
          if (!dependents.has(dep)) dependents.set(dep, []);
          dependents.get(dep).push(q.id);
        }
      }
    }
    mode = store.get('qb-mode') || 'expert';
    setMode(mode, false);
    window.addEventListener('hashchange', route);
    route();
  });

  const visibleChapters = () => D.chapters.filter((c) => !c.hidden && (c.mode === 'both' || c.mode === mode) && c.quests.length);

  function setMode(m, reroute = true) {
    mode = m; store.set('qb-mode', m);
    document.querySelectorAll('.mode-toggle button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === m));
    renderNav();
    if (reroute) {
      // jump to the sibling chapter of the other mode if one exists
      if (chapter && chapter.mode !== 'both' && chapter.mode !== m) {
        const base = chapter.file.replace(/_expert$/, '');
        const alt = visibleChapters().find((c) => c.file === (m === 'expert' ? base + '_expert' : base)) || visibleChapters().find((c) => c.file.replace(/_expert$/, '') === base);
        location.hash = alt ? alt.file : visibleChapters()[0].file;
      }
      if (sQuery()) doSearch();
    }
  }
  document.querySelectorAll('.mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function renderNav() {
    const chs = visibleChapters();
    const groups = [{ id: '', title: '' }, ...D.groups];
    let html = '';
    for (const g of groups) {
      const list = chs.filter((c) => c.group === g.id).sort((a, b) => a.order - b.order);
      if (!list.length) continue;
      if (g.title) html += `<div class="group-title">${esc(g.title)}</div>`;
      for (const c of list) {
        const n = c.quests.length;
        html += `<button class="ch-btn" data-file="${esc(c.file)}" ${chapter === c ? 'aria-current="true"' : ''}>${iconHTML(c.icon?.icon, c.title)}<span>${esc(plain(c.title))}</span><span class="count">${n}</span></button>`;
      }
    }
    $('#chapters').innerHTML = html;
  }
  $('#chapters').addEventListener('click', (e) => {
    const b = e.target.closest('.ch-btn'); if (!b) return;
    location.hash = b.dataset.file;
    $('#sidebar').classList.remove('open');
  });

  function route() {
    const [file, qid] = decodeURIComponent(location.hash.slice(1)).split('/');
    let ch = D.chapters.find((c) => c.file === file);
    if (ch && ch.mode !== 'both' && ch.mode !== mode) { mode = ch.mode; setMode(mode, false); }
    if (!ch || ch.hidden) ch = visibleChapters().sort((a, b) => (a.group === '' ? -1 : 0) - (b.group === '' ? -1 : 0) || a.order - b.order)[0];
    if (ch !== chapter) { chapter = ch; renderChapter(); renderNav(); }
    if (qid && qById.has(qid)) { selectQuest(qById.get(qid), true); } else closePanel(false);
  }

  // ---------- board ----------
  function shapeOf(s) { return ['circle', 'square', 'rsquare', 'diamond', 'hexagon', 'pentagon', 'octagon', 'gear', 'heart'].includes(s) ? s : 'circle'; }

  function renderChapter() {
    const ch = chapter;
    $('#ch-title').textContent = plain(ch.title);
    $('#ch-sub').textContent = Array.isArray(ch.subtitle) ? plain(ch.subtitle.join(' ')) : plain(ch.subtitle || '');
    const ci = ch.icon?.icon && D.icons[ch.icon.icon];
    $('#ch-icon').src = ci || ''; $('#ch-icon').style.visibility = ci ? 'visible' : 'hidden';
    document.title = `${plain(ch.title)} · ${D.title} Quests`;

    const items = ch.quests.map((q) => ({ q, x: q.x, y: q.y, size: q.size || 1, shape: q.shape }));
    for (const l of ch.links) {
      const q = qById.get(l.linked); if (!q) continue;
      items.push({ q, x: l.x, y: l.y, size: l.size || q.size || 1, shape: l.shape || q.shape, link: true });
    }
    const pos = new Map();
    let html = '';
    for (const it of items) {
      const px = it.x * U, py = it.y * U, s = BASE * it.size;
      if (!it.link || !pos.has(it.q.id)) pos.set(it.q.id, { x: px, y: py, r: s / 2 });
      const cls = ['q', `shape-${shapeOf(it.shape)}`, it.q.optional ? 'optional' : '', it.q.hidden ? 'hiddenq' : '', it.link ? 'link' : ''].join(' ');
      html += `<button class="${cls}" data-id="${it.q.id}" style="left:${px}px;top:${py}px;width:${s}px;height:${s}px" aria-label="${esc(plain(it.q.title))}"><span class="frame"></span>${iconHTML(it.q.icon, it.q.title)}</button>`;
    }
    $('#nodes').innerHTML = html;

    let lines = '';
    for (const q of ch.quests) {
      if (q.hide_lines) continue;
      const b = pos.get(q.id);
      for (const dep of q.deps) {
        const a = pos.get(dep); if (!a) continue;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        lines += `<path data-from="${dep}" data-to="${q.id}" d="M${a.x + ux * a.r} ${a.y + uy * a.r}L${b.x - ux * b.r} ${b.y - uy * b.r}"/>`;
      }
    }
    $('#lines').innerHTML = lines;
    chapter._bounds = bounds(items);
    fit();
  }

  function bounds(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const r = (BASE * it.size) / 2;
      x0 = Math.min(x0, it.x * U - r); y0 = Math.min(y0, it.y * U - r);
      x1 = Math.max(x1, it.x * U + r); y1 = Math.max(y1, it.y * U + r);
    }
    if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0, y0, x1, y1 };
  }

  const vp = $('#viewport'), canvas = $('#canvas');
  function apply() {
    canvas.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    const g = 26 * view.k;
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${view.x}px ${view.y}px`;
  }
  function fit() {
    const b = chapter._bounds, r = vp.getBoundingClientRect(), pad = 40;
    const k = Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0), 1.6);
    view.k = Math.max(0.25, k);
    view.x = r.width / 2 - ((b.x0 + b.x1) / 2) * view.k;
    view.y = r.height / 2 - ((b.y0 + b.y1) / 2) * view.k;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const k = Math.min(4, Math.max(0.2, view.k * f));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k; apply();
  }
  window.addEventListener('resize', () => chapter && fit());
  $('#zoom-fit').onclick = fit;
  $('#zoom-in').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
  $('#zoom-out').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); };
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // pointer pan + pinch
  const ptrs = new Map(); let moved = 0, pinch = null;
  vp.addEventListener('pointerdown', (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  window.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 4 && !vp.hasPointerCapture(e.pointerId)) { try { vp.setPointerCapture(e.pointerId); } catch {} vp.classList.add('dragging'); }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), r = vp.getBoundingClientRect();
      zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d;
    } else if (ptrs.size === 1 && moved > 4) { view.x += dx; view.y += dy; apply(); }
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) vp.classList.remove('dragging'); };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);

  $('#nodes').addEventListener('click', (e) => {
    if (moved > 6) return;
    const b = e.target.closest('.q'); if (!b) return;
    location.hash = `${chapter.file}/${b.dataset.id}`;
  });
  vp.addEventListener('click', (e) => { if (moved <= 6 && !e.target.closest('.q') && sel) location.hash = chapter.file; });

  // tooltip
  const tip = $('#tooltip');
  $('#nodes').addEventListener('pointerover', (e) => {
    const b = e.target.closest('.q'); if (!b || e.pointerType === 'touch') return;
    const q = qById.get(b.dataset.id);
    tip.innerHTML = `${fmtLegacy(q.title)}${q.subtitle ? `<small>${fmtLegacy(q.subtitle)}</small>` : ''}`;
    tip.hidden = false;
  });
  $('#nodes').addEventListener('pointerout', (e) => { if (e.target.closest('.q')) tip.hidden = true; });
  window.addEventListener('pointermove', (e) => { if (!tip.hidden) { tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; } });

  // ---------- panel ----------
  function highlight(q) {
    document.querySelectorAll('.q.sel').forEach((n) => n.classList.remove('sel'));
    document.querySelectorAll('#lines path').forEach((p) => p.classList.remove('hi', 'hi-out'));
    if (!q) return;
    document.querySelectorAll(`.q[data-id="${q.id}"]`).forEach((n) => n.classList.add('sel'));
    document.querySelectorAll(`#lines path[data-to="${q.id}"]`).forEach((p) => p.classList.add('hi'));
    document.querySelectorAll(`#lines path[data-from="${q.id}"]`).forEach((p) => p.classList.add('hi-out'));
  }

  function centerOn(q) {
    const r = vp.getBoundingClientRect();
    const px = q.x * U * view.k + view.x, py = q.y * U * view.k + view.y;
    const panelW = window.innerWidth > 760 ? 460 : 0;
    const panelH = window.innerWidth <= 760 ? r.height * 0.55 : 0;
    if (px < 40 || px > r.width - panelW - 40 || py < 40 || py > r.height - panelH - 40) {
      view.x += (r.width - panelW) / 2 - px; view.y += (r.height - panelH) / 2 - py; apply();
    }
  }

  function stackRow(st, count, extra = '') {
    if (!st) return '';
    const n = count || st.count || 1;
    let alts = '';
    if (st.alts) alts = `<div class="alts">${st.alts.map((a) => `<span title="${esc(a.name)}">${iconHTML(a.icon, a.name)}</span>`).join('')}</div>`;
    const sub = st.tag ? `#${esc(st.tag)}` : st.alts ? 'Any of' : esc(st.id);
    return `<div class="row">${iconHTML(st.icon, st.name)}<div class="t">${esc(st.alts ? 'Any of these' : st.name)}<small>${sub}${extra}</small>${alts}</div>${n > 1 ? `<span class="n">×${n}</span>` : ''}</div>`;
  }

  const TASK_LABEL = { checkmark: 'Click to complete', advancement: 'Advancement', dimension: 'Visit dimension', observation: 'Look at', stat: 'Statistic', gamestage: 'Game stage', kill: 'Kill', location: 'Location' };
  function taskHTML(t) {
    if (t.type === 'item') return stackRow(t.item, t.count, t.consume ? ' · consumed' : '');
    const label = TASK_LABEL[t.type] || t.type;
    const detail = t.advancement || t.dimension || t.observe || (t.stat ? `${t.stat} ≥ ${t.value}` : '') || t.stage || '';
    const ic = t.icon?.icon;
    return `<div class="row">${iconHTML(ic, label)}<div class="t">${esc(plain(t.title) || label)}<small>${esc(t.title ? label + (detail ? ' · ' + detail : '') : detail)}</small></div></div>`;
  }
  function rewardHTML(r) {
    if (r.type === 'item') return stackRow(r.item, r.count);
    if (r.type === 'xp' || r.type === 'xp_levels') return `<div class="row"><span class="ph">XP</span><div class="t">${r.xp} ${r.type === 'xp_levels' ? 'levels' : 'experience'}</div></div>`;
    if (r.type === 'command') {
      return `<div class="row">${iconHTML(r.icon?.icon, r.title)}<div class="t">${esc(plain(r.title) || 'Command reward')}<small>${r.loot ? 'Loot box' : 'Command'}</small></div></div>`;
    }
    if (r.type === 'random' || r.type === 'choice' || r.type === 'loot') {
      const tb = D.reward_tables[r.table];
      return `<div class="row">${iconHTML(r.icon?.icon, 'RT')}<div class="t">${esc(plain(r.title) || tb?.title || 'Reward table')}<small>${r.type === 'choice' ? 'Choose one' : 'Random reward'}</small>${tb ? `<div class="alts">${tb.items.map((a) => `<span title="${esc(a.name)}">${iconHTML(a.icon, a.name)}</span>`).join('')}</div>` : ''}</div></div>`;
    }
    return `<div class="row"><span class="ph">?</span><div class="t">${esc(plain(r.title) || r.type)}</div></div>`;
  }
  function questLink(id) {
    const q = qById.get(id); if (!q) return '';
    const ch = chById.get(q.chapter);
    const other = ch !== chapter ? `<small>${esc(plain(ch.title))}</small>` : '';
    return `<button class="dep-link" data-goto="${ch.file}/${q.id}">${iconHTML(q.icon, q.title)}<span>${fmtLegacy(q.title)}</span>${other}</button>`;
  }

  function selectQuest(q, fromRoute) {
    sel = q;
    highlight(q);
    const tags = [];
    if (q.optional) tags.push('Optional');
    if (q.hidden) tags.push('Hidden until unlocked');
    if (q.dep_req === 'one_completed' || q.dep_req === 'one_started') tags.push('Needs any one prerequisite');
    const desc = (q.desc || []).map(fmtLine).join('');
    const deps = q.deps.filter((d) => qById.has(d));
    const next = (dependents.get(q.id) || []).filter((d) => { const c = chById.get(qById.get(d).chapter); return !c.hidden && (c.mode === 'both' || c.mode === mode); });
    $('#panel-body').innerHTML = `
      <div class="p-head"><div class="big">${iconHTML(q.icon, q.title)}</div><div><h3>${fmtLegacy(q.title)}</h3>${q.subtitle ? `<p>${fmtLegacy(q.subtitle)}</p>` : ''}</div></div>
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
      ${desc.replace(/<p>&nbsp;<\/p>$/, '') ? `<div class="desc">${desc}</div>` : ''}
      ${q.tasks.length ? `<div class="sec"><h4>Tasks</h4>${q.tasks.map(taskHTML).join('')}</div>` : ''}
      ${q.rewards.length ? `<div class="sec"><h4>Rewards</h4>${q.rewards.map(rewardHTML).join('')}</div>` : ''}
      ${deps.length ? `<div class="sec"><h4>Requires</h4>${deps.map(questLink).join('')}</div>` : ''}
      ${next.length ? `<div class="sec"><h4>Unlocks</h4>${next.map(questLink).join('')}</div>` : ''}`;
    $('#panel').hidden = false;
    $('#panel-body').scrollTop = 0;
    if (fromRoute) centerOn(q);
  }
  function closePanel() { sel = null; highlight(null); $('#panel').hidden = true; }
  $('#panel-close').onclick = () => { location.hash = chapter.file; };
  $('#panel').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) location.hash = b.dataset.goto; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (sel) location.hash = chapter.file; else if (sQuery()) { $('#search').value = ''; doSearch(); } }
    if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
  });

  // ---------- search ----------
  const sQuery = () => $('#search').value.trim().toLowerCase();
  function doSearch() {
    const s = sQuery();
    $('#results').hidden = !s; $('#chapters').hidden = !!s;
    if (!s) return;
    const chs = new Set(visibleChapters());
    const hits = [];
    for (const ch of chs) for (const q of ch.quests) {
      const hay = [q.title, q.subtitle, ...(q.desc || []), ...q.tasks.map((t) => (t.item?.name || '') + ' ' + (t.item?.id || '') + ' ' + (t.title || ''))].join(' ').toLowerCase();
      const title = plain(q.title).toLowerCase();
      if (hay.includes(s)) hits.push({ q, ch, score: title.includes(s) ? (title.startsWith(s) ? 0 : 1) : 2 });
    }
    hits.sort((a, b) => a.score - b.score);
    $('#results').innerHTML = hits.length
      ? hits.slice(0, 200).map(({ q, ch }) => `<button class="res" data-goto="${ch.file}/${q.id}">${iconHTML(q.icon, q.title)}<span>${fmtLegacy(q.title)}<small>${esc(plain(ch.title))}</small></span></button>`).join('')
      : `<div class="res-empty">No quests match “${esc(s)}”.</div>`;
  }
  $('#search').addEventListener('input', doSearch);
  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    location.hash = b.dataset.goto; $('#sidebar').classList.remove('open');
  });
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
})();
