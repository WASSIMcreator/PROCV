/**
 * PRO CV – saves every order form sent from the site.
 *
 * - One row per client in the "Commandes" sheet (all answers + the full WhatsApp text).
 * - Photos and documents come by WhatsApp; the script refuses files.
 * - You get one email per new client within about a minute (sent by flushPending, not by the
 *   request itself, so many clients ordering together are all saved).
 *
 * - Meta Conversions API: a qualified Lead is sent server-side when the form arrives, and a
 *   Purchase when you tick "Payé" in the sheet (CAPI section at the end of this file).
 *
 * Setup: see google-apps-script/README.md
 */

var ROOT_FOLDER = 'PRO CV – Clients';
var SHEET_NAME = 'Commandes';
var MAX_FILE_MB = 15;
var MAX_FILES_PER_ORDER = 15;
var HEAD = ['Date', 'ID', 'Nom', 'Téléphone', 'Email', 'Poste', 'Type', 'Allemand', 'Ville', 'Fichiers reçus', 'Dossier Drive', 'Message complet'];

// Anti-spam: anyone who finds the /exec link can post to it, so new orders are capped.
// The per-phone cap stops one spammer. The hourly cap is only a safety net against a robot
// flood: it must stay far above real traffic, or real clients are refused when ads run well
// (it was 20, and spam plus a busy hour filled it, so real orders after that were lost).
var MAX_BODY_CHARS = 100000;   // a real form is a few KB
var MAX_NEW_PER_HOUR = 300;    // new orders per hour, all clients together
var MAX_NEW_PER_PHONE = 3;     // new orders per phone number in 6 hours

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY_CHARS) return out({ ok: false, error: 'too big' });
    var p = JSON.parse(raw);
    // photos and documents now come by WhatsApp: the script no longer takes files
    if (p.type !== 'form') return out({ ok: false, error: 'not accepted' });
    var o = p.data || {};
    // hidden field that people never see: only robots fill it. Answer ok so they do not retry.
    if (o.pc_check) return out({ ok: true });
    var digits = String(o.tel || '').replace(/\D/g, '');
    if (!String(o.nom || '').trim() || digits.length < 8 || digits.length > 15) return out({ ok: false, error: 'missing name or phone' });
    var id = String(p.id || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!id) return out({ ok: false, error: 'no id' });
    // Saving a row takes about a second, so many clients at once just wait their turn.
    // The email is not sent here (see saveForm), which keeps each turn short.
    lock.waitLock(30000);
    var limit = spamLimit(id, digits);
    if (limit) return out({ ok: false, error: limit });
    var row = saveForm(id, p);
    // The Meta call can take a second: release the lock first so other clients are not kept waiting.
    lock.releaseLock();
    capiLead_(row, id, p); // never throws: a Meta error must not cost us the order
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Counts only new orders (an id already in the sheet is the same client sending again).
// Returns an error text when a cap is reached, else ''.
function spamLimit(id, digits) {
  if (findRow(sheet(), id)) return '';
  var cache = CacheService.getScriptCache();
  var hourKey = 'H_' + Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyyMMddHH'), phoneKey = 'T_' + digits.slice(-9);
  var nHour = +(cache.get(hourKey) || 0), nPhone = +(cache.get(phoneKey) || 0);
  if (nHour >= MAX_NEW_PER_HOUR) return 'too many orders this hour';
  if (nPhone >= MAX_NEW_PER_PHONE) return 'too many orders for this phone';
  cache.put(hourKey, String(nHour + 1), 3600);
  cache.put(phoneKey, String(nPhone + 1), 21600);
  return '';
}

// Opening the /exec link in a browser just says it works.
function doGet() { return out({ ok: true, service: 'PRO CV form' }); }

// Text typed by the client: a leading = + - @ would make Sheets read it as a formula.
function safe(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }

