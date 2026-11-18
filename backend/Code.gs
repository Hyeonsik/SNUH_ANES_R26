/** @OnlyCurrentDoc */
/**
 * 인계보드 백엔드 (Google Apps Script)
 *
 * 처음 한 번만:
 *   1) 아래 INITIAL_PASSWORDS 세 개를 원하는 비밀번호로 바꾸고, INITIAL_MEMBERS 에 동기 이름을 적는다.
 *      (이 코드는 반드시 구글 시트 안에서 확장 프로그램 → Apps Script 로 연 프로젝트에 붙여넣는다.
 *       script.google.com 에서 새로 만든 독립 프로젝트에서는 동작하지 않는다.)
 *   2) 상단 함수 선택에서 setup 을 고르고 ▶ 실행 (권한 승인).
 *      권한 승인 화면에는 "이 스프레드시트"와 "이 앱이 만든 드라이브 파일"만 보인다(appsscript.json 참고).
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

// 배포된 서버 코드가 어떤 버전인지 확인용. 코드를 바꿀 때마다 올린다.
var BACKEND_VERSION = '2026-11-18.1';

var ENTRY_COLS = ['id', 'scope', 'target', 'section', 'tag', 'text', 'authorId',
  'createdAt', 'updatedAt', 'updatedBy', 'confirmedAt', 'confirmedBy', 'deleted',
  'title', 'tags', 'source', 'images', 'ocr', 'ownerKey'];
var COMMENT_COLS = ['id', 'entryId', 'text', 'authorId', 'createdAt', 'deleted', 'ownerKey'];
var MAX_IMAGE = 8 * 1024 * 1024;
var PROF_COLS = ['id', 'name', 'boards', 'memo', 'order', 'deleted'];
var HIST_COLS = ['ts', 'entryId', 'action', 'by', 'before', 'after'];
var DOC_COLS = ['id', 'board', 'slot', 'title', 'kind', 'fileId', 'url', 'name', 'mime', 'size', 'note', 'by', 'at', 'deleted'];
var MAX_FILE = 25 * 1024 * 1024;
var FOLDER_NAME = '인계보드 파일';
var LEVEL = { viewer: 1, member: 2, admin: 3 };
var MAX_TEXT = 5000;

/* ---------- 진입점 ---------- */

