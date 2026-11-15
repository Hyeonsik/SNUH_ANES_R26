// 로컬 테스트용: Apps Script 전역 객체를 흉내 내고 실제 Code.gs 를 실행한다.
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), crypto = require('crypto');

class Range {
  constructor(sh, r, c, nr, nc) {
    if (r + nr - 1 > sh.maxRows) throw new Error('Range out of bounds: row ' + (r + nr - 1) + ' > ' + sh.maxRows);
    Object.assign(this, { sh, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('dimension mismatch');
    vals.forEach((row, i) => row.forEach((v, j) => {
      const R = this.r - 1 + i;
      this.sh.data[R] = this.sh.data[R] || [];
      // 실제 시트처럼 선행 apostrophe 는 저장되지 않는다고 가정
      this.sh.data[R][this.c - 1 + j] = typeof v === 'string' && v[0] === "'" ? v.slice(1) : v;
    }));
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(a, n) { this.maxRows += n; }
  setFrozenRows() {}
}
const sheets = {};
const props = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n))
  }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep: () => {}
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);

const PW = { admin: 'admin-1234', member: 'dongi-1234', viewer: 'view-1234' };
ctx.INITIAL_PASSWORDS = PW;
vm.runInContext('INITIAL_PASSWORDS = ' + JSON.stringify(PW) + '; INITIAL_MEMBERS = ["현식","이연","가을","민수","한결","순영","지수","문정"]; setup();', ctx);

function call(body) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s); }

// ---- 샘플 데이터 ----
if (process.argv.includes('--seed')) {
  const cfg = call({ action: 'getAll', pw: PW.admin }).config;
  const sec = (bid, name) => cfg.boards.find(b => b.id === bid).sections.find(s => s.name === name).id;
  const psec = name => cfg.profSections.find(s => s.name === name).id;
  const prof = (name, boards, memo) => call({ action: 'saveProfessor', pw: PW.admin, prof: { name, boards, memo } }).prof.id;
  const p1 = prof('가나다', ['peds'], '소아 심장 주로 하심');
  const p2 = prof('라마바', ['peds', 'ent'], '');
  prof('사아자', ['peds'], '');
  prof('차카타', ['os'], '');
  const add = (by, scope, target, section, text, tag, daysAgo) => {
    const r = call({ action: 'addEntry', pw: PW.member, by, entry: { scope, target, section, text, tag } });
    if (!r.ok) throw new Error(r.error);
    if (daysAgo) {
      const sh = sheets.entries; const t = new Date(Date.now() - daysAgo * 864e5).toISOString();
      const row = sh.data.findIndex(x => x && x[0] === r.entry.id);
      sh.data[row][7] = t; sh.data[row][8] = t; sh.data[row][10] = t;
    }
  };
  add('m1', 'board', 'peds', sec('peds', '턴 개요'), '7시 전까지 소아방 머신 체크 끝내기.\n첫 케이스 환아는 보호자와 함께 holding에서 대기합니다.', '', 20);
  add('m2', 'board', 'peds', sec('peds', '세팅·준비'), '- 체중별 ETT 사이즈 표는 각 방 서랍 첫 칸\n- 24G 넉넉히 미리 꺼내두기\n- 워머 켜두기', '', 9);
  add('m3', 'board', 'peds', sec('peds', '수술별'), 'RAE tube 기본. 끝나고 suction 꼼꼼히 하고 **출혈 확인 후** 발관.', 'Tonsillectomy', 5);
  add('m4', 'board', 'peds', sec('peds', '수술별'), 'dexamethasone 들어갔는지 마지막에 한 번 더 확인.', 'Tonsillectomy', 2);
  add('m7', 'board', 'peds', sec('peds', '수술별'), 'caudal 하는 경우 많음. 체위 변경 전에 미리 준비물 세팅.', 'Orchiopexy', 3);
  add('m7', 'board', 'peds', sec('peds', '주의할 점'), 'inhalation induction 때 보호자 퇴실 타이밍을 미리 설명해두면 수월해요.', '', 1);
  add('m5', 'prof', p1, psec('선호 약물'), '유도 때 sevoflurane 8%로 시작하시는 걸 선호.', '', 6);
  add('m6', 'prof', p1, psec('싫어하시는 것'), '**라인 여러 번 찌르는 것** 싫어하심.\n두 번 실패하면 바로 노티.', '', 4);
  add('m8', 'prof', p1, psec('라인·모니터링'), 'BIS 꼭 붙이심.', '', 400);
  add('m2', 'prof', p2, psec('유도·유지'), 'remifentanil TCI 자주 쓰심. 펌프 미리 세팅해두기.', '', 8);
  add('m1', 'board', 'os', sec('os', '턴 개요'), 'OS는 아침 첫 방 블록이 많아요. 초음파 기계 위치부터 확인.', '', 12);
  add('m4', 'board', 'tips', sec('tips', 'EMR·전산'), '마취기록 템플릿을 즐겨찾기 해두면 편해요.', '', 30);
  add('m1', 'board', 'study', sec('study', '약리'), '**Sugammadex 용량**\n- 2 mg/kg: TOF count 2 이상\n- 4 mg/kg: PTC 1–2\n- 16 mg/kg: rocuronium 1.2 mg/kg 직후 즉시 역전', '', 0);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const WEB = path.join(__dirname, '../docs');
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', c => (b += c));
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(ctx.doPost({ postData: { contents: b } }).s); });
    return;
  }
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("window.HB_CONFIG={API_URL:'/api'};"); }
  if (u === '/') u = '/index.html';
  const f = path.join(WEB, u);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(8787, () => console.log('listening 8787'));

module.exports = { call, PW };