function saveForm(id, p) {
  var o = p.data || {};
  var sh = sheet(), r = findRow(sh, id);
  var props = PropertiesService.getScriptProperties();
  var want = Math.min(+p.nfiles || 0, MAX_FILES_PER_ORDER);
  // photos are sent on WhatsApp now: a Drive folder only when files are announced or already there
  var folder = (want > 0 || props.getProperty('F_' + id)) ? orderFolder(id, o) : null;
  var row = [new Date(), id, safe(o.nom), "'" + (o.tel || ''), safe(o.email), safe(o.metier), safe(o.but), safe(o.allemand), safe(o.ville),
             folder ? countFiles(folder) : 0, folder ? folder.getUrl() : '', safe(String(p.message || '').slice(0, 45000))];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  var saved = r || sh.getLastRow();
  try { saveMeta_(sh, saved, p); } catch (e) { console.warn('meta columns: ' + e); }

  // One email (+ WhatsApp alert) per new client. It is sent by flushPending, which runs every
  // minute, not here: sending mail inside the request held the lock for seconds per order, so
  // when many clients ordered together the others timed out and their rows were never saved.
  if (!r) {
    props.setProperty('N_' + id, String(want));
    props.setProperty('P_' + id, String(Date.now())); // pending until the email is really sent
    ensureTrigger();
  }
  return saved;
}

// Sends the email (and WhatsApp alert) once per order. Called under the script lock.
// The order stays pending (P_) until the email is sent, so flushPending retries a failure.
function sendMail(id) {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('P_' + id)) return; // already sent
  var me = Session.getEffectiveUser().getEmail();
  var sh = sheet(), r = findRow(sh, id);
  if (!me || !r) return;
  var v = sh.getRange(r, 1, 1, HEAD.length).getValues()[0];
  var nom = v[2], tel = String(v[3]).replace(/^'/, ''), message = v[11];
  var folder = props.getProperty('F_' + id) ? orderFolder(id, null) : null;

  // attach the files (Gmail limit is 25 MB per email; keep a margin)
  var att = [], total = 0, skipped = 0, n = 0, it = folder ? folder.getFiles() : { hasNext: function () { return false; } };
  while (it.hasNext()) {
    var f = it.next(); n++;
    if (total + f.getSize() > 20 * 1024 * 1024) { skipped++; continue; }
    att.push(f.getBlob()); total += f.getSize();
  }
  sh.getRange(r, 10).setValue(n);

  var want = +(props.getProperty('N_' + id) || 0);
  var note = n ? '\n\n📎 ' + att.length + ' fichier(s) en pièce jointe' + (skipped ? ', ' + skipped + ' trop lourd(s), voir Drive' : '') + '.'
               : '\n\n📎 Photos et documents : le client les envoie sur WhatsApp.';
  if (n < want) note += '\n⚠️ ' + (want - n) + ' fichier(s) annoncé(s) mais pas reçu(s) : demandez-les au client sur WhatsApp.';
  var mail = {
    to: me,
    subject: 'PRO CV – nouveau formulaire : ' + (nom || '?') + ' (' + tel + ')',
    body: message + note + (folder ? '\n\n📁 Photos et documents : ' + folder.getUrl() : '') + '\n📊 Tableau : ' + sh.getParent().getUrl()
  };
  try {
    MailApp.sendEmail(Object.assign({ attachments: att }, mail));
  } catch (e) {
    // attachments refused (size, type…): send the text and the Drive link anyway
    mail.body += '\n\n(Pièces jointes non envoyées : ' + String(e).slice(0, 200) + ')';
    MailApp.sendEmail(mail); // if this throws too, P_ stays and flushPending retries
  }
  props.deleteProperty('P_' + id);
  props.deleteProperty('N_' + id);

  sendWhatsApp('🆕 PRO CV – nouvelle commande\n👤 ' + (nom || '?') + '\n📞 ' + tel +
    '\n💼 ' + (v[5] || '-') + ' (' + (v[6] || '-') + ')\n🇩🇪 ' + (v[7] || '-') + '\n📍 ' + (v[8] || '-') +
    '\n📎 ' + n + ' fichier(s)' + (n < want ? ' (' + (want - n) + ' manquant(s))' : '') +
    (folder ? '\n📁 ' + folder.getUrl() : '') + '\n✉️ Détails complets dans Gmail.');
}

