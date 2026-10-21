# Torncity Userscripts

Torn staff payment tracker, version 8.0.0.

See [API usage and privacy](docs/API-USAGE.md) for the disclosure shown at both key-entry fields, required access, local storage/sharing details, request pacing, rate-limit handling and invalid-key removal. The document also provides ready-to-paste Greasy Fork disclosure text.

[Install the tracker](https://greasyfork.org/en/scripts/552053-torn-lingerie-store-tax-tracker)

## Payment periods

Settings → Calculate from Tax Period contains a start date and weeks to display (1–52). By default, Always show the latest period keeps the most recent six weeks visible. Selecting a date switches to a fixed period. Dates use their Sunday-start UTC week; future weeks are not charged. Staff joining later are charged from their join week.

The table, last-payment date and outstanding amount cover only the selected period. Cash and the configured item (Xanax by default) combine at your configured weekly rates. Changing rates recalculates the requested history; historical rates are not stored separately.

Ordinary payments count in the week received. A payment worth more than one week, or receipts exceeding that week's requirement, is allocated to oldest unpaid weeks first. The tracker checks the preceding period (six previous weeks for a six-week view). If an individual payment in the selected period covers more weeks than that, its employee's lookback extends to that equivalent number of weeks. Other staff do not acquire a longer lookback because someone else made a large payment. Only value remaining after the checked arrears and selected period are covered becomes future credit.

Example at $7.5m/week: a $45m payment first checks the previous six weeks. If those were unpaid, it clears them rather than prepaying the displayed period. If they were already paid, it can cover the selected period. A $90m payment checks twelve previous weeks. Ordinary weekly payments remain attached to their actual receipt week.

This is an allocation policy, not proof of what the sender intended. Arrears outside the checked lookback are not inferred. Click a week for the actual receipt dates and amounts. Incomplete scans show unconfirmed balances instead of declaring unpaid staff.

## Reminders and write-offs

Click an employee name with a confirmed outstanding balance to open Torn's message composer for that player. The script prepares a friendly subject and reminder showing the selected period's cash/item amount after write-offs. It never submits a message. Drafts are stored locally under a random token, expire after 30 minutes, and are accepted only on the matching recipient's compose route. If Torn's editor can be identified and is empty, the script fills it; existing text is preserved. A preview/Copy reminder fallback is available if the editor cannot be filled. Live Torn composer compatibility still needs checking.

Use **Write off / adjustments** beside the balance to enter a cash amount, choose the first applicable week, and add a note. **Use one free week** enters the configured weekly cash rate. The amount is distributed over unpaid obligations from the chosen week onward within the selected period; amounts above that outstanding tax are rejected. Adjustments are stored as week-equivalent fractions at the rate when entered, so a free week remains a free week after a rate change. They reduce requirements instead of inventing receipts. Weeks show **Written off** or **Paid · adjusted**, and saved adjustments have an **Undo** control. They persist in the active profile and are included in the settings backup. Actual payment history remains separate.

## Local cache and API access

Receipts are stored only in browser localStorage, isolated by active profile and a SHA-256 fingerprint of the API key. The receipt cache does not include the API key itself. Completed history is reused; refresh scans from a five-minute overlap before the last successful checkpoint and deduplicates by log ID. Choosing an earlier period fetches the missing earlier history. Partial scans never establish complete history. Browser storage can be cleared by the browser; if cache writes fail the tracker continues with live results.

The key remains in the existing local settings and is sent only to Torn's API. Cash logs require Full Access or a custom key permitting the relevant cash/item logs, employees, items and torn/logtypes. The per-receipt-type page limit controls the maximum batches fetched, not the calculation length. Each page contains up to 100 logs. Raw cached receipt data is reparsed when rates, items or exclusions change.

## Trying the beta

Back up your existing userscript/settings before trying it. It uses the original name, namespace and active profile storage. Keep only one version enabled. Previous saved settings remain, but legacy per-member requirements, requirement resets, week exclusions and carrybacks do not affect this simplified calculation. Individual payment exclusions still apply. Releases sync from main to Greasy Fork; installed release updates come from Greasy Fork.

The settings backup exports the active settings without its API key. It does not export the receipt cache.

## Validation

```bash
node --check torn-tax-tracker.user.js
node tools/payment-ledger.test.cjs
node tools/log-pagination.test.cjs
node tools/period-cache.test.cjs
node tools/api-usage.test.cjs
node tools/preview.cjs
```

The preview at http://127.0.0.1:8766 uses a mocked Torn API and a fake key. Tests cover mixed payments, exclusions, historical periods, bulk arrears versus future credit, per-employee extended lookback, joins, timestamp pagination, cache reuse, missing coverage, deduplication and API-key isolation. Live Torn data still needs trial verification.

MIT license; see LICENSE.
