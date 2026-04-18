# Torncity Userscripts

Small collection repo for Torn userscripts.

## Current scripts

- `torn-tax-tracker.user.js` — company tax tracker panel for Torn (overview, payments, employee management, reminders).

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