// WhatsApp alert to the owner through CallMeBot (text only: files stay in Drive, the link is in the message).
// Off until both script properties are set: WA_PHONE (e.g. 212706828446) and WA_APIKEY (from CallMeBot).
// CallMeBot takes the text in the URL, and Apps Script refuses long URLs: keep the alert short.
function sendWhatsApp(text) {
  var props = PropertiesService.getScriptProperties();
  var phone = props.getProperty('WA_PHONE'), key = props.getProperty('WA_APIKEY');
  if (!phone || !key) return;
  var t = String(text);
  while (t.length > 20 && encodeURIComponent(t).length > 1500) { var cp = Array.from(t); t = cp.slice(0, Math.floor(cp.length * 0.9)).join(''); }
  try {
    var res = UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone) +
      '&apikey=' + encodeURIComponent(key) + '&text=' + encodeURIComponent(t), { muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) console.warn('CallMeBot ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  } catch (e) { console.warn('CallMeBot failed: ' + e); /* the email is already sent */ }
}

// Run once from the editor after setting WA_PHONE and WA_APIKEY: you should get a WhatsApp message.
function testWhatsApp() { sendWhatsApp('✅ PRO CV : les alertes WhatsApp marchent.'); }

// Runs every minute (trigger made by setup / ensureTrigger): sends the email for new clients.
// An order that announced files waits for them, 10 min at most. Also retries emails that failed.
// It takes the lock once per email, so orders arriving meanwhile are saved between two emails.
function flushPending() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  // Gmail allows about 100 emails a day on a normal account: past that, keep them pending
  // (the rows are already in the sheet) and try again on a later run.
  if (MailApp.getRemainingDailyQuota() < 1) { console.warn('mail quota used up for today'); return; }
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('P_') !== 0) return;
    var id = k.slice(2), want = +(all['N_' + id] || 0);
    if (want > 0 && Date.now() - (+all[k]) < 10 * 60 * 1000) {
      var fid = all['F_' + id], have = 0;
      try { have = fid ? countFiles(DriveApp.getFolderById(fid)) : 0; } catch (e) {}
      if (have < want) return; // files still arriving
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return; // busy with orders: next run
    try { sendMail(id); } catch (e) { console.warn('flush ' + k + ': ' + e); }
    finally { lock.releaseLock(); }
  });
}

// The every-minute check is created by setup(); this also creates it if setup was not run again,
// and replaces the old every-10-minutes trigger once (TRIGGER_V marks that it was done).
function ensureTrigger() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('TRIGGER_V') === '2') return;
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'flushPending') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('flushPending').timeBased().everyMinutes(1).create();
    props.setProperty('TRIGGER_V', '2');
  } catch (e) { console.warn('trigger: ' + e); }
}

// ---- helpers ----

function countFiles(folder) {
  var n = 0, it = folder.getFiles();
  while (it.hasNext()) { it.next(); n++; }
  return n;
}

function sheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SHEET_ID'), ss;
  if (ssId) ss = SpreadsheetApp.openById(ssId); // an error here fails this request; never replace the real sheet
  if (!ss) {
    ss = SpreadsheetApp.create('PRO CV – Commandes');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0].setName(SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
  }
  return sh;
}

function findRow(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === id) return i + 2;
  return 0;
}

