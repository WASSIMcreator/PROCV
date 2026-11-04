/**
 * PRO CV – saves every order form sent from the site.
 *
 * - One row per client in the "Commandes" sheet (all answers + the full WhatsApp text).
 * - Photos and documents go into Drive: "PRO CV – Clients" / <date name phone>.
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

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = JSON.parse(e.postData.contents);
    var id = String(p.id || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!id) return out({ ok: false, error: 'no id' });
    if (p.type === 'form') saveForm(id, p);
    else if (p.type === 'file') saveFile(id, p);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Opening the /exec link in a browser just says it works.
function doGet() { return out({ ok: true, service: 'PRO CV form' }); }

function saveForm(id, p) {
  var o = p.data || {};
  var sh = sheet(), r = findRow(sh, id);
  var folder = orderFolder(id, o);
  var row = [new Date(), id, o.nom || '', "'" + (o.tel || ''), o.email || '', o.metier || '', o.but || '', o.allemand || '', o.ville || '',
             countFiles(folder), folder.getUrl(), String(p.message || '').slice(0, 45000)];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);

  // One email per new client, with the photos attached. Photos upload after the form,
  // so wait until all the announced files are in Drive (or 10 min, see flushPending).
  if (!r) {
    var props = PropertiesService.getScriptProperties();
    var want = Math.min(+p.nfiles || 0, MAX_FILES_PER_ORDER);
    props.setProperty('N_' + id, String(want));
    if (countFiles(folder) >= want) sendMail(id);
    else props.setProperty('P_' + id, String(Date.now()));
  }
}

function sendMail(id) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('P_' + id);
  if (props.getProperty('S_' + id)) return; // already sent
  props.setProperty('S_' + id, '1');
  var me = Session.getEffectiveUser().getEmail();
  if (!me) return;

  var sh = sheet(), r = findRow(sh, id);
  if (!r) return;
  var v = sh.getRange(r, 1, 1, HEAD.length).getValues()[0];
  var nom = v[2], tel = String(v[3]).replace(/^'/, ''), message = v[11];
  var folder = orderFolder(id, null);

  // attach the files (Gmail limit is 25 MB per email; keep a margin)
  var att = [], total = 0, skipped = 0, n = 0, it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next(); n++;
    if (total + f.getSize() > 20 * 1024 * 1024) { skipped++; continue; }
    att.push(f.getBlob()); total += f.getSize();
  }
  sh.getRange(r, 10).setValue(n);

  var note = n ? '\n\n📎 ' + att.length + ' fichier(s) en pièce jointe' + (skipped ? ', ' + skipped + ' trop lourd(s), voir Drive' : '') + '.'
               : '\n\n📎 Aucune photo reçue par le site (le client peut les envoyer sur WhatsApp).';
  MailApp.sendEmail({
    to: me,
    subject: 'PRO CV – nouveau formulaire : ' + (nom || '?') + ' (' + tel + ')',
    body: message + note + '\n\n📁 Photos et documents : ' + folder.getUrl() + '\n📊 Tableau : ' + sh.getParent().getUrl(),
    attachments: att
  });
}

// Runs every 10 min (trigger made by setup): sends the email for clients whose photos
// never all arrived, with whatever is in Drive.
function flushPending() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('P_') === 0 && Date.now() - (+all[k]) > 10 * 60 * 1000) sendMail(k.slice(2));
  });
}

function saveFile(id, p) {
  var folder = orderFolder(id, null);
  var n = countFiles(folder);
  if (n >= MAX_FILES_PER_ORDER) return;
  var bytes = Utilities.base64Decode(p.b64 || '');
  if (!bytes.length || bytes.length > MAX_FILE_MB * 1024 * 1024) return;
  var mime = /^(image\/[\w.+-]+|application\/pdf)$/.test(p.mime) ? p.mime : 'application/octet-stream';
  var name = (p.kind || 'doc') + ' - ' + String(p.name || 'fichier').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 80);
  // the site may retry a file that already arrived: skip exact duplicates (same name and size)
  var same = folder.getFilesByName(name);
  while (same.hasNext()) if (same.next().getSize() === bytes.length) return;
  folder.createFile(Utilities.newBlob(bytes, mime, name));

  var sh = sheet(), r = findRow(sh, id);
  if (r) sh.getRange(r, 10).setValue(n + 1);

  // last announced photo arrived: send the email now
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('P_' + id) && n + 1 >= +(props.getProperty('N_' + id) || 0)) sendMail(id);
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
  try { ss = ssId && SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
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