function doGet() {
  return out_({ ok: true, msg: 'handover board api', version: BACKEND_VERSION });
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
    res.version = BACKEND_VERSION;
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function route_(req, role) {
  switch (req.action) {
    case 'login': return {};
    case 'getAll': return getAll_(req);
    case 'addEntry': need_(role, 'member'); return locked_(function () { return addEntry_(req); });
    case 'updateEntry': need_(role, 'member'); return locked_(function () { return updateEntry_(req, role); });
    case 'deleteEntry': need_(role, 'member'); return locked_(function () { return deleteEntry_(req, role); });
    case 'history': return history_(req);
    case 'comments': return comments_(req);
    case 'addComment': need_(role, 'member'); return locked_(function () { return addComment_(req, role); });
    case 'deleteComment': need_(role, 'member'); return locked_(function () { return deleteComment_(req, role); });
    case 'uploadImage': need_(role, 'member'); return uploadImage_(req);
    case 'imageData': return imageData_(req);
    case 'saveConfig': need_(role, 'admin'); return locked_(function () { return saveConfig_(req); });
    case 'saveProfessor': need_(role, 'admin'); return locked_(function () { return saveProfessor_(req); });
    case 'deleteProfessor': need_(role, 'admin'); return locked_(function () { return deleteProfessor_(req); });
    case 'setPassword': need_(role, 'admin'); return setPassword_(req);
    case 'uploadDoc': need_(role, 'member'); return uploadDoc_(req);
    case 'addDocLink': need_(role, 'member'); return locked_(function () { return addDocLink_(req); });
    case 'deleteDoc': need_(role, 'member'); return locked_(function () { return deleteDoc_(req); });
    case 'docData': return docData_(req);
    default: throw new Error('알 수 없는 요청입니다: ' + req.action);
  }
}

/* ---------- 조회 ---------- */

function getAll_(req) {
  var key = ownerKey_(req.ck);
  var counts = {};
  readRows_(sheet_('comments', COMMENT_COLS), COMMENT_COLS).forEach(function (c) {
    if (!truthy_(c.deleted)) counts[c.entryId] = (counts[c.entryId] || 0) + 1;
  });
  var entries = readRows_(sheet_('entries', ENTRY_COLS), ENTRY_COLS)
    .filter(function (r) { return !truthy_(r.deleted); })
    .map(function (r) { return entryOut_(r, key, counts); });
  var profs = readRows_(sheet_('professors', PROF_COLS), PROF_COLS)
    .filter(function (r) { return !truthy_(r.deleted); })
    .map(profOut_);
  var docs = readRows_(sheet_('docs', DOC_COLS), DOC_COLS)
    .filter(function (r) { return !truthy_(r.deleted); })
    .map(function (r) { delete r.deleted; delete r.fileId; return r; });
  return { config: readConfig_(), profs: profs, entries: entries, docs: docs, serverTime: now_() };
}

function entryOut_(r, key, counts) {
  var o = {};
  for (var k in r) o[k] = r[k];
  o.mine = !!(key && o.ownerKey && o.ownerKey === key);
  delete o.ownerKey; delete o.deleted;
  try { o.images = o.images ? JSON.parse(o.images) : []; } catch (e) { o.images = []; }
  o.comments = counts ? (counts[o.id] || 0) : 0;
  return o;
}

/** 수정·삭제 권한: 관리자, 같은 기기에서 쓴 사람, 또는 같은 이름(익명 제외)으로 고른 사람 */
function canModify_(row, req, role) {
  if (role === 'admin') return true;
  var key = ownerKey_(req.ck);
  if (key && row.ownerKey && row.ownerKey === key) return true;
  return !!(row.authorId && row.authorId !== 'anon' && row.authorId === String(req.by || ''));
}

function ownerKey_(ck) {
  return ck ? hash_('owner|' + String(ck)).slice(0, 24) : '';
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
  var images = cleanImages_(e.images);
  var text = cleanText_(e.text, images.length);
  var t = now_();
  var row = {
    id: newId_(),
    scope: e.scope, target: String(e.target),
    section: String(e.section || ''), tag: cleanTag_(e.tag), text: text,
    authorId: String(req.by || ''), createdAt: t, updatedAt: t, updatedBy: String(req.by || ''),
    confirmedAt: t, confirmedBy: String(req.by || ''), deleted: '',
    title: cleanTitle_(e.title), tags: cleanTags_(e.tags), source: String(e.source || '').slice(0, 40),
    images: JSON.stringify(images), ocr: ocrOf_(images), ownerKey: ownerKey_(req.ck)
  };
  appendRow_(sheet_('entries', ENTRY_COLS), ENTRY_COLS, row);
  log_(row.id, 'add', req.by, '', text);
  return { entry: entryOut_(row, row.ownerKey, null) };
}

function updateEntry_(req, role) {
  var sh = sheet_('entries', ENTRY_COLS);
  var found = findRow_(sh, ENTRY_COLS, req.id);
  if (!found || truthy_(found.obj.deleted)) throw new Error('이미 삭제되었거나 없는 글입니다.');
  var o = found.obj;
  if (!canModify_(o, req, role)) throw new Error('쓴 사람만 수정할 수 있습니다.');
  var before = o.text;
  var images = req.images !== undefined ? cleanImages_(req.images) : parseImages_(o.images);
  if (req.text !== undefined) o.text = cleanText_(req.text, images.length);
  if (req.section !== undefined) o.section = String(req.section || '');
  if (req.tag !== undefined) o.tag = cleanTag_(req.tag);
  if (req.title !== undefined) o.title = cleanTitle_(req.title);
  if (req.tags !== undefined) o.tags = cleanTags_(req.tags);
  if (req.source !== undefined) o.source = String(req.source || '').slice(0, 40);
  if (req.images !== undefined) { o.images = JSON.stringify(images); o.ocr = ocrOf_(images); }
  o.updatedAt = now_();
  o.updatedBy = String(req.by || '');
  writeRow_(sh, ENTRY_COLS, found.rowIndex, o);
  log_(o.id, 'edit', req.by, before, o.text);
  return { entry: entryOut_(o, ownerKey_(req.ck), countComments_(o.id)) };
}

function deleteEntry_(req, role) {
  var sh = sheet_('entries', ENTRY_COLS);
  var found = findRow_(sh, ENTRY_COLS, req.id);
  if (!found) throw new Error('없는 글입니다.');
  if (!canModify_(found.obj, req, role)) throw new Error('쓴 사람만 삭제할 수 있습니다.');
  found.obj.deleted = 'TRUE';
  found.obj.updatedAt = now_();
  found.obj.updatedBy = String(req.by || '');
  writeRow_(sh, ENTRY_COLS, found.rowIndex, found.obj);
  log_(found.obj.id, 'delete', req.by, found.obj.text, '');
  return { id: req.id };
}

/* ---------- 댓글 ---------- */

function comments_(req) {
  var key = ownerKey_(req.ck);
  var list = readRows_(sheet_('comments', COMMENT_COLS), COMMENT_COLS)
    .filter(function (c) { return c.entryId === req.id && !truthy_(c.deleted); })
    .map(function (c) {
      var mine = !!(key && c.ownerKey === key);
      return { id: c.id, entryId: c.entryId, text: c.text, authorId: c.authorId, createdAt: c.createdAt, mine: mine };
    });
  return { comments: list };
}

function addComment_(req, role) {
  var found = findRow_(sheet_('entries', ENTRY_COLS), ENTRY_COLS, req.id);
  if (!found || truthy_(found.obj.deleted)) throw new Error('없는 글입니다.');
  var text = String(req.text || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('댓글을 입력하세요.');
  if (text.length > 2000) throw new Error('댓글은 2000자 이하로 써주세요.');
  var row = { id: newId_(), entryId: req.id, text: text, authorId: String(req.by || ''), createdAt: now_(), deleted: '', ownerKey: ownerKey_(req.ck) };
  appendRow_(sheet_('comments', COMMENT_COLS), COMMENT_COLS, row);
  return { comment: { id: row.id, entryId: row.entryId, text: row.text, authorId: row.authorId, createdAt: row.createdAt, mine: true } };
}

function deleteComment_(req, role) {
  var sh = sheet_('comments', COMMENT_COLS);
  var found = findRow_(sh, COMMENT_COLS, req.id);
  if (!found || truthy_(found.obj.deleted)) throw new Error('없는 댓글입니다.');
  if (!canModify_(found.obj, req, role)) throw new Error('쓴 사람만 삭제할 수 있습니다.');
  found.obj.deleted = 'TRUE';
  writeRow_(sh, COMMENT_COLS, found.rowIndex, found.obj);
  return { id: req.id };
}

function countComments_(entryId) {
  var n = 0;
  readRows_(sheet_('comments', COMMENT_COLS), COMMENT_COLS).forEach(function (c) {
    if (c.entryId === entryId && !truthy_(c.deleted)) n++;
  });
  var o = {}; o[entryId] = n;
  return o;
}

/* ---------- 사진 ---------- */

function uploadImage_(req) {
  var d = req.image || {};
  if (!d.data) throw new Error('사진이 비어 있습니다.');
  var bytes = Utilities.base64Decode(String(d.data));
  if (bytes.length > MAX_IMAGE) throw new Error('사진은 8MB 이하만 올릴 수 있습니다.');
  var mime = /^image\//.test(String(d.mime)) ? String(d.mime) : 'image/jpeg';
  var name = String(d.name || 'image.jpg').slice(0, 120);
  var blob = Utilities.newBlob(bytes, mime, name);
  var file = Drive.Files.create({ name: name, parents: [folder_()], mimeType: mime }, blob, { fields: 'id' });
  try { Drive.Permissions.create({ type: 'anyone', role: 'reader' }, file.id); } catch (e) { /* 공유 제한 시 서버 경유로 보여줌 */ }
  var ocr = '';
  if (d.ocr) ocr = ocrImage_(blob, name);
  return { image: { id: file.id, w: +d.w || 0, h: +d.h || 0, ocr: ocr } };
}

/** 구글 드라이브의 문서 변환 OCR. 실패하면 빈 문자열(업로드는 그대로 진행). */
function ocrImage_(blob, name) {
  var docId = null;
  try {
    var doc = Drive.Files.create({ name: 'ocr-' + name, mimeType: 'application/vnd.google-apps.document', parents: [folder_()] },
      blob, { ocrLanguage: 'ko', fields: 'id' });
    docId = doc.id;
    var text = '';
    try {
      var r = Drive.Files.export(docId, 'text/plain');
      text = typeof r === 'string' ? r : (r && r.getDataAsString ? r.getDataAsString('UTF-8') : '');
    } catch (e1) {
      var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/plain',
        { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (res.getResponseCode() === 200) text = res.getContentText('UTF-8');
    }
    return String(text || '').replace(/^\uFEFF/, '').replace(/\s+\n/g, '\n').trim().slice(0, 6000);
  } catch (e) {
    return '';
  } finally {
    if (docId) { try { Drive.Files.remove(docId); } catch (e2) { try { Drive.Files.update({ trashed: true }, docId); } catch (e3) { /* 무시 */ } } }
  }
}

function imageData_(req) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(req.id || ''))) throw new Error('잘못된 사진입니다.');
  var b = Drive.Files.get(req.id, { alt: 'media' });
  if (b && b.getBytes) b = b.getBytes();
  return { data: Utilities.base64Encode(b) };
}