function orderFolder(id, o) {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('ROOT_ID'), root;
  try { root = rootId && DriveApp.getFolderById(rootId); } catch (e) { root = null; }
  if (!root) {
    root = DriveApp.createFolder(ROOT_FOLDER);
    props.setProperty('ROOT_ID', root.getId());
  }
  var key = 'F_' + id, fid = props.getProperty(key), f;
  try { f = fid && DriveApp.getFolderById(fid); } catch (e) { f = null; }
  if (!f) {
    f = root.createFolder(Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd HH-mm') + ' ' + id);
    props.setProperty(key, f.getId());
  }
  if (o && o.nom) {
    var nice = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd') + ' ' + o.nom + ' ' + (o.tel || '');
    if (f.getName() !== nice) f.setName(nice.replace(/[\\\/:*?"<>|]/g, '_'));
  }
  return f;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (▶ Run) to grant access and create the sheet + folder
// and the every-minute check that emails new orders.
function setup() {
  var sh = sheet();
  orderFolder('test', { nom: 'TEST', tel: '' });
  PropertiesService.getScriptProperties().deleteProperty('TRIGGER_V');
  ensureTrigger();
  Logger.log('Sheet: ' + sh.getParent().getUrl());
}

// =====================================================================================
// Meta Conversions API (server-side events)
//
// Script properties (⚙ Paramètres du projet > Propriétés du script), never in this file:
//   META_CAPI_TOKEN       access token from Events Manager > Paramètres > API Conversions
//   META_TEST_EVENT_CODE  optional, e.g. TEST12345: events then show in "Tester les événements"
//                         (delete it once the test is done)
// Run setupCapiColumns() once: it adds the columns below and the "Payé" trigger.
// =====================================================================================

var CAPI_URL = 'https://graph.facebook.com/v21.0/1814127609805768/events';
var CAPI_COLS = ['Payé', 'CAPI_Lead_Status', 'CAPI_Purchase_Status', 'Meta_Event_ID', 'Meta_FBP', 'Meta_FBC', 'Meta_Source_URL', 'Meta_User_Agent'];
var LEAD_LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];

// Column number of each header. Missing CAPI headers are added after the last used column,
// so the existing columns never move.
function capiCols_(sh) {
  var last = Math.max(sh.getLastColumn(), HEAD.length);
  var names = sh.getRange(1, 1, 1, last).getValues()[0].map(String);
  var missing = CAPI_COLS.filter(function (n) { return names.indexOf(n) < 0; });
  if (missing.length) {
    sh.getRange(1, last + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    names = names.concat(missing);
  }
  var c = {};
  names.forEach(function (n, i) { if (n) c[n] = i + 1; });
  return c;
}

// Keeps what the browser sent for Meta, and puts an unticked "Payé" box on the row.
function saveMeta_(sh, r, p) {
  var c = capiCols_(sh);
  var cell = sh.getRange(r, c['Payé']);
  if (cell.getDataValidation() == null) cell.insertCheckboxes();
  var put = function (name, v) { if (v) sh.getRange(r, c[name]).setValue(safe(String(v).slice(0, 1000))); };
  put('Meta_Event_ID', String(p.event_id || '').replace(/[^\w-]/g, '').slice(0, 80));
  put('Meta_FBP', p.fbp);
  put('Meta_FBC', p.fbc);
  put('Meta_Source_URL', p.event_source_url);
  put('Meta_User_Agent', p.client_user_agent);
}

// Phone as Meta wants it: digits with the country code (Moroccan 06/07/05 -> 2126/2127/2125).
function normPhone_(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (/^00/.test(d)) d = d.slice(2);
  else if (/^0/.test(d)) { d = d.slice(1); if (!/^212/.test(d)) d = '212' + d; } // local number typed with 0
  else if (/^[5-7]\d{8}$/.test(d)) d = '212' + d;
  return d.replace(/^2120/, '212');
}
// Same rule as the site: Moroccan 212 + 5/6/7 + 8 digits, or another country's 8 to 15 digits.
function okPhone_(d) { return /^212[5-7]\d{8}$/.test(d) || (!/^212/.test(d) && /^\d{8,15}$/.test(d)); }

function hashSha256_(val) {
  var v = String(val == null ? '' : val);
  if (!v) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var h = ((b + 256) % 256).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
}

// user_data: email, phone, first and last name hashed (+ country for Moroccan numbers);
// fbp, fbc and the user agent unhashed, as Meta asks.
function userData_(u) {
  var d = {}, add = function (k, v) { if (v) d[k] = [hashSha256_(v)]; };
  add('em', String(u.email || '').trim().toLowerCase());
  var ph = normPhone_(u.tel);
  if (okPhone_(ph)) { add('ph', ph); if (/^212/.test(ph)) add('country', 'ma'); }
  var words = String(u.nom || '').trim().toLowerCase().replace(/[.,'’"()\-]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length) add('fn', words[0]);
  if (words.length > 1) add('ln', words[words.length - 1]);
  if (u.fbp) d.fbp = String(u.fbp);
  if (u.fbc) d.fbc = String(u.fbc);
  if (u.ua) d.client_user_agent = String(u.ua);
  return d;
}

// Sends one event. Returns 'OK…', 'NO TOKEN' or the error text; never throws.
function capiSend_(ev) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('META_CAPI_TOKEN');
  if (!token) return 'NO TOKEN';
  var body = { data: [ev], access_token: token };
  var test = props.getProperty('META_TEST_EVENT_CODE');
  if (test) body.test_event_code = test;
  try {
    var res = UrlFetchApp.fetch(CAPI_URL, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) return 'OK' + (test ? ' (test ' + test + ')' : '');
    return 'ERROR ' + code + ': ' + res.getContentText().slice(0, 300);
  } catch (e) {
    return 'ERROR ' + String(e).slice(0, 300);
  }
}

function stamp_() { return Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd HH:mm'); }

// Server-side Lead with the browser's event_id, so Meta counts the two as one.
// Only when the site says the lead qualifies (German A2+, real phone, first send of the day for
// this phone), checked again here; once per row and once per phone per day.
function capiLead_(r, id, p) {
  try {
    var o = p.data || {};
    if (!r || !p.lead_ok || LEAD_LEVELS.indexOf(String(o.allemand)) < 0) return;
    var ph = normPhone_(o.tel);
    if (!okPhone_(ph)) return;
    if (!PropertiesService.getScriptProperties().getProperty('META_CAPI_TOKEN')) return;
    var sh = sheet(), c = capiCols_(sh);
    if (String(sh.getRange(r, 2).getValue()) !== id) { r = findRow(sh, id); if (!r) return; } // the sheet was sorted
    var stCell = sh.getRange(r, c['CAPI_Lead_Status']);
    if (stCell.getValue()) return;
    var cache = CacheService.getScriptCache();
    var dayKey = 'L_' + ph + '_' + Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyyMMdd');
    if (cache.get(dayKey)) { stCell.setValue('SKIPPED same phone today'); return; }
    var st = capiSend_({
      event_name: 'Lead',
      event_id: String(p.event_id || (id + '-lead')),
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: String(p.event_source_url || 'https://procv.store/'),
      user_data: userData_({ email: o.email, tel: o.tel, nom: o.nom, fbp: p.fbp, fbc: p.fbc, ua: p.client_user_agent }),
      custom_data: { value: 200, currency: 'MAD', content_name: o.but || 'Bewerbung' }
    });
    if (/^OK/.test(st)) cache.put(dayKey, '1', 86400);
    stCell.setValue(st + ' ' + stamp_());
  } catch (e) {
    console.warn('CAPI lead: ' + e);
  }
}

// Purchase when you tick "Payé". Runs from the installable "On edit" trigger made by
// setupCapiColumns() (a simple onEdit is not allowed to call Meta).
function onCommandesEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME) return;
  var c = capiCols_(sh), col = c['Payé'];
  if (e.range.getColumn() > col || e.range.getLastColumn() < col) return;
  for (var r = Math.max(2, e.range.getRow()); r <= e.range.getLastRow(); r++) {
    if (sh.getRange(r, col).getValue() !== true) continue;
    var stCell = sh.getRange(r, c['CAPI_Purchase_Status']);
    if (stCell.getValue()) continue; // already sent: unticking and ticking again sends nothing
    var v = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    var get = function (name) { return c[name] ? String(v[c[name] - 1] || '') : ''; };
    var evId = get('Meta_Event_ID'), url = get('Meta_Source_URL'), ua = get('Meta_User_Agent');
    var ev = {
      event_name: 'Purchase',
      event_id: (evId ? evId.replace(/-lead$/, '') : 'row-' + r) + '-purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: url && ua ? 'website' : 'other',
      user_data: userData_({ email: v[4], tel: String(v[3]).replace(/^'/, ''), nom: v[2], fbp: get('Meta_FBP'), fbc: get('Meta_FBC'), ua: ua }),
      custom_data: { value: 200, currency: 'MAD', content_name: String(v[6] || '') || 'Bewerbung' }
    };
    if (url) ev.event_source_url = url;
    var st = capiSend_(ev);
    stCell.setValue(/^OK/.test(st) ? 'SENT ' + stamp_() + st.slice(2) : st);
  }
}

// Run once from the editor (▶ Exécuter): adds the CAPI columns, puts a "Payé" box on every
// order, and creates the On edit trigger for onCommandesEdit.
function setupCapiColumns() {
  var sh = sheet(), c = capiCols_(sh), last = sh.getLastRow();
  if (last >= 2) {
    var pay = sh.getRange(2, c['Payé'], last - 1, 1), vals = pay.getValues();
    pay.insertCheckboxes();
    pay.setValues(vals.map(function (x) { return [x[0] === true]; }));
  }
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onCommandesEdit'; });
  if (!has) ScriptApp.newTrigger('onCommandesEdit').forSpreadsheet(sh.getParent()).onEdit().create();
  Logger.log('CAPI ready. Token set: ' + !!PropertiesService.getScriptProperties().getProperty('META_CAPI_TOKEN'));
}

// Run from the editor to check the token: sends one test Lead (it shows in Test Events
// only while META_TEST_EVENT_CODE is set).
function testCapi() {
  Logger.log(capiSend_({
    event_name: 'Lead', event_id: 'test-' + Date.now(), event_time: Math.floor(Date.now() / 1000),
    action_source: 'website', event_source_url: 'https://procv.store/formulaire/',
    user_data: userData_({ email: 'test@example.com', tel: '0612345678', nom: 'Test Procv', ua: 'Mozilla/5.0 (test)' }),
    custom_data: { value: 200, currency: 'MAD', content_name: 'Test' }
  }));
}
