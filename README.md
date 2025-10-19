Website Checker (Google Apps Script)
===================================

A lightweight website monitoring script that logs checks to a Google Sheet, surfaces a live Dashboard, and emails you when any URL fails.

The project is a single Google Apps Script (`code.js`) that you can attach to a spreadsheet. It periodically fetches one or more URLs, records status/latency/metadata, and maintains a simple operational dashboard.

Overview
--------

- Checks one or more URLs on a schedule (time‑based trigger)
- Follows redirects and records HTTP status and response time
- Extracts page title and meta description (for quick sanity checks)
- Records response payload size and resolves DNS A/AAAA via Google DoH
- Writes results to a `Checks` sheet with stable headers
- Builds a `Dashboard` sheet with KPIs, per‑URL stats, and a failure feed
- Sends email alerts when a check fails (non‑2xx/3xx or thrown error)

Sheets Created
--------------

- `Checks` — Append‑only log with these columns:
  - A `Timestamp` (local tz), B `URL`, C `OK` (TRUE/FALSE), D `Status` (code),
    E `Final URL`, F `Response Time (ms)`, G `Payload (bytes)`,
    H `Title`, I `Meta Description`, J `Keyword`, K `Keyword Present`,
    L `DNS A`, M `DNS AAAA`, N `SSL Days Remaining` (placeholder), O `Error`.
- `Config` — Key/value config (see Configuration).
- `Dashboard` — Summary KPIs and per‑URL performance table with sparklines.

Quick Start
-----------

1) Create a new Apps Script project (or open the Script Editor from a Sheet).
2) Paste the contents of `code.js` into the project (File → New → Script file → replace).
3) Run `initialize()` once. This creates the spreadsheet, tabs, headers, and dashboard.
4) Open the created spreadsheet (URL is logged) and confirm tabs exist.
5) Run `runChecks()` to append a test set of rows.
6) Set a time‑based trigger (Triggers → Add Trigger):
   - Function: `runChecks`
   - Event source: Time‑driven
   - Type: Hour timer (for example, every 1 hour)

On first run, Apps Script will prompt for permissions (Spreadsheet, URL fetch, email).

Configuration
-------------

Open the `Config` tab and edit values in column B:

- `PAGES` — Comma‑separated list. Each item can be a full URL or a path relative to `SITE_BASE` (default `http://www.travelpets.com`). Examples:
  - `/` or `/status` or `http://example.com/health`.
- `KEYWORD` — Optional keyword to search for in page HTML (sets `Keyword Present`).
- `EMAILS` — Comma‑separated list of addresses to notify on failures.

The script persists the Spreadsheet ID in Script Properties so it can reopen the same sheet on subsequent runs.

Public Functions
----------------

- `initialize()` — One‑time setup. Creates sheets, headers, conditional formatting, default config, and the Dashboard.
- `runChecks()` — Performs checks for configured pages, appends rows to `Checks`, sends email for failures, and refreshes the Dashboard.
- `testSingleUrl()` — Fetches a single URL and logs the result to the console for quick manual testing.

Dashboard
---------

- KPIs (last 24h): total checks, failures, uptime, and average response time.
- Per‑URL table: last status, last OK, average and 95th percentile response times, and a sparkline of the most recent samples.
- Recent failures (last 20): timestamp, URL, status, and error message.

Notes about formulas:
- The Dashboard formulas coerce URLs to text using `TO_TEXT` to avoid issues when `Checks!B` contains hyperlinks.
- A hidden helper column holds the latest row index for each URL to reliably pull the most recent values.

Email Alerts
------------

When any check returns non‑OK (`ok !== true`) the script emails each address from `Config!B:B` (or your account email if empty). The message contains timestamp, URL, status, and the error (if present), plus a link to the spreadsheet.

Permissions & Quotas
--------------------

The script needs:
- Spreadsheet access (`SpreadsheetApp`)
- URL fetch (`UrlFetchApp`)
- Email send (`MailApp`)
- Properties (`PropertiesService`)

Apps Script applies daily quotas. If you scale checks significantly, consider spacing cron intervals or limiting URLs.

Troubleshooting
---------------

- Dashboard cells stay blank:
  - Ensure `Checks` has at least one data row for each URL.
  - Make sure `Dashboard!A13:A` contains exactly the URLs found in `Checks!B:B`. The sheet auto‑generates this list; avoid manual edits.
  - If your URL cells are hyperlinks, the formulas already coerce to text, but if you copy/paste, extra spaces can still break matches. Clean with TRIM if needed.
  - Force a recalculation by re‑running `runChecks()` or momentarily editing a Dashboard formula cell.
- No emails sent:
  - Confirm `EMAILS` contains valid addresses, or leave empty to send to your own account.
  - Check the `Error` column in `Checks` for clues.
- Timezone:
  - The sheet uses the script timezone (`initialize()` sets it). Adjust in Script Settings if desired.

Extending
---------

- SSL Days Remaining: Currently a placeholder for HTTPS URLs; you can add a certificate lookup to populate column N.
- Extra health checks: Parse additional HTML signals or API responses.
- Webhooks: In addition to email, post failures to chat or incident tools.

Files
-----

- `code.js` — Main Apps Script source.
- `README.md` — This guide.

---
If you want, I can add a `rebuildDashboard()` utility that refreshes formulas without clearing any custom formatting or notes on the Dashboard tab.

## License

MIT

---

## Author

**Erick Perales** — IT Architect, Cloud Migration Specialist  
<https://github.com/peralese>