function cleanImages_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).filter(function (i) { return i && /^[A-Za-z0-9_-]{10,}$/.test(String(i.id || '')); }).map(function (i) {
    return { id: String(i.id), w: +i.w || 0, h: +i.h || 0, ocr: String(i.ocr || '').slice(0, 6000), cap: String(i.cap || '').slice(0, 120) };
  });
}
function parseImages_(s) { try { return s ? JSON.parse(s) : []; } catch (e) { return []; } }
function ocrOf_(images) {
  return images.map(function (i) { return i.ocr; }).filter(String).join('\n').slice(0, 20000);
}
function cleanTitle_(t) { return String(t || '').trim().slice(0, 120); }
function cleanTags_(t) {
  var arr = Array.isArray(t) ? t : String(t || '').split(',');
  var seen = {};
  return arr.map(function (x) { return String(x).trim().replace(/^#/, '').slice(0, 30); })
    .filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }).slice(0, 15).join(',');
}

/* ---------- 인계장 파일 ---------- */

function uploadDoc_(req) {
  var d = req.doc || {};
  checkBoard_(d.board);
  if (!d.data) throw new Error('파일이 비어 있습니다.');
  var bytes = Utilities.base64Decode(String(d.data));
  if (bytes.length > MAX_FILE) throw new Error('파일은 25MB 이하만 올릴 수 있습니다.');
  var name = String(d.name || 'file').slice(0, 200);
  var blob = Utilities.newBlob(bytes, String(d.mime || 'application/octet-stream'), name);
  // 고급 서비스 Drive(v3)를 쓴다. drive.file 권한으로 이 앱이 만든 파일만 다룰 수 있다.
  var file = Drive.Files.create({ name: name, parents: [folder_()], mimeType: blob.getContentType() }, blob, { fields: 'id' });
  var url = '';
  try {
    Drive.Permissions.create({ type: 'anyone', role: 'reader' }, file.id);
    url = 'https://drive.google.com/file/d/' + file.id + '/view';
  } catch (e) { url = ''; }
  return locked_(function () {
    var row = docRow_(d, req.by, { kind: 'file', fileId: file.id, url: url, name: name, mime: blob.getContentType(), size: String(bytes.length) });
    appendRow_(sheet_('docs', DOC_COLS), DOC_COLS, row);
    delete row.deleted; delete row.fileId;
    return { doc: row };
  });
}

function addDocLink_(req) {
  var d = req.doc || {};
  checkBoard_(d.board);
  var url = String(d.url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error('http 로 시작하는 주소를 입력하세요.');
  var row = docRow_(d, req.by, { kind: 'link', fileId: '', url: url, name: '', mime: '', size: '' });
  appendRow_(sheet_('docs', DOC_COLS), DOC_COLS, row);
  delete row.deleted; delete row.fileId;
  return { doc: row };
}

function docRow_(d, by, extra) {
  var title = String(d.title || extra.name || '인계장').trim().slice(0, 100);
  var row = {
    id: newId_(), board: String(d.board), slot: String(d.slot || newId_()), title: title,
    note: String(d.note || '').slice(0, 200), by: String(by || ''), at: now_(), deleted: ''
  };
  for (var k in extra) row[k] = extra[k];
  return row;
}

function deleteDoc_(req) {
  var sh = sheet_('docs', DOC_COLS);
  var found = findRow_(sh, DOC_COLS, req.id);
  if (!found) throw new Error('없는 파일입니다.');
  found.obj.deleted = 'TRUE';
  writeRow_(sh, DOC_COLS, found.rowIndex, found.obj);
  if (found.obj.fileId) {
    try { Drive.Files.update({ trashed: true }, found.obj.fileId); } catch (e) { /* 이미 없음 */ }
  }
  return { id: req.id };
}

function docData_(req) {
  var found = findRow_(sheet_('docs', DOC_COLS), DOC_COLS, req.id);
  if (!found || truthy_(found.obj.deleted) || !found.obj.fileId) throw new Error('파일을 찾을 수 없습니다.');
  var bytes = Drive.Files.get(found.obj.fileId, { alt: 'media' });
  if (bytes && bytes.getBytes) bytes = bytes.getBytes();
  return { name: found.obj.name, mime: found.obj.mime, data: Utilities.base64Encode(bytes) };
}

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      var cur = Drive.Files.get(id, { fields: 'id,trashed' });
      if (!cur.trashed) return id;
    } catch (e) { /* 폴더가 지워졌으면 새로 만든다 */ }
  }
  var f = Drive.Files.create({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' });
  props.setProperty('FOLDER_ID', f.id);
  return f.id;
}

function checkBoard_(id) {
  if (!readConfig_().boards.some(function (b) { return b.id === id; })) throw new Error('없는 보드입니다.');
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

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
  c.studyTags = cleanTags_(c.studyTags || []).split(',').filter(String);
  c.studySources = (Array.isArray(c.studySources) ? c.studySources : STUDY_SOURCES).map(String).filter(String).slice(0, 12);
  c.links = (Array.isArray(c.links) ? c.links : []).filter(function (l) {
    return l && l.title && /^https?:\/\//.test(String(l.url || ''));
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
  sheet_('docs', DOC_COLS);
  sheet_('comments', COMMENT_COLS);
  var es = sheet_('entries', ENTRY_COLS);
  es.getRange(1, 1, 1, ENTRY_COLS.length).setValues([ENTRY_COLS]);
  folder_();
  migrateStudy_();
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

/** 공부 보드: 카테고리(섹션)와 키워드 기본값. 이미 바꿔 쓴 경우에는 건드리지 않는다. */
function migrateStudy_() {
  var cs = sheet_('config', ['config']);
  var v = cs.getRange(2, 1).getValue();
  if (!v) return;
  var c = JSON.parse(v), changed = false;
  var b = c.boards.filter(function (x) { return x.id === 'study'; })[0];
  if (b) {
    if (b.type !== 'study') { b.type = 'study'; changed = true; }
    var old = ['기도', '약리', '생리·모니터링', '소아', '부위마취', '기타'];
    var names = b.sections.map(function (x) { return x.name; });
    if (names.join('|') === old.join('|')) {
      var keep = {};
      b.sections.forEach(function (x) { keep[x.name] = x.id; });
      b.sections = STUDY_CATEGORIES.map(function (n) { return keep[n] ? { id: keep[n], name: n } : sec_(n); });
      changed = true;
    }
  }
  if (!Array.isArray(c.studyTags) || !c.studyTags.length) { c.studyTags = STUDY_TAGS.slice(); changed = true; }
  if (!Array.isArray(c.studySources) || !c.studySources.length) { c.studySources = STUDY_SOURCES.slice(); changed = true; }
  if (changed) cs.getRange(2, 1).setValue(JSON.stringify(c));
}

var STUDY_CATEGORIES = ['마취 전 평가', '기도', '약리', '모니터링·술기', '수액·수혈·전해질', '호흡·환기', '심혈관', '부위마취·통증', '소아·산과', '분야별 마취', '합병증·응급', '장비·세팅', '기타'];
var STUDY_TAGS = ['propofol', 'remifentanil', 'rocuronium', 'sugammadex', 'sevoflurane', 'TIVA', 'vasopressor', 'LMA', 'intubation', 'C-line', 'A-line', 'PONV', 'TCI', 'ECG', 'PFT', 'steroid', 'albumin', '수혈', '소아', '산과'];
var STUDY_SOURCES = ['교수님 설명', '내 공부', '교과서', '강의·학회', '논문'];

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
      { id: 'study', name: '공부', group: '공통', type: 'study', sections: STUDY_CATEGORIES.map(sec_) }
    ],
    profSections: [sec_('스타일'), sec_('세팅·준비'), sec_('선호 약물'), sec_('라인·모니터링'), sec_('유도·유지'), sec_('싫어하시는 것'), sec_('기타')],
    links: [],
    studyTags: STUDY_TAGS.slice(),
    studySources: STUDY_SOURCES.slice()
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
  var c = v ? JSON.parse(v) : defaultConfig_();
  if (!Array.isArray(c.links)) c.links = [];
  if (!Array.isArray(c.studyTags)) c.studyTags = STUDY_TAGS.slice();
  if (!Array.isArray(c.studySources)) c.studySources = STUDY_SOURCES.slice();
  return c;
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

function cleanText_(t, allowEmpty) {
  var s = String(t || '').replace(/\r\n/g, '\n').trim();
  if (!s && !allowEmpty) throw new Error('내용을 입력하세요.');
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
  if (!ss) throw new Error('이 스크립트가 스프레드시트에 연결되어 있지 않습니다. 구글 시트에서 확장 프로그램 → Apps Script 로 만든 프로젝트에 붙여넣어야 합니다.');
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
