/**
 * PRO CV – saves every order form sent from the site.
 *
 * - One row per client in the "Commandes" sheet (all answers + the full WhatsApp text).
 * - Photos and documents come by WhatsApp; the script refuses files.
 * - You get one email per new client, with the photos and documents attached
 *   (sent when the last photo arrives, or after 10 minutes at most).
 *
 * Setup: see google-apps-script/README.md
 */

var ROOT_FOLDER = 'PRO CV – Clients';
var SHEET_NAME = 'Commandes';
var MAX_FILE_MB = 15;
var MAX_FILES_PER_ORDER = 15;
var HEAD = ['Date', 'ID', 'Nom', 'Téléphone', 'Email', 'Poste', 'Type', 'Allemand', 'Ville', 'Fichiers reçus', 'Dossier Drive', 'Message complet'];

// Anti-spam: anyone who finds the /exec link can post to it, so new orders are capped.
var MAX_BODY_CHARS = 100000;   // a real form is a few KB
var MAX_NEW_PER_HOUR = 20;     // new orders per hour, all clients together
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
    lock.waitLock(60000);
    var limit = spamLimit(id, digits);
    if (limit) return out({ ok: false, error: limit });
    saveForm(id, p);
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
// ?a=seen&id=… counts today's visitors for the site (see seen below).
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.a === 'seen') return out(seen(p.id));
  return out({ ok: true, service: 'PRO CV form' });
}

// Today's real visitors (Moroccan time), shown on the site.
// Each browser sends a random id it keeps (no name, no IP); an id counts once a day.
var MAX_SEEN_IDS = 500;        // ids kept per day (a script property holds about 9 KB)
var MAX_SEEN_PER_HOUR = 300;   // anyone can call the link: caps how fast the count can be pushed up

function seen(id) {
  id = String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 10);
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
  var lock = LockService.getScriptLock();
  var read = function () { var s = JSON.parse(props.getProperty('SEEN') || '{}'); return s.day === day ? s : { day: day, n: 0, ids: [] }; };
  if (!lock.tryLock(5000)) return { ok: true, n: read().n }; // busy with an order: show the count, skip this visit
  try {
    var s = read();
    if (id.length === 10 && s.ids.indexOf(id) < 0) {
      var cache = CacheService.getScriptCache(), hourKey = 'S_' + Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyyMMddHH');
      var nHour = +(cache.get(hourKey) || 0);
      if (nHour < MAX_SEEN_PER_HOUR) {
        cache.put(hourKey, String(nHour + 1), 3600);
        s.n++;
        s.ids.push(id);
        if (s.ids.length > MAX_SEEN_IDS) s.ids = s.ids.slice(-MAX_SEEN_IDS);
        props.setProperty('SEEN', JSON.stringify(s));
      }
    }
    return { ok: true, n: s.n };
  } finally {
    lock.releaseLock();
  }
}

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

  // One email per new client, with the photos attached. Photos upload after the form,
  // so wait until all the announced files are in Drive (or 10 min, see flushPending).
  if (!r) {
    props.setProperty('N_' + id, String(want));
    props.setProperty('P_' + id, String(Date.now())); // pending until the email is really sent
    ensureTrigger();
    if ((folder ? countFiles(folder) : 0) >= want) trySend(id);
  }
}

// The form/file is already saved: an email error must not make the site report a failure.
function trySend(id) { try { sendMail(id); } catch (e) { console.warn('mail ' + id + ': ' + e); } }

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

// Runs every 10 min (trigger made by setup): sends the email for clients whose photos
// never all arrived, with whatever is in Drive. Also retries emails that failed.
function flushPending() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return; // busy with uploads: next run
  try {
    var props = PropertiesService.getScriptProperties(), all = props.getProperties();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('P_') === 0 && Date.now() - (+all[k]) > 10 * 60 * 1000) {
        try { sendMail(k.slice(2)); } catch (e) { console.warn('flush ' + k + ': ' + e); }
      }
    });
  } finally { lock.releaseLock(); }
}

// The 10-minute check is created by setup(); this also creates it if setup was not run again.
function ensureTrigger() {
  try {
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'flushPending'; });
    if (!has) ScriptApp.newTrigger('flushPending').timeBased().everyMinutes(10).create();
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
// and the 10-minute check that emails orders whose photos never all arrived.
function setup() {
  var sh = sheet();
  orderFolder('test', { nom: 'TEST', tel: '' });
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'flushPending'; });
  if (!has) ScriptApp.newTrigger('flushPending').timeBased().everyMinutes(10).create();
  Logger.log('Sheet: ' + sh.getParent().getUrl());
}
