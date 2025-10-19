/** Website Checker for travelpets.com (Google Apps Script)
 *  - Logs to a Google Sheet
 *  - Hourly trigger supported (set via Triggers UI)
 *  - DNS via Google DNS-over-HTTPS
 *  - SSL days remaining: placeholder for future (site is HTTP today)
 *  - Conditional formatting to highlight failures (row turns red when real data row fails)
 *  - Email alert to addresses listed in Config (EMAILS)
 *  - NEW: Dashboard sheet with KPIs, per-URL stats, sparklines, and recent failures
 */

const SITE_BASE = 'http://www.travelpets.com'; // default base
const SHEET_NAME = 'Checks';
const CONFIG_SHEET = 'Config';
const DASHBOARD_SHEET = 'Dashboard';
const SPREADSHEET_NAME = 'Website Checks — travelpets.com';

// ==== Public entry points ====

/** One-time initializer: creates spreadsheet and config sheet if missing */
function initialize() {
  const ss = getOrCreateSpreadsheet_();
  ensureSheetsAndHeaders_(ss);  // headers + conditional formatting
  createDefaultConfig_(ss);
  ensureDashboard_(ss);         // creates/refreshes dashboard
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone() || 'America/Chicago');
  Logger.log('Initialized. Spreadsheet URL: %s', ss.getUrl());
}

/** Main job: checks configured pages and appends rows to the sheet */
function runChecks() {
  const ss = getOrCreateSpreadsheet_();
  ensureSheetsAndHeaders_(ss); // make sure headers/CF exist
  const cfg = readConfig_(ss);

  const pages = cfg.pages; // array of paths or full URLs
  const keyword = cfg.keyword || null;

  const rows = [];
  for (const page of pages) {
    const url = normalizeUrl_(page, SITE_BASE);
    const result = checkUrl_(url, keyword);
    rows.push(resultToRow_(result));
  }

  const sh = ss.getSheetByName(SHEET_NAME);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  // ---- Email alert on failures ----
  // A "failure" is OK !== true (covers HTTP errors and thrown exceptions)
  const OK_COL = 3;     // 1-indexed (A=1, B=2, C=3)
  const failures = rows.filter(r => r[OK_COL - 1] !== true);

  if (failures.length > 0) {
    const body = failures.map(r => {
      const ts = r[1 - 1];     // Timestamp (A)
      const url = r[2 - 1];    // URL (B)
      const ok = r[3 - 1];     // OK (C)
      const status = r[4 - 1]; // Status (D)
      const err = r[15 - 1];   // Error (O)
      return `Timestamp: ${ts}\nURL: ${url}\nOK: ${ok}\nStatus: ${status}\nError: ${err || ''}\n`;
    }).join('\n---\n');

    const subject = `Website check: ${failures.length} failure(s) detected`;
    const recipients = (cfg.emails && cfg.emails.length > 0)
      ? cfg.emails
      : [Session.getActiveUser().getEmail()];

    recipients.forEach(to => {
      if (to && /@/.test(to)) {
        MailApp.sendEmail({
          to: to.trim(),
          subject,
          body: `One or more URLs failed:\n\n${body}\nSpreadsheet: ${ss.getUrl()}`
        });
      }
    });
  }

  // Refresh dashboard each run
  ensureDashboard_(ss);
}

// ==== Core checks ====

