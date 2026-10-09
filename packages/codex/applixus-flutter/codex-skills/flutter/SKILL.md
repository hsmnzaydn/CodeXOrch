---
name: flutter
description: "Flutter state, routing, data, localization and native bridge implementation."
---

# Flutter implementation

Inspect target repository and affected contracts. Preserve its state, repository, routing, localization and theme conventions. Keep business logic outside widgets; settle async loading/error paths and avoid writes after disposal.

Change source for generated models and run existing generator; never edit generated Dart. Native bridge changes need typed errors, permissions and platform checks. Redact tokens and personal data; keep production logging disabled.

Select existing analyze, unit, widget and golden checks for affected surfaces. Native changes also need Android/iOS checks; Flutter-only results do not prove native behavior. Report command, target and result.

When changed behavior is visible UI, the ONE quick direct check may use `orca emulator` (iOS Simulator / Android over adb; `orca emulator ax` for the accessibility tree) after building and installing the app; see `orca skills get orca-emulator` / `orca skills get orca-emulator-android`. Not a test suite, not an extra worker.

After localization changes, run the target project's current explicit localization verification; do not assume a hook runs it.

Project-specific rules belong to bound project pack, not every Flutter project.
