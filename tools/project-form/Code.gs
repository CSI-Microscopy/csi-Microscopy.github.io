/**
 * CSI Project Initiation Form: notifications and project status.
 *
 * Paste into the Apps Script editor of the form's responses spreadsheet
 * ("CSI Project Initiation (Responses)": Extensions > Apps Script), then run
 * setup() once. See README.md next to this file.
 *
 * On each form submission:
 *   1. The user and their PI get a confirmation with the next steps.
 *   2. All staff and the unit address get the full answers, a link to the
 *      row in the sheet and the staff's next steps.
 *   3. The row gets Status "New" and a "Notified at" time, so a response is
 *      never announced twice.
 *
 * When staff change a row's Status, the user and PI get an email saying what
 * happens next (see STATUS_EMAILS below). Any other edit sends nothing.
 *
 * Columns are found by their header text, not their position, so the script
 * keeps working if the form gains questions or columns move.
 */

// ── Settings ────────────────────────────────────────────────────────────
const CONFIG = {
  UNIT_NAME: 'CSI Microscopy',
  UNIT_EMAIL: 'core.csi@mail.huji.ac.il',          // Reply-To on every email
  STAFF: [
    'einat.zelinger@mail.huji.ac.il',
    'tally.kossovsky@mail.huji.ac.il',
    'danielw@savion.huji.ac.il',
  ],
  REPLY_WORKING_DAYS: 3,                            // promised in the confirmation
  SITE: 'https://csi-microscopy.github.io/',
  BOOKIT: 'https://bookit-prod.cc.huji.ac.il/Weekly.aspx',
  LOGO: 'https://csi-microscopy.github.io/assets/brand/csi-mark.png',
  SHEET_NAME: 'Form Responses 1',
  STATUS_EMAILS: true,                              // false: the Status column sends nothing
};

// Columns this script adds to the right of the form's columns (setup()).
const COL = {
  STATUS: 'Status',
  OWNER: 'Owner',
  KICKOFF: 'Kick-off date',
  NOTIFIED: 'Notified at',
};
const STATUSES = ['New', 'Kick-off scheduled', 'Kick-off done', 'Trained', 'On hold', 'Closed'];
// Subject of the email each status sends; statuses not listed send nothing.
const STATUS_SUBJECTS = {
  'Kick-off scheduled': 'your kick-off meeting is scheduled',
  'Kick-off done': 'next steps after your kick-off meeting',
  'Trained': 'you can now book the instrument',
  'Closed': 'your project is completed',
};

// Form questions, matched by a distinctive part of the header text.
const Q = {
  email: 'Email Address',
  name: 'Full Name',
  phone: 'Cellphone',
  pi: "Lab's PI:",
  piEmail: "Lab's PI Email",
  meeting: 'first meeting with the PI',
  bookit: 'Bookit',
  sample: 'Type of Sample',
  question: 'research question',
  policyUpload: 'Publication policy - Read, Sign',
};

// ── Setup (run once from the editor) ────────────────────────────────────
function setup() {
  const sheet = getSheet_();
  ensureColumns_(sheet);
  const ss = sheet.getParent();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onProjectSubmit', 'onStatusEdit'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onProjectSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onStatusEdit').forSpreadsheet(ss).onEdit().create();
  // Mark existing responses as already announced, so nothing is sent for them.
  const h = headers_(sheet);
  const last = sheet.getLastRow();
  if (last > 1) {
    const notified = sheet.getRange(2, h[COL.NOTIFIED], last - 1, 1);
    const vals = notified.getValues().map(r => [r[0] || 'before notifications']);
    notified.setValues(vals);
  }
  SpreadsheetApp.getActive().toast('CSI notifications are on: triggers created and status columns added.');
}

// ── Form submission ─────────────────────────────────────────────────────
function onProjectSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getSheet_();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  notifyRow_(sheet, row, { test: false });
}

/** Safe test: re-sends the last response's two emails to you only, marked [TEST]. */
function testLastResponse() {
  const sheet = getSheet_();
  notifyRow_(sheet, sheet.getLastRow(), { test: true });
}

