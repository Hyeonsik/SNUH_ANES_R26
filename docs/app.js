/* 인계보드 프론트엔드 — 의존성 없는 단일 스크립트 */
(function () {
  'use strict';

  var API_URL = (window.HB_CONFIG && window.HB_CONFIG.API_URL) || '';
  var LS = 'hb.';

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

  var CK = (function () {
    var k = null;
    try { k = localStorage.getItem('hb.ck'); } catch (e) { k = null; }
    if (!k) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('hb.ck', k); } catch (e) { /* 저장 불가 */ }
    }
    return k;
  })();
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
    var body = Object.assign({ action: action, pw: S.pw, by: S.me || '', ck: CK }, payload || {});
    setBusy(true);
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setBusy(false);
        if (!j.ok) {
          if (j.code === 'AUTH' && action !== 'login') { logout(); }
          var msg = j.error || '요청에 실패했습니다.';
          if (/^알 수 없는 요청입니다/.test(msg)) msg = '서버(Apps Script)가 예전 버전입니다. Code.gs 를 최신으로 바꾸고 저장한 뒤 배포 관리 → 새 버전으로 배포해 주세요.';
          throw new Error(msg);
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
  function canModify(e) { return canWrite() && (isAdmin() || e.mine || (S.me && S.me !== 'anon' && e.authorId === S.me)); }
  function isStudyBoard(b) { return !!b && (b.type === 'study' || b.id === 'study'); }
  function studyBoards() { return S.data.config.boards.filter(isStudyBoard); }
  function findEntry(id) { return S.data.entries.filter(function (x) { return x.id === id; })[0]; }
  function cbadge(n) { return n ? '<span class="cbadge" aria-label="댓글 ' + n + '개">' + (n > 99 ? '99+' : n) + '</span>' : ''; }

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

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
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
      case 'b': body = S.idx.boards[r.id] ? (isStudyBoard(S.idx.boards[r.id]) ? viewStudy(r.id) : r.sub === 'prof' ? viewBoardProfs(r.id) : viewBoard(r.id)) : viewMissing(); break;
      case 'p': body = S.idx.profs[r.id] ? viewProf(r.id) : viewMissing(); break;
      case 'profs': body = viewProfs(); break;
      case 'search': body = viewSearch(); break;
      case 'admin': body = isAdmin() ? viewAdmin() : viewMissing(); break;
      default: body = viewHome();
    }
    app.innerHTML =
      '<div class="shell">' + topbar(r) +
      '<div class="layout">' + sidebar(r) + '<main class="main' + (r.name === 'home' || (r.name === 'b' && S.idx.boards[r.id] && isStudyBoard(S.idx.boards[r.id])) ? ' main-wide' : '') + '" id="main">' + body + '</main></div>' +
      fab(r) + '</div>';
    if (r.name === 'b' && r.sub === 's' && r.third && S.scrollSec) {
      S.scrollSec = false;
      var el = document.getElementById('sec-' + r.third);
      if (el) { el.classList.remove('collapsed'); setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0); }
    }
    if (S.focusEntry) {
      var fid = S.focusEntry; S.focusEntry = null;
      var fe = document.getElementById('e-' + fid);
      var fentry = findEntry(fid);
      if (fentry && fentry.scope === 'board' && isStudyBoard(S.idx.boards[fentry.target])) { setTimeout(function () { openEntry(fid); }, 0); fe = null; }
      if (fe) {
        var sec = fe.closest('.section');
        if (sec) sec.classList.remove('collapsed');
        setTimeout(function () { fe.scrollIntoView({ block: 'center' }); fe.classList.add('flash'); }, 0);
        setTimeout(function () { fe.classList.remove('flash'); }, 2200);
      }
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
      '<button class="search-pill" data-act="palette" aria-label="전체 검색">' + ICON.search + '<span class="sp-text">검색</span><kbd>' + (IS_MAC ? '⌘' : 'Ctrl') + ' K</kbd></button>' +
      (isAdmin() ? '<a class="icon-btn" href="#/admin" aria-label="관리자 설정">' + ICON.gear + '</a>' : '') +
      me + '</div>' + strip(r) + '</header>';
  }

  function navItems() {
    var groups = [], gmap = {};
    S.data.config.boards.forEach(function (b) {
      if (isStudyBoard(b)) return;
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
    studyBoards().forEach(function (b) {
      out += '<a class="chip-nav chip-study" href="#/b/' + b.id + '"' + (isCurrent(r, 'b', b.id) ? ' aria-current="page"' : '') + '>' + esc(b.name) + '</a>';
    });
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
      studyBoards().map(function (b) {
        return '<a class="side-link side-study" href="#/b/' + b.id + '"' + (isCurrent(r, 'b', b.id) ? ' aria-current="page"' : '') + '>' + esc(b.name) + '<small>' + (S.idx.counts['board|' + b.id] || '') + '</small></a>';
      }).join('') +
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
    if (r.name === 'b' && S.idx.boards[r.id] && isStudyBoard(S.idx.boards[r.id])) return '<button class="fab" data-act="study-new" data-board="' + esc(r.id) + '">' + ICON.plus + '공부 노트</button>';
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
    var stale = false;
    var edited = e.updatedAt && e.updatedAt !== e.createdAt;
    var crumb = opts.crumb ? '<a class="msg-crumb" href="' + crumbHref(e) + '">' + esc(crumbText(e)) + '</a>' : '';
    if (opts.prof && S.idx.profs[e.target]) crumb = '<a class="prof-label" href="#/p/' + esc(e.target) + '">' + esc(S.idx.profs[e.target].name) + ' 교수님</a>';
    return '<div class="msg' + (stale ? ' stale' : '') + '" id="e-' + esc(e.id) + '">' +
      '<span class="avatar" style="background:' + c + '" aria-hidden="true">' + esc(initialOf(e.authorId)) + '</span>' +
      '<div><div class="msg-meta">' +
      '<span class="name-label" style="background:' + c + '">' + esc(nameOf(e.authorId)) + '</span>' +
      '<span class="msg-time" title="' + esc(e.createdAt) + '">' + ago(e.createdAt) + '</span>' +
      (edited ? '<span class="edited">· ' + esc(nameOf(e.updatedBy)) + ' 수정</span>' : '') +
      crumb +
      '</div><button class="bubble" style="--c:' + c + '" data-act="entry" data-id="' + esc(e.id) + '">' +
      (e.title ? '<b class="bubble-title">' + esc(e.title) + '</b>' : '') + fmt(e.text, opts.q) +
      ((e.images || []).length ? '<span class="bubble-imgs">' + e.images.slice(0, 4).map(function (im) { return imgTag(im.id, 'w300', ''); }).join('') + '</span>' : '') +
      cbadge(e.comments) + '</button></div></div>';
  }
  function crumbText(e) {
    if (e.scope === 'board') {
      var b = S.idx.boards[e.target];
      var s = b && b.sections.filter(function (x) { return x.id === e.section; })[0];
      if (isStudyBoard(b)) return (b.name) + (s ? ' › ' + s.name : '') + (e.title ? ' › ' + e.title : '');
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
      cfg.boards.filter(function (b) { return !isStudyBoard(b); }).map(overviewCard).join('') + '</div></section>';
    var studyHtml = studyBoards().map(function (b) {
      var list = (S.idx.byTarget['board|' + b.id] || []).slice().sort(function (a, c) { return a.updatedAt < c.updatedAt ? 1 : -1; });
      return '<section class="home-block home-study"><div class="block-head"><h2>' + esc(b.name) + ' 노트</h2><a class="add-link" href="#/b/' + b.id + '">전체 ' + list.length + '개 보기</a></div>' +
        (list.length ? '<div class="study-strip">' + list.slice(0, 8).map(function (e) { return studyCard(e, { compact: true }); }).join('') + '</div>'
          : '<div class="empty-line">교수님께 들은 설명이나 공부한 내용을 사진과 함께 남겨보세요.</div>') + '</section>';
    }).join('');

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
      linkHtml + studyHtml + groups + recentHtml;
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
  function openSheet(html, cls) {
    sheet.innerHTML = '<div class="sheet-panel' + (cls ? ' ' + cls : '') + '" role="dialog" aria-modal="true"><div class="grabber"></div>' + html + '</div>';
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = sheet.querySelector('[autofocus]');
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeSheet() {
    sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = '';
  }
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !sheet.hidden && !LB.open && !PALETTE_UI.open) closeSheet(); });

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
    var e = findEntry(id);
    if (!e) return;
    var study = e.scope === 'board' && isStudyBoard(S.idx.boards[e.target]);
    var c = colorOf(e.authorId);
    var edited = e.updatedAt && e.updatedAt !== e.createdAt;
    var tools = '<div class="ed-tools">' +
      (canModify(e) ? '<button class="tool" data-act="edit" data-id="' + esc(id) + '">수정</button>' : '') +
      '<button class="tool" data-act="copy" data-id="' + esc(id) + '">복사</button>' +
      '<button class="tool" data-act="history" data-id="' + esc(id) + '">이력</button>' +
      (canModify(e) ? '<button class="tool tool-danger" data-act="delete" data-id="' + esc(id) + '">삭제</button>' : '') +
      '<button class="tool tool-close" data-act="close" aria-label="닫기">✕</button></div>';
    var imgs = (e.images || []).length ? '<div class="ed-imgs' + (e.images.length === 1 ? ' one' : '') + '">' + e.images.map(function (im, i) {
      return '<button class="ed-img" data-act="lightbox" data-id="' + esc(id) + '" data-i="' + i + '">' + imgTag(im.id, 'w1000', '') + '</button>';
    }).join('') + '</div>' : '';
    var tags = study && e.tags ? '<div class="ed-tags">' + e.tags.split(',').map(function (t) { return '<span class="kw">#' + esc(t) + '</span>'; }).join('') + '</div>' : '';
    openSheet('<div class="ed">' + tools +
      '<div class="ed-crumb">' + esc(crumbText(e).replace(e.title ? ' › ' + e.title : '', '')) + (study && e.source ? ' · ' + esc(e.source) : '') + '</div>' +
      (e.title ? '<h2 class="ed-title">' + esc(e.title) + '</h2>' : '') +
      '<div class="ed-meta"><span class="avatar" style="background:' + c + '">' + esc(initialOf(e.authorId)) + '</span><b>' + esc(nameOf(e.authorId)) + '</b>' +
      '<span>' + new Date(e.createdAt).toLocaleDateString('ko-KR') + (edited ? ' · ' + esc(nameOf(e.updatedBy)) + ' 수정' : '') + '</span></div>' +
      tags + (e.text ? '<div class="ed-body">' + fmt(e.text) + '</div>' : '') + imgs +
      '<section class="ed-comments"><h3>댓글 <span class="count" id="cm-count">' + (e.comments || 0) + '</span></h3>' +
      '<div id="cm-list" class="cm-list">' + (e.comments ? '<div class="loading">불러오는 중…</div>' : '<div class="cm-empty">아직 댓글이 없어요.</div>') + '</div></section>' +
      (canWrite() ? '<form class="cm-form" id="cm-form" data-id="' + esc(id) + '"><textarea name="text" rows="1" maxlength="2000" placeholder="댓글 달기"></textarea><button class="btn btn-primary btn-sm" type="submit">등록</button></form>' : '') +
      '</div>', 'sheet-wide');
    if (e.comments) loadComments(id);
  }

  function loadComments(id) {
    api('comments', { id: id }).then(function (j) {
      var list = document.getElementById('cm-list');
      if (!list) return;
      var e = findEntry(id);
      if (e && e.comments !== j.comments.length) { e.comments = j.comments.length; afterLocalChange(true); }
      renderComments(id, j.comments);
    }).catch(function (err) { toast(err.message); });
  }
  function renderComments(id, list) {
    var el = document.getElementById('cm-list');
    if (!el) return;
    el._data = list;
    document.getElementById('cm-count').textContent = list.length;
    el.innerHTML = list.length ? list.map(function (c) {
      var mine = canWrite() && (isAdmin() || c.mine || (S.me && S.me !== 'anon' && c.authorId === S.me));
      return '<div class="cm"><span class="avatar" style="background:' + colorOf(c.authorId) + '">' + esc(initialOf(c.authorId)) + '</span>' +
        '<div class="cm-main"><div class="cm-meta"><b>' + esc(nameOf(c.authorId)) + '</b><span>' + ago(c.createdAt) + '</span>' +
        (mine ? '<button class="cm-del" data-act="cm-del" data-id="' + esc(c.id) + '" data-entry="' + esc(id) + '" aria-label="댓글 삭제">삭제</button>' : '') + '</div>' +
        '<div class="cm-text">' + fmt(c.text) + '</div></div></div>';
    }).join('') : '<div class="cm-empty">아직 댓글이 없어요.</div>';
  }
  function submitComment(f) {
    var ta = f.querySelector('textarea'), text = ta.value.trim();
    if (!text) return;
    var id = f.getAttribute('data-id'), btn = f.querySelector('button');
    btn.disabled = true;
    api('addComment', { id: id, text: text }).then(function (j) {
      btn.disabled = false; ta.value = ''; ta.style.height = '';
      var el = document.getElementById('cm-list');
      var list = (el && el._data) || [];
      list.push(j.comment);
      renderComments(id, list);
      var e = findEntry(id); if (e) { e.comments = list.length; afterLocalChange(true); }
      el.lastElementChild && el.lastElementChild.scrollIntoView({ block: 'nearest' });
    }).catch(function (err) { btn.disabled = false; toast(err.message); });
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
    var tabs = [['basic', '기본'], ['study', '공부'], ['links', '링크'], ['members', '동기'], ['boards', '보드'], ['profsec', '교수님 섹션'], ['profs', '교수님 명단'], ['pw', '비밀번호']];
    var out = '<div class="page-head"><h1>관리자 설정</h1><p>구조 변경은 아래 "설정 저장"을 눌러야 모두에게 반영됩니다.</p></div>' +
      '<div class="admin-tabs">' + tabs.map(function (t) {
        return '<button class="chip-nav" data-act="admin-tab" data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
      }).join('') + '</div>';

    if (tab === 'basic') {
      out += '<div class="admin-card"><label class="field"><span>보드 이름</span><input class="input" data-bind="title" value="' + esc(d.title || '') + '"></label></div>';
    } else if (tab === 'study') {
      var sb = studyBoards()[0];
      out += '<div class="admin-card"><h3>키워드 버튼</h3><textarea class="textarea" style="min-height:90px" data-bind-list="studyTags">' + esc((d.studyTags || []).join(', ')) + '</textarea>' +
        '<div class="hint">쉼표로 구분합니다. 공부 보드 상단 버튼과 글쓰기 화면에 이 순서대로 나옵니다. 동기들이 새로 만든 키워드도 자동으로 뒤에 붙습니다.</div></div>' +
        '<div class="admin-card"><h3>출처 종류</h3><textarea class="textarea" style="min-height:60px" data-bind-list="studySources">' + esc((d.studySources || []).join(', ')) + '</textarea></div>' +
        '<div class="admin-card"><h3>카테고리</h3><p class="hint" style="margin-top:0">카테고리는 "보드" 탭의 ' + esc(sb ? sb.name : '공부') + ' 보드 섹션입니다. 거기서 이름·순서를 바꾸면 됩니다.</p></div>';
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
      case 'palette': openPalette(); break;
      case 'study-new': openStudyComposer(el.getAttribute('data-board')); break;
      case 'study-card': openEntry(id); break;
      case 'lightbox': openLightbox(id, +el.getAttribute('data-i')); break;
      case 'cm-del':
        if (!confirm('댓글을 삭제할까요?')) return;
        var entryId = el.getAttribute('data-entry');
        api('deleteComment', { id: id }).then(function () {
          var cl = document.getElementById('cm-list');
          var list = ((cl && cl._data) || []).filter(function (c) { return c.id !== id; });
          renderComments(entryId, list);
          var ce = findEntry(entryId); if (ce) { ce.comments = list.length; afterLocalChange(true); }
        }).catch(function (err) { toast(err.message); });
        break;
      case 'st-view': S.st.view = el.getAttribute('data-v'); saveSt(); rerenderKeep(); break;
      case 'st-cat': S.st.cat = el.getAttribute('data-v'); saveSt(); rerenderKeep(); break;
      case 'st-tag':
        var tg = el.getAttribute('data-v'), ti = S.st.tags.indexOf(tg);
        if (ti >= 0) S.st.tags.splice(ti, 1); else S.st.tags.push(tg);
        saveSt(); rerenderKeep(); break;
      case 'st-clear': S.st.tags = []; S.st.cat = ''; S.st.src = ''; S.st.author = ''; S.st.photo = false; S.st.q = ''; saveSt(); rerenderKeep(); break;
      case 'st-photo': S.st.photo = !S.st.photo; saveSt(); rerenderKeep(); break;
      case 'cmp-tag':
        el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); break;
      case 'cmp-src':
        el.closest('.src-row').querySelectorAll('[data-act=cmp-src]').forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); }); break;
      case 'cmp-img-del': CMP.images.splice(+el.getAttribute('data-i'), 1); renderCmpImages(); break;
      case 'cmp-img-left':
        var ii = +el.getAttribute('data-i'); if (ii > 0) { var tt = CMP.images[ii]; CMP.images[ii] = CMP.images[ii - 1]; CMP.images[ii - 1] = tt; renderCmpImages(); } break;
      case 'lb-close': closeLightbox(); break;
      case 'lb-prev': moveLightbox(-1); break;
      case 'lb-next': moveLightbox(1); break;
      case 'lb-ocr': var lo = document.querySelector('.lb-ocr'); if (lo) lo.hidden = !lo.hidden; break;
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
        var e = findEntry(id);
        if (!e) break;
        if (e.scope === 'board' && isStudyBoard(S.idx.boards[e.target])) openStudyComposer(e.target, e);
        else openComposer(e.scope, e.target, e.section, e);
        break;
      case 'history': openHistory(id); break;
      case 'copy':
        var ce = S.data.entries.filter(function (x) { return x.id === id; })[0];
        if (ce && navigator.clipboard) navigator.clipboard.writeText(ce.text).then(function () { toast('복사했어요.'); closeSheet(); });
        break;
      case 'delete':
        if (!confirm('이 글을 삭제할까요? 댓글도 함께 보이지 않게 됩니다.')) return;
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
      case 'goto-study-admin': S.adminTab = 'study'; break;
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
    if (t.matches('[data-bind-list]')) setDraft(t.getAttribute('data-bind-list'), t.value.split(',').map(function (x) { return x.trim().replace(/^#/, ''); }).filter(Boolean));
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
    var sf = el.closest('#study-form');
    if (sf) return sf;
    if (sheet.hidden) {
      var r = parseRoute();
      if (r.name === 'b' && S.idx.boards[r.id] && isStudyBoard(S.idx.boards[r.id])) return document.getElementById('study-root');
      if (r.name === 'b' && r.sub !== 'prof') return document.querySelector('.docs-block[data-board]');
    }
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
    if (t.id === 'study-form') return addStudyFiles(ev.dataTransfer.files);
    if (t.id === 'study-root') { openStudyComposer(t.getAttribute('data-board')); return addStudyFiles(ev.dataTransfer.files); }
    if (t.hasAttribute('data-drop')) setDropFile(t.closest('form'), file);
    else openDocUpload(t.getAttribute('data-board'), null, file);
  });
  window.addEventListener('dragover', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener('drop', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
  document.addEventListener('change', function (ev) {
    if (ev.target.name === 'file' && ev.target.closest('#doc-form')) showPicked(ev.target.closest('#doc-form'));
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.target.closest && ev.target.closest('#cm-form')) {
      ev.preventDefault(); return ev.target.closest('form').requestSubmit();
    }
    if (LB.open) {
      if (ev.key === 'Escape') { ev.preventDefault(); return closeLightbox(); }
      if (ev.key === 'ArrowLeft') return moveLightbox(-1);
      if (ev.key === 'ArrowRight') return moveLightbox(1);
    }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && ev.target.closest('#study-form')) {
      ev.preventDefault(); return ev.target.closest('form').requestSubmit();
    }
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
    if (f.id === 'study-form') return submitStudy(f);
    if (f.id === 'cm-form') return submitComment(f);
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
  function afterLocalChange(quiet) {
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

  /* ---------- 공부 보드 ---------- */
  var ST_DEFAULT = { view: 'gallery', cat: '', tags: [], src: '', author: '', photo: false, q: '', sort: 'new' };
  S.st = (function () { try { return Object.assign({}, ST_DEFAULT, JSON.parse(ls('st') || '{}'), { q: '' }); } catch (e) { return Object.assign({}, ST_DEFAULT); } })();
  if (!Array.isArray(S.st.tags)) S.st.tags = [];
  function saveSt() { var c = Object.assign({}, S.st); delete c.q; ls('st', JSON.stringify(c)); }
  function rerenderKeep() {
    var y = window.scrollY, a = document.activeElement, aid = a && a.id, pos = a && a.selectionStart;
    render(); window.scrollTo(0, y);
    if (aid) { var n = document.getElementById(aid); if (n) { n.focus(); if (pos != null && n.setSelectionRange) n.setSelectionRange(pos, pos); } }
  }
  function tagsOf(e) { return e.tags ? String(e.tags).split(',').filter(String) : []; }
  function searchText(e) {
    return [e.title || '', e.text || '', e.tag || '', (e.tags || '').replace(/,/g, ' '), e.source || '', crumbText(e), nameOf(e.authorId), e.ocr || ''].join(' ');
  }

  // 사진: 드라이브 썸네일 주소를 쓰고, 막히면 서버를 거쳐 받아온다.
  var IMG_CACHE = {};
  function imgTag(id, size, alt) {
    if (IMG_CACHE[id]) return '<img src="' + IMG_CACHE[id] + '" alt="' + esc(alt || '') + '" loading="lazy">';
    return '<img src="https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=' + size + '" data-img-id="' + esc(id) + '" alt="' + esc(alt || '') + '" loading="lazy" referrerpolicy="no-referrer">';
  }
  document.addEventListener('error', function (ev) {
    var img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.getAttribute('data-img-id') || img._fallback) return;
    img._fallback = true;
    var id = img.getAttribute('data-img-id');
    if (IMG_CACHE[id]) { img.src = IMG_CACHE[id]; return; }
    api('imageData', { id: id }).then(function (j) {
      var bin = atob(j.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      IMG_CACHE[id] = URL.createObjectURL(new Blob([arr]));
      document.querySelectorAll('img[data-img-id="' + id + '"]').forEach(function (n) { n.src = IMG_CACHE[id]; });
    }).catch(function () { img.classList.add('img-broken'); });
  }, true);

  function studyFilter(boardId) {
    var st = S.st, b = S.idx.boards[boardId];
    var terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = (S.idx.byTarget['board|' + boardId] || []).filter(function (e) {
      if (st.cat && e.section !== st.cat) return false;
      if (st.src && e.source !== st.src) return false;
      if (st.author && e.authorId !== st.author) return false;
      if (st.photo && !(e.images || []).length) return false;
      var tg = tagsOf(e);
      if (st.tags.length && !st.tags.every(function (t) { return tg.indexOf(t) >= 0; })) return false;
      if (terms.length && !matchAll(searchText(e), terms)) return false;
      return true;
    });
    var by = st.sort;
    list.sort(function (a, c) {
      if (by === 'old') return a.createdAt < c.createdAt ? -1 : 1;
      if (by === 'cmt') return (c.comments || 0) - (a.comments || 0) || (a.updatedAt < c.updatedAt ? 1 : -1);
      if (by === 'title') return String(a.title || a.text).localeCompare(String(c.title || c.text), 'ko');
      return a.updatedAt < c.updatedAt ? 1 : -1;
    });
    var known = {};
    b.sections.forEach(function (x) { known[x.id] = 1; });
    return { list: list, terms: terms, known: known };
  }

  function catColor(boardId, secId) {
    var b = S.idx.boards[boardId], i = b ? b.sections.findIndex(function (x) { return x.id === secId; }) : -1;
    var hues = ['#2E6F95', '#B5462F', '#5A7D2B', '#7A4E9C', '#A06A00', '#1F7A6E', '#9B3C67', '#4A5FA8', '#8A5A3A', '#3C7F4A', '#A0434A', '#55606E', '#6C6C3A'];
    return i < 0 ? '#7A8583' : hues[i % hues.length];
  }

  function studyCard(e, opts) {
    opts = opts || {};
    var b = S.idx.boards[e.target];
    var sec = b && b.sections.filter(function (x) { return x.id === e.section; })[0];
    var im = (e.images || [])[0];
    var terms = opts.terms || [];
    var ocrHit = terms.length && e.ocr && !matchAll([e.title, e.text, e.tags].join(' '), terms) && matchAll(e.ocr, terms);
    var body = snippet(e.text);
    return '<button class="scard' + (opts.compact ? ' compact' : '') + (im ? ' has-img' : '') + '" data-act="study-card" data-id="' + esc(e.id) + '" style="--cat:' + catColor(e.target, e.section) + '">' +
      (im ? '<span class="scard-img" style="aspect-ratio:' + (im.w && im.h ? Math.max(0.6, Math.min(1.8, im.w / im.h)).toFixed(3) : '4/3') + '">' + imgTag(im.id, 'w600', '') +
        ((e.images || []).length > 1 ? '<span class="img-count">+' + (e.images.length - 1) + '</span>' : '') + '</span>' : '') +
      '<span class="scard-body">' +
      '<span class="scard-cat">' + esc(sec ? sec.name : '분류 없음') + (e.source ? '<i>' + esc(e.source) + '</i>' : '') + '</span>' +
      (e.title ? '<b class="scard-title">' + hl(e.title, terms) + '</b>' : '') +
      (body ? '<span class="scard-text">' + hl(body.slice(0, 220), terms) + '</span>' : '') +
      (ocrHit ? '<span class="scard-ocr">📷 사진 속 글자: ' + hl(around(e.ocr, terms), terms) + '</span>' : '') +
      (tagsOf(e).length ? '<span class="scard-tags">' + tagsOf(e).slice(0, 5).map(function (t) { return '<span class="kw' + (S.st.tags.indexOf(t) >= 0 ? ' on' : '') + '">#' + esc(t) + '</span>'; }).join('') + '</span>' : '') +
      '<span class="scard-foot"><i class="dot" style="background:' + colorOf(e.authorId) + '"></i>' + esc(nameOf(e.authorId)) + '<span>' + ago(e.updatedAt) + '</span>' +
      (e.comments ? '<span class="scard-cm">💬 ' + e.comments + '</span>' : '') + '</span></span>' + cbadge(e.comments) + '</button>';
  }

  function viewStudy(boardId) {
    var b = S.idx.boards[boardId], st = S.st, cfg = S.data.config;
    var all = S.idx.byTarget['board|' + boardId] || [];
    var res = studyFilter(boardId), list = res.list;
    // 키워드: 관리자가 정한 것 + 실제 쓰인 것(많이 쓰인 순)
    var used = {};
    all.forEach(function (e) { tagsOf(e).forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
    var preset = cfg.studyTags || [];
    var tags = preset.concat(Object.keys(used).filter(function (t) { return preset.indexOf(t) < 0; }).sort(function (a, c) { return used[c] - used[a]; }));
    st.tags.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
    var catCount = {};
    all.forEach(function (e) { catCount[e.section] = (catCount[e.section] || 0) + 1; });
    var authors = {};
    all.forEach(function (e) { authors[e.authorId] = 1; });
    var filtered = st.cat || st.tags.length || st.src || st.author || st.photo || st.q;

    var head = '<div class="page-head study-head"><div><div class="eyebrow">함께 쌓는 공부 노트</div><h1>' + esc(b.name) + '</h1>' +
      '<p>' + all.length + '개 · 사진 ' + all.reduce(function (n, e) { return n + (e.images || []).length; }, 0) + '장</p></div></div>';
    var tools = '<div class="st-bar">' +
      '<div class="searchbar st-search">' + ICON.search + '<input class="input" id="st-q" type="search" placeholder="제목, 내용, 키워드, 사진 속 글자까지 검색" value="' + esc(st.q) + '" autocomplete="off"></div>' +
      '<nav class="seg st-views" aria-label="보기 방식">' + [['gallery', '갤러리'], ['board', '보드'], ['list', '목록']].map(function (v) {
        return '<a href="javascript:void 0" data-act="st-view" data-v="' + v[0] + '"' + (st.view === v[0] ? ' aria-current="page"' : '') + '>' + v[1] + '</a>';
      }).join('') + '</nav></div>';
    var cats = '<div class="st-cats">' + '<button class="chip-nav' + (!st.cat ? ' on' : '') + '" data-act="st-cat" data-v="">전체 <small>' + all.length + '</small></button>' +
      b.sections.map(function (x) {
        return '<button class="chip-nav' + (st.cat === x.id ? ' on' : '') + '" data-act="st-cat" data-v="' + esc(x.id) + '" style="--cat:' + catColor(boardId, x.id) + '"><i class="cat-dot"></i>' + esc(x.name) + (catCount[x.id] ? ' <small>' + catCount[x.id] + '</small>' : '') + '</button>';
      }).join('') + '</div>';
    var kws = '<div class="st-kws">' + tags.map(function (t) {
      return '<button class="kw-btn' + (st.tags.indexOf(t) >= 0 ? ' on' : '') + (used[t] ? '' : ' unused') + '" data-act="st-tag" data-v="' + esc(t) + '" aria-pressed="' + (st.tags.indexOf(t) >= 0) + '">#' + esc(t) + (used[t] ? '<small>' + used[t] + '</small>' : '') + '</button>';
    }).join('') + (isAdmin() ? '<a class="kw-edit" href="#/admin" data-act="goto-study-admin">키워드 관리</a>' : '') + '</div>';
    var filters = '<div class="st-filters">' +
      '<select class="select sm" id="st-src" aria-label="출처"><option value="">출처 전체</option>' + (cfg.studySources || []).map(function (x) { return '<option' + (st.src === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select class="select sm" id="st-author" aria-label="작성자"><option value="">작성자 전체</option>' + Object.keys(authors).map(function (a) { return '<option value="' + esc(a) + '"' + (st.author === a ? ' selected' : '') + '>' + esc(nameOf(a)) + '</option>'; }).join('') + '</select>' +
      '<button class="chip-nav' + (st.photo ? ' on' : '') + '" data-act="st-photo">📷 사진 있는 것만</button>' +
      '<select class="select sm" id="st-sort" aria-label="정렬">' + [['new', '최근 수정순'], ['old', '오래된순'], ['cmt', '댓글 많은순'], ['title', '제목순']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      (filtered ? '<button class="add-link" data-act="st-clear">필터 지우기</button>' : '') +
      '<span class="st-count">' + list.length + '개</span></div>';

    var body;
    if (!all.length) {
      body = '<div class="st-empty"><b>아직 공부 노트가 없어요.</b><span>교수님께 들은 설명, 공부한 내용, 칠판·교과서 사진을 남겨보세요. 사진은 끌어다 놓거나 Ctrl+V로 붙여넣을 수 있어요.</span>' +
        (canWrite() ? '<button class="btn btn-primary" data-act="study-new" data-board="' + esc(boardId) + '">첫 노트 쓰기</button>' : '') + '</div>';
    } else if (!list.length) {
      body = '<div class="st-empty"><b>조건에 맞는 노트가 없어요.</b><span>키워드를 줄이거나 검색어를 바꿔보세요.</span><button class="btn" data-act="st-clear">필터 지우기</button></div>';
    } else if (st.view === 'board') {
      var cols = b.sections.concat(list.some(function (e) { return !res.known[e.section]; }) ? [{ id: '__none', name: '분류 없음' }] : []);
      body = '<div class="kanban">' + cols.map(function (x) {
        var items = list.filter(function (e) { return x.id === '__none' ? !res.known[e.section] : e.section === x.id; });
        if (!items.length) return '';
        return '<div class="kcol" style="--cat:' + catColor(boardId, x.id) + '"><div class="kcol-head"><i class="cat-dot"></i><b>' + esc(x.name) + '</b><span>' + items.length + '</span></div>' +
          '<div class="kcol-body">' + (items.map(function (e) { return studyCard(e, { terms: res.terms, compact: true }); }).join('') || '<div class="empty-line">비어 있음</div>') + '</div></div>';
      }).join('') + '</div>';
    } else if (st.view === 'list') {
      body = '<div class="slist">' + list.map(function (e) {
        var sec = b.sections.filter(function (x) { return x.id === e.section; })[0];
        return '<button class="srow" data-act="study-card" data-id="' + esc(e.id) + '" style="--cat:' + catColor(boardId, e.section) + '">' +
          '<span class="srow-cat"><i class="cat-dot"></i>' + esc(sec ? sec.name : '분류 없음') + '</span>' +
          '<span class="srow-main"><b>' + hl(e.title || snippet(e.text).slice(0, 60) || '(제목 없음)', res.terms) + '</b>' +
          '<span class="srow-tags">' + tagsOf(e).slice(0, 4).map(function (t) { return '#' + esc(t); }).join(' ') + '</span></span>' +
          '<span class="srow-meta">' + ((e.images || []).length ? '📷' + e.images.length + ' ' : '') + (e.comments ? '💬' + e.comments + ' ' : '') + esc(nameOf(e.authorId)) + ' · ' + shortDate(e.updatedAt) + '</span></button>';
      }).join('') + '</div>';
    } else {
      body = '<div class="gallery">' + list.map(function (e) { return studyCard(e, { terms: res.terms }); }).join('') + '</div>';
    }
    return '<div id="study-root" data-board="' + esc(boardId) + '">' + head + tools + cats + kws + filters + body + '</div>';
  }

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'st-q') { S.st.q = t.value; clearTimeout(viewStudy._t); viewStudy._t = setTimeout(rerenderKeep, 120); }
    if (t.closest && t.closest('#cm-form') && t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'st-src') { S.st.src = t.value; saveSt(); rerenderKeep(); }
    if (t.id === 'st-author') { S.st.author = t.value; saveSt(); rerenderKeep(); }
    if (t.id === 'st-sort') { S.st.sort = t.value; saveSt(); rerenderKeep(); }
    if (t.name === 'imgs' && t.closest('#study-form')) { addStudyFiles(t.files); t.value = ''; }
  });
  document.addEventListener('paste', function (ev) {
    var f = document.getElementById('study-form');
    var files = Array.prototype.filter.call((ev.clipboardData && ev.clipboardData.files) || [], function (x) { return /^image\//.test(x.type); });
    if (!files.length) return;
    if (f) { ev.preventDefault(); return addStudyFiles(files); }
    var r = parseRoute();
    if (sheet.hidden && canWrite() && r.name === 'b' && S.idx && S.idx.boards[r.id] && isStudyBoard(S.idx.boards[r.id])) {
      ev.preventDefault(); openStudyComposer(r.id); addStudyFiles(files);
    }
  });

  /* ---------- 공부 노트 작성 ---------- */
  var CMP = { images: [] };
  function openStudyComposer(boardId, entry) {
    var b = S.idx.boards[boardId], cfg = S.data.config;
    CMP = { images: entry ? (entry.images || []).map(function (im) { return Object.assign({ status: 'done', key: rid('k') }, im); }) : [], board: boardId };
    var cur = entry ? entry.section : (S.st.cat || (b.sections[0] && b.sections[0].id));
    var mineTags = entry ? tagsOf(entry) : S.st.tags.slice();
    var used = {};
    (S.idx.byTarget['board|' + boardId] || []).forEach(function (e) { tagsOf(e).forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
    var tagList = (cfg.studyTags || []).slice();
    Object.keys(used).sort(function (a, c) { return used[c] - used[a]; }).forEach(function (t) { if (tagList.indexOf(t) < 0) tagList.push(t); });
    mineTags.forEach(function (t) { if (tagList.indexOf(t) < 0) tagList.push(t); });
    var src = entry ? entry.source : (cfg.studySources || [])[0];
    openSheet('<form id="study-form"' + (entry ? ' data-id="' + esc(entry.id) + '"' : '') + ' data-board="' + esc(boardId) + '">' +
      '<h2 class="sheet-title">' + (entry ? '공부 노트 수정' : '공부 노트 쓰기') + '</h2>' +
      '<label class="field"><span>제목</span><input class="input" name="title" maxlength="120" value="' + esc(entry ? entry.title : '') + '" placeholder="예: Sufentanil vs fentanyl CSHT" autofocus></label>' +
      '<label class="field"><span>카테고리</span><select class="select" name="section">' + b.sections.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="field"><span>출처</span><div class="src-row">' + (cfg.studySources || []).map(function (x) {
        return '<button type="button" class="kw-btn" data-act="cmp-src" data-v="' + esc(x) + '" aria-pressed="' + (x === src) + '">' + esc(x) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field"><span>키워드 (여러 개 고를 수 있어요)</span><div class="kw-pick" id="kw-pick">' + tagList.map(function (t) {
        return '<button type="button" class="kw-btn" data-act="cmp-tag" data-v="' + esc(t) + '" aria-pressed="' + (mineTags.indexOf(t) >= 0) + '">#' + esc(t) + '</button>';
      }).join('') + '</div><input class="input" id="kw-new" placeholder="새 키워드 입력 후 Enter (쉼표로 여러 개)" maxlength="60" style="margin-top:8px"></div>' +
      '<div class="field"><span>사진</span><label class="dropzone img-drop" data-drop="1"><input type="file" name="imgs" accept="image/*" multiple>' +
      '<span class="dz-text">사진을 끌어다 놓거나, 눌러서 고르거나, Ctrl+V로 붙여넣기</span></label>' +
      '<div class="cmp-imgs" id="cmp-imgs"></div>' +
      '<label class="check" style="margin-top:8px"><input type="checkbox" name="ocr" checked>사진 속 글자를 읽어서 검색되게 하기</label></div>' +
      '<label class="field"><span>내용</span><textarea class="textarea" name="text" maxlength="5000" placeholder="교수님 설명, 공부한 내용을 정리해 주세요. 사진만 올려도 됩니다.">' + esc(entry ? entry.text : '') + '</textarea>' +
      '<div class="hint">**굵게** · 줄 앞에 "- " 를 쓰면 목록 · Ctrl/⌘+Enter 저장</div></label>' +
      (!entry && S.me !== 'anon' ? '<label class="check" style="margin:0 0 14px"><input type="checkbox" name="anon">익명으로 올리기</label>' : '') +
      '<div class="sheet-actions"><button class="btn" type="button" data-act="close">취소</button><button class="btn btn-primary" type="submit">' + (entry ? '수정 저장' : '올리기') + '</button></div></form>', 'sheet-wide');
    renderCmpImages();
    var kn = document.getElementById('kw-new');
    kn.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      addNewTags(kn.value); kn.value = '';
    });
  }
  function addNewTags(v) {
    var pick = document.getElementById('kw-pick');
    String(v || '').split(',').map(function (x) { return x.trim().replace(/^#/, ''); }).filter(Boolean).forEach(function (t) {
      var ex = pick.querySelector('[data-v="' + CSS.escape(t) + '"]');
      if (ex) { ex.setAttribute('aria-pressed', 'true'); return; }
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'kw-btn'; b.setAttribute('data-act', 'cmp-tag'); b.setAttribute('data-v', t); b.setAttribute('aria-pressed', 'true');
      b.textContent = '#' + t; pick.appendChild(b);
    });
  }
  function renderCmpImages() {
    var el = document.getElementById('cmp-imgs');
    if (!el) return;
    el.innerHTML = CMP.images.map(function (im, i) {
      var src = im.preview ? '<img src="' + im.preview + '" alt="">' : imgTag(im.id, 'w300', '');
      return '<div class="cmp-img ' + (im.status || '') + '">' + src +
        (im.status === 'up' ? '<span class="cmp-st">올리는 중…</span>' : im.status === 'err' ? '<span class="cmp-st err">실패</span>' : (im.ocr ? '<span class="cmp-st ok" title="' + esc(im.ocr.slice(0, 200)) + '">글자 인식됨</span>' : '')) +
        (i > 0 ? '<button type="button" class="cmp-x left" data-act="cmp-img-left" data-i="' + i + '" aria-label="앞으로">‹</button>' : '') +
        '<button type="button" class="cmp-x" data-act="cmp-img-del" data-i="' + i + '" aria-label="빼기">✕</button></div>';
    }).join('');
  }
  function addStudyFiles(files) {
    var f = document.getElementById('study-form');
    if (!f) return;
    var wantOcr = f.querySelector('[name=ocr]').checked;
    Array.prototype.forEach.call(files, function (file) {
      if (!/^image\//.test(file.type)) { toast('사진 파일만 올릴 수 있어요. 문서는 각 보드의 인계장 파일에 올려주세요.'); return; }
      if (CMP.images.length >= 20) { toast('사진은 한 노트에 20장까지예요.'); return; }
      var item = { key: rid('k'), status: 'up', preview: URL.createObjectURL(file) };
      CMP.images.push(item);
      renderCmpImages();
      prepImage(file).then(function (p) {
        return api('uploadImage', { image: { data: p.data, mime: p.mime, name: file.name || 'image.jpg', w: p.w, h: p.h, ocr: wantOcr } });
      }).then(function (j) {
        Object.assign(item, j.image, { status: 'done' });
        renderCmpImages();
      }).catch(function (e) { item.status = 'err'; renderCmpImages(); toast(e.message); });
    });
  }
  // 긴 변 2000px, JPEG로 줄여서 올린다(작은 사진은 그대로).
  function prepImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, 2000 / Math.max(w, h));
        var keep = scale === 1 && file.size < 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(file.type);
        if (keep) {
          var r = new FileReader();
          r.onload = function () { resolve({ data: String(r.result).split(',')[1], mime: file.type, w: w, h: h }); };
          r.onerror = function () { reject(new Error('사진을 읽지 못했어요.')); };
          r.readAsDataURL(file); return;
        }
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ data: c.toDataURL('image/jpeg', 0.86).split(',')[1], mime: 'image/jpeg', w: c.width, h: c.height });
      };
      img.onerror = function () { reject(new Error('이 사진 형식은 열 수 없어요. JPG나 PNG로 올려주세요.')); };
      img.src = url;
    });
  }
  function submitStudy(f) {
    if (CMP.images.some(function (i) { return i.status === 'up'; })) return toast('사진을 올리는 중이에요. 잠시 후 다시 눌러주세요.');
    addNewTags(document.getElementById('kw-new').value);
    var fd = new FormData(f), id = f.getAttribute('data-id');
    var tags = Array.prototype.map.call(f.querySelectorAll('#kw-pick [aria-pressed=true]'), function (b) { return b.getAttribute('data-v'); });
    var srcBtn = f.querySelector('.src-row [aria-pressed=true]');
    var images = CMP.images.filter(function (i) { return i.status === 'done'; }).map(function (i) { return { id: i.id, w: i.w, h: i.h, ocr: i.ocr || '', cap: i.cap || '' }; });
    var text = String(fd.get('text') || '').trim(), title = String(fd.get('title') || '').trim();
    if (!text && !images.length) return toast('내용이나 사진 중 하나는 있어야 해요.');
    var payload = { title: title, section: fd.get('section'), tags: tags, source: srcBtn ? srcBtn.getAttribute('data-v') : '', text: text, images: images };
    var btn = f.querySelector('[type=submit]'); btn.disabled = true;
    var p = id ? api('updateEntry', Object.assign({ id: id }, payload))
      : api('addEntry', { by: fd.get('anon') ? 'anon' : S.me, entry: Object.assign({ scope: 'board', target: f.getAttribute('data-board') }, payload) });
    p.then(function (j) {
      upsertEntry(j.entry); toast(id ? '수정했어요.' : '올렸어요.');
      openEntry(j.entry.id);
    }).catch(function (e) { btn.disabled = false; toast(e.message); });
  }

  /* ---------- 사진 크게 보기 ---------- */
  var LB = { open: false, id: null, i: 0, el: null };
  function openLightbox(entryId, i) {
    LB.id = entryId; LB.i = i; LB.open = true;
    if (!LB.el) {
      LB.el = document.createElement('div');
      LB.el.className = 'lightbox';
      document.body.appendChild(LB.el);
      var sx = null;
      LB.el.addEventListener('touchstart', function (ev) { sx = ev.touches[0].clientX; }, { passive: true });
      LB.el.addEventListener('touchend', function (ev) {
        if (sx == null) return;
        var dx = ev.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) > 50) moveLightbox(dx < 0 ? 1 : -1);
      });
      LB.el.addEventListener('click', function (ev) { if (ev.target === LB.el || ev.target.classList.contains('lb-stage')) closeLightbox(); });
    }
    drawLightbox();
  }
  function drawLightbox() {
    var e = findEntry(LB.id), ims = (e && e.images) || [], im = ims[LB.i];
    if (!im) return closeLightbox();
    LB.el.hidden = false;
    LB.el.innerHTML = '<div class="lb-top"><span>' + (LB.i + 1) + ' / ' + ims.length + '</span>' +
      (im.ocr ? '<button class="lb-btn" data-act="lb-ocr">글자 보기</button>' : '') +
      '<a class="lb-btn" href="https://drive.google.com/file/d/' + encodeURIComponent(im.id) + '/view" target="_blank" rel="noopener">원본</a>' +
      '<button class="lb-btn" data-act="lb-close" aria-label="닫기">✕</button></div>' +
      '<div class="lb-stage">' + imgTag(im.id, 'w2000', '') + '</div>' +
      (ims.length > 1 ? '<button class="lb-nav prev" data-act="lb-prev" aria-label="이전">‹</button><button class="lb-nav next" data-act="lb-next" aria-label="다음">›</button>' : '') +
      (im.ocr ? '<div class="lb-ocr" hidden>' + esc(im.ocr) + '</div>' : '');
  }
  function moveLightbox(d) {
    var e = findEntry(LB.id), n = ((e && e.images) || []).length;
    if (!n) return;
    LB.i = (LB.i + d + n) % n; drawLightbox();
  }
  function closeLightbox() { LB.open = false; if (LB.el) { LB.el.hidden = true; LB.el.innerHTML = ''; } }

  /* ---------- 전체 검색 (Ctrl/⌘+K) ---------- */
  var PALETTE_UI = { open: false, q: '', sel: 0, items: [], el: null };
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function choseong(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i) - 0xAC00;
      out += (c >= 0 && c <= 11171) ? CHO[Math.floor(c / 588)] : str[i];
    }
    return out;
  }
  function isChoQuery(t) { return /^[ㄱ-ㅎ]+$/.test(t); }
  function matchAll(hay, terms) {
    var h = hay.toLowerCase(), ch = null;
    return terms.every(function (t) {
      if (h.indexOf(t) >= 0) return true;
      if (isChoQuery(t)) { ch = ch || choseong(h); return ch.indexOf(t) >= 0; }
      return false;
    });
  }
  function hl(text, terms) {
    var h = esc(text);
    terms.filter(function (t) { return !isChoQuery(t); }).forEach(function (t) {
      var re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      h = h.replace(re, function (m) { return '\u0001' + m + '\u0002'; });
    });
    return h.replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
  }
  function around(text, terms) {
    var t = snippet(text), lower = t.toLowerCase(), pos = -1;
    terms.forEach(function (x) { var i = lower.indexOf(x); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
    if (pos > 30) t = '…' + t.slice(pos - 20);
    return t.slice(0, 140);
  }

  function paletteItems(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var groups = [];
    if (!terms.length) {
      var rec = [];
      try { rec = JSON.parse(ls('recentq') || '[]'); } catch (e) { rec = []; }
      if (rec.length) groups.push({ name: '최근 검색', items: rec.map(function (r) { return { kind: 'recent', icon: '↺', title: r, run: function () { setPaletteQuery(r); } }; }) });
      groups.push({ name: '바로 가기', items: S.data.config.boards.map(function (b) {
        return { kind: 'board', icon: '#', title: b.name, sub: b.group, run: function () { location.hash = '#/b/' + b.id; } };
      }).concat([{ kind: 'page', icon: '◎', title: '교수님 목록', run: function () { location.hash = '#/profs'; } }]) });
      return groups;
    }
    var pages = [];
    S.data.config.boards.forEach(function (b) {
      if (matchAll(b.name + ' ' + (b.group || ''), terms)) pages.push({ kind: 'board', icon: '#', title: b.name, sub: (b.group || '') + ' 보드', run: function () { location.hash = '#/b/' + b.id; } });
      b.sections.forEach(function (sec) {
        var secTerms = terms.filter(function (t) { return !matchAll(b.name, [t]); });
        if (secTerms.length && matchAll(b.name + ' ' + sec.name, terms) && matchAll(sec.name, secTerms)) {
          pages.push({ kind: 'section', icon: '§', title: b.name + ' › ' + sec.name, sub: '섹션', run: function () { location.hash = '#/b/' + b.id + '/s/' + sec.id; } });
        }
      });
    });
    S.data.profs.forEach(function (p) {
      if (matchAll(p.name + ' ' + (p.memo || '') + ' 교수님', terms)) pages.push({ kind: 'prof', icon: '◎', title: p.name + ' 교수님', sub: (S.idx.counts['prof|' + p.id] || 0) + '개 · ' + p.boards.map(function (x) { return S.idx.boards[x] ? S.idx.boards[x].name : ''; }).filter(String).join(', '), run: function () { location.hash = '#/p/' + p.id; } });
    });
    if (pages.length) groups.push({ name: '페이지', items: pages.slice(0, 8) });

    var entries = S.data.entries.filter(function (e) {
      return matchAll(searchText(e), terms);
    }).sort(function (a, b) {
      var ta = ((a.title || '') + a.text).toLowerCase().indexOf(terms[0]) >= 0 ? 0 : 1, tb = ((b.title || '') + b.text).toLowerCase().indexOf(terms[0]) >= 0 ? 0 : 1;
      return ta - tb || (a.updatedAt < b.updatedAt ? 1 : -1);
    });
    if (entries.length) groups.push({ name: '인계 ' + entries.length + '개', items: entries.slice(0, 40).map(function (e) {
      var src = e.text && matchAll(e.text, terms) ? e.text : (e.ocr && matchAll(e.ocr, terms) ? '📷 ' + e.ocr : (e.text || e.tags || ''));
      return { kind: 'entry', icon: '', color: colorOf(e.authorId), title: crumbText(e), html: hl(around(src, terms), terms), sub: nameOf(e.authorId) + ' · ' + ago(e.updatedAt),
        run: function () { S.focusEntry = e.id; var h = crumbHref(e); if (location.hash === h) render(); else location.hash = h; } };
    }) });

    var docs = (S.data.docs || []).filter(function (d) { return matchAll(d.title + ' ' + (d.name || '') + ' ' + (d.note || '') + ' ' + (S.idx.boards[d.board] ? S.idx.boards[d.board].name : ''), terms); });
    if (docs.length) groups.push({ name: '인계장 파일', items: docs.slice(0, 8).map(function (d) {
      return { kind: 'doc', icon: extOf(d), title: d.title, sub: (S.idx.boards[d.board] ? S.idx.boards[d.board].name + ' · ' : '') + (d.note || shortDate(d.at)), run: function () { openDoc(d.id); } };
    }) });
    var links = (S.data.config.links || []).filter(function (l) { return matchAll(l.title + ' ' + l.url, terms); });
    if (links.length) groups.push({ name: '링크', items: links.map(function (l) {
      return { kind: 'link', icon: l.icon || '🔗', title: l.title, sub: '새 탭에서 열기', run: function () { window.open(l.url, '_blank', 'noopener'); } };
    }) });
    return groups;
  }

  function openPalette(q) {
    if (!S.data || !S.pw) return;
    if (PALETTE_UI.open) { PALETTE_UI.el.querySelector('input').select(); return; }
    var el = document.createElement('div');
    el.className = 'palette-overlay';
    el.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="전체 검색">' +
      '<div class="palette-input">' + ICON.search + '<input type="search" placeholder="인계, 교수님, 보드, 파일, 링크 검색… (초성도 돼요)" autocomplete="off" spellcheck="false" aria-controls="palette-list">' +
      '<button class="palette-esc" data-pal="close" aria-label="닫기">esc</button></div>' +
      '<div class="palette-list" id="palette-list" role="listbox"></div>' +
      '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>esc</kbd> 닫기</span></div></div>';
    document.body.appendChild(el);
    PALETTE_UI.el = el; PALETTE_UI.open = true;
    document.body.style.overflow = 'hidden';
    var inp = el.querySelector('input');
    inp.addEventListener('input', function () { PALETTE_UI.q = inp.value; PALETTE_UI.sel = 0; renderPalette(); });
    el.addEventListener('mousedown', function (ev) { if (ev.target === el) closePalette(); });
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-pal=close]')) return closePalette();
      var it = ev.target.closest('[data-pi]');
      if (it) choosePalette(+it.getAttribute('data-pi'));
    });
    el.addEventListener('mousemove', function (ev) {
      var it = ev.target.closest('[data-pi]');
      if (it && +it.getAttribute('data-pi') !== PALETTE_UI.sel) { PALETTE_UI.sel = +it.getAttribute('data-pi'); markSel(false); }
    });
    inp.value = q || '';
    PALETTE_UI.q = inp.value;
    renderPalette();
    inp.focus(); inp.select();
  }
  function setPaletteQuery(q) {
    var inp = PALETTE_UI.el.querySelector('input');
    inp.value = q; PALETTE_UI.q = q; PALETTE_UI.sel = 0; renderPalette(); inp.focus();
  }
  function closePalette() {
    if (!PALETTE_UI.open) return;
    PALETTE_UI.el.remove(); PALETTE_UI.open = false; PALETTE_UI.el = null;
    document.body.style.overflow = '';
  }
  function renderPalette() {
    var groups = paletteItems(PALETTE_UI.q.trim());
    var flat = [], html = '';
    groups.forEach(function (g) {
      html += '<div class="pal-group">' + esc(g.name) + '</div>';
      g.items.forEach(function (it) {
        var i = flat.length; flat.push(it);
        var icon = it.kind === 'entry' ? '<i class="dot" style="background:' + it.color + '"></i>'
          : it.kind === 'doc' ? '<span class="ext ext-' + String(it.icon).toLowerCase() + '">' + esc(it.icon) + '</span>'
          : '<span class="pal-icon">' + esc(it.icon) + '</span>';
        html += '<div class="pal-item" role="option" data-pi="' + i + '">' + icon +
          '<div class="pal-main"><div class="pal-title">' + hl(it.title, it.kind === 'recent' ? [] : PALETTE_UI.q.toLowerCase().split(/\s+/).filter(Boolean)) + '</div>' +
          (it.html ? '<div class="pal-snip">' + it.html + '</div>' : '') + '</div>' +
          (it.sub ? '<span class="pal-sub">' + esc(it.sub) + '</span>' : '') + '</div>';
      });
    });
    if (!flat.length) html = '<div class="pal-empty">"' + esc(PALETTE_UI.q) + '"에 맞는 결과가 없어요. 다른 단어나 초성으로 찾아보세요.</div>';
    PALETTE_UI.items = flat;
    var list = PALETTE_UI.el.querySelector('.palette-list');
    list.innerHTML = html;
    list.scrollTop = 0;
    markSel(true);
  }
  function markSel(scroll) {
    var list = PALETTE_UI.el.querySelector('.palette-list');
    list.querySelectorAll('.pal-item').forEach(function (n) {
      var on = +n.getAttribute('data-pi') === PALETTE_UI.sel;
      n.classList.toggle('sel', on); n.setAttribute('aria-selected', on);
      if (on && scroll) n.scrollIntoView({ block: 'nearest' });
    });
  }
  function choosePalette(i) {
    var it = PALETTE_UI.items[i];
    if (!it) return;
    if (it.kind === 'recent') return it.run();
    var q = PALETTE_UI.q.trim();
    if (q) {
      var rec = [];
      try { rec = JSON.parse(ls('recentq') || '[]'); } catch (e) { rec = []; }
      rec = [q].concat(rec.filter(function (x) { return x !== q; })).slice(0, 6);
      ls('recentq', JSON.stringify(rec));
    }
    closePalette();
    it.run();
  }
  document.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if ((ev.metaKey || ev.ctrlKey) && (k === 'k' || k === 'K')) {
      ev.preventDefault();
      if (PALETTE_UI.open) closePalette(); else if (sheet.hidden) openPalette();
      return;
    }
    if (!PALETTE_UI.open) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (k === '/' && sheet.hidden && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !ev.target.isContentEditable) { ev.preventDefault(); openPalette(); }
      return;
    }
    if (k === 'Escape') { ev.preventDefault(); closePalette(); }
    else if (k === 'ArrowDown') { ev.preventDefault(); PALETTE_UI.sel = Math.min(PALETTE_UI.sel + 1, PALETTE_UI.items.length - 1); markSel(true); }
    else if (k === 'ArrowUp') { ev.preventDefault(); PALETTE_UI.sel = Math.max(PALETTE_UI.sel - 1, 0); markSel(true); }
    else if (k === 'Enter' && !ev.isComposing) { ev.preventDefault(); choosePalette(PALETTE_UI.sel); }
  }, true);

  /* ---------- 동기화 ---------- */
  function maybeRefresh() {
    if (S.pw && S.role && document.visibilityState === 'visible' && Date.now() - S.lastFetch > 30000 && sheet.hidden && !S.dirty && !PALETTE_UI.open) {
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
