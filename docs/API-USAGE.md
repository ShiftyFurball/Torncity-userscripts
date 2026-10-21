# API usage and privacy

This disclosure applies to the staff payment tracker beta. It is displayed beside both API-key entry fields in the script. Reviewed against [Torn's official API guidelines](https://www.torn.com/api.html) and [scripting rules](https://www.torn.com/rules.php) on 21 October 2026. This is a description of behavior, not an endorsement or approval by Torn staff.

| Category | Tracker behavior |
| --- | --- |
| Purpose | Read company employees and incoming cash/item logs to calculate staff tax payments, arrears, credit and user-requested reminder drafts. |
| Data storage | Only locally in browser localStorage on the Torn origin. Settings, cached receipts, item catalog, write-offs and reminder drafts remain until cleared. Drafts stop being accepted after 30 minutes; their stored text is not automatically deleted. Uninstalling the userscript does not erase browser storage. |
| Data sharing | No developer-server uploads, analytics or automatic third-party data sharing. API requests go directly to api.torn.com over HTTPS. At the user's request, a reminder is placed in Torn's message composer and can be copied to the clipboard. Sending the message is a separate manual action. |
| Key storage and sharing | The key is stored locally, not encrypted. It is sent only to Torn's API and excluded from the script's settings backup. The receipt-cache identifier contains a SHA-256 fingerprint, not the key itself. Browser localStorage is shared with other scripts on the same Torn origin; it is not a protected userscript-only vault. |
| Required access | Full Access, or a custom key permitting company/employees, relevant incoming cash/item user/log types, torn/items and torn/logtypes. The script does not require the Torn account password. |

## Requests and errors

All API requests, including retries, item lookups and employee lookups, pass through one scheduler. This script allows immediate bursts of up to 10 requests per rolling 10 seconds, with a separate limit of 60 requests per rolling minute. There is no artificial delay between requests while both budgets have room. Scheduling information is shared in localStorage and coordinated through Web Locks where supported. Without shared browser storage/locks it falls back to local tab pacing. Other scripts, devices and browsers still consume the same account-wide Torn quota; this scheduler cannot reserve their quota.

HTTP 429 and Torn errors 5/8 pause further requests for at least 60 seconds, using a longer numeric Retry-After value where supplied. The active refresh stops; it does not rapidly retry a rate-limit or temporary IP block. Some transient service/network failures have bounded retries, with each attempt passing through the scheduler.

Torn authentication/key errors 1, 2, 10, 13 and 18 stop the request immediately and remove that key from the active settings and matching saved profiles. Other cooperating tabs receive the settings change. If browser storage cannot be updated, the current tab still disables the in-memory key. A valid, enabled key must be saved before requests can resume. Insufficient-permission error 16 stops the request and explains the necessary log access.

Cached completed history and overlapping incremental refreshes reduce repeated log downloads. Requests filter incoming receipt types and fetch only the selected period and the arrears lookback required by its allocation policy. Request-limit and disclosure wording should be reviewed if Torn changes its official guidelines.

The last completed staff/payment view is also cached locally. Opening the tracker within two minutes reuses it without API requests. Older cached results display while a fresh check runs and remain unconfirmed until that check finishes. Manual Refresh bypasses the two-minute freshness window. Period, rate, item, roster-mode or exclusion changes invalidate the cached view. Employee lists are included in the local snapshot; dates-in-company are adjusted when the snapshot crosses a UTC day. Log-type metadata is cached for 24 hours.

## Greasy Fork description text

The tracker uses your API key to read company employees and incoming cash/item logs for staff tax calculations. Your key, cached receipts, settings, write-offs and reminder drafts stay in this browser; they are not uploaded to the developer or analytics services. The key is stored locally without encryption, sent only to Torn's API over HTTPS, and excluded from settings backups. Other scripts on the same Torn origin can access localStorage. Data remains until browser storage is cleared; uninstalling the script does not clear it. Reminder drafts stop being accepted after 30 minutes. Reminders open in Torn's composer for you to review and send manually. Requires Full Access or a custom key with company/employees, the required user/log types, torn/items and torn/logtypes. Requests are paced, and rate-limit or invalid-key errors stop further use until the cooldown ends or an enabled key is saved.