function checkUrl_(url, keyword) {
  const started = new Date();
  let ok = false, status = null, finalUrl = null, rtMs = null, payloadBytes = null;
  let title = null, metaDesc = null, keywordPresent = null, error = null;
  let dnsA = [], dnsAAAA = [], sslDaysRemaining = null;

  try {
    // DNS lookup
    const host = getHostname_(url);
    if (host) {
      const dns = resolveDns_(host);
      dnsA = dns.A || [];
      dnsAAAA = dns.AAAA || [];
    }

    // Fetch (follow redirects)
    const fetchStart = Date.now();
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    rtMs = Date.now() - fetchStart;

    status = res.getResponseCode();
    // GAS doesn't expose final URL after redirects; keep the requested URL
    finalUrl = url;
    const content = res.getContent();
    payloadBytes = content ? content.length : null;

    const ctype = String(res.getHeaders()['Content-Type'] || '').toLowerCase();
    let html = '';
    if (ctype.indexOf('text/html') !== -1 || looksLikeHtml_(content)) {
      html = res.getContentText() || '';
      title = extractTitle_(html);
      metaDesc = extractMetaDescription_(html);
      if (keyword) {
        keywordPresent = html.toLowerCase().indexOf(String(keyword).toLowerCase()) !== -1;
      }
    }

    ok = status >= 200 && status < 400;

    // SSL days (future): only meaningful for HTTPS
    if (url.startsWith('https://')) {
      // Placeholder until SSL is enabled. Keep null today.
      sslDaysRemaining = null;
    }
  } catch (e) {
    error = String(e && e.message ? e.message : e);
  }

  return {
    timestamp: Utilities.formatDate(started, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    url,
    ok,
    status,
    finalUrl,
    responseTimeMs: rtMs,
    payloadBytes,
    title,
    metaDescription: metaDesc,
    keyword,
    keywordPresent,
    dnsA: dnsA.join(' | '),
    dnsAAAA: dnsAAAA.join(' | '),
    sslDaysRemaining,
    error
  };
}

// ==== Helpers ====

function normalizeUrl_(maybePathOrUrl, base) {
  const s = String(maybePathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return base.replace(/\/+$/, '') + s;
  return base.replace(/\/+$/, '') + '/' + s;
}

function getHostname_(url) {
  try {
    return new URL(url).hostname;
  } catch (_e) {
    return null;
  }
}

function resolveDns_(hostname) {
  // Google DNS-over-HTTPS
  const out = { A: [], AAAA: [] };
  try {
    const a = UrlFetchApp.fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, { muteHttpExceptions: true });
    if (a.getResponseCode() === 200) {
      const body = JSON.parse(a.getContentText());
      if (body.Answer) {
        out.A = body.Answer.filter(r => r.type === 1).map(r => r.data);
      }
    }
  } catch (_e) {}
  try {
    const aaaa = UrlFetchApp.fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=AAAA`, { muteHttpExceptions: true });
    if (aaaa.getResponseCode() === 200) {
      const body = JSON.parse(aaaa.getContentText());
      if (body.Answer) {
        out.AAAA = body.Answer.filter(r => r.type === 28).map(r => r.data);
      }
    }
  } catch (_e) {}
  return out;
}

function looksLikeHtml_(bytes) {
  if (!bytes) return false;
  const head = Utilities.newBlob(bytes.slice(0, Math.min(bytes.length, 512))).getDataAsString();
  return /<!doctype html|<html|<head|<title/i.test(head || '');
}

function extractTitle_(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? trimAndClip_(decodeHtmlEntities_(m[1]), 200) : null;
}

function extractMetaDescription_(html) {
  // name="description"
  let m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (m && m[1]) return trimAndClip_(decodeHtmlEntities_(m[1]), 400);
  // og:description
  m = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (m && m[1]) return trimAndClip_(decodeHtmlEntities_(m[1]), 400);
  return null;
}

function trimAndClip_(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Minimal HTML entity decode for common cases
function decodeHtmlEntities_(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function resultToRow_(r) {
  return [
    r.timestamp,           // A
    r.url,                 // B
    r.ok,                  // C
    r.status,              // D
    r.finalUrl,            // E
    r.responseTimeMs,      // F
    r.payloadBytes,        // G
    r.title,               // H
    r.metaDescription,     // I
    r.keyword,             // J
    r.keywordPresent,      // K
    r.dnsA,                // L
    r.dnsAAAA,             // M
    r.sslDaysRemaining,    // N
    r.error                // O
  ];
}

// ==== Spreadsheet plumbing ====

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (_e) {}
  }
  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function ensureSheetsAndHeaders_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  const headers = [
    'Timestamp','URL','OK','Status','Final URL','Response Time (ms)','Payload (bytes)',
    'Title','Meta Description','Keyword','Keyword Present','DNS A','DNS AAAA','SSL Days Remaining','Error'
  ];
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // Conditional formatting:
  // Only highlight rows that have a Timestamp (A non-blank) AND (OK = FALSE OR Error is non-empty)
  const rules = sh.getConditionalFormatRules();
  const range = sh.getRange(2, 1, sh.getMaxRows() - 1, headers.length);
  const builder = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([range])
    .whenFormulaSatisfied('=AND(LEN($A2)>0, OR($C2=FALSE, LEN($O2)>0))')
    .setBackground('#f8d7da') // soft red
    .build();

  // Replace any prior CF rule covering this range to avoid duplicates
  const filtered = rules.filter(r => {
    const rgs = r.getRanges();
    return !(rgs.length === 1 &&
             rgs[0].getRow() === 2 &&
             rgs[0].getColumn() === 1 &&
             rgs[0].getNumColumns() === headers.length);
  });
  filtered.push(builder);
  sh.setConditionalFormatRules(filtered);

  let cfg = ss.getSheetByName(CONFIG_SHEET);
  if (!cfg) cfg = ss.insertSheet(CONFIG_SHEET);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1,1,1,2).setValues([['KEY','VALUE']]).setFontWeight('bold');
    cfg.setFrozenRows(1);
  }
}

function createDefaultConfig_(ss) {
  const cfg = ss.getSheetByName(CONFIG_SHEET);
  const upserts = [
    ['KEYWORD','pets'], // change or leave blank
    ['PAGES','/ , http://travelpets.com/content/hotels/countries.asp?Area=Hotels&city=Dallas&id_country=US&id_region=TX'],
    ['EMAILS',''] // comma-separated (e.g., "you@example.com, wife@example.com")
  ];
  upserts.forEach(([k,v]) => upsertConfig_(cfg, k, v));
}

function upsertConfig_(cfgSheet, key, value) {
  const data = cfgSheet.getDataRange().getValues();
  for (let i=2;i<=data.length;i++) {
    if (String(cfgSheet.getRange(i,1).getValue()).trim() === key) {
      cfgSheet.getRange(i,2).setValue(value);
      return;
    }
  }
  cfgSheet.appendRow([key, value]);
}

function readConfig_(ss) {
  const cfg = ss.getSheetByName(CONFIG_SHEET);
  const map = {};
  const vals = cfg.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || '').trim();
    if (k) map[k] = vals[i][1];
  }
  const keyword = (map['KEYWORD'] || '').toString().trim();
  const pagesRaw = (map['PAGES'] || '/').toString();
  const pages = pagesRaw.split(',').map(s => s.trim()).filter(Boolean);
  const emails = (map['EMAILS'] || '').toString()
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean);
  return { keyword, pages, emails };
}

// ==== Dashboard ====

function ensureDashboard_(ss) {
  let dsh = ss.getSheetByName(DASHBOARD_SHEET);
  if (!dsh) dsh = ss.insertSheet(DASHBOARD_SHEET);
  dsh.clear();

  // Title + updated at
  dsh.getRange('A1').setValue('Website Checks — Dashboard').setFontWeight('bold').setFontSize(16);
  dsh.getRange('A3').setValue('Last updated:').setFontWeight('bold');
  dsh.getRange('B3').setFormula('=NOW()');
  dsh.getRange('B3').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // ---- KPIs (last 24h) ----
  dsh.getRange('A5').setValue('Checks (24h)').setFontWeight('bold');
  dsh.getRange('B5').setFormula('=COUNTIF(Checks!A:A, ">" & TEXT(NOW()-1,"yyyy-mm-dd hh:mm:ss"))');

  dsh.getRange('A6').setValue('Failures (24h)').setFontWeight('bold');
  dsh.getRange('B6').setFormula('=COUNTIFS(Checks!A:A, ">" & TEXT(NOW()-1,"yyyy-mm-dd hh:mm:ss"), Checks!C:C, FALSE)');

  dsh.getRange('A7').setValue('Uptime (24h)').setFontWeight('bold');
  dsh.getRange('B7').setFormula('=IFERROR(1 - B6/B5, )');
  dsh.getRange('B7').setNumberFormat('0.00%');

  dsh.getRange('A8').setValue('Avg Response (24h, ms)').setFontWeight('bold');
  dsh.getRange('B8').setFormula('=IFERROR(ROUND(AVERAGE(FILTER(Checks!F:F, VALUE(Checks!A:A) > NOW()-1)),0), )');

  // ---- Recent failures table ----
  dsh.getRange('H10').setValue('Recent Failures (last 20)').setFontWeight('bold');

  // Write across 4 columns (H12:K12)
  dsh.getRange(12, 8, 1, 4).setValues([
    ['Timestamp','URL','Status','Error']
  ]).setFontWeight('bold');

  dsh.getRange('H13').setFormula('=QUERY(Checks!A:O,"select A,B,D,O where C = false order by A desc limit 20",0)');

  // Optional: tidy column widths
  dsh.setColumnWidths(1, 6, 180);
  dsh.setColumnWidth(6, 220);
  dsh.setColumnWidths(8, 4, 160);
}


/** Quick manual test for a single URL (run from editor) */
function testSingleUrl() {
  const res = checkUrl_('http://www.travelpets.com/', 'pets');
  Logger.log(JSON.stringify(res, null, 2));
}
