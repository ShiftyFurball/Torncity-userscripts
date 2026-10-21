Track staff company tax paid in cash, Xanax or another configured item.

### Features

- Clear weekly Paid, Part paid and Unpaid statuses.
- Shows the latest six weeks by default, with an adjustable start date and 1–52 weeks displayed.
- Cash and items combine using your configured weekly rates.
- Click a week for actual receipt dates and amounts.
- Opens immediately from the last completed results. Reopening within two minutes makes no automatic API requests; older cached results appear while new receipts are checked. **Refresh** checks immediately.
- Click an employee's name to prepare a friendly payment reminder.
- Small **⋯** controls beside names provide write-offs and free-week adjustments, with Undo.

### Payment calculations

Ordinary payments count in the week received. Bulk payments and excess above a week's requirement clear older shortfalls first.

For a six-week view, the tracker checks the preceding six weeks. If an individual payment in the selected period covers more weeks, that employee's lookback extends accordingly. Only the remaining value becomes future credit. This is an allocation policy, not confirmation of the sender's intentions; arrears outside the checked lookback are not inferred.

Balances and last-payment dates cover the selected period. Incomplete history is marked unconfirmed. Changing rates recalculates the requested history; separate historical rates are not recorded.

### Setup

1. Install with Tampermonkey and reload Torn.
2. Click **Tax**, enter your API key and open **Settings**.
3. Set the weekly cash amount, item quantity and item name.
4. Under **Calculate from Tax Period**, choose a date or leave **Always show the latest period** enabled.

Weeks run Sunday–Saturday in UTC. A chosen date uses its Sunday-start week. Employees joining later are charged from their join week.

### Reminders and write-offs

Reminders open in Torn's composer for you to review and send manually. Existing drafts are preserved; **Copy reminder** is available if prefilling fails.

Write-offs reduce specific weekly obligations without recording fake payments. Enter a cash amount or choose **Use one free week**, select the first applicable week and add a note. Adjustments are saved as week-equivalent fractions at the rate when entered, and can be undone. Amounts above the selected unpaid tax are rejected.

### API usage and privacy

| Category | Details |
| --- | --- |
| Purpose | Read company employees and incoming cash/item logs to calculate staff tax payments and user-requested reminders. |
| Storage | Key, settings, cached receipts, write-offs and drafts stay in browser localStorage until cleared. Uninstalling the script does not erase them. Drafts stop being accepted after 30 minutes; stored text is not automatically deleted. |
| Sharing | No developer uploads, analytics or automatic third-party sharing. API requests go directly to Torn. At your request, reminder text is placed in Torn's composer for manual sending, or copied to your clipboard. |
| Key security | Stored locally without encryption; sent only to Torn's API over HTTPS and excluded from settings backups. Other scripts on the same Torn origin can access localStorage. |
| Access | Full Access, or a custom key permitting company/employees, relevant incoming user/log types, torn/items and torn/logtypes. No Torn account password is required. |

Requests allow short bursts within budgets of 10 per 10 seconds and 60 per minute across cooperating tabs. Other tools and browsers share Torn's account quota. Rate-limit responses trigger a cooldown; invalid or disabled keys are removed from use.

[Torn API guidelines](https://www.torn.com/api.html) · [Full API-use disclosure](https://github.com/ShiftyFurball/Torncity-userscripts/blob/main/docs/API-USAGE.md) · [Source code](https://github.com/ShiftyFurball/Torncity-userscripts)

### Updating from version 7

Back up your settings first and keep only one copy of the script enabled. Version 8 uses a simplified calculation policy. Legacy per-member requirements, resets, week exclusions and carrybacks remain saved but are not applied in this view. Individual payment exclusions remain respected.

License: MIT.
