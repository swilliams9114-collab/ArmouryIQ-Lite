# Changelog

## 0.1.7

- Added API-versus-local-storage synchronization diagnostics.
- Diagnostics now show Torn's inventory timestamp, returned changes, totals, and save mismatches.

## 0.1.6

- Added Torn's supported timestamp cache-buster to manual armoury synchronization.
- Sync Now now requests fresh faction inventory after deposits and withdrawals.

## 0.1.5

- Split the Torn item catalog into compact storage chunks for TornPDA compatibility.
- Create whitelist settings only when an item is selected instead of preloading 1,455 records.
- Changed the three-letter picker to search the compact full catalog directly.

## 0.1.4

- Added safe API response-shape diagnostics without storing API keys or item details.
- Added support for nested and ID-keyed inventory response collections.

## 0.1.3

- Added support for both array and ID-keyed-object item catalog responses.
- Added discovered-item and tracked-item counts to Diagnostics.

## 0.1.2

- Changed the item picker to use Torn's complete item catalog.
- Items can now be tracked even when the faction currently has zero in stock.
- Added catalog market prices as an initial value for restock estimates.

## 0.1.1

- Added a three-letter item picker with selectable matches.
- Separated item discovery from the tracked-item configuration list.
- Fixed the mobile keyboard closing while typing in the item picker.
- Added automatic lowest Item Market price refresh.
- Added a dedicated Alerts tab for stock and loan-limit warnings.

## 0.1.0

- Initial ArmouryIQ Lite release.
- Added inventory synchronization, configurable tracking rules, local history, usage estimates, restock calculations, loan monitoring, reports, backups, and diagnostics.
