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
- Builds a `Dashboard` sheet with KPIs and a failure feed
- Sends email alerts when a check fails (non‑2xx/3xx or thrown error)
- Enforces data retention: keeps only the last N days (default 7)

Sheets Created
--------------

- `Checks` — Append‑only log with these columns:
  - A `Timestamp` (local tz), B `URL`, C `OK` (TRUE/FALSE), D `Status` (code),
    E `Final URL`, F `Response Time (ms)`, G `Payload (bytes)`,
    H `Title`, I `Meta Description`, J `Keyword`, K `Keyword Present`,
    L `DNS A`, M `DNS AAAA`, N `SSL Days Remaining` (placeholder), O `Error`.
- `Config` — Key/value config (see Configuration).
- `Dashboard` - Summary KPIs plus a "Recent Failures" table.

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
- `RETENTION_DAYS` — Number of days to keep in `Checks`. Older rows are deleted automatically after each run. Default: `7`.

The script persists the Spreadsheet ID in Script Properties so it can reopen the same sheet on subsequent runs.

Public Functions
----------------

- `initialize()` — One‑time setup. Creates sheets, headers, conditional formatting, default config, and the Dashboard.
- `runChecks()` — Performs checks for configured pages, appends rows to `Checks`, sends email for failures, and refreshes the Dashboard.
  Also prunes rows older than `RETENTION_DAYS` from the `Checks` sheet.
- `testSingleUrl()` — Fetches a single URL and logs the result to the console for quick manual testing.
- `cleanupOldData()` — Manual cleanup function. Immediately removes all data older than `RETENTION_DAYS` from the `Checks` sheet. Useful for one-time cleanup of accumulated historical data.

Dashboard
---------

- KPIs (last 24h): total checks, failures, uptime, and average response time.
- Recent failures (last 20): timestamp, URL, status, and error message. The table lives under the KPIs on the left and shows "No failures" when none are present.

Notes
- The dashboard is rebuilt on each run via `ensureDashboard_()`.

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

- Dashboard not updating:
  - Run `runChecks()` (or `initialize()`) to rebuild the sheet.
  - If KPIs look stale, wait a few seconds for formulas to calculate.
- No emails sent:
  - Confirm `EMAILS` contains valid addresses, or leave empty to send to your own account.
  - Check the `Error` column in `Checks` for clues.
- Timezone:
  - The sheet uses the script timezone (`initialize()` sets it). Adjust in Script Settings if desired.

Extending
---------

- Archival: Move old rows to an `Archive` sheet before deleting to keep a long-running history without slowing the `Checks` tab.
- Rollups: Write one row per day with totals, failures, uptime, average and p95 response time for long-term trend charts.
- SSL expiry: Populate column N with days remaining for HTTPS endpoints.
- Alerting: Rate-limit alerts, require X consecutive failures before paging, or send to Slack/webhooks in addition to email.
- Extra checks: JSON/API assertions, keyword must/must-not match, HEAD vs GET.

Roadmap: AWS Lambda Migration
------------------------------

For more frequent checks, better scalability, and resume-building experience, consider migrating to AWS Lambda:

### Architecture Overview

```
CloudWatch Events (cron) → Lambda Function → Check URLs
                              ↓
                         DynamoDB (results)
                              ↓
                         SNS Topic → Email/SMS
                              ↓
                         CloudWatch Dashboard
```

### Benefits

- **Faster checks**: 1-15 minute intervals (vs. hourly)
- **Cost-effective**: Pay-per-use (~$1-5/month for typical usage)
- **Scalable**: Handle hundreds of URLs without performance degradation
- **Better alerting**: SNS integration for email, SMS, Slack, PagerDuty
- **Professional monitoring**: CloudWatch metrics and dashboards
- **Resume skill**: AWS Lambda, DynamoDB, CloudWatch, Infrastructure as Code

### Implementation Steps

1. **Lambda Function** (Python or Node.js)
   - Port `checkUrl_()` logic to Lambda handler
   - Use `requests` (Python) or `axios` (Node.js) for HTTP checks
   - Add retry logic with exponential backoff (already implemented in current version)
   - Store results in DynamoDB

2. **DynamoDB Table**
   - Partition key: `url` (string)
   - Sort key: `timestamp` (number, Unix epoch)
   - Attributes: status, responseTime, ok, error, title, etc.
   - TTL: Auto-delete records older than retention period

3. **CloudWatch Events**
   - Cron expression: `rate(15 minutes)` or `cron(0/15 * * * ? *)`
   - Trigger Lambda on schedule

