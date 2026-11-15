/** @OnlyCurrentDoc */
/**
 * 인계보드 백엔드 (Google Apps Script)
 *
 * 처음 한 번만:
 *   1) 아래 INITIAL_PASSWORDS 세 개를 원하는 비밀번호로 바꾸고, INITIAL_MEMBERS 에 동기 이름을 적는다.
 *   2) 상단 함수 선택에서 setup 을 고르고 ▶ 실행 (권한 승인).
 *   3) 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → URL 복사.
 *   4) 실행이 끝나면 INITIAL_PASSWORDS 는 지워도 된다(비밀번호는 해시로만 저장됨).
 *      이후 비밀번호 변경은 화면의 관리자 설정에서 한다.
 */
var INITIAL_PASSWORDS = {
  admin: 'CHANGE-ME-admin',
  member: 'CHANGE-ME-member',
  viewer: 'CHANGE-ME-viewer'
};

// 처음 등록할 동기 이름 (이후 추가·변경은 화면의 관리자 설정 > 동기에서)
var INITIAL_MEMBERS = [];

var ENTRY_COLS = ['id', 'scope', 'target', 'section', 'tag', 'text', 'authorId',
  'createdAt', 'updatedAt', 'updatedBy', 'confirmedAt', 'confirmedBy', 'deleted'];
var PROF_COLS = ['id', 'name', 'boards', 'memo', 'order', 'deleted'];
var HIST_COLS = ['ts', 'entryId', 'action', 'by', 'before', 'after'];
var LEVEL = { viewer: 1, member: 2, admin: 3 };
var MAX_TEXT = 5000;

/* ---------- 진입점 ---------- */

