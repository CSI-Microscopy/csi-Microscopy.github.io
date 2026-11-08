# Project Initiation Form: notifications

`Code.gs` is a Google Apps Script for the responses spreadsheet of the
[Project Initiation Form](https://forms.gle/igPJLiemJrT7ZCL56)
("CSI Project Initiation (Responses)"). It keeps the form exactly as it is,
with its sign-in, its policy upload and its sheet, and adds emails.

## What it sends

**On every new response**

| Email | To | Content |
|---|---|---|
| Confirmation | The user, with every address in "Lab's PI Email" in cc | Receipt, then the next steps: Bookit account, the kick-off meeting with the PI (within `REPLY_WORKING_DAYS`), no sample preparation yet, training. Links to "Choosing a microscope" and "Microscopy basics". Warns if the signed policy was not uploaded. |
| New request | All staff, with the unit address in cc | A one-line summary, every answer, a link to the row, and the staff's next steps. Reply-all goes to the user and PI. |

Replies to the confirmation go to `core.csi@mail.huji.ac.il`.

**When staff change a row's Status**

The script adds four columns to the right of the form's columns: **Status**
(a dropdown), **Owner**, **Kick-off date** and **Notified at**. New responses
get Status "New".

| Status | Email to the user and PI |
|---|---|
| New | none |
| Kick-off scheduled | The date and owner, from the Kick-off date and Owner columns. What to bring, and a reminder not to prepare samples yet. Fill the date before setting the status. |
| Kick-off done | Prepare samples as agreed; training will be booked in Bookit; link to the startup guides. |
| Trained | Book your own time; move and back up data (60-day server rule). |
| On hold | none |
| Closed | Thanks; follow the signed publication policy when publishing. |

Only a change to a single Status cell sends an email. Re-selecting the same
status, pasting or filling several cells, and edits to other columns send
nothing.

## Setup (once, about 5 minutes)

1. Open the responses spreadsheet, then **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` in the editor with this folder's `Code.gs`, then save.
3. Check the settings at the top: staff addresses, `REPLY_WORKING_DAYS` (3 is a placeholder), and `SHEET_NAME`.
4. Choose **setup** in the function menu and click **Run**. Google asks for permission to edit the sheet and send email as you; allow it.
   Setup adds the four columns, marks existing responses as already announced (nothing is sent for them), and creates the two triggers.
5. Choose **testLastResponse** and **Run**. You alone receive both emails for the latest response, marked [TEST], with the addresses they would have gone to.
6. Submit a test response through the form, or wait for the next real one.

## Good to know

- **Sender.** Emails are sent from the Google account that ran `setup`, with "CSI Microscopy" as the sender name. The status emails also come from that account, whoever changes the cell.
- **Who can trigger status emails.** Anyone with edit access to the sheet.
- **Duplicates.** A response is announced once. The time goes into Notified at, and the script skips any row where it is already filled.
- **Columns.** The script finds columns by their header text, so new form questions or moved columns do not break it. Do not rename the four columns it adds.
- **Turning it off.** Set `STATUS_EMAILS: false` to stop the status emails only. To stop everything, delete the two triggers (clock icon in the editor).
- **Limits.** [Unverified] Google Workspace accounts can send about 1,500 emails a day from scripts. Each response sends two emails, plus one per status change.
- **Testing without Google.** The script's logic was run under Node with stand-ins for Google's services, against the real column headers. That covered recipients, several PI addresses, Hebrew answers, escaping of HTML in answers, the missing-policy warning, the duplicate guard, every status and test mode. It has not yet run inside Google Apps Script itself; step 5 is that check.
