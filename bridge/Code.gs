// ana-workspace-bridge: Claude Code のスキル ana-gmail / ana-drive が Chrome 経由で呼ぶ Apps Script。
// 送信・削除の関数は作らない。許可した操作だけを action として公開する。
// Gmail は高度なサービス（gmail.readonly + gmail.compose）で使う。
// ウェブアプリとして「実行するユーザー=自分」「アクセス=自分のみ」で公開する。他人に URL を渡さない。

const MAX_BODY = 6000;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'ping';
  let result;
  try {
    if (action === 'ping') {
      result = { user: Session.getActiveUser().getEmail(), now: new Date().toISOString() };
    } else if (action === 'gmailSearch') {
      result = { messages: gmailSearch(p.q, Number(p.max || 10)) };
    } else if (action === 'gmailThread') {
      result = { messages: gmailThread(p.threadId, Number(p.bodyChars || 1500)) };
    } else if (action === 'createDraft') {
      result = createDraft(p);
    } else if (action === 'driveSearch') {
      result = { files: driveSearch(p.name, p.folderId, Number(p.max || 20), p.text) };
    } else if (action === 'sheetText') {
      result = sheetText(p.fileId, Number(p.maxRows || 100));
    } else if (action === 'slidesDump') {
      result = slidesDump(p.fileId, p.pages);
    } else if (action === 'sheetEdit') {
      result = sheetEdit(p.fileId, JSON.parse(p.ops || '[]'));
    } else if (action === 'docEdit') {
      result = docEdit(p.fileId, JSON.parse(p.ops || '[]'));
    } else if (action === 'slidesEdit') {
      result = slidesEdit(p.fileId, JSON.parse(p.ops || '[]'));
    } else {
      throw new Error('unknown action: ' + action);
    }
    result.ok = true;
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// 読み取りのみ：Gmail 検索（新しい順）
function gmailSearch(q, max) {
  if (!q) throw new Error('q is required');
  const list = Gmail.Users.Messages.list('me', { q: q, maxResults: Math.min(max, 25) });
  return (list.messages || []).map(function (m) {
    const msg = Gmail.Users.Messages.get('me', m.id, { format: 'full' });
    const h = headerMap(msg.payload.headers);
    return {
      id: msg.id, threadId: msg.threadId, labels: msg.labelIds,
      date: h['date'], from: h['from'], to: h['to'], cc: h['cc'], subject: h['subject'],
      messageId: h['message-id'],
      body: plainText(msg.payload).slice(0, MAX_BODY),
    };
  });
}

// 読み取りのみ：スレッド内の全メッセージ（古い順。下書きは除く。本文は引用部分を除いて先頭 bodyChars 文字）
function gmailThread(threadId, bodyChars) {
  if (!threadId) throw new Error('threadId is required');
  const thread = Gmail.Users.Threads.get('me', threadId, { format: 'full' });
  return (thread.messages || [])
    .filter(function (msg) { return (msg.labelIds || []).indexOf('DRAFT') < 0; })
    .map(function (msg) {
      const h = headerMap(msg.payload.headers);
      return {
        id: msg.id, labels: msg.labelIds, date: h['date'], from: h['from'], to: h['to'], cc: h['cc'],
        subject: h['subject'], autoSubmitted: h['auto-submitted'] || '',
        body: stripQuoted(plainText(msg.payload)).slice(0, Math.min(bodyChars, MAX_BODY)),
      };
    });
}

// 読み取りのみ：名前に name を含む／本文に text を含むファイル（folderId 指定時はそのフォルダ直下）。更新日の新しい順
function driveSearch(name, folderId, max, text) {
  if (!name && !text) throw new Error('name or text is required');
  const cond = [];
  if (name) cond.push('title contains "' + name.replace(/"/g, '') + '"');
  if (text) cond.push('fullText contains "' + text.replace(/"/g, '') + '"');
  let q = cond.join(' and ') + ' and trashed = false';
  if (folderId) q += ' and "' + folderId.replace(/"/g, '') + '" in parents';
  const it = DriveApp.searchFiles(q);
  const files = [];
  while (it.hasNext() && files.length < 200) {
    const f = it.next();
    files.push({
      id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), url: f.getUrl(),
      updated: Utilities.formatDate(f.getLastUpdated(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
      created: Utilities.formatDate(f.getDateCreated(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    });
  }
  files.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  return files.slice(0, Math.min(max, 50));
}

// 読み取りのみ：任意のスプレッドシートの全タブの表示値（各タブ先頭 maxRows 行、空行は落とす）
function sheetText(fileId, maxRows) {
  if (!fileId) throw new Error('fileId is required');
  const ss = SpreadsheetApp.openById(fileId);
  return {
    spreadsheet: ss.getName(),
    sheets: ss.getSheets().map(function (sh) {
      const rows = Math.min(sh.getLastRow(), maxRows);
      const cols = sh.getLastColumn();
      const values = rows && cols ? sh.getRange(1, 1, rows, cols).getDisplayValues() : [];
      return {
        sheet: sh.getName(), lastRow: sh.getLastRow(),
        values: values.filter(function (r) { return r.some(function (v) { return v !== ''; }); }),
      };
    }),
  };
}

// 読み取りのみ：スライドのテキストと表（pages は "1,2,3" のような 1 始まりの番号。省略時は全ページ）
// Google スライドは SlidesApp、pptx は zip を展開して XML から読む（ファイルは作らない）
function slidesDump(fileId, pages) {
  const want = pages ? pages.split(',').map(Number) : null;
  const file = DriveApp.getFileById(fileId);
  const mime = file.getMimeType();
  const out = { name: file.getName(), mimeType: mime, slides: [] };
  if (mime === MimeType.GOOGLE_SLIDES) {
    SlidesApp.openById(fileId).getSlides().forEach(function (s, i) {
      if (want && want.indexOf(i + 1) < 0) return;
      const texts = [];
      const tables = [];
      s.getPageElements().forEach(function (el) {
        const t = el.getPageElementType();
        if (t === SlidesApp.PageElementType.SHAPE) {
          const txt = el.asShape().getText().asString().trim();
          if (txt) texts.push(txt);
        } else if (t === SlidesApp.PageElementType.TABLE) {
          const tb = el.asTable();
          const rows = [];
          for (let r = 0; r < tb.getNumRows(); r++) {
            const row = [];
            for (let c = 0; c < tb.getNumColumns(); c++) {
              let v = '';
              try { v = tb.getCell(r, c).getText().asString().trim(); } catch (e) { v = '(merged)'; }
              row.push(v);
            }
            rows.push(row);
          }
          tables.push({ objectId: el.getObjectId(), rows: rows });
        }
      });
      out.slides.push({ page: i + 1, objectId: s.getObjectId(), texts: texts, tables: tables });
    });
  } else if (/presentationml|powerpoint/.test(mime)) {
    const blobs = Utilities.unzip(file.getBlob().setContentType('application/zip'));
    const slides = blobs.filter(function (b) { return /^ppt\/slides\/slide\d+\.xml$/.test(b.getName()); })
      .sort(function (a, b) { return slideNo(a.getName()) - slideNo(b.getName()); });
    slides.forEach(function (b) {
      const n = slideNo(b.getName());
      if (want && want.indexOf(n) < 0) return;
      const xml = b.getDataAsString('UTF-8');
      const tables = (xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []).map(function (tbl) {
        return (tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []).map(function (tr) {
          return (tr.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []).map(xmlText);
        });
      });
      const texts = xmlText(xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, ''));
      out.slides.push({ page: n, texts: [texts], tables: tables.map(function (rows) { return { rows: rows }; }) });
    });
  } else {
    throw new Error('unsupported mimeType: ' + mime);
  }
  return out;
}

// ops: [{op:'setValues', sheet, range:'B2:C3', values:[[...]]} | {op:'insertRows', sheet, before, count} | {op:'appendRow', sheet, values:[...]}]
function sheetEdit(fileId, ops) {
  if (!fileId) throw new Error('fileId is required');
  const ss = SpreadsheetApp.openById(fileId);
  const results = ops.map(function (o) {
    const sh = o.sheet ? ss.getSheetByName(o.sheet) : ss.getSheets()[0];
    if (!sh) return { op: o.op, ok: false, error: 'sheet not found: ' + o.sheet };
    try {
      if (o.op === 'setValues') {
        const range = sh.getRange(o.range);
        const before = range.getDisplayValues();
        range.setValues(o.values);
        return { op: o.op, ok: true, sheet: sh.getName(), range: range.getA1Notation(), before: before };
      } else if (o.op === 'insertRows') {
        sh.insertRowsBefore(o.before, o.count || 1);
        return { op: o.op, ok: true, sheet: sh.getName(), before: o.before, count: o.count || 1 };
      } else if (o.op === 'appendRow') {
        sh.appendRow(o.values);
        return { op: o.op, ok: true, sheet: sh.getName(), row: sh.getLastRow() };
      }
      return { op: o.op, ok: false, error: 'unknown op' };
    } catch (e) {
      return { op: o.op, ok: false, error: String(e) };
    }
  });
  SpreadsheetApp.flush();
  return { spreadsheet: ss.getName(), url: ss.getUrl(), results: results };
}

// ops: [{op:'append', text} | {op:'insertAfter', anchor, text} | {op:'replace', find, replace}]
// anchor は段落に含まれる文字列（最初に当たった段落の直後に入れる）。find は正規表現ではなく文字列
function docEdit(fileId, ops) {
  if (!fileId) throw new Error('fileId is required');
  const doc = DocumentApp.openById(fileId);
  const body = doc.getBody();
  const results = ops.map(function (o) {
    try {
      if (o.op === 'append') {
        body.appendParagraph(o.text);
        return { op: o.op, ok: true };
      } else if (o.op === 'insertAfter') {
        const paras = body.getParagraphs();
        const i = paras.findIndex(function (p) { return p.getText().indexOf(o.anchor) >= 0; });
        if (i < 0) return { op: o.op, ok: false, error: 'anchor not found: ' + o.anchor };
        body.insertParagraph(body.getChildIndex(paras[i]) + 1, o.text);
        return { op: o.op, ok: true, after: paras[i].getText().slice(0, 80) };
      } else if (o.op === 'replace') {
        if (!o.find) return { op: o.op, ok: false, error: 'find is required' };
        const count = body.getText().split(o.find).length - 1;
        if (!count) return { op: o.op, ok: false, error: 'not found: ' + o.find };
        body.replaceText(o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.replace || '');
        return { op: o.op, ok: true, count: count };
      }
      return { op: o.op, ok: false, error: 'unknown op' };
    } catch (e) {
      return { op: o.op, ok: false, error: String(e) };
    }
  });
  doc.saveAndClose();
  return { document: doc.getName(), url: doc.getUrl(), results: results };
}

// ops: [{op:'replace', find, replace} | {op:'setText', table, row, col, text} | {op:'insertRow', table, after, values:[...]}]
// table は slidesDump の objectId。row/col は 0 始まり。deckEdit と違い全ページ・任意のファイルが対象
function slidesEdit(fileId, ops) {
  if (!fileId) throw new Error('fileId is required');
  const pres = SlidesApp.openById(fileId);
  const tables = {};
  pres.getSlides().forEach(function (s) {
    s.getTables().forEach(function (t) { tables[t.getObjectId()] = t; });
  });
  const results = ops.map(function (o) {
    try {
      if (o.op === 'replace') {
        if (!o.find) return { op: o.op, ok: false, error: 'find is required' };
        const count = pres.replaceAllText(o.find, o.replace || '', true);
        return count ? { op: o.op, ok: true, count: count } : { op: o.op, ok: false, error: 'not found: ' + o.find };
      }
      const t = tables[o.table];
      if (!t) return { op: o.op, ok: false, error: 'table not found: ' + o.table };
      if (o.op === 'setText') {
        const text = t.getCell(o.row, o.col).getText();
        const before = text.asString().replace(/\n$/, '');
        text.setText(o.text);
        return { op: o.op, ok: true, before: before };
      } else if (o.op === 'insertRow') {
        const row = t.insertRow(o.after + 1);
        (o.values || []).forEach(function (v, c) {
          if (v !== null && c < row.getNumCells()) row.getCell(c).getText().setText(v);
        });
        return { op: o.op, ok: true };
      }
      return { op: o.op, ok: false, error: 'unknown op' };
    } catch (e) {
      return { op: o.op, ok: false, error: String(e) };
    }
  });
  pres.saveAndClose();
  return { presentation: pres.getName(), url: 'https://docs.google.com/presentation/d/' + fileId + '/edit', results: results };
}

// 下書き作成のみ（送信しない）。同じ件名の下書き・送信済みがあれば作らない。
// threadId を渡すとそのスレッドへの返信下書きになる。
// recipientsFrom（送信済みメールの id）を渡すと、その To/Cc をそのまま使う。
function createDraft(p) {
  if (p.replyAllTo) return createReplyAllDraft(p);
  if (p.recipientsFrom) {
    const src = Gmail.Users.Messages.get('me', p.recipientsFrom, { format: 'metadata', metadataHeaders: ['To', 'Cc'] });
    if ((src.labelIds || []).indexOf('SENT') < 0) throw new Error('recipientsFrom must be a sent message');
    const h = headerMap(src.payload.headers);
    p.to = h['to'];
    p.cc = h['cc'] || '';
  }
  if (!p.to || !p.subject || !p.body) throw new Error('to, subject, body are required');
  const dupQ = 'subject:"' + p.subject.replace(/"/g, '') + '"';
  const drafts = Gmail.Users.Drafts.list('me', { q: dupQ, maxResults: 5 }).drafts || [];
  const sent = Gmail.Users.Messages.list('me', { q: 'in:sent ' + dupQ, maxResults: 5 }).messages || [];
  // replaceExisting=1: 同じ件名の下書きがちょうど1件あり未送信なら、その下書きを上書きする（削除はしない）
  const replaceId = p.replaceExisting === '1' && drafts.length === 1 && !sent.length ? drafts[0].id : null;
  if (!replaceId && p.allowExistingThread !== '1' && (drafts.length || sent.length)) {
    return { created: false, reason: 'duplicate', drafts: drafts.length, sent: sent.length };
  }
  const boundary = 'ana-' + Utilities.getUuid();
  const headers = [
    'To: ' + encodeAddressList(p.to),
    p.cc ? 'Cc: ' + encodeAddressList(p.cc) : null,
    'Subject: =?UTF-8?B?' + Utilities.base64Encode(p.subject, Utilities.Charset.UTF_8) + '?=',
    p.inReplyTo ? 'In-Reply-To: ' + p.inReplyTo : null,
    p.inReplyTo ? 'References: ' + (p.references || p.inReplyTo) : null,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
  ].filter(Boolean);
  const raw = headers.join('\r\n') + '\r\n\r\n' +
    mimePart(boundary, 'text/plain', toPlain(p.body)) +
    mimePart(boundary, 'text/html', toHtml(p.body)) +
    '--' + boundary + '--\r\n';
  const message = { raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8) };
  if (p.threadId) message.threadId = p.threadId;
  const draft = replaceId
    ? Gmail.Users.Drafts.update({ id: replaceId, message: message }, 'me', replaceId)
    : Gmail.Users.Drafts.create({ message: message }, 'me');
  return {
    created: !replaceId, replaced: !!replaceId,
    draftId: draft.id, messageId: draft.message.id, threadId: draft.message.threadId,
    url: 'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.message.id,
  };
}

// replyAllTo（メッセージ id）への全員返信の下書き。同じスレッドに下書きがあれば作らない。
// 宛先：相手のメッセージなら Reply-To（無ければ From）を To、To/Cc の残りを Cc。自分の送信なら To/Cc をそのまま。
function createReplyAllDraft(p) {
  if (!p.body) throw new Error('body is required');
  const src = Gmail.Users.Messages.get('me', p.replyAllTo, {
    format: 'metadata', metadataHeaders: ['From', 'Reply-To', 'To', 'Cc', 'Subject', 'Message-ID', 'References'],
  });
  const existing = (Gmail.Users.Drafts.list('me', { maxResults: 100 }).drafts || [])
    .filter(function (d) { return d.message && d.message.threadId === src.threadId; });
  if (existing.length) return { created: false, reason: 'draft_exists_in_thread', drafts: existing.length };

  const h = headerMap(src.payload.headers);
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const fromMe = (src.labelIds || []).indexOf('SENT') >= 0;
  const to = fromMe ? splitAddresses(h['to']) : splitAddresses(h['reply-to'] || h['from']);
  const seen = {};
  seen[me] = true;
  const uniq = function (list) {
    return list.filter(function (a) {
      const key = addressOf(a);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  };
  const toList = uniq(to);
  const ccList = uniq(splitAddresses(h['cc']).concat(fromMe ? [] : splitAddresses(h['to'])));
  const subject = /^re:/i.test(h['subject']) ? h['subject'] : 'Re: ' + h['subject'];
  return createDraft({
    to: toList.join(', '), cc: ccList.join(', '), subject: subject, body: p.body,
    threadId: src.threadId, inReplyTo: h['message-id'],
    references: ((h['references'] || '') + ' ' + h['message-id']).trim(),
    allowExistingThread: '1',
  });
}

function splitAddresses(list) {
  return ((list || '').match(/(?:"[^"]*"|[^,"])+/g) || [])
    .map(function (s) { return s.trim(); }).filter(Boolean);
}

function addressOf(entry) {
  const m = /<([^>]+)>/.exec(entry);
  return (m ? m[1] : entry).trim().toLowerCase();
}

// 宛先ヘッダーの表示名に日本語があれば RFC 2047 でエンコードする（"石井 あいり" <a@b> → =?UTF-8?B?..?= <a@b>）
function encodeAddressList(list) {
  const entries = list.match(/(?:"[^"]*"|[^,"])+/g) || [];
  return entries.map(function (entry) {
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(entry);
    if (!m) return entry.trim();
    const name = m[1].replace(/^"|"$/g, '');
    if (!name) return '<' + m[2] + '>';
    if (/^[\x20-\x7e]*$/.test(name)) return '"' + name.replace(/"/g, '') + '" <' + m[2] + '>';
    return '=?UTF-8?B?' + Utilities.base64Encode(name, Utilities.Charset.UTF_8) + '?= <' + m[2] + '>';
  }).join(',\r\n '); // 1行 998 文字の上限を超えないよう宛先ごとに折り返す
}

// 本文中の [文字](https://...) をリンクとして扱う。テキスト版は「文字<URL>」
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

function toPlain(body) {
  return body.replace(LINK_RE, '$1<$2>');
}

function toHtml(body) {
  const esc = function (s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  let html = '';
  let last = 0;
  body.replace(LINK_RE, function (m, text, url, offset) {
    html += esc(body.slice(last, offset)) + '<a href="' + esc(url) + '">' + esc(text) + '</a>';
    last = offset + m.length;
    return m;
  });
  html += esc(body.slice(last));
  return '<div dir="ltr">' + html.replace(/\r?\n/g, '<br>') + '</div>';
}

function mimePart(boundary, type, text) {
  const b64 = Utilities.base64Encode(text.replace(/\r?\n/g, '\r\n'), Utilities.Charset.UTF_8);
  return '--' + boundary + '\r\n' +
    'Content-Type: ' + type + '; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    b64.replace(/.{76}/g, '$&\r\n') + '\r\n';
}

function headerMap(headers) {
  const out = {};
  (headers || []).forEach(function (h) { out[h.name.toLowerCase()] = h.value; });
  return out;
}

// 本文テキスト。text/plain を優先し、無ければ text/html のタグを除いたもの
function plainText(part) {
  return findBody(part, 'text/plain') ||
    findBody(part, 'text/html').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

function findBody(part, mimeType) {
  if (part.mimeType === mimeType && part.body && part.body.data) return decodeData(part.body.data);
  const parts = part.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const t = findBody(parts[i], mimeType);
    if (t) return t;
  }
  return '';
}

// 高度なサービスは body.data をバイト配列で返す（文字列の場合は base64url）
function decodeData(data) {
  const bytes = Array.isArray(data) ? data : Utilities.base64DecodeWebSafe(data);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function slideNo(name) {
  return Number(/slide(\d+)\.xml$/.exec(name)[1]);
}

// DrawingML の段落ごとに <a:t> を連結
function xmlText(xml) {
  return (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(function (p) {
    return (p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(function (t) {
      return t.replace(/<\/?a:t>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }).join('');
  }).filter(Boolean).join('\n');
}

// 返信の引用部分（"On ... wrote:" / "From: ..." / "> " 行 以降）を落とす
function stripQuoted(text) {
  const cut = text.search(/\n(On .+wrote:|From: .+\n|-----Original Message-----|\d{4}年\d{1,2}月\d{1,2}日.+:)/);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  return head.split('\n').filter(function (l) { return !/^\s*>/.test(l); }).join('\n').trim();
}

// エディタから手動実行：マニフェストの全スコープが付与されているか確認し、足りなければ承認を求める
function authorizeAll() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  Logger.log('all scopes granted');
}
