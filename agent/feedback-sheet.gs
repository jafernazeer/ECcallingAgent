/**
 * Google Apps Script Web App that appends EC Calling Agent feedback to a sheet.
 *
 * Setup
 *  1. Create a Google Sheet. Note its id from the URL.
 *  2. Extensions > Apps Script, paste this file, set SHEET_ID below.
 *  3. Deploy > New deployment > Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the /exec URL into GOOGLE_SHEETS_WEBHOOK_URL in the server env.
 *
 * "Anyone" is required because the portal server calls this without a Google
 * identity. The URL is the credential, so keep it server-side and rotate the
 * deployment if it ever leaks.
 */

const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
const SHEET_NAME = "Feedback";

const HEADERS = [
  "Submitted At",
  "Score",
  "Reasons",
  "Comment",
  "Caller Name",
  "Company",
  "Location",
  "Phone",
  "Email",
  "Requirement",
  "AI Call Summary",
  "Call ID",
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();

    sheet.appendRow([
      data.submittedAt || new Date().toISOString(),
      data.score || "",
      data.reasons || "",
      data.comment || "",
      data.callerName || "",
      data.callerCompany || "",
      data.callerLocation || "",
      // Leading zeros matter on UAE numbers - force text so Sheets keeps them.
      data.callerPhone ? "'" + data.callerPhone : "",
      data.callerEmail || "",
      data.requirement || "",
      data.callSummary || "",
      data.callId || "",
    ]);

    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

function getSheet_() {
  const book = SpreadsheetApp.openById(SHEET_ID);
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