function notifyRow_(sheet, row, opts) {
  ensureColumns_(sheet);
  const h = headers_(sheet);
  if (!opts.test && sheet.getRange(row, h[COL.NOTIFIED]).getValue()) return; // already announced
  const r = readRow_(sheet, row);

  const people = recipientsFor_(r);
  const subjectName = r.name || r.email || 'new request';

  send_(opts, {
    to: people.user,
    cc: people.pis,
    subject: `${CONFIG.UNIT_NAME}: we received your project request`,
    htmlBody: userConfirmationHtml_(r),
  });
  send_(opts, {
    to: CONFIG.STAFF,
    cc: [CONFIG.UNIT_EMAIL],
    subject: `New project request: ${subjectName}${r.pi ? ' (' + r.pi + ')' : ''}${r.sample ? ', ' + r.sample : ''}`,
    htmlBody: staffHtml_(r, rowLink_(sheet, row)),
    replyTo: [people.user].concat(people.pis).filter(Boolean).join(','),
  });

  if (!opts.test) {
    if (!sheet.getRange(row, h[COL.STATUS]).getValue()) sheet.getRange(row, h[COL.STATUS]).setValue('New');
    sheet.getRange(row, h[COL.NOTIFIED]).setValue(new Date());
  }
}

// ── Status changes ──────────────────────────────────────────────────────
function onStatusEdit(e) {
  if (!CONFIG.STATUS_EMAILS || !e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return; // ignore pastes and fills
  const h = headers_(sheet);
  if (e.range.getColumn() !== h[COL.STATUS] || e.range.getRow() < 2) return;
  const status = String(e.value || '').trim();
  if (!status || status === String(e.oldValue || '').trim()) return;
  if (!STATUS_SUBJECTS[status]) return; // "New" and "On hold" send nothing
  const r = readRow_(sheet, e.range.getRow());
  const body = statusHtml_(status, r);
  if (!body) return;
  const people = recipientsFor_(r);
  if (!people.user) return;
  send_({ test: false }, {
    to: people.user,
    cc: people.pis,
    subject: `${CONFIG.UNIT_NAME}: ${STATUS_SUBJECTS[status]}`,
    htmlBody: body,
  });
}

// ── Email content ───────────────────────────────────────────────────────
function userConfirmationHtml_(r) {
  const hasBookit = /already/i.test(r.bookit);
  const online = /online/i.test(r.meeting);
  const policyMissing = !r.policyUpload;
  const steps = [];
  steps.push(hasBookit
    ? `<b>Bookit.</b> You already have a Bookit account. The kick-off meeting, your training and all later sessions are booked there.`
    : `<b>Open a Bookit account</b> now, if you have not yet: <a href="${CONFIG.BOOKIT}">Bookit</a>. The kick-off meeting, your training and all later sessions are booked there.`);
  steps.push(`<b>Kick-off meeting.</b> A staff member will write to you within ${CONFIG.REPLY_WORKING_DAYS} working days to agree a date${online ? ', online as you asked' : ', on-site as you asked'}. You and your PI, or someone on their behalf, attend. Bring a short description of your samples, how many you expect, your timeline, and any questions about mounting the samples.`);
  steps.push(`<b>Do not prepare samples yet.</b> Preparation differs for every instrument, and a sample prepared for one is often useless for another. We agree it at the kick-off.`);
  steps.push(`<b>Training.</b> After the kick-off, staff run your first session on the instrument with you. From then on you book your own time.`);
  const policy = policyMissing
    ? `<p style="padding:10px 12px;background:#FFF4E5;border-radius:8px"><b>Missing:</b> we did not receive the publication policy signed by your PI. No work can start in the unit without it. Please send it to <a href="mailto:${CONFIG.UNIT_EMAIL}">${CONFIG.UNIT_EMAIL}</a>.</p>`
    : '';
  return wrap_(`
    <p>Dear ${esc_(r.name || 'colleague')},</p>
    <p>Thank you. We received your project request${r.pi ? ' for the ' + esc_(r.pi) + ' lab' : ''}. Your PI is copied on this email.</p>
    ${policy}
    <h3 style="margin:18px 0 6px">What happens next</h3>
    <ol style="padding-left:20px">${steps.map(s => `<li style="margin:0 0 8px">${s}</li>`).join('')}</ol>
    <h3 style="margin:18px 0 6px">While you wait</h3>
    <ul style="padding-left:20px">
      <li><a href="${CONFIG.SITE}modalities.html">Choosing a microscope</a>: what each technique can show and what the sample needs.</li>
      <li><a href="${CONFIG.SITE}basics.html">Microscopy basics</a>: resolution, pixel size, exposure and channels in plain language.</li>
      <li>Plan where your data will live. Data on the image analysis server is deleted after at most 60 days, so copy it to your own lab storage.</li>
    </ul>
    <p>Questions? Reply to this email; it goes to the unit.</p>`);
}

function staffHtml_(r, link) {
  const rows = r._all.map(([q, a]) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #E3E8EE;color:#5B6B7B;vertical-align:top;width:38%">${esc_(q)}</td>` +
    `<td dir="auto" style="padding:6px 10px;border-bottom:1px solid #E3E8EE;vertical-align:top;white-space:pre-wrap">${linkify_(esc_(a))}</td></tr>`).join('');
  const policy = r.policyUpload ? 'uploaded' : '<b style="color:#B4441B">missing</b>';
  return wrap_(`
    <p><b>${esc_(r.name || r.email)}</b>${r.pi ? ' (' + esc_(r.pi) + ' lab)' : ''} submitted a project request.
       Sample: ${esc_(r.sample || 'not given')}. First meeting: ${esc_(r.meeting || 'not given')}. Bookit: ${esc_(r.bookit || 'not given')}. Signed policy: ${policy}.</p>
    <h3 style="margin:18px 0 6px">Next steps for staff</h3>
    <ol style="padding-left:20px">
      <li style="margin:0 0 6px">Agree who owns it and put the name in the <b>Owner</b> column: <a href="${link}">open the row</a>.</li>
      <li style="margin:0 0 6px">Reply all within ${CONFIG.REPLY_WORKING_DAYS} working days to agree the kick-off date with the user and PI. Replies to this email go to them.</li>
      <li style="margin:0 0 6px">Fill <b>Kick-off date</b>, then set <b>Status</b> to "Kick-off scheduled". The user and PI get an email with the date automatically; later stages (Kick-off done, Trained, Closed) send one too.</li>
      ${r.policyUpload ? '' : '<li style="margin:0 0 6px">The signed publication policy is missing. The user was asked to send it; no work starts without it.</li>'}
    </ol>
    <h3 style="margin:18px 0 6px">Answers</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>`);
}

function statusHtml_(status, r) {
  const hi = `<p>Dear ${esc_(r.name || 'colleague')},</p>`;
  const kickoff = r.kickoff ? formatDate_(r.kickoff) : '';
  switch (status) {
    case 'Kick-off scheduled':
      return wrap_(`${hi}
        <p>Your kick-off meeting is scheduled${kickoff ? ' for <b>' + esc_(kickoff) + '</b>' : ''}${r.owner ? ' with ' + esc_(r.owner) : ''}. You and your PI, or someone on their behalf, attend.</p>
        <p><b>Before the meeting:</b> make sure you have a <a href="${CONFIG.BOOKIT}">Bookit</a> account, and bring a short description of your samples, how many you expect, your timeline and any mounting questions. Please do not prepare samples yet.</p>`);
    case 'Kick-off done':
      return wrap_(`${hi}
        <p>Thank you for the kick-off meeting. <b>Next:</b> prepare your samples as agreed, and your training session on the instrument will be booked in <a href="${CONFIG.BOOKIT}">Bookit</a>${r.owner ? ' by ' + esc_(r.owner) : ''}.</p>
        <p>The <a href="${CONFIG.SITE}#startup-shutdown-guides">startup and shutdown guides</a> are the written version of what you will learn; have a look before the session.</p>`);
    case 'Trained':
      return wrap_(`${hi}
        <p>You are now trained on the instrument. <b>Next:</b> book your own time in <a href="${CONFIG.BOOKIT}">Bookit</a>; a booking must be approved before it can be used.</p>
        <p>Move your data to the <a href="${CONFIG.SITE}image-analysis-server/">image analysis server</a> after each session and copy it to your own lab storage: server data is deleted after at most 60 days. Help with analysis is part of the service.</p>`);
    case 'Closed':
      return wrap_(`${hi}
        <p>We have marked your project as completed. Thank you for working with the unit.</p>
        <p>When you publish, please follow the publication policy you and your PI signed. To start a new project, fill in the Project Initiation Form again.</p>`);
    default:
      return ''; // New, On hold, or anything else: no email
  }
}

function wrap_(inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1B2733;max-width:640px">
    <p style="margin:0 0 14px"><img src="${CONFIG.LOGO}" alt="CSI" height="40" style="height:40px"></p>
    ${inner}
    <p style="margin-top:22px;color:#5B6B7B;font-size:13px">${CONFIG.UNIT_NAME} · Faculty of Agriculture, Food and Environment · <a href="${CONFIG.SITE}">${CONFIG.SITE.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></p>
  </div>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function send_(opts, msg) {
  const to = [].concat(msg.to || []).filter(Boolean);
  const cc = [].concat(msg.cc || []).filter(Boolean);
  if (!to.length) return;
  if (opts.test) {
    const me = Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({
      to: me,
      subject: '[TEST] ' + msg.subject,
      htmlBody: `<p style="font:13px Arial;color:#B4441B">Test: would go to ${esc_(to.join(', '))}${cc.length ? '; cc ' + esc_(cc.join(', ')) : ''}.</p>` + msg.htmlBody,
      name: CONFIG.UNIT_NAME,
    });
    return;
  }
  MailApp.sendEmail({
    to: to.join(','),
    cc: cc.join(','),
    subject: msg.subject,
    htmlBody: msg.htmlBody,
    name: CONFIG.UNIT_NAME,
    replyTo: msg.replyTo || CONFIG.UNIT_EMAIL,
  });
}

function recipientsFor_(r) {
  const user = (r.email || '').trim().toLowerCase();
  const pis = extractEmails_(r.piEmail).filter(x => x !== user);
  return { user, pis };
}

/** Every email address in a free-text answer ("a@x + b@y", "a@x / b@y"). */
function extractEmails_(text) {
  const found = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map(x => x.toLowerCase()))];
}

function readRow_(sheet, row) {
  const lastCol = sheet.getLastColumn();
  const head = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const vals = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const find = key => {
    const i = head.findIndex(t => t.toLowerCase().includes(key.toLowerCase()));
    return i < 0 ? '' : vals[i];
  };
  const r = {};
  Object.keys(Q).forEach(k => { r[k] = String(find(Q[k]) || '').trim(); });
  r.owner = String(find(COL.OWNER) || '').trim();
  r.kickoff = find(COL.KICKOFF);
  const own = new Set(Object.values(COL));
  r._all = head.map((t, i) => [t.trim(), vals[i]])
    .filter(([t, v]) => t && !own.has(t) && t !== 'Timestamp' && String(v).trim() !== '')
    .map(([t, v]) => [t, isDate_(v) ? formatDate_(v) : String(v)]);
  return r;
}

function headers_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  head.forEach((t, i) => { map[String(t).trim()] = i + 1; });
  return map;
}

function ensureColumns_(sheet) {
  const h = headers_(sheet);
  let next = sheet.getLastColumn() + 1;
  Object.values(COL).forEach(name => {
    if (h[name]) return;
    sheet.getRange(1, next).setValue(name).setFontWeight('bold');
    next++;
  });
  const h2 = headers_(sheet);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, h2[COL.STATUS], Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  const dateRule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
  sheet.getRange(2, h2[COL.KICKOFF], Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(dateRule);
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`No sheet named "${CONFIG.SHEET_NAME}". Set CONFIG.SHEET_NAME.`);
  return sheet;
}

function rowLink_(sheet, row) {
  return `${sheet.getParent().getUrl()}#gid=${sheet.getSheetId()}&range=A${row}`;
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v);
}

function formatDate_(d) {
  if (!isDate_(d)) return String(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'EEE d MMM yyyy, HH:mm');
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Turns https:// links in already-escaped text into anchors (uploaded file links). */
function linkify_(escaped) {
  return escaped.replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`);
}
