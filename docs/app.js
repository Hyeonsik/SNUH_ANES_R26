/* 인계보드 프론트엔드 — 의존성 없는 단일 스크립트 */
(function () {
  'use strict';

  var API_URL = (window.HB_CONFIG && window.HB_CONFIG.API_URL) || '';
  var LS = 'hb.';
  var STALE_DAYS = 365;

  // 주사기 라벨(ISO 26825) 계열 색
  var PALETTE = [
    { id: 'induction', name: '노랑 · 유도제', hex: '#FFE14D' },
    { id: 'benzo', name: '주황 · 벤조', hex: '#FF9A3C' },
    { id: 'nmb', name: '빨강 · 근이완제', hex: '#FF7378' },
    { id: 'opioid', name: '하늘 · 마약성 진통제', hex: '#7FC6E8' },
    { id: 'vaso', name: '보라 · 승압제', hex: '#C9A7E0' },
    { id: 'anticholi', name: '연두 · 항콜린제', hex: '#A6D66B' },
    { id: 'antiemetic', name: '살구 · 항구토제', hex: '#F5BFA0' },
    { id: 'local', name: '회색 · 국소마취제', hex: '#B9B4AC' },
    { id: 'mint', name: '민트', hex: '#7FD8C4' },
    { id: 'pink', name: '분홍', hex: '#F4A6CC' },
    { id: 'sand', name: '모래', hex: '#DCC788' },
    { id: 'steel', name: '청회색', hex: '#9DB4CC' }
  ];
  var ANON = { id: 'anon', name: '익명', color: 'anon' };
  var PAL = { anon: '#D5DBD9' };
  PALETTE.forEach(function (p) { PAL[p.id] = p.hex; });

  var S = {
    pw: ls('pw'), role: ls('role'), me: ls('me'),
    data: null, idx: null, lastFetch: 0, busy: false,
    draft: null, adminTab: 'basic', dirty: false, q: '', scrollSec: true
  };
  try { S.data = JSON.parse(ls('cache') || 'null'); } catch (e) { S.data = null; }
  var collapsed = {};
  try { collapsed = JSON.parse(ls('collapsed') || '{}'); } catch (e) { collapsed = {}; }

  /* ---------- 저장소 ---------- */
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(LS + k);
      if (v === null) localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, v);
    } catch (e) { return null; }
  }

  /* ---------- API ---------- */
  function api(action, payload) {
    if (!API_URL) return Promise.reject(new Error('config.js 에 API 주소가 아직 없습니다.'));
    var body = Object.assign({ action: action, pw: S.pw, by: S.me || '' }, payload || {});
    setBusy(true);
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setBusy(false);
        if (!j.ok) {
          if (j.code === 'AUTH' && action !== 'login') { logout(); }
          throw new Error(j.error || '요청에 실패했습니다.');
        }
        if (j.role && j.role !== S.role && action !== 'login') { S.role = j.role; ls('role', j.role); }
        return j;
      }, function (err) {
        setBusy(false);
        throw new Error('서버에 연결하지 못했습니다. 네트워크를 확인하세요.');
      });
  }

  function refresh(silent) {
    return api('getAll').then(function (j) {
      S.data = { config: j.config, profs: j.profs, entries: j.entries, docs: j.docs || [] };
      S.lastFetch = Date.now();
      ls('cache', JSON.stringify(S.data));
      buildIndex();
      render();
    }).catch(function (e) { if (!silent) toast(e.message); });
  }

  /* ---------- 인덱스 ---------- */
  function buildIndex() {
    var d = S.data;
    var I = { boards: {}, profs: {}, members: {}, byTarget: {}, counts: {}, last: {}, tags: {}, docs: {} };
    I.members[ANON.id] = ANON;
    (d.docs || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).forEach(function (doc) {
      var bd = I.docs[doc.board] = I.docs[doc.board] || { order: [], slots: {} };
      if (!bd.slots[doc.slot]) { bd.slots[doc.slot] = []; bd.order.push(doc.slot); }
      bd.slots[doc.slot].push(doc);
    });
    d.config.boards.forEach(function (b) { I.boards[b.id] = b; });
    d.profs.forEach(function (p) { I.profs[p.id] = p; });
    d.config.members.forEach(function (m) { I.members[m.id] = m; });
    d.entries.forEach(function (e) {
      var k = e.scope + '|' + e.target;
      (I.byTarget[k] = I.byTarget[k] || []).push(e);
      I.counts[k] = (I.counts[k] || 0) + 1;
      if (!I.last[k] || e.updatedAt > I.last[k]) I.last[k] = e.updatedAt;
      if (e.tag) (I.tags[k] = I.tags[k] || {})[e.tag] = 1;
    });
    S.idx = I;
  }

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rid(p) { return p + Math.random().toString(36).slice(2, 9); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function colorOf(memberId) {
    var m = S.idx && S.idx.members[memberId];
    return (m && PAL[m.color]) || '#D2DBD8';
  }
  function nameOf(memberId) {
    var m = S.idx && S.idx.members[memberId];
    return m ? m.name : '알 수 없음';
  }
  function initialOf(memberId) { return memberId === 'anon' ? '?' : nameOf(memberId).slice(0, 1); }
  function fmtSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n ? n + 'B' : '';
  }
  function extOf(doc) {
    if (doc.kind === 'link') return 'LINK';
    var m = String(doc.name || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toUpperCase().slice(0, 4) : 'FILE';
  }
  function snippet(text) {
    return String(text || '').replace(/\*\*/g, '').replace(/^\s*[-•·*]\s+/gm, '').replace(/\s+/g, ' ').trim();
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '.' + d.getDate();
  }
  function canWrite() { return S.role === 'member' || S.role === 'admin'; }
  function isAdmin() { return S.role === 'admin'; }

  function ago(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime(), d = (Date.now() - t) / 1000;
    if (d < 60) return '방금';
    if (d < 3600) return Math.floor(d / 60) + '분 전';
    if (d < 86400) return Math.floor(d / 3600) + '시간 전';
    if (d < 86400 * 7) return Math.floor(d / 86400) + '일 전';
    var dt = new Date(t);
    var y = String(dt.getFullYear()).slice(2);
    return y + '.' + (dt.getMonth() + 1) + '.' + dt.getDate();
  }
  function isStale(e) {
    var t = new Date(e.confirmedAt || e.updatedAt || e.createdAt).getTime();
    return Date.now() - t > STALE_DAYS * 86400000;
  }

  // **굵게**, "- " 목록, 링크, 검색 강조
  function fmt(text, q) {
    var raw = String(text || '');
    if (q) {
      var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      raw = raw.replace(re, function (m) { return '\u0001' + m + '\u0002'; });
    }
    var lines = raw.split('\n');
    var html = '', list = false, para = [];
    function flushPara() { if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; } }
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*[-•·*]\s+(.*)$/);
      if (m) {
        flushPara();
        if (!list) { html += '<ul>'; list = true; }
        html += '<li>' + inline(m[1]) + '</li>';
      } else {
        if (list) { html += '</ul>'; list = false; }
        if (ln.trim() === '') flushPara(); else para.push(inline(ln));
      }
    });
    if (list) html += '</ul>';
    flushPara();
    return html.replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
  }
  function inline(s) {
    var h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return h;
  }

  var ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function setBusy(b) {
    S.busy = b;
    var d = document.querySelector('.sync-dot');
    if (d) d.classList.toggle('busy', b);
  }

  /* ---------- 라우팅 ---------- */
  function parseRoute() {
    var h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
    return { name: h[0] || 'home', id: h[1] ? decodeURIComponent(h[1]) : null, sub: h[2] || null, third: h[3] ? decodeURIComponent(h[3]) : null };
  }
  window.addEventListener('hashchange', function () {
    if (S.dirty && parseRoute().name !== 'admin' && !confirm('저장하지 않은 설정 변경이 있습니다. 나갈까요?')) {
      history.back(); return;
    }
    if (parseRoute().name !== 'admin') { S.dirty = false; S.draft = null; }
    S.scrollSec = true; window.scrollTo(0, 0); render();
  });

  /* ---------- 렌더 ---------- */
  var app = document.getElementById('app');

  function render() {
    if (!S.pw || !S.role) return renderGate();
    if (S.role !== 'viewer' && !S.me) return renderWho();
    if (S.role !== 'viewer' && S.idx && !S.idx.members[S.me]) return renderWho();
    if (!S.data) { app.innerHTML = '<div class="loading">불러오는 중…</div>'; return; }
    if (!S.idx) buildIndex();
    document.title = S.data.config.title || '인계보드';

    var r = parseRoute();
    var body;
    switch (r.name) {
      case 'b': body = S.idx.boards[r.id] ? (r.sub === 'prof' ? viewBoardProfs(r.id) : viewBoard(r.id)) : viewMissing(); break;
      case 'p': body = S.idx.profs[r.id] ? viewProf(r.id) : viewMissing(); break;
      case 'profs': body = viewProfs(); break;
      case 'search': body = viewSearch(); break;
      case 'admin': body = isAdmin() ? viewAdmin() : viewMissing(); break;
      default: body = viewHome();
    }
    app.innerHTML =
      '<div class="shell">' + topbar(r) +
      '<div class="layout">' + sidebar(r) + '<main class="main' + (r.name === 'home' ? ' main-wide' : '') + '" id="main">' + body + '</main></div>' +
      fab(r) + '</div>';
    if (r.name === 'b' && r.sub === 's' && r.third && S.scrollSec) {
      S.scrollSec = false;
      var el = document.getElementById('sec-' + r.third);
      if (el) { el.classList.remove('collapsed'); setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0); }
    }
    if (r.name === 'search') {
      var inp = document.getElementById('q');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }

  function stripes(n) {
    var ms = S.data ? S.data.config.members.filter(function (m) { return !m.hidden; }) : [];
    var cols = ms.length ? ms.map(function (m) { return PAL[m.color]; }) : PALETTE.slice(0, 8).map(function (p) { return p.hex; });
    return cols.slice(0, n || 8);
  }

  function topbar(r) {
    var me = S.role === 'viewer'
      ? '<button class="icon-btn" data-act="menu" aria-label="메뉴"><span class="avatar" style="background:#DCE3E1">👀</span></button>'
      : '<button class="icon-btn" data-act="menu" aria-label="메뉴"><span class="avatar" style="background:' + colorOf(S.me) + '">' + esc(initialOf(S.me)) + '</span></button>';
    return '<header class="topbar"><div class="topbar-row">' +
      '<a class="brand" href="#/"><span class="brand-mark">' +
      stripes(4).map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') +
      '</span>' + esc(S.data.config.title || '인계보드') + '</a>' +
      '<span class="sync-dot' + (S.busy ? ' busy' : '') + '" title="동기화 상태"></span>' +
      '<a class="icon-btn" href="#/search" aria-label="검색">' + ICON.search + '</a>' +
      (isAdmin() ? '<a class="icon-btn" href="#/admin" aria-label="관리자 설정">' + ICON.gear + '</a>' : '') +
      me + '</div>' + strip(r) + '</header>';
  }

  function navItems() {
    var groups = [], gmap = {};
    S.data.config.boards.forEach(function (b) {
      var g = b.group || '기타';
      if (!gmap[g]) { gmap[g] = { name: g, boards: [] }; groups.push(gmap[g]); }
      gmap[g].boards.push(b);
    });
    return groups;
  }
  function isCurrent(r, name, id) {
    if (name === 'home') return r.name === 'home';
    if (name === 'profs') return r.name === 'profs' || r.name === 'p';
    return r.name === 'b' && r.id === id;
  }
  function strip(r) {
    var out = '<nav class="strip" aria-label="보드">';
    out += '<a class="chip-nav" href="#/"' + (isCurrent(r, 'home') ? ' aria-current="page"' : '') + '>홈</a>';
    navItems().forEach(function (g) {
      out += '<span class="strip-sep"></span>';
      g.boards.forEach(function (b) {
        out += '<a class="chip-nav" href="#/b/' + b.id + '"' + (isCurrent(r, 'b', b.id) ? ' aria-current="page"' : '') + '>' + esc(b.name) + '</a>';
      });
    });
    out += '<span class="strip-sep"></span><a class="chip-nav" href="#/profs"' + (isCurrent(r, 'profs') ? ' aria-current="page"' : '') + '>교수님</a>';
    return out + '</nav>';
  }
  function sidebar(r) {
    var out = '<aside class="sidebar"><div class="side-group">' +
      '<a class="side-link" href="#/"' + (isCurrent(r, 'home') ? ' aria-current="page"' : '') + '>홈</a>' +
      '<a class="side-link" href="#/profs"' + (isCurrent(r, 'profs') ? ' aria-current="page"' : '') + '>교수님 <small>' + S.data.profs.length + '</small></a></div>';
    navItems().forEach(function (g) {
      out += '<div class="side-group"><h4>' + esc(g.name) + '</h4>';
      g.boards.forEach(function (b) {
        out += '<a class="side-link" href="#/b/' + b.id + '"' + (isCurrent(r, 'b', b.id) ? ' aria-current="page"' : '') + '>' +
          esc(b.name) + '<small>' + (S.idx.counts['board|' + b.id] || '') + '</small></a>';
      });
      out += '</div>';
    });
    return out + '</aside>';
  }
  function fab(r) {
    if (!canWrite()) return '';
    if (r.name === 'b' && r.sub !== 'prof' && S.idx.boards[r.id]) return '<button class="fab" data-act="compose" data-scope="board" data-target="' + esc(r.id) + '">' + ICON.plus + '인계 추가</button>';
    if (r.name === 'p' && S.idx.profs[r.id]) return '<button class="fab" data-act="compose" data-scope="prof" data-target="' + esc(r.id) + '">' + ICON.plus + '인계 추가</button>';
    return '';
  }

  /* ---------- 화면: 로그인 ---------- */
  function renderGate(err) {
    var cols = PALETTE.slice(0, 8).map(function (p) { return p.hex; });
    app.innerHTML = '<div class="gate"><form class="gate-card" id="gate">' +
      '<div class="label-stripes">' + cols.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</div>' +
      '<h1>' + esc((S.data && S.data.config.title) || '인계보드') + '</h1>' +
      '<p>동기들끼리 쓰는 인계 공간입니다. 받은 비밀번호를 입력하세요.</p>' +
      '<label class="field"><span>비밀번호</span><input class="input" id="pw" type="password" autocomplete="current-password" required></label>' +
      '<div class="err" id="gate-err">' + esc(err || (API_URL ? '' : 'config.js 에 API 주소가 아직 없습니다.')) + '</div>' +
      '<button class="btn btn-primary btn-block" type="submit">들어가기</button></form></div>';
    document.getElementById('pw').focus();
  }

  function renderWho() {
    var ms = S.data ? S.data.config.members.filter(function (m) { return !m.hidden; }) : [];
    if (!S.data) { app.innerHTML = '<div class="loading">불러오는 중…</div>'; return; }
    if (!S.idx) buildIndex();
    app.innerHTML = '<div class="gate"><div class="gate-card">' +
      '<h1>누구신가요?</h1><p>고른 이름과 색으로 인계가 표시됩니다. 나중에 메뉴에서 바꿀 수 있어요.</p>' +
      '<div class="who-grid">' + ms.map(function (m) {
        return '<button class="who-btn" data-act="pick-me" data-id="' + esc(m.id) + '" aria-pressed="' + (S.me === m.id) + '">' +
          '<span class="avatar" style="background:' + PAL[m.color] + '">' + esc(m.name.slice(0, 1)) + '</span>' + esc(m.name) + '</button>';
      }).join('') +
      '<button class="who-btn" data-act="pick-me" data-id="anon" aria-pressed="' + (S.me === 'anon') + '"><span class="avatar" style="background:' + PAL.anon + '">?</span>익명</button>' +
      '</div>' +
      '<p class="hint" style="margin-top:12px">익명으로 고르면 쓴 글에 이름 대신 "익명"이 표시됩니다.</p>' +
      '</div></div>';
  }

  /* ---------- 화면: 말풍선 ---------- */
  function msg(e, opts) {
    opts = opts || {};
    var c = colorOf(e.authorId);
    var stale = isStale(e);
    var edited = e.updatedAt && e.updatedAt !== e.createdAt;
    var crumb = opts.crumb ? '<a class="msg-crumb" href="' + crumbHref(e) + '">' + esc(crumbText(e)) + '</a>' : '';
    if (opts.prof && S.idx.profs[e.target]) crumb = '<a class="prof-label" href="#/p/' + esc(e.target) + '">' + esc(S.idx.profs[e.target].name) + ' 교수님</a>';
    return '<div class="msg' + (stale ? ' stale' : '') + '">' +
      '<span class="avatar" style="background:' + c + '" aria-hidden="true">' + esc(initialOf(e.authorId)) + '</span>' +
      '<div><div class="msg-meta">' +
      '<span class="name-label" style="background:' + c + '">' + esc(nameOf(e.authorId)) + '</span>' +
      '<span class="msg-time" title="' + esc(e.createdAt) + '">' + ago(e.createdAt) + '</span>' +
      (edited ? '<span class="edited">· ' + esc(nameOf(e.updatedBy)) + ' 수정</span>' : '') +
      (stale ? '<span class="stale-note">1년 넘게 확인 안 됨</span>' : '') + crumb +
      '</div><button class="bubble" style="--c:' + c + '" data-act="entry" data-id="' + esc(e.id) + '">' + fmt(e.text, opts.q) + '</button></div></div>';
  }
  function crumbText(e) {
    if (e.scope === 'board') {
      var b = S.idx.boards[e.target];
      var s = b && b.sections.filter(function (x) { return x.id === e.section; })[0];
      return (b ? b.name : '?') + (s ? ' › ' + s.name : '') + (e.tag ? ' › ' + e.tag : '');
    }
    var p = S.idx.profs[e.target];
    var ps = S.data.config.profSections.filter(function (x) { return x.id === e.section; })[0];
    return (p ? p.name + ' 교수님' : '?') + (ps ? ' › ' + ps.name : '');
  }
  function crumbHref(e) { return e.scope === 'board' ? '#/b/' + e.target : '#/p/' + e.target; }

  function sectionsView(scope, target, sections) {
    var list = S.idx.byTarget[scope + '|' + target] || [];
    var known = {};
    sections.forEach(function (s) { known[s.id] = 1; });
    var orphan = list.filter(function (e) { return !known[e.section]; });
    var all = sections.slice();
    if (orphan.length) all.push({ id: '__none', name: '섹션 없음' });
    return all.map(function (s) {
      var items = s.id === '__none' ? orphan : list.filter(function (e) { return e.section === s.id; });
      var key = scope + '|' + target + '|' + s.id;
      var isCol = !!collapsed[key];
      var plain = items.filter(function (e) { return !e.tag; }).sort(byCreated);
      var tagged = {}, order = [];
      items.filter(function (e) { return e.tag; }).sort(byCreated).forEach(function (e) {
        if (!tagged[e.tag]) { tagged[e.tag] = []; order.push(e.tag); }
        tagged[e.tag].push(e);
      });
      var body = plain.map(function (e) { return msg(e); }).join('') +
        order.map(function (t) {
          return '<div class="tag-group"><span class="tag-title">' + esc(t) + '</span>' + tagged[t].map(function (e) { return msg(e); }).join('') + '</div>';
        }).join('');
      if (!items.length) body = '<div class="empty-line">' + (canWrite() ? '아직 없어요. 처음 아는 걸 남겨주세요.' : '아직 없어요.') + '</div>';
      return '<section class="section' + (isCol ? ' collapsed' : '') + '" id="sec-' + esc(s.id) + '">' +
        '<div class="section-head"><button class="section-toggle" data-act="toggle" data-key="' + esc(key) + '" aria-expanded="' + !isCol + '">' +
        '<h2>' + esc(s.name) + '</h2><span class="count">' + items.length + '</span><span class="caret">▼</span></button>' +
        (canWrite() && s.id !== '__none' ? '<button class="add-link" data-act="compose" data-scope="' + scope + '" data-target="' + esc(target) + '" data-section="' + esc(s.id) + '">추가</button>' : '') +
        '</div><div class="section-body">' + body + '</div></section>';
    }).join('');
  }
  function byCreated(a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; }

  /* ---------- 화면: 홈 ---------- */
  function viewHome() {
    var cfg = S.data.config;
    var links = cfg.links || [];
    var linkHtml = '<section class="home-block"><div class="block-head"><h2>자주 쓰는 링크</h2>' +
      (isAdmin() ? '<a class="add-link" href="#/admin" data-act="goto-links">편집</a>' : '') + '</div>' +
      (links.length ? '<div class="links-grid">' + links.map(function (l) {
        return '<a class="link-tile" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
          '<span class="link-icon" aria-hidden="true">' + esc(l.icon || '🔗') + '</span><span class="link-title">' + esc(l.title) + '</span></a>';
      }).join('') + '</div>'
        : '<div class="empty-line">' + (isAdmin() ? '관리자 설정 → 링크에서 추가하세요.' : '아직 등록된 링크가 없어요.') + '</div>') + '</section>';

    var groups = '<section class="home-block"><div class="block-head"><h2>전체 보드</h2></div><div class="ov-grid">' +
      cfg.boards.map(overviewCard).join('') + '</div></section>';

    var recent = S.data.entries.slice().sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).slice(0, 8);
    var recentHtml = recent.length ? '<section class="home-block"><div class="block-head"><h2>최근 업데이트</h2><a class="add-link" href="#/search">전체 검색</a></div><div class="list">' +
      recent.map(function (e) {
        return '<a class="list-row recent-row" href="' + crumbHref(e) + '"><i class="dot" style="background:' + colorOf(e.authorId) + '"></i>' +
          '<span class="recent-text"><b>' + esc(crumbText(e)) + '</b><span>' + esc(snippet(e.text)) + '</span></span>' +
          '<span class="sub">' + ago(e.updatedAt) + '</span></a>';
      }).join('') + '</div></section>' : '';

    var who = S.role === 'viewer' ? '' : nameOf(S.me) + ', ';
    return '<div class="page-head"><div class="eyebrow">' + esc(who) + '안녕하세요</div><h1>' + esc(cfg.title || '인계보드') + '</h1>' +
      '<p>인계 ' + S.data.entries.length + '개 · 교수님 ' + S.data.profs.length + '분 · 인계장 파일 ' + countSlots() + '개</p></div>' +
      linkHtml + groups + recentHtml;
  }
  function countSlots() {
    var n = 0;
    Object.keys(S.idx.docs).forEach(function (b) { n += S.idx.docs[b].order.length; });
    return n;
  }
  function overviewCard(b) {
    var k = 'board|' + b.id;
    var list = S.idx.byTarget[k] || [];
    var n = S.idx.counts[k] || 0, last = S.idx.last[k];
    var docs = S.idx.docs[b.id];
    var docHtml = docs ? docs.order.map(function (slot) {
      var d = docs.slots[slot][0];
      return '<button class="ov-doc" data-act="doc-open" data-id="' + esc(d.id) + '"><span class="ext ext-' + extOf(d).toLowerCase() + '">' + esc(extOf(d)) + '</span>' +
        '<span class="ov-doc-title">' + esc(d.title) + '</span><span class="sub">' + shortDate(d.at) + '</span></button>';
    }).join('') : '';
    var secs = b.sections.map(function (s) {
      var items = list.filter(function (e) { return e.section === s.id; });
      if (!items.length) return '';
      var latest = items.slice().sort(function (a, c) { return a.updatedAt < c.updatedAt ? 1 : -1; })[0];
      return '<li><a href="#/b/' + esc(b.id) + '/s/' + esc(s.id) + '"><span class="ov-sec">' + esc(s.name) + '</span>' +
        (latest ? '<span class="ov-snip"><i class="dot" style="background:' + colorOf(latest.authorId) + '"></i>' + esc(snippet(latest.text)) + '</span>'
          : '<span class="ov-snip ov-empty">비어 있음</span>') +
        '<span class="ov-n">' + (items.length || '') + '</span></a></li>';
    }).join('');
    var pc = boardProfs(b.id).length;
    if (!secs) secs = '<li class="ov-none">아직 인계 없음</li>';
    return '<article class="ov-card"><a class="ov-head" href="#/b/' + esc(b.id) + '"><span><small class="ov-group">' + esc(b.group || '') + '</small><b>' + esc(b.name) + '</b></span>' +
      '<span class="sub">' + n + '개' + (last ? ' · ' + ago(last) : '') + '</span></a>' +
      docHtml + '<ul class="ov-secs">' + secs + '</ul>' +
      (pc ? '<a class="ov-prof" href="#/b/' + esc(b.id) + '/prof">교수님 ' + pc + '분 보기</a>' : '') + '</article>';
  }

  /* ---------- 화면: 보드 ---------- */
  function boardProfs(boardId) {
    return S.data.profs.filter(function (p) { return p.boards.indexOf(boardId) >= 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }
  function boardSeg(b, sub) {
    var n = boardProfs(b.id).length;
    if (!n && !isAdmin()) return '';
    return '<nav class="seg"><a href="#/b/' + b.id + '"' + (sub !== 'prof' ? ' aria-current="page"' : '') + '>인계</a>' +
      '<a href="#/b/' + b.id + '/prof"' + (sub === 'prof' ? ' aria-current="page"' : '') + '>교수님 ' + n + '</a></nav>';
  }
  function viewBoard(id) {
    var b = S.idx.boards[id];
    return '<div class="page-head"><div class="eyebrow">' + esc(b.group || '') + '</div><h1>' + esc(b.name) + '</h1></div>' +
      boardSeg(b, null) + docsBlock(id) + sectionsView('board', id, b.sections);
  }
  function docsBlock(boardId) {
    var docs = S.idx.docs[boardId];
    if (!docs && !canWrite()) return '';
    var cards = docs ? docs.order.map(function (slot) {
      var vs = docs.slots[slot], d = vs[0];
      var meta = [d.kind === 'link' ? '링크' : fmtSize(d.size), nameOf(d.by), ago(d.at)].filter(String).join(' · ');
      return '<div class="doc-card"><span class="ext ext-' + extOf(d).toLowerCase() + '">' + esc(extOf(d)) + '</span>' +
        '<div class="doc-main"><b>' + esc(d.title) + '</b><span class="sub">' + esc(meta) + (vs.length > 1 ? ' · 이전 버전 ' + (vs.length - 1) + '개' : '') + '</span>' +
        (d.note ? '<span class="doc-note">' + esc(d.note) + '</span>' : '') + '</div>' +
        '<div class="doc-actions"><button class="btn btn-sm btn-primary" data-act="doc-open" data-id="' + esc(d.id) + '">열기</button>' +
        '<button class="btn btn-sm" data-act="doc-more" data-board="' + esc(boardId) + '" data-slot="' + esc(slot) + '">더보기</button></div></div>';
    }).join('') : '';
    return '<section class="docs-block" data-board="' + esc(boardId) + '"><div class="section-head"><div class="section-toggle"><h2>인계장 파일</h2><span class="count">' + (docs ? docs.order.length : 0) + '</span></div>' +
      (canWrite() ? '<button class="add-link" data-act="doc-upload" data-board="' + esc(boardId) + '">올리기</button>' : '') + '</div>' +
      (cards || '<div class="empty-line">hwp, pdf, pptx, docx 같은 긴 인계장 파일을 올려두면 여기서 바로 열 수 있어요.' + (canWrite() ? ' 파일을 이 영역에 끌어다 놓아도 됩니다.' : '') + '</div>') + '</section>';
  }

  function profRows(list) {
    if (!list.length) return '';
    return '<div class="list">' + list.map(function (p) {
      var n = S.idx.counts['prof|' + p.id] || 0, last = S.idx.last['prof|' + p.id];
      return '<a class="list-row" href="#/p/' + p.id + '"><span class="title">' + esc(p.name) + ' 교수님</span>' +
        '<span class="sub">' + n + '개' + (last ? ' · ' + ago(last) : '') + '</span></a>';
    }).join('') + '</div>';
  }
  function viewBoardProfs(id) {
    var b = S.idx.boards[id];
    var list = boardProfs(id);
    return '<div class="page-head"><div class="eyebrow">' + esc(b.group || '') + '</div><h1>' + esc(b.name) + '</h1></div>' +
      boardSeg(b, 'prof') +
      (list.length ? '<div class="prof-chips">' + list.map(function (p) {
        var n = S.idx.counts['prof|' + p.id] || 0;
        return '<a class="prof-chip" href="#/p/' + esc(p.id) + '"><b>' + esc(p.name) + '</b><span class="sub">' + n + '</span></a>';
      }).join('') + '</div>' : '<div class="empty-line">이 보드에 연결된 교수님이 없습니다.</div>') +
      (isAdmin() ? '<p><button class="btn btn-sm" data-act="prof-edit" data-board="' + esc(id) + '">교수님 추가</button></p>' : '') +
      (list.length ? mergedProfView(id, list) : '');
  }

  // 교수님 인계를 섹션 기준으로 합쳐서 보여준다. 섹션 안에서는 교수님별로 묶는다.
  function mergedProfView(boardId, profs) {
    var out = '<div class="block-head" style="margin-top:22px"><h2>교수님 인계 전체</h2><span class="sub">섹션별 · 이름을 누르면 교수님 페이지</span></div>';
    out += S.data.config.profSections.map(function (sec) {
      var key = 'merge|' + boardId + '|' + sec.id;
      var isCol = !!collapsed[key];
      var total = 0;
      var body = profs.map(function (p) {
        var items = (S.idx.byTarget['prof|' + p.id] || []).filter(function (e) { return e.section === sec.id; }).sort(byCreated);
        total += items.length;
        return items.map(function (e) { return msg(e, { prof: true }); }).join('');
      }).join('');
      if (!total) return '';
      return '<section class="section' + (isCol ? ' collapsed' : '') + '"><div class="section-head">' +
        '<button class="section-toggle" data-act="toggle" data-key="' + esc(key) + '" aria-expanded="' + !isCol + '">' +
        '<h2>' + esc(sec.name) + '</h2><span class="count">' + total + '</span><span class="caret">▼</span></button></div>' +
        '<div class="section-body">' + body + '</div></section>';
    }).join('');
    return out;
  }

  /* ---------- 화면: 교수님 ---------- */
  function viewProfs() {
    var q = (S.profQ || '').trim();
    var groups = navItems();
    var out = '<div class="page-head"><h1>교수님</h1><p>보드별로 모았어요. 여러 보드에 계신 분은 각각 보입니다.</p></div>' +
      '<div class="searchbar">' + ICON.search + '<input class="input" id="profq" placeholder="이름으로 찾기" value="' + esc(q) + '"></div>';
    var shown = 0;
    groups.forEach(function (g) {
      g.boards.forEach(function (b) {
        var list = boardProfs(b.id).filter(function (p) { return !q || p.name.indexOf(q) >= 0; });
        if (!list.length) return;
        shown += list.length;
        out += '<div class="list-heading">' + esc(b.name) + '</div>' + profRows(list);
      });
    });
    var loose = S.data.profs.filter(function (p) {
      return !p.boards.some(function (bid) { return S.idx.boards[bid]; }) && (!q || p.name.indexOf(q) >= 0);
    });
    if (loose.length) { shown += loose.length; out += '<div class="list-heading">보드 미지정</div>' + profRows(loose); }
    if (!shown) out += '<div class="empty-line">' + (q ? '찾는 이름이 없어요.' : '아직 등록된 교수님이 없어요.' + (isAdmin() ? ' 아래 버튼으로 추가하세요.' : ' 관리자에게 추가를 요청하세요.')) + '</div>';
    if (isAdmin()) out += '<p><button class="btn btn-sm" data-act="prof-edit">교수님 추가</button></p>';
    return out;
  }
  function viewProf(id) {
    var p = S.idx.profs[id];
    var chips = p.boards.filter(function (b) { return S.idx.boards[b]; }).map(function (b) {
      return '<a class="chip" href="#/b/' + b + '/prof">' + esc(S.idx.boards[b].name) + '</a>';
    }).join('');
    return '<div class="page-head"><div class="eyebrow">교수님 인계</div><h1>' + esc(p.name) + ' 교수님</h1>' +
      (p.memo ? '<p>' + esc(p.memo) + '</p>' : '') +
      '<div class="chips">' + chips + (isAdmin() ? '<button class="chip" data-act="prof-edit" data-id="' + esc(id) + '">정보 수정</button>' : '') + '</div></div>' +
      sectionsView('prof', id, S.data.config.profSections);
  }

  /* ---------- 화면: 검색 ---------- */
  function viewSearch() {
    var q = S.q.trim();
    var res = [];
    if (q.length >= 1) {
      var lq = q.toLowerCase();
      res = S.data.entries.filter(function (e) {
        return (e.text + ' ' + (e.tag || '') + ' ' + crumbText(e)).toLowerCase().indexOf(lq) >= 0;
      }).sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).slice(0, 100);
    }
    return '<div class="page-head"><h1>검색</h1></div>' +
      '<div class="searchbar">' + ICON.search + '<input class="input" id="q" type="search" placeholder="약 이름, 수술명, 교수님 이름…" value="' + esc(S.q) + '" autocomplete="off"></div>' +
      (q ? '<p class="muted">' + res.length + '개 찾음' + (res.length === 100 ? ' (최대 100개 표시)' : '') + '</p>' : '') +
      res.map(function (e) { return msg(e, { crumb: true, q: q }); }).join('');
  }

  function viewMissing() {
    return '<div class="page-head"><h1>찾는 페이지가 없어요</h1><p>삭제되었거나 권한이 없는 페이지입니다. <a href="#/">홈으로 가기</a></p></div>';
  }

  /* ---------- 시트 ---------- */
  var sheet = document.getElementById('sheet');
  function openSheet(html) {
    sheet.innerHTML = '<div class="sheet-panel" role="dialog" aria-modal="true"><div class="grabber"></div>' + html + '</div>';
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = sheet.querySelector('[autofocus]');
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeSheet() {
    sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = '';
  }
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !sheet.hidden) closeSheet(); });

  function sectionsFor(scope, target) {
    return scope === 'board' ? S.idx.boards[target].sections : S.data.config.profSections;
  }

  function openComposer(scope, target, sectionId, entry) {
    var secs = sectionsFor(scope, target);
    var where = scope === 'board' ? S.idx.boards[target].name : S.idx.profs[target].name + ' 교수님';
    var cur = entry ? entry.section : (sectionId || (secs[0] && secs[0].id));
    var tags = Object.keys(S.idx.tags[scope + '|' + target] || {}).sort();
    openSheet('<form id="composer" data-scope="' + scope + '" data-target="' + esc(target) + '"' + (entry ? ' data-id="' + esc(entry.id) + '"' : '') + '>' +
      '<h2 class="sheet-title">' + (entry ? '인계 수정' : esc(where) + '에 인계 추가') + '</h2>' +
      '<label class="field"><span>섹션</span><select class="select" name="section">' +
      secs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === cur ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>수술명·주제 (선택)</span><input class="input" name="tag" list="taglist" maxlength="60" placeholder="예: Tonsillectomy" value="' + esc(entry ? entry.tag : '') + '">' +
      '<datalist id="taglist">' + tags.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
      '<div class="hint">같은 이름끼리 섹션 안에서 묶여 보입니다.</div></label>' +
      '<label class="field"><span>내용</span><textarea class="textarea" name="text" required maxlength="5000" autofocus placeholder="한 가지씩 짧게 남기면 찾기 쉬워요.">' + esc(entry ? entry.text : '') + '</textarea>' +
      '<div class="hint">**굵게** · 줄 앞에 "- " 를 쓰면 목록 · Ctrl/⌘+Enter 저장</div></label>' +
      (!entry && S.me !== 'anon' ? '<label class="check" style="margin:0 0 14px"><input type="checkbox" name="anon">익명으로 올리기</label>' : '') +
      '<div class="sheet-actions"><button class="btn" type="button" data-act="close">취소</button>' +
      '<button class="btn btn-primary" type="submit">' + (entry ? '수정 저장' : '추가') + '</button></div></form>');
  }

  function openEntry(id) {
    var e = S.data.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var meta = nameOf(e.authorId) + ' · ' + new Date(e.createdAt).toLocaleDateString('ko-KR') +
      (e.confirmedAt ? ' · 마지막 확인 ' + ago(e.confirmedAt) + (e.confirmedBy ? ' (' + nameOf(e.confirmedBy) + ')' : '') : '');
    openSheet('<h2 class="sheet-title">' + esc(crumbText(e)) + '</h2>' +
      '<div class="preview">' + esc(e.text.slice(0, 200)) + '</div>' +
      '<p class="muted" style="margin:-6px 0 14px;font-size:13px">' + esc(meta) + '</p>' +
      '<div class="action-list">' +
      (canWrite() ? '<button class="btn" data-act="edit" data-id="' + esc(id) + '">수정</button>' +
        '<button class="btn" data-act="confirm" data-id="' + esc(id) + '">아직 유효해요 (확인 날짜 갱신)</button>' : '') +
      '<button class="btn" data-act="history" data-id="' + esc(id) + '">수정 이력 보기</button>' +
      '<button class="btn" data-act="copy" data-id="' + esc(id) + '">내용 복사</button>' +
      (canWrite() ? '<button class="btn btn-danger" data-act="delete" data-id="' + esc(id) + '">삭제</button>' : '') +
      '<button class="btn" data-act="close">닫기</button></div>');
  }

  function openMenu() {
    openSheet('<h2 class="sheet-title">' + (S.role === 'viewer' ? '보기 전용으로 접속 중' : esc(nameOf(S.me)) + '님') + '</h2>' +
      '<p class="muted" style="margin:-8px 0 14px;font-size:13.5px">권한: ' + ({ admin: '관리자', member: '동기', viewer: '보기 전용' }[S.role]) + '</p>' +
      '<div class="action-list">' +
      (S.role !== 'viewer' ? '<button class="btn" data-act="change-me">이름 바꾸기</button>' : '') +
      '<button class="btn" data-act="reload">새로고침</button>' +
      (isAdmin() ? '<a class="btn" href="#/admin" data-act="close">관리자 설정</a>' : '') +
      '<button class="btn btn-danger" data-act="logout">로그아웃</button>' +
      '<button class="btn" data-act="close">닫기</button></div>');
  }

  function openHistory(id) {
    openSheet('<h2 class="sheet-title">수정 이력</h2><div id="hist" class="loading">불러오는 중…</div><div class="sheet-actions"><button class="btn" data-act="close">닫기</button></div>');
    api('history', { id: id }).then(function (j) {
      var el = document.getElementById('hist');
      if (!el) return;
      var label = { add: '작성', edit: '수정', 'delete': '삭제', confirm: '확인' };
      el.className = '';
      el.innerHTML = j.history.slice().reverse().map(function (h) {
        return '<div class="hist-item"><b>' + esc(nameOf(h.by)) + '</b> ' + label[h.action] + ' · <span class="muted">' + new Date(h.ts).toLocaleString('ko-KR') + '</span>' +
          (h.action === 'edit' ? '<div class="diff">이전: ' + esc(h.before) + '</div>' : '') + '</div>';
      }).join('') || '<p class="muted">이력이 없습니다.</p>';
    }).catch(function (e) { toast(e.message); });
  }

  function openProfEditor(id, boardId) {
    var p = id ? S.idx.profs[id] : { name: '', boards: boardId ? [boardId] : [], memo: '' };
    openSheet('<form id="prof-form"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' +
      '<h2 class="sheet-title">' + (id ? '교수님 정보 수정' : '교수님 추가') + '</h2>' +
      '<label class="field"><span>이름</span><input class="input" name="name" required maxlength="30" value="' + esc(p.name) + '" autofocus placeholder="성함만 (교수님 제외)"></label>' +
      '<div class="field"><span>보드</span>' + S.data.config.boards.map(function (b) {
        return '<label class="check"><input type="checkbox" name="boards" value="' + esc(b.id) + '"' + (p.boards.indexOf(b.id) >= 0 ? ' checked' : '') + '>' + esc(b.name) + '</label>';
      }).join('') + '</div>' +
      '<label class="field"><span>한 줄 메모 (선택)</span><input class="input" name="memo" maxlength="200" value="' + esc(p.memo || '') + '" placeholder="예: 소아 심장 주로 하심"></label>' +
      '<div class="sheet-actions">' + (id ? '<button class="btn btn-danger" type="button" data-act="prof-delete" data-id="' + esc(id) + '">삭제</button>' : '') +
      '<button class="btn" type="button" data-act="close">취소</button><button class="btn btn-primary" type="submit">저장</button></div></form>');
  }

  /* ---------- 인계장 파일 ---------- */
  var MAX_UPLOAD = 25 * 1024 * 1024;
  function findDoc(id) { return (S.data.docs || []).filter(function (x) { return x.id === id; })[0]; }

  function setDropFile(form, file) {
    var input = form.querySelector('[name=file]');
    try {
      var dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    } catch (e) { form._dropped = file; }
    showPicked(form);
  }
  function pickedFile(form) {
    var input = form.querySelector('[name=file]');
    return (input.files && input.files[0]) || form._dropped || null;
  }
  function showPicked(form) {
    var f = pickedFile(form), t = form.querySelector('.dz-text');
    if (!t) return;
    t.textContent = f ? f.name + ' (' + fmtSize(f.size) + ')' : '파일을 여기로 끌어다 놓거나 눌러서 고르세요';
    form.querySelector('.dropzone').classList.toggle('has-file', !!f);
    if (f) {
      var title = form.querySelector('[name=title]');
      if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '');
      form.querySelector('[name=file]').required = false;
    }
  }

  function openDocUpload(boardId, slot, droppedFile) {
    var cur = slot && S.idx.docs[boardId] ? S.idx.docs[boardId].slots[slot][0] : null;
    var now = new Date();
    var defNote = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 업데이트';
    openSheet('<form id="doc-form" data-board="' + esc(boardId) + '"' + (slot ? ' data-slot="' + esc(slot) + '"' : '') + ' data-mode="file">' +
      '<h2 class="sheet-title">' + (cur ? '새 버전으로 교체' : esc(S.idx.boards[boardId].name) + ' 인계장 올리기') + '</h2>' +
      (cur ? '<p class="muted" style="margin:-8px 0 14px;font-size:14px">지금 버전(' + esc(cur.title) + ', ' + shortDate(cur.at) + ')은 이전 버전으로 남습니다.</p>' : '') +
      '<div class="seg" style="margin:0 0 14px"><a href="javascript:void 0" data-act="doc-mode" data-mode="file" aria-current="page">파일 올리기</a><a href="javascript:void 0" data-act="doc-mode" data-mode="link">링크로 등록</a></div>' +
      '<label class="field doc-file"><span>파일 (25MB 이하)</span><span class="dropzone" data-drop="1"><input type="file" name="file" required accept=".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg">' +
      '<span class="dz-text">파일을 여기로 끌어다 놓거나 눌러서 고르세요</span></span></label>' +
      '<label class="field doc-url"><span>주소</span><input class="input" type="url" name="url" placeholder="https://drive.google.com/…"></label>' +
      '<label class="field"><span>제목</span><input class="input" name="title" maxlength="100" value="' + esc(cur ? cur.title : '') + '" placeholder="비우면 파일 이름"></label>' +
      '<label class="field"><span>메모 (선택)</span><input class="input" name="note" maxlength="200" value="' + esc(defNote) + '"></label>' +
      '<div class="upload-status muted" style="font-size:14px;min-height:1em;margin:-4px 0 10px"></div>' +
      '<div class="sheet-actions"><button class="btn" type="button" data-act="close">취소</button><button class="btn btn-primary" type="submit">' + (cur ? '교체' : '올리기') + '</button></div></form>');
    if (droppedFile) setDropFile(document.getElementById('doc-form'), droppedFile);
  }

  function submitDoc(f) {
    var btn = f.querySelector('[type=submit]');
    var status = f.querySelector('.upload-status');
    var mode = f.getAttribute('data-mode');
    var base = { board: f.getAttribute('data-board'), slot: f.getAttribute('data-slot') || '', title: f.querySelector('[name=title]').value.trim(), note: f.querySelector('[name=note]').value.trim() };
    var done = function (j) {
      S.data.docs = (S.data.docs || []).concat([j.doc]);
      afterLocalChange(); closeSheet(); toast(base.slot ? '새 버전으로 바꿨어요.' : '올렸어요.');
    };
    var fail = function (e) { btn.disabled = false; status.textContent = ''; toast(e.message); };
    if (mode === 'link') {
      base.url = f.querySelector('[name=url]').value.trim();
      btn.disabled = true;
      return api('addDocLink', { doc: base }).then(done, fail);
    }
    var file = pickedFile(f);
    if (!file) return toast('파일을 고르세요.');
    if (file.size > MAX_UPLOAD) return toast('25MB 이하 파일만 올릴 수 있어요.');
    btn.disabled = true;
    status.textContent = '올리는 중… (' + fmtSize(file.size) + ')';
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result).split(',')[1] || '';
      base.name = file.name; base.mime = file.type || 'application/octet-stream'; base.data = data;
      api('uploadDoc', { doc: base }).then(done, fail);
    };
    reader.onerror = function () { fail(new Error('파일을 읽지 못했어요.')); };
    reader.readAsDataURL(file);
  }

  function openDocMore(boardId, slot) {
    var vs = S.idx.docs[boardId].slots[slot], d = vs[0];
    openSheet('<h2 class="sheet-title">' + esc(d.title) + '</h2>' +
      '<div class="action-list">' +
      (canWrite() ? '<button class="btn" data-act="doc-replace" data-board="' + esc(boardId) + '" data-slot="' + esc(slot) + '">새 버전으로 교체</button>' : '') +
      '</div>' +
      '<div class="list-heading">버전 ' + vs.length + '개</div><div class="list">' + vs.map(function (v, i) {
        return '<div class="list-row"><span class="ext ext-' + extOf(v).toLowerCase() + '">' + esc(extOf(v)) + '</span>' +
          '<span class="title" style="font-weight:600">' + (i === 0 ? '현재 · ' : '') + esc(v.note || v.title) +
          '<span class="sub" style="display:block;font-weight:400">' + esc([v.name, fmtSize(v.size), nameOf(v.by), new Date(v.at).toLocaleDateString('ko-KR')].filter(String).join(' · ')) + '</span></span>' +
          '<button class="btn btn-sm" data-act="doc-open" data-id="' + esc(v.id) + '">열기</button>' +
          (canWrite() ? '<button class="mini" data-act="doc-delete" data-id="' + esc(v.id) + '" aria-label="이 버전 삭제">✕</button>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="sheet-actions" style="margin-top:14px"><button class="btn" data-act="close">닫기</button></div>');
  }

  function openDoc(id, el) {
    var d = findDoc(id);
    if (!d) return;
    if (d.url) { window.open(d.url, '_blank', 'noopener'); return; }
    if (el) el.disabled = true;
    toast('파일을 받는 중…');
    api('docData', { id: id }).then(function (j) {
      if (el) el.disabled = false;
      var bin = atob(j.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: j.mime || 'application/octet-stream' }));
      var a = document.createElement('a');
      a.href = url; a.download = j.name || 'file';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }).catch(function (e) { if (el) el.disabled = false; toast(e.message); });
  }

  function parseLinks(text) {
    var out = [], title = null;
    String(text || '').split(/\r?\n/).forEach(function (ln) {
      var t = ln.trim();
      if (!t) return;
      var m = t.match(/https?:\/\/\S+/);
      if (m) {
        var before = t.slice(0, m.index).trim();
        var name = before || title || m[0].replace(/^https?:\/\//, '').slice(0, 40);
        var icon = '';
        var em = name.match(/^(\p{Extended_Pictographic}️?)\s*/u);
        if (em) { icon = em[1]; name = name.slice(em[0].length); }
        out.push({ id: rid('l'), icon: icon || '🔗', title: name.trim(), url: m[0] });
        title = null;
      } else {
        title = t;
      }
    });
    return out;
  }

  /* ---------- 관리자 ---------- */
  function viewAdmin() {
    if (!S.draft) S.draft = clone(S.data.config);
    var d = S.draft, tab = S.adminTab;
    var tabs = [['basic', '기본'], ['links', '링크'], ['members', '동기'], ['boards', '보드'], ['profsec', '교수님 섹션'], ['profs', '교수님 명단'], ['pw', '비밀번호']];
    var out = '<div class="page-head"><h1>관리자 설정</h1><p>구조 변경은 아래 "설정 저장"을 눌러야 모두에게 반영됩니다.</p></div>' +
      '<div class="admin-tabs">' + tabs.map(function (t) {
        return '<button class="chip-nav" data-act="admin-tab" data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
      }).join('') + '</div>';

    if (tab === 'basic') {
      out += '<div class="admin-card"><label class="field"><span>보드 이름</span><input class="input" data-bind="title" value="' + esc(d.title || '') + '"></label></div>';
    } else if (tab === 'links') {
      if (!d.links) d.links = [];
      out += '<div class="admin-card"><h3>홈 링크</h3>' + d.links.map(function (l, i) {
        return '<div class="edit-row link-edit"><input class="input" style="width:52px;text-align:center" data-bind="links.' + i + '.icon" value="' + esc(l.icon || '') + '" placeholder="🔗" maxlength="4">' +
          '<div class="grow" style="display:grid;gap:4px"><input class="input" data-bind="links.' + i + '.title" value="' + esc(l.title) + '" placeholder="이름">' +
          '<input class="input" data-bind="links.' + i + '.url" value="' + esc(l.url) + '" placeholder="https://" inputmode="url"></div>' +
          '<button class="mini" data-act="move" data-list="links" data-i="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">↑</button>' +
          '<button class="mini" data-act="move" data-list="links" data-i="' + i + '" data-d="1"' + (i === d.links.length - 1 ? ' disabled' : '') + ' aria-label="아래로">↓</button>' +
          '<button class="mini" data-act="remove-link" data-i="' + i + '" aria-label="삭제">✕</button></div>';
      }).join('') + '<button class="btn btn-sm" data-act="add-link-row">링크 추가</button></div>' +
        '<div class="admin-card"><h3>한꺼번에 붙여넣기</h3><textarea class="textarea" id="bulk-links" placeholder="🗂️ 이름&#10;https://…&#10;🗂️ 다른 이름&#10;https://…"></textarea>' +
        '<div class="hint">이름 줄 다음에 주소 줄이 오는 형식이면 됩니다. 이미 있는 주소는 건너뜁니다.</div>' +
        '<p><button class="btn btn-sm" data-act="bulk-links">목록에 추가</button></p></div>';
    } else if (tab === 'members') {
      out += '<div class="admin-card"><h3>동기</h3>' + d.members.map(function (m, i) {
        return '<div class="edit-row"><span class="swatch" style="background:' + PAL[m.color] + '"></span>' +
          '<input class="input grow" data-bind="members.' + i + '.name" value="' + esc(m.name) + '" maxlength="10">' +
          '<select class="select" style="width:auto;max-width:42%" data-bind="members.' + i + '.color" data-rerender="1">' +
          PALETTE.map(function (p) { return '<option value="' + p.id + '"' + (p.id === m.color ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select>' +
          '<label class="check" style="margin:0 2px"><input type="checkbox" data-bind="members.' + i + '.hidden"' + (m.hidden ? ' checked' : '') + '>숨김</label></div>';
      }).join('') +
        '<p class="hint">숨긴 동기의 예전 인계는 그대로 이름과 색으로 보입니다. 이름 고르기 목록에서만 빠집니다.</p>' +
        '<button class="btn btn-sm" data-act="add-member">동기 추가</button></div>';
    } else if (tab === 'boards') {
      out += d.boards.map(function (b, i) {
        var n = S.idx.counts['board|' + b.id] || 0;
        return '<div class="admin-card"><div class="edit-row">' +
          '<input class="input grow" data-bind="boards.' + i + '.name" value="' + esc(b.name) + '" placeholder="보드 이름" style="font-weight:700">' +
          '<button class="mini" data-act="move" data-list="boards" data-i="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">↑</button>' +
          '<button class="mini" data-act="move" data-list="boards" data-i="' + i + '" data-d="1"' + (i === d.boards.length - 1 ? ' disabled' : '') + ' aria-label="아래로">↓</button>' +
          '<button class="mini" data-act="remove" data-list="boards" data-i="' + i + '" data-count="' + n + '" aria-label="보드 삭제">✕</button></div>' +
          '<div class="edit-row"><span class="muted" style="font-size:13.5px;width:44px">그룹</span><input class="input grow" data-bind="boards.' + i + '.group" value="' + esc(b.group || '') + '" list="grouplist" placeholder="예: 본원 턴"></div>' +
          '<div style="margin:10px 0 4px;font-size:13.5px;font-weight:700;color:var(--muted)">섹션</div>' +
          listEditor('boards.' + i + '.sections', b.sections, 'board|' + b.id) + '</div>';
      }).join('') +
        '<datalist id="grouplist">' + uniq(d.boards.map(function (b) { return b.group; })).map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
        '<button class="btn btn-sm" data-act="add-board">보드 추가</button>';
    } else if (tab === 'profsec') {
      out += '<div class="admin-card"><h3>모든 교수님 페이지에 공통으로 쓰는 섹션</h3>' + listEditor('profSections', d.profSections, 'prof') + '</div>';
    } else if (tab === 'profs') {
      var all = S.data.profs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      out += '<p><button class="btn btn-sm" data-act="prof-edit">교수님 추가</button></p>' +
        (all.length ? '<div class="list">' + all.map(function (p) {
          return '<button class="list-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left" data-act="prof-edit" data-id="' + esc(p.id) + '"><span class="title">' + esc(p.name) + '</span><span class="sub">' +
            esc(p.boards.map(function (b) { return S.idx.boards[b] ? S.idx.boards[b].name : ''; }).filter(String).join(', ') || '보드 없음') + '</span></button>';
        }).join('') + '</div>' : '<div class="empty-line">아직 없습니다.</div>') +
        '<p class="hint">교수님 명단은 저장 버튼 없이 바로 반영됩니다.</p>';
    } else if (tab === 'pw') {
      out += [['admin', '관리자'], ['member', '동기'], ['viewer', '보기 전용']].map(function (r) {
        return '<form class="admin-card" data-pwform="' + r[0] + '"><h3>' + r[1] + ' 비밀번호</h3><div class="edit-row">' +
          '<input class="input grow" name="pw" type="text" minlength="4" required placeholder="새 비밀번호 (4자 이상)" autocomplete="off">' +
          '<button class="btn btn-sm btn-primary" type="submit">변경</button></div></form>';
      }).join('') + '<p class="hint">바꾸면 그 비밀번호로 로그인해 있던 사람은 다시 입력해야 합니다.</p>';
    }
    if (tab !== 'profs' && tab !== 'pw') {
      out += '<div class="sticky-save"><span>' + (S.dirty ? '저장하지 않은 변경이 있어요' : '변경 사항 없음') + '</span>' +
        '<button class="btn btn-sm" data-act="admin-reset"' + (S.dirty ? '' : ' disabled') + ' style="background:transparent;color:#fff;border-color:#4a5655">되돌리기</button>' +
        '<button class="btn btn-sm btn-primary" data-act="admin-save"' + (S.dirty ? '' : ' disabled') + '>설정 저장</button></div>';
    }
    return out;
  }
  function uniq(a) { var o = {}; return a.filter(function (x) { if (!x || o[x]) return false; o[x] = 1; return true; }); }

  function listEditor(path, items, countKey) {
    return items.map(function (s, i) {
      var n;
      if (countKey === 'prof') {
        n = S.data.entries.filter(function (e) { return e.scope === 'prof' && e.section === s.id; }).length;
      } else {
        n = (S.idx.byTarget[countKey] || []).filter(function (e) { return e.section === s.id; }).length;
      }
      return '<div class="edit-row"><input class="input grow" data-bind="' + path + '.' + i + '.name" value="' + esc(s.name) + '">' +
        '<button class="mini" data-act="move" data-list="' + path + '" data-i="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">↑</button>' +
        '<button class="mini" data-act="move" data-list="' + path + '" data-i="' + i + '" data-d="1"' + (i === items.length - 1 ? ' disabled' : '') + ' aria-label="아래로">↓</button>' +
        '<button class="mini" data-act="remove" data-list="' + path + '" data-i="' + i + '" data-count="' + n + '" aria-label="삭제">✕</button></div>';
    }).join('') + '<button class="btn btn-sm" data-act="add-item" data-list="' + path + '">섹션 추가</button>';
  }

  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a[k]; }, o); }
  function setDraft(path, v) {
    var ks = path.split('.'), last = ks.pop();
    var parent = ks.length ? getPath(S.draft, ks.join('.')) : S.draft;
    parent[last] = v;
    markDirty();
  }
  function markDirty() {
    S.dirty = true;
    var bar = document.querySelector('.sticky-save');
    if (bar) {
      bar.querySelector('span').textContent = '저장하지 않은 변경이 있어요';
      bar.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    }
  }
  function rerenderAdmin() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (act) {
      case 'close': closeSheet(); break;
      case 'menu': openMenu(); break;
      case 'pick-me':
        S.me = id; ls('me', id); render(); break;
      case 'change-me':
        closeSheet(); S.me = null; ls('me', null); render(); break;
      case 'logout': closeSheet(); logout(); break;
      case 'reload': closeSheet(); refresh().then(function () { toast('최신 내용으로 바꿨어요.'); }); break;
      case 'toggle':
        var k = el.getAttribute('data-key');
        if (collapsed[k]) delete collapsed[k]; else collapsed[k] = 1;
        ls('collapsed', JSON.stringify(collapsed));
        el.closest('.section').classList.toggle('collapsed');
        el.setAttribute('aria-expanded', !collapsed[k]);
        break;
      case 'compose':
        openComposer(el.getAttribute('data-scope'), el.getAttribute('data-target'), el.getAttribute('data-section')); break;
      case 'entry': openEntry(id); break;
      case 'edit':
        var e = S.data.entries.filter(function (x) { return x.id === id; })[0];
        if (e) openComposer(e.scope, e.target, e.section, e);
        break;
      case 'confirm':
        el.disabled = true;
        api('confirmEntry', { id: id }).then(function (j) { upsertEntry(j.entry); closeSheet(); toast('확인 날짜를 갱신했어요.'); })
          .catch(function (err) { el.disabled = false; toast(err.message); });
        break;
      case 'history': openHistory(id); break;
      case 'copy':
        var ce = S.data.entries.filter(function (x) { return x.id === id; })[0];
        if (ce && navigator.clipboard) navigator.clipboard.writeText(ce.text).then(function () { toast('복사했어요.'); closeSheet(); });
        break;
      case 'delete':
        if (!confirm('이 인계를 삭제할까요? 수정 이력에는 남습니다.')) return;
        el.disabled = true;
        api('deleteEntry', { id: id }).then(function () {
          S.data.entries = S.data.entries.filter(function (x) { return x.id !== id; });
          afterLocalChange(); closeSheet(); toast('삭제했어요.');
        }).catch(function (err) { el.disabled = false; toast(err.message); });
        break;
      case 'prof-edit': openProfEditor(id, el.getAttribute('data-board')); break;
      case 'prof-delete':
        var cnt = S.idx.counts['prof|' + id] || 0;
        if (!confirm('교수님을 명단에서 삭제할까요?' + (cnt ? ' 이 교수님 페이지의 인계 ' + cnt + '개도 함께 보이지 않게 됩니다.' : ''))) return;
        api('deleteProfessor', { id: id }).then(function () {
          S.data.profs = S.data.profs.filter(function (p) { return p.id !== id; });
          S.data.entries = S.data.entries.filter(function (e) { return !(e.scope === 'prof' && e.target === id); });
          afterLocalChange(); closeSheet(); toast('삭제했어요.');
          if (parseRoute().name === 'p') location.hash = '#/profs';
        }).catch(function (err) { toast(err.message); });
        break;
      case 'admin-tab': S.adminTab = el.getAttribute('data-tab'); rerenderAdmin(); break;
      case 'add-member':
        var used = S.draft.members.map(function (m) { return m.color; });
        var free = PALETTE.filter(function (p) { return used.indexOf(p.id) < 0; })[0] || PALETTE[0];
        S.draft.members.push({ id: rid('m'), name: '', color: free.id });
        markDirty(); rerenderAdmin();
        var ins = document.querySelectorAll('[data-bind^="members."][data-bind$=".name"]');
        if (ins.length) ins[ins.length - 1].focus();
        break;
      case 'add-board':
        S.draft.boards.push({ id: rid('b'), name: '새 보드', group: '', sections: [{ id: rid('s'), name: '턴 개요' }] });
        markDirty(); rerenderAdmin(); break;
      case 'add-item':
        getPath(S.draft, el.getAttribute('data-list')).push({ id: rid('s'), name: '새 섹션' });
        markDirty(); rerenderAdmin(); break;
      case 'move':
        var arr = getPath(S.draft, el.getAttribute('data-list'));
        var i = +el.getAttribute('data-i'), dd = +el.getAttribute('data-d');
        var tmp = arr[i]; arr[i] = arr[i + dd]; arr[i + dd] = tmp;
        markDirty(); rerenderAdmin(); break;
      case 'remove':
        var n = +el.getAttribute('data-count');
        var list = getPath(S.draft, el.getAttribute('data-list'));
        var ri = +el.getAttribute('data-i');
        var isBoard = el.getAttribute('data-list') === 'boards';
        var msgTxt = isBoard
          ? '"' + list[ri].name + '" 보드를 삭제할까요?' + (n ? ' 인계 ' + n + '개가 화면에서 사라집니다(시트에는 남음).' : '')
          : '"' + list[ri].name + '" 섹션을 삭제할까요?' + (n ? ' 인계 ' + n + '개는 "섹션 없음"으로 옮겨 보입니다.' : '');
        if (!confirm(msgTxt)) return;
        list.splice(ri, 1); markDirty(); rerenderAdmin(); break;
      case 'add-link-row':
        S.draft.links = S.draft.links || [];
        S.draft.links.push({ id: rid('l'), icon: '🔗', title: '', url: '' });
        markDirty(); rerenderAdmin(); break;
      case 'remove-link':
        S.draft.links.splice(+el.getAttribute('data-i'), 1); markDirty(); rerenderAdmin(); break;
      case 'bulk-links':
        var added = parseLinks(document.getElementById('bulk-links').value).filter(function (l) {
          return !(S.draft.links || []).some(function (x) { return x.url === l.url; });
        });
        S.draft.links = (S.draft.links || []).concat(added);
        if (added.length) markDirty();
        rerenderAdmin(); toast(added.length + '개를 추가했어요. "설정 저장"을 눌러야 반영됩니다.'); break;
      case 'goto-links': S.adminTab = 'links'; break;
      case 'doc-upload': openDocUpload(el.getAttribute('data-board')); break;
      case 'doc-replace': openDocUpload(el.getAttribute('data-board'), el.getAttribute('data-slot')); break;
      case 'doc-more': openDocMore(el.getAttribute('data-board'), el.getAttribute('data-slot')); break;
      case 'doc-open': openDoc(id, el); break;
      case 'doc-delete':
        if (!confirm('이 버전을 삭제할까요? 드라이브 휴지통으로 이동합니다.')) return;
        api('deleteDoc', { id: id }).then(function () {
          S.data.docs = S.data.docs.filter(function (x) { return x.id !== id; });
          afterLocalChange(); closeSheet(); toast('삭제했어요.');
        }).catch(function (err) { toast(err.message); });
        break;
      case 'doc-mode':
        var form = el.closest('form');
        form.setAttribute('data-mode', el.getAttribute('data-mode'));
        form.querySelectorAll('[data-act=doc-mode]').forEach(function (b) { b.setAttribute('aria-current', b === el ? 'page' : 'false'); });
        form.querySelector('[name=file]').required = el.getAttribute('data-mode') === 'file';
        form.querySelector('[name=url]').required = el.getAttribute('data-mode') === 'link';
        break;
      case 'admin-reset':
        S.draft = clone(S.data.config); S.dirty = false; rerenderAdmin(); break;
      case 'admin-save': saveConfig(el); break;
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'q') { S.q = t.value; var pos = t.selectionStart; render(); var n = document.getElementById('q'); if (n) n.setSelectionRange(pos, pos); return; }
    if (t.id === 'profq') { S.profQ = t.value; var p2 = t.selectionStart; render(); var n2 = document.getElementById('profq'); n2.focus(); n2.setSelectionRange(p2, p2); return; }
    if (t.matches('[data-bind]') && t.type !== 'checkbox' && t.tagName !== 'SELECT') setDraft(t.getAttribute('data-bind'), t.value);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.matches('[data-bind]')) return;
    if (t.type === 'checkbox') setDraft(t.getAttribute('data-bind'), t.checked);
    else if (t.tagName === 'SELECT') { setDraft(t.getAttribute('data-bind'), t.value); if (t.getAttribute('data-rerender')) rerenderAdmin(); }
  });
  // 드래그 앤 드롭: 업로드 창의 상자, 또는 보드의 "인계장 파일" 영역에 놓으면 업로드 창이 열린다.
  function dropTarget(ev) {
    var el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    if (!el) return null;
    var t = el.closest('[data-drop]') || el.closest('.docs-block[data-board]');
    if (t) return t;
    // 보드 화면이면 어디에 놓아도 그 보드의 인계장으로 올린다.
    if (sheet.hidden) { var r = parseRoute(); if (r.name === 'b' && r.sub !== 'prof') return document.querySelector('.docs-block[data-board]'); }
    return null;
  }
  function hasFiles(ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0; }
  ['dragenter', 'dragover'].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      if (!hasFiles(ev)) return;
      var t = dropTarget(ev);
      if (!t || !canWrite()) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      t.classList.add('drag-over');
    });
  });
  document.addEventListener('dragleave', function (ev) {
    var t = dropTarget(ev);
    if (t && !t.contains(ev.relatedTarget)) t.classList.remove('drag-over');
  });
  document.addEventListener('drop', function (ev) {
    if (!hasFiles(ev)) return;
    var t = dropTarget(ev);
    if (!t || !canWrite()) return;
    ev.preventDefault();
    t.classList.remove('drag-over');
    var file = ev.dataTransfer.files[0];
    if (!file) return;
    if (t.hasAttribute('data-drop')) setDropFile(t.closest('form'), file);
    else openDocUpload(t.getAttribute('data-board'), null, file);
  });
  window.addEventListener('dragover', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener('drop', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
  document.addEventListener('change', function (ev) {
    if (ev.target.name === 'file' && ev.target.closest('#doc-form')) showPicked(ev.target.closest('#doc-form'));
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && ev.target.closest('#composer')) {
      ev.preventDefault();
      ev.target.closest('form').requestSubmit();
    }
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    ev.preventDefault();
    if (f.id === 'gate') return doLogin(f);
    if (f.id === 'composer') return submitComposer(f);
    if (f.id === 'prof-form') return submitProf(f);
    if (f.id === 'doc-form') return submitDoc(f);
    if (f.getAttribute('data-pwform')) return submitPw(f);
  });

  function doLogin(f) {
    var pw = f.querySelector('#pw').value;
    var btn = f.querySelector('button'); btn.disabled = true;
    S.pw = pw;
    api('login').then(function (j) {
      S.role = j.role; ls('pw', pw); ls('role', j.role);
      return refresh();
    }).catch(function (e) {
      S.pw = null; btn.disabled = false;
      document.getElementById('gate-err').textContent = e.message;
    });
  }

  function logout() {
    ['pw', 'role', 'cache'].forEach(function (k) { ls(k, null); });
    S.pw = S.role = null; S.data = null; S.idx = null; S.draft = null; S.dirty = false;
    location.hash = '#/';
    renderGate();
  }

  function upsertEntry(e) {
    var i = S.data.entries.findIndex(function (x) { return x.id === e.id; });
    if (i >= 0) S.data.entries[i] = e; else S.data.entries.push(e);
    afterLocalChange();
  }
  function afterLocalChange() {
    ls('cache', JSON.stringify(S.data));
    buildIndex();
    var y = window.scrollY; render(); window.scrollTo(0, y);
  }

  function submitComposer(f) {
    var btn = f.querySelector('[type=submit]'); btn.disabled = true;
    var fd = new FormData(f);
    var id = f.getAttribute('data-id');
    var p = id
      ? api('updateEntry', { id: id, text: fd.get('text'), section: fd.get('section'), tag: fd.get('tag') })
      : api('addEntry', { by: fd.get('anon') ? 'anon' : S.me, entry: { scope: f.getAttribute('data-scope'), target: f.getAttribute('data-target'), section: fd.get('section'), tag: fd.get('tag'), text: fd.get('text') } });
    p.then(function (j) {
      upsertEntry(j.entry); closeSheet(); toast(id ? '수정했어요.' : '추가했어요.');
      var sk = j.entry.scope + '|' + j.entry.target + '|' + j.entry.section;
      if (collapsed[sk]) { delete collapsed[sk]; ls('collapsed', JSON.stringify(collapsed)); render(); }
    }).catch(function (e) { btn.disabled = false; toast(e.message); });
  }

  function submitProf(f) {
    var btn = f.querySelector('[type=submit]'); btn.disabled = true;
    var fd = new FormData(f);
    var id = f.getAttribute('data-id');
    api('saveProfessor', { prof: { id: id || '', name: fd.get('name'), boards: fd.getAll('boards'), memo: fd.get('memo') } }).then(function (j) {
      var i = S.data.profs.findIndex(function (p) { return p.id === j.prof.id; });
      if (i >= 0) S.data.profs[i] = j.prof; else S.data.profs.push(j.prof);
      afterLocalChange(); closeSheet(); toast(id ? '수정했어요.' : '추가했어요.');
    }).catch(function (e) { btn.disabled = false; toast(e.message); });
  }

  function submitPw(f) {
    var target = f.getAttribute('data-pwform');
    var pw = f.querySelector('[name=pw]').value;
    var label = { admin: '관리자', member: '동기', viewer: '보기 전용' }[target];
    if (!confirm(label + ' 비밀번호를 바꿀까요?')) return;
    api('setPassword', { target: target, newPw: pw }).then(function () {
      if (target === S.role) { S.pw = pw; ls('pw', pw); }
      f.reset(); toast(label + ' 비밀번호를 바꿨어요.');
    }).catch(function (e) { toast(e.message); });
  }

  function saveConfig(btn) {
    var d = S.draft;
    d.members = d.members.filter(function (m) { return m.name.trim(); });
    d.members.forEach(function (m) { m.name = m.name.trim(); });
    for (var i = 0; i < d.boards.length; i++) {
      if (!d.boards[i].name.trim()) { toast('이름이 비어 있는 보드가 있어요.'); return; }
      d.boards[i].sections = d.boards[i].sections.filter(function (s) { return s.name.trim(); });
    }
    d.profSections = d.profSections.filter(function (s) { return s.name.trim(); });
    d.links = (d.links || []).filter(function (l) { return l.title.trim() && /^https?:\/\//.test(l.url.trim()); });
    d.links.forEach(function (l) { l.title = l.title.trim(); l.url = l.url.trim(); if (!l.id) l.id = rid('l'); });
    btn.disabled = true;
    api('saveConfig', { config: d }).then(function (j) {
      S.data.config = j.config; S.draft = clone(j.config); S.dirty = false;
      afterLocalChange(); toast('설정을 저장했어요.');
    }).catch(function (e) { btn.disabled = false; toast(e.message); });
  }

  /* ---------- 동기화 ---------- */
  function maybeRefresh() {
    if (S.pw && S.role && document.visibilityState === 'visible' && Date.now() - S.lastFetch > 30000 && sheet.hidden && !S.dirty) {
      refresh(true);
    }
  }
  document.addEventListener('visibilitychange', maybeRefresh);
  window.addEventListener('focus', maybeRefresh);
  setInterval(maybeRefresh, 120000);

  /* ---------- 시작 ---------- */
  if (S.data) { try { buildIndex(); } catch (e) { S.data = null; } }
  render();
  if (S.pw && S.role) refresh(true);
})();
