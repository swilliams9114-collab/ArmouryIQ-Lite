# Changelog

## 0.2.5

- Added timestamp-based faction-news pagination when Torn omits its next-page link.
- Consumption sync now continues past the first 100 Armory events in each seven-day block.

## 0.2.4

- Fixed consumption quantities being inflated by unrelated numbers in faction-news text.
- Quantities are now accepted only when directly attached to the item or action; otherwise each usage log counts as one.

## 0.2.3

- Fixed faction-news pagination to follow Torn's time-based next-page links instead of repeating pages with numeric offsets.
- Deduplicated matching activity while syncing so progress and saved totals reflect unique news records.

## 0.2.2

- Split the 90-day Consumption sync into seven-day API windows to avoid large-query backend failures.
- Added automatic retries for temporary Torn API errors and saved progress after every completed window.
- Clarified sync progress by separating news entries scanned from matching armoury records found.

## 0.2.1

- Reduced Consumption Tracker syncing and retention from one year to 90 days.
- Removed the 365-day filter and lowered the local activity safety cap.
- Existing consumption data older than 90 days is removed on the next sync.

## 0.2.0

- Added a searchable Consumption Tracker powered by faction armory news.
- Added item search, date ranges, total usage, member totals, and a detailed activity timeline.
- Added manual consumption synchronization and copyable staff reports.
- Added compact one-year local activity storage with backup and restore support.
- Updated custom-key creation to request Faction Inventory and Faction News only.

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