function doGet() {
  return out_({ ok: true, msg: 'handover board api' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
  }
  var role = roleOf_(req.pw);
  if (!role) {
    Utilities.sleep(700);
    return out_({ ok: false, code: 'AUTH', error: '비밀번호가 맞지 않습니다.' });
  }
  try {
    var res = route_(req, role) || {};
    res.ok = true;
    res.role = role;
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function route_(req, role) {
  switch (req.action) {
    case 'login': return {};
    case 'getAll': return getAll_();
    case 'addEntry': need_(role, 'member'); return locked_(function () { return addEntry_(req); });
    case 'updateEntry': need_(role, 'member'); return locked_(function () { return updateEntry_(req); });
    case 'deleteEntry': need_(role, 'member'); return locked_(function () { return deleteEntry_(req); });
    case 'confirmEntry': need_(role, 'member'); return locked_(function () { return confirmEntry_(req); });
    case 'history': return history_(req);
    case 'saveConfig': need_(role, 'admin'); return locked_(function () { return saveConfig_(req); });
    case 'saveProfessor': need_(role, 'admin'); return locked_(function () { return saveProfessor_(req); });
    case 'deleteProfessor': need_(role, 'admin'); return locked_(function () { return deleteProfessor_(req); });
    case 'setPassword': need_(role, 'admin'); return setPassword_(req);
    default: throw new Error('알 수 없는 요청입니다: ' + req.action);
  }
}

/* ---------- 조회 ---------- */

function getAll_() {
  var entries = readRows_(sheet_('entries', ENTRY_COLS), ENTRY_COLS)
    .filter(function (r) { return !truthy_(r.deleted); })
    .map(function (r) { delete r.deleted; return r; });
  var profs = readRows_(sheet_('professors', PROF_COLS), PROF_COLS)
    .filter(function (r) { return !truthy_(r.deleted); })
    .map(profOut_);
  return { config: readConfig_(), profs: profs, entries: entries, serverTime: now_() };
}

function history_(req) {
  var rows = readRows_(sheet_('history', HIST_COLS), HIST_COLS)
    .filter(function (r) { return r.entryId === req.id; });
  return { history: rows };
}

/* ---------- 인계 ---------- */

function addEntry_(req) {
  var e = req.entry || {};
  var cfg = readConfig_();
  validateTarget_(cfg, e.scope, e.target);
  var text = cleanText_(e.text);
  var t = now_();
  var row = {
    id: Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    scope: e.scope, target: String(e.target),
    section: String(e.section || ''), tag: cleanTag_(e.tag), text: text,
    authorId: String(req.by || ''), createdAt: t, updatedAt: t, updatedBy: String(req.by || ''),
    confirmedAt: t, confirmedBy: String(req.by || ''), deleted: ''
  };
  appendRow_(sheet_('entries', ENTRY_COLS), ENTRY_COLS, row);
  log_(row.id, 'add', req.by, '', text);
  delete row.deleted;
  return { entry: row };
}

function updateEntry_(req) {
  var sh = sheet_('entries', ENTRY_COLS);
  var found = findRow_(sh, ENTRY_COLS, req.id);
  if (!found || truthy_(found.obj.deleted)) throw new Error('이미 삭제되었거나 없는 인계입니다.');
  var before = found.obj.text;
  var o = found.obj;
  if (req.text !== undefined) o.text = cleanText_(req.text);
  if (req.section !== undefined) o.section = String(req.section || '');
  if (req.tag !== undefined) o.tag = cleanTag_(req.tag);
  o.updatedAt = now_();
  o.updatedBy = String(req.by || '');
  o.confirmedAt = o.updatedAt;
  o.confirmedBy = o.updatedBy;
  writeRow_(sh, ENTRY_COLS, found.rowIndex, o);
  log_(o.id, 'edit', req.by, before, o.text);
  delete o.deleted;
  return { entry: o };
}

function deleteEntry_(req) {
  var sh = sheet_('entries', ENTRY_COLS);
  var found = findRow_(sh, ENTRY_COLS, req.id);
  if (!found) throw new Error('없는 인계입니다.');
  found.obj.deleted = 'TRUE';
  found.obj.updatedAt = now_();
  found.obj.updatedBy = String(req.by || '');
  writeRow_(sh, ENTRY_COLS, found.rowIndex, found.obj);
  log_(found.obj.id, 'delete', req.by, found.obj.text, '');
  return { id: req.id };
}

function confirmEntry_(req) {
  var sh = sheet_('entries', ENTRY_COLS);
  var found = findRow_(sh, ENTRY_COLS, req.id);
  if (!found || truthy_(found.obj.deleted)) throw new Error('없는 인계입니다.');
  found.obj.confirmedAt = now_();
  found.obj.confirmedBy = String(req.by || '');
  writeRow_(sh, ENTRY_COLS, found.rowIndex, found.obj);
  log_(found.obj.id, 'confirm', req.by, '', '');
  delete found.obj.deleted;
  return { entry: found.obj };
}

/* ---------- 구조(관리자) ---------- */

function saveConfig_(req) {
  var c = req.config;
  if (!c || typeof c !== 'object') throw new Error('설정 형식이 올바르지 않습니다.');
  if (!Array.isArray(c.members) || !Array.isArray(c.boards) || !Array.isArray(c.profSections)) {
    throw new Error('설정에 members / boards / profSections 가 필요합니다.');
  }
  c.boards.forEach(function (b) {
    if (!b.id || !b.name || !Array.isArray(b.sections)) throw new Error('보드 형식이 올바르지 않습니다.');
  });
  var json = JSON.stringify(c);
  if (json.length > 45000) throw new Error('설정이 너무 큽니다.');
  sheet_('config', ['config']).getRange(2, 1).setValue(json);
  return { config: c };
}

function saveProfessor_(req) {
  var p = req.prof || {};
  var name = String(p.name || '').trim();
  if (!name) throw new Error('교수님 이름을 입력하세요.');
  var sh = sheet_('professors', PROF_COLS);
  var row = {
    id: p.id || ('p' + Utilities.getUuid().replace(/-/g, '').slice(0, 8)),
    name: name,
    boards: (p.boards || []).join(','),
    memo: String(p.memo || '').slice(0, 500),
    order: String(p.order || ''),
    deleted: ''
  };
  var found = p.id ? findRow_(sh, PROF_COLS, p.id) : null;
  if (found) writeRow_(sh, PROF_COLS, found.rowIndex, row);
  else appendRow_(sh, PROF_COLS, row);
  return { prof: profOut_(row) };
}

function deleteProfessor_(req) {
  var sh = sheet_('professors', PROF_COLS);
  var found = findRow_(sh, PROF_COLS, req.id);
  if (!found) throw new Error('없는 교수님입니다.');
  found.obj.deleted = 'TRUE';
  writeRow_(sh, PROF_COLS, found.rowIndex, found.obj);
  return { id: req.id };
}

function setPassword_(req) {
  if (!LEVEL[req.target]) throw new Error('대상 권한이 올바르지 않습니다.');
  var pw = String(req.newPw || '');
  if (pw.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');
  var props = PropertiesService.getScriptProperties();
  var h = hash_(pw);
  ['admin', 'member', 'viewer'].forEach(function (r) {
    if (r !== req.target && props.getProperty('HASH_' + r) === h) {
      throw new Error('다른 권한의 비밀번호와 같을 수 없습니다.');
    }
  });
  props.setProperty('HASH_' + req.target, h);
  return {};
}

/* ---------- 설치 ---------- */

function setup() {
  sheet_('entries', ENTRY_COLS);
  sheet_('professors', PROF_COLS);
  sheet_('history', HIST_COLS);
  var cs = sheet_('config', ['config']);
  if (!cs.getRange(2, 1).getValue()) cs.getRange(2, 1).setValue(JSON.stringify(defaultConfig_()));
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  ['admin', 'member', 'viewer'].forEach(function (r) {
    if (!props.getProperty('HASH_' + r)) {
      var pw = INITIAL_PASSWORDS[r];
      if (!pw || pw.indexOf('CHANGE-ME') === 0) throw new Error('INITIAL_PASSWORDS.' + r + ' 를 먼저 바꿔주세요.');
      props.setProperty('HASH_' + r, hash_(pw));
    }
  });
  var hs = ['admin', 'member', 'viewer'].map(function (r) { return props.getProperty('HASH_' + r); });
  if (hs[0] === hs[1] || hs[1] === hs[2] || hs[0] === hs[2]) throw new Error('세 비밀번호는 서로 달라야 합니다.');
  return 'setup 완료';
}

/** 비밀번호를 잊었을 때: INITIAL_PASSWORDS 를 새로 적고 이 함수를 실행 */
function resetPasswords() {
  var props = PropertiesService.getScriptProperties();
  ['admin', 'member', 'viewer'].forEach(function (r) { props.deleteProperty('HASH_' + r); });
  return setup();
}

function defaultConfig_() {
  var turn = function () {
    return [sec_('턴 개요'), sec_('세팅·준비'), sec_('수술별'), sec_('주의할 점')];
  };
  return {
    title: 'R26 인계보드',
    members: INITIAL_MEMBERS.map(function (name, i) {
      var colors = ['induction', 'benzo', 'nmb', 'opioid', 'vaso', 'anticholi', 'antiemetic', 'local', 'mint', 'pink', 'sand', 'steel'];
      return { id: 'm' + (i + 1), name: name, color: colors[i % colors.length] };
    }),
    boards: [
      { id: 'os', name: 'OS', group: '본원 턴', sections: turn() },
      { id: 'ent', name: 'ENT', group: '본원 턴', sections: turn() },
      { id: 'ns', name: 'NS', group: '본원 턴', sections: turn() },
      { id: 'ktpl', name: 'KTPL', group: '본원 턴', sections: turn() },
      { id: 'peds', name: '소아', group: '소아 턴', sections: turn() },
      { id: 'brm', name: '보라매', group: '파견 턴', sections: turn() },
      { id: 'tips', name: '꿀팁', group: '공통', sections: [sec_('당직·생활'), sec_('EMR·전산'), sec_('장비·약품'), sec_('기타')] },
      { id: 'study', name: '공부', group: '공통', sections: [sec_('기도'), sec_('약리'), sec_('생리·모니터링'), sec_('소아'), sec_('부위마취'), sec_('기타')] }
    ],
    profSections: [sec_('선호 약물'), sec_('라인·모니터링'), sec_('유도·유지'), sec_('싫어하시는 것'), sec_('기타')]
  };
}

/* ---------- 유틸 ---------- */

function sec_(name) {
  return { id: 's' + Utilities.getUuid().replace(/-/g, '').slice(0, 8), name: name };
}

function need_(role, min) {
  if (LEVEL[role] < LEVEL[min]) throw new Error('이 작업을 할 권한이 없습니다.');
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function roleOf_(pw) {
  if (!pw) return null;
  var props = PropertiesService.getScriptProperties();
  var h = hash_(String(pw));
  var roles = ['admin', 'member', 'viewer'];
  for (var i = 0; i < roles.length; i++) {
    if (props.getProperty('HASH_' + roles[i]) === h) return roles[i];
  }
  return null;
}

function hash_(pw) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function readConfig_() {
  var v = sheet_('config', ['config']).getRange(2, 1).getValue();
  return v ? JSON.parse(v) : defaultConfig_();
}

function validateTarget_(cfg, scope, target) {
  if (scope === 'board') {
    if (!cfg.boards.some(function (b) { return b.id === target; })) throw new Error('없는 보드입니다.');
  } else if (scope === 'prof') {
    var sh = sheet_('professors', PROF_COLS);
    var f = findRow_(sh, PROF_COLS, target);
    if (!f || truthy_(f.obj.deleted)) throw new Error('없는 교수님입니다.');
  } else {
    throw new Error('잘못된 위치입니다.');
  }
}

function cleanText_(t) {
  var s = String(t || '').replace(/\r\n/g, '\n').trim();
  if (!s) throw new Error('내용을 입력하세요.');
  if (s.length > MAX_TEXT) throw new Error('내용이 너무 깁니다(' + MAX_TEXT + '자 이하).');
  return s;
}

function cleanTag_(t) {
  return String(t || '').trim().slice(0, 60);
}

function profOut_(r) {
  return { id: r.id, name: r.name, boards: String(r.boards || '').split(',').filter(String), memo: r.memo, order: r.order };
}

function truthy_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function now_() { return new Date().toISOString(); }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function log_(entryId, action, by, before, after) {
  appendRow_(sheet_('history', HIST_COLS), HIST_COLS,
    { ts: now_(), entryId: entryId, action: action, by: String(by || ''), before: before || '', after: after || '' });
}

/* 시트 입출력: 모든 칸을 일반 텍스트로 다뤄 날짜·수식 자동 변환을 막는다. */

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function enc_(v) {
  var s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

function dec_(v) {
  if (v instanceof Date) return v.toISOString();
  var s = v === undefined || v === null ? '' : String(v);
  return /^'[=+\-@']/.test(s) ? s.slice(1) : s;
}

function readRows_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    cols.forEach(function (c, i) { o[c] = dec_(r[i]); });
    return o;
  });
}

function findRow_(sh, cols, id) {
  var last = sh.getLastRow();
  if (last < 2 || !id) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var rowIndex = i + 2;
      var vals = sh.getRange(rowIndex, 1, 1, cols.length).getValues()[0];
      var o = {};
      cols.forEach(function (c, j) { o[c] = dec_(vals[j]); });
      return { rowIndex: rowIndex, obj: o };
    }
  }
  return null;
}

function appendRow_(sh, cols, obj) {
  var r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) {
    var oldMax = sh.getMaxRows();
    sh.insertRowsAfter(oldMax, 500);
    sh.getRange(oldMax + 1, 1, 500, cols.length).setNumberFormat('@');
  }
  sh.getRange(r, 1, 1, cols.length).setNumberFormat('@')
    .setValues([cols.map(function (c) { return enc_(obj[c]); })]);
}

function writeRow_(sh, cols, rowIndex, obj) {
  sh.getRange(rowIndex, 1, 1, cols.length).setNumberFormat('@')
    .setValues([cols.map(function (c) { return enc_(obj[c]); })]);
}
