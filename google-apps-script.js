/**
 * Future Fund Savings — Google Apps Script Backend (FIXED)
 *
 * ════════════════════════════════════════════════════════
 *  SETUP GUIDE  (read all 6 steps before starting)
 * ════════════════════════════════════════════════════════
 *
 * STEP 1 — Create your Google Sheet
 *   a. Go to https://sheets.google.com and create a NEW blank spreadsheet.
 *   b. Name it anything (e.g. "Future Fund Savings").
 *   c. Copy the Sheet ID from the URL:
 *        https://docs.google.com/spreadsheets/d/  ← SHEET_ID IS HERE →  /edit
 *      Example ID:  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
 *   d. Paste it as the value of SPREADSHEET_ID below (replace the placeholder).
 *
 * STEP 2 — Paste this script
 *   a. Go to https://script.google.com → click "New project".
 *   b. Delete the empty function that appears, then paste this entire file.
 *   c. Give the project a name (top-left, e.g. "Future Fund API").
 *
 * STEP 3 — Set the Spreadsheet ID
 *   Replace  YOUR_GOOGLE_SHEET_ID_HERE  below with the ID from Step 1c.
 *   ⚠️  Keep the single quotes around it.
 *
 * STEP 4 — Run setupSpreadsheet() ONCE to create the sheet headers
 *   a. In the toolbar, select the function "setupSpreadsheet" from the dropdown
 *      (it shows "Select function" or the last-run function name).
 *   b. Click the ▶ Run button.
 *   c. A permission dialog will appear → click "Review permissions"
 *      → choose your Google account → click "Advanced" → "Go to … (unsafe)"
 *      → "Allow".  (This is normal for personal scripts.)
 *   d. Check the Execution log — it should say "Spreadsheet setup complete!".
 *   e. Open your Google Sheet — you should now see three tabs:
 *      Members | Payments | Expenses  with colour-coded headers.
 *
 * STEP 5 — Deploy as a Web App
 *   a. Click Deploy (top-right) → "New deployment".
 *   b. Click the gear ⚙ icon next to "Type" → choose "Web app".
 *   c. Set:
 *        Description    : any label, e.g. "v1"
 *        Execute as     : Me  (your Google account)
 *        Who has access : Anyone          ← IMPORTANT (not "Anyone with Google account")
 *   d. Click "Deploy".
 *   e. Copy the Web App URL that appears (looks like:
 *        https://script.google.com/macros/s/AKfy.../exec  )
 *
 * STEP 6 — Paste the Web App URL into your website's Settings page.
 *
 * ════════════════════════════════════════════════════════
 *  IMPORTANT NOTES
 * ════════════════════════════════════════════════════════
 *  • Every time you edit this script you MUST create a NEW deployment
 *    (Deploy → New deployment) — editing does NOT update an existing one.
 *  • If requests fail with a 401 / redirect error, re-check "Who has access"
 *    is set to "Anyone" (not "Anyone with Google account").
 *  • The Web App URL ends in /exec — make sure it is not /dev.
 *    The /dev URL requires authentication and will not work from your site.
 * ════════════════════════════════════════════════════════
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SPREADSHEET_ID= '1m-nLSKQ6ONG_IrkqPetANB3iF8697sGpWCnwWtBzWEQ' // ← REPLACE THIS (Step 1c)
const SHEET_MEMBERS  = 'Members';
const SHEET_PAYMENTS = 'Payments';
const SHEET_EXPENSES = 'Expenses';
const SHEET_NOTICES  = 'Notice';
// ─────────────────────────────────────────────────────────────────────────────


// FIX 1: doGet must handle OPTIONS pre-flight AND missing e / e.parameter
function doGet(e) {
  // Handle CORS pre-flight (browser sends OPTIONS before POST from some hosts)
  if (e && e.parameter && e.parameter.method === 'OPTIONS') {
    return buildOutput('');
  }

  try {
    // FIX 2: Guard against missing parameters (direct URL visits, health checks)
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

    if (action === 'fetch') {
      const data = fetchAllData();
      return buildOutput(JSON.stringify(data));
    }

    // Default health-check response
    return buildOutput(JSON.stringify({ status: 'ok', message: 'Future Fund Savings API is running' }));

  } catch (err) {
    return buildOutput(JSON.stringify({ error: err.message, stack: err.stack }));
  }
}


// FIX 3: doPost guards against empty / malformed body
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return buildOutput(JSON.stringify({ error: 'Empty request body' }));
    }

    const payload = JSON.parse(e.postData.contents);

    if (payload.action === 'sync') {
      syncAllData(payload);
      return buildOutput(JSON.stringify({ status: 'ok', synced: true }));
    }

    return buildOutput(JSON.stringify({ error: 'Unknown action: ' + payload.action }));

  } catch (err) {
    return buildOutput(JSON.stringify({ error: err.message }));
  }
}


// FIX 4: Centralised output builder — ensures CORS headers are always set
function buildOutput(jsonString) {
  return ContentService
    .createTextOutput(jsonString || '')
    .setMimeType(ContentService.MimeType.JSON)
    // addHeader is NOT available in Apps Script — CORS is handled by the
    // "Anyone" access setting in the deployment. Calls below are removed
    // because they throw "addHeader is not a function" in current GAS runtime.
    // (The original script used addHeader which causes a runtime crash.)
}


// ─── DATA LAYER ──────────────────────────────────────────────────────────────

function fetchAllData() {
  const ss = openSheet();
  return {
    members:  sheetToJSON(ss, SHEET_MEMBERS),
    payments: sheetToJSON(ss, SHEET_PAYMENTS),
    expenses: sheetToJSON(ss, SHEET_EXPENSES),
    notices:  sheetToJSON(ss, SHEET_NOTICES),
  };
}

function syncAllData(payload) {
  const ss = openSheet();
  if (payload.members)  writeSheet(ss, SHEET_MEMBERS,  payload.members,  memberHeaders());
  if (payload.payments) writeSheet(ss, SHEET_PAYMENTS, payload.payments, paymentHeaders());
  if (payload.expenses) writeSheet(ss, SHEET_EXPENSES, payload.expenses, expenseHeaders());
  if (payload.notices)  writeSheet(ss, SHEET_NOTICES,  payload.notices,  noticeHeaders());
}


// FIX 5: Validate SPREADSHEET_ID before trying to open — gives a clear error
function openSheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'YOUR_GOOGLE_SHEET_ID_HERE') {
    throw new Error('SPREADSHEET_ID is not set. Open the script, replace YOUR_GOOGLE_SHEET_ID_HERE with your real Sheet ID, then redeploy.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function sheetToJSON(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
    return obj;
  });
}

function writeSheet(ss, name, data, headers) {
  const sheet = getOrCreateSheet(ss, name);
  sheet.clearContents();
  const rows = [headers, ...(data || []).map(obj => headers.map(h => (obj[h] !== undefined ? obj[h] : '')))];
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#0b0f1a')
    .setFontColor('#f0b429')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
}


// ─── HEADERS ─────────────────────────────────────────────────────────────────

function memberHeaders()  { return ['id','name','email','role','position','phone','joinDate','active']; }
function paymentHeaders() { return ['id','memberId','memberName','amount','type','forMonth','forYear','date','note']; }
function expenseHeaders() { return ['id','title','category','amount','date','by','note']; }
function noticeHeaders()  { return ['id','section','title','message','date','by','createdAt','expiresAt']; }


// ─── ONE-TIME SETUP ──────────────────────────────────────────────────────────
// Run this function ONCE from the Apps Script editor (Step 4 above).

function setupSpreadsheet() {
  const ss = openSheet(); // will throw early if ID is not set
  writeSheet(ss, SHEET_MEMBERS,  [], memberHeaders());
  writeSheet(ss, SHEET_PAYMENTS, [], paymentHeaders());
  writeSheet(ss, SHEET_EXPENSES, [], expenseHeaders());
  writeSheet(ss, SHEET_NOTICES,  [], noticeHeaders());
  Logger.log('Spreadsheet setup complete! Four sheets created: Members, Payments, Expenses, Notice.');
}


// ─── QUICK TEST ──────────────────────────────────────────────────────────────
// Run testFetch() from the editor to verify the sheet connection is working.

function testFetch() {
  try {
    const data = fetchAllData();
    Logger.log('Connection OK. Row counts → Members: %s | Payments: %s | Expenses: %s | Notices: %s',
      data.members.length, data.payments.length, data.expenses.length, data.notices.length);
  } catch (err) {
    Logger.log('ERROR: ' + err.message);
  }
}
