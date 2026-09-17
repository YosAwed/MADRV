# Native local file picker activation — 2026-09-17

The user clarified the report: their own device works, but another Android Chrome user taps the upload arrow and no file selection screen opens. The earlier description suggested file/folder routing, but the confirmed problem occurs before selection. The exact affected Android/Chrome combination and native picker failure have not been reproduced on a physical device.

## Final change

- The upload arrow/drop area now contains an actual transparent file input covering the visible hit area. The user's tap reaches the native file control directly instead of JavaScript forwarding `.click()` to a display:none input.
- A visible 「ファイルを選択」 label uses native label association with the same file input. 「フォルダを選択」 contains its own native directory input. Neither local picker requires scripted `.click()` activation.
- Ordinary files still go through the single-source loader; explicit folder selection still goes through the folder/playlist loader. The speculative relative-path routing from the first draft was removed after clarification.
- Multiple file selection for an MDX/MDR + PDX pair remains available. Drop handling and keyboard selection are retained.
- Empty selections preserve the current source and notice. Inputs are reset immediately after copying their File objects to allow repeat selection.

## Verification

`node scripts/verify-local-selection.mjs` uses generated original MDX and PDX fixtures. Local Chromium (Android user agent, mobile viewport and touch) and WebKit both passed:

- Arrow-coordinate hit testing targets the actual file input.
- A touchscreen tap opens the file chooser while JavaScript `HTMLInputElement.click()` is deliberately blocked for file inputs.
- The visible file and folder labels open their respective native inputs, with the directory attribute only on the folder input.
- A standalone file loads without adding a playlist; a two-song folder adds two entries; one file inside the same folder does not import siblings; a one-song folder still adds one playlist entry.
- MDX/PDX pairing, cancellation, and native keyboard activation work; no page errors.
- Added a regression for dropping a file onto the overlaid file input and bubbling to the existing drop handler.

Both TypeScript checks pass. The existing 216-test suite passed during this development work. The browser automation intercepts chooser results; it does not emulate or verify the native Android OS picker UI.

Development branch: `codex/local-file-selection`. This is a compatibility mitigation for device testing, not a claim that the affected Android's root cause has been confirmed. Production remains unchanged pending device confirmation.