4. **SNS Topic**
   - Create topic for alerts
   - Subscribe email addresses
   - Lambda publishes to SNS on failures

5. **CloudWatch Dashboard**
   - Uptime percentage (last 24h, 7d, 30d)
   - Response time metrics (avg, p95, p99)
   - Failure count and rate
   - Alarms for consecutive failures

6. **Infrastructure as Code** (Optional but recommended)
   - Use AWS SAM, Terraform, or CDK
   - Version control infrastructure
   - Easy deployment and rollback

### Migration Path

**Phase 1: Parallel Run** (1-2 weeks)
- Deploy Lambda alongside existing Google Apps Script
- Compare results for accuracy
- Tune retry logic and thresholds

**Phase 2: Gradual Cutover**
- Reduce Google Apps Script frequency to 2-4 hours
- Use Lambda as primary monitor
- Keep Google Sheets for historical analysis

**Phase 3: Full Migration** (Optional)
- Disable Google Apps Script
- Export historical data to S3
- Use CloudWatch/Grafana for dashboards

### Estimated Costs

- **Lambda**: ~$0.20/month (1M requests free tier, then $0.20 per 1M)
- **DynamoDB**: ~$0.25/month (25GB free tier, on-demand pricing)
- **CloudWatch**: ~$0.50/month (basic metrics free, custom metrics $0.30 each)
- **SNS**: ~$0.50/month (1,000 emails free, then $2 per 100k)
- **Total**: ~$1-2/month (well within free tier for first year)

### Learning Resources

- [AWS Lambda Getting Started](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html)
- [Building a Serverless Website Monitor](https://aws.amazon.com/blogs/compute/building-a-serverless-website-monitor/)
- [AWS SAM for Serverless Applications](https://aws.amazon.com/serverless/sam/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)

### Sample Lambda Function (Python)

```python
import json
import boto3
import requests
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')
table = dynamodb.Table('website-checks')

def lambda_handler(event, context):
    urls = event.get('urls', [])
    failures = []
    
    for url in urls:
        result = check_url(url)
        
        # Store in DynamoDB
        table.put_item(Item={
            'url': url,
            'timestamp': int(datetime.now().timestamp()),
            'status': result['status'],
            'ok': result['ok'],
            'responseTime': result['responseTime'],
            'error': result.get('error', '')
        })
        
        # Collect failures
        if not result['ok']:
            failures.append(result)
    
    # Send alert if failures
    if failures:
        sns.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789:website-alerts',
            Subject=f'Website Check: {len(failures)} failure(s)',
            Message=json.dumps(failures, indent=2)
        )
    
    return {'statusCode': 200, 'body': json.dumps('Checks complete')}

def check_url(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            start = datetime.now()
            response = requests.get(url, timeout=10, allow_redirects=True)
            elapsed = (datetime.now() - start).total_seconds() * 1000
            
            return {
                'url': url,
                'status': response.status_code,
                'ok': 200 <= response.status_code < 400,
                'responseTime': int(elapsed)
            }
        except Exception as e:
            if attempt == max_retries - 1:
                return {
                    'url': url,
                    'status': None,
                    'ok': False,
                    'responseTime': None,
                    'error': str(e)
                }
            time.sleep(2 ** attempt)  # Exponential backoff
```

This roadmap provides a clear path to migrate when you're ready to level up your monitoring infrastructure and add valuable AWS experience to your resume.

SMS Alerts
----------

Two practical options to receive SMS when failures occur:

- Email-to-SMS gateway (quickest): Add your carrier address to `Config → EMAILS`.
  - AT&T: `1234567890@txt.att.net`
  - Verizon SMS: `1234567890@vtext.com` (160 chars)
  - Verizon MMS: `1234567890@vzwpix.com` (longer messages/links)
  - T‑Mobile: `1234567890@tmomail.net`
  - Google Fi: `1234567890@msg.fi.google.com`
  Notes: Messages are plain text and may be truncated; carriers may throttle bulk sends.

- Twilio (programmable SMS): Store `TWILIO_SID`, `TWILIO_TOKEN`, and `TWILIO_FROM` in Script Properties and add a helper that posts to Twilio’s REST API. Call it alongside the existing email alert when failures occur.
  - Minimal helper (pseudo): `sendSmsTwilio_(to, body)` → `UrlFetchApp.fetch('https://api.twilio.com/.../Messages.json', { method: 'post', headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid+':'+token) }, payload: { To: to, From: from, Body: body } })`.
  - Keep bodies short for readability on SMS.

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
