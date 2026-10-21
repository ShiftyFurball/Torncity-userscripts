# Torncity Userscripts

Small collection repo for Torn userscripts.

## Eight-week tracker beta

This branch contains a simpler payment checklist. It has not been released to existing Greasy Fork users.

- Eight weekly status cells per employee, with actual receipt dates/amounts on click.
- Cash and the configured item (Xanax by default) count together. For a $10m / 7 Xanax rate, $5m plus 4 Xanax covers one week with a small credit.
- Payments cover oldest unpaid weeks first; the eight-column display does not erase older debt. Tracking starts at the saved start year/week and each employee's join week when available.
- Current-week shortfalls are labelled due this week. Outstanding totals include the current week.
- Incomplete scans and request failures show unconfirmed balances instead of declaring staff unpaid.
- Daily controls are Refresh, Settings and an outstanding-only filter. Settings expose the API key, cash rate, item rate and item name; history/backup controls are collapsed.

[Install the beta from GitHub](https://raw.githubusercontent.com/ShiftyFurball/Torncity-userscripts/codex/simple-eight-week-tracker/torn-tax-tracker.user.js)

Before trying it, export the installed script/settings using your userscript manager. This beta uses the same script name and namespace and is intended to replace the old version in your manager. Do not enable both copies. The beta uses the existing active profile's storage; it does not erase old settings. Its updates point to this beta branch.

This is intentionally a new calculation policy: saved per-member rates, requirement-reset dates, excluded weeks and carrybacks are preserved in storage but do not affect the simplified calculation. Saved individual payment exclusions still apply. If you depend on those advanced adjustments, retain the old version until a migration is agreed. Changing the default rates recalculates the tracked period; historical rates are not yet recorded separately.

History is fetched back to the saved tracking start on refresh, subject to the page limit. All older debt can only be confirmed when that scan completes. Only recognized incoming receipt/deposit logs are counted; unrecognized log formats require an anonymized example to support them. Live Torn API behavior still needs trial verification.

For local verification:

```bash
node --check torn-tax-tracker.user.js
node tools/payment-ledger.test.cjs
node tools/preview.cjs
```

The preview at `http://127.0.0.1:8766` uses simulated staff and payments, never a real API key. The settings backup button exports the active profile's settings without its API key.

## Current scripts

- `torn-tax-tracker.user.js` — company tax tracker panel for Torn (overview, payments, employee management, reminders).
  - Supports per-company profile IDs so you can keep separate tracking data if you move companies or manage multiple companies.

## Repository layout

- Root userscript files for direct install/update compatibility.
- Future supporting docs should go in `docs/`.
- Future helper tooling/scripts should go in `tools/`.

## Development notes

- Keep userscript metadata (`@version`, `@downloadURL`, `@updateURL`) updated when making user-facing changes.
- Validate syntax before commit:

```bash
node --check torn-tax-tracker.user.js
```
