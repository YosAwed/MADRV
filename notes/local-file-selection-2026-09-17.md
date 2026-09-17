# Local file versus folder selection — 2026-09-17

The user reported that Android Chrome appeared to read an entire folder when they wanted to open a single file. Inspection found separate underlying inputs, but only the folder picker had a visible labeled button; ordinary file selection was accessed through the drop area. In addition, the folder input's change handler always imported a playlist, regardless of the returned File metadata. The exact Android picker interaction has not been reproduced on a physical device.

## Changes

- Added adjacent, explicit 「ファイルを選択」 and 「フォルダを選択」 buttons. The drop area still opens the ordinary file input. Only the folder input has directory-selection attributes.
- Both inputs dispatch according to the returned selection: files with directory-relative paths use the folder/playlist loader; ordinary files use the existing single-source loader. A folder containing one song remains a folder; a standalone file returned by a directory picker no longer automatically becomes a playlist.
- Preserved simultaneous MDX/MDR + PDX selection and later PDX addition.
- Empty selections leave the loaded source and notice unchanged. File inputs are reset immediately after copying their File objects, allowing the same file to be selected again.

The directory discriminator follows [File and Directory Entries API](https://wicg.github.io/entries-api/#html-forms), which specifies directory-relative paths for directory selections. This does not add filesystem traversal or permission requests: only files returned by the browser are read.

## Verification

`node scripts/verify-local-selection.mjs` uses generated original MDX files and a generated PDX bank, taps the actual chooser buttons, and verifies the selected input's directory attribute. Chromium with Android user agent, mobile viewport and touch input passed:

- Standalone file loads without adding a playlist.
- Two-song folder adds two playlist entries.
- Selecting one file within that folder does not import sibling files.
- Simulated ordinary File returned through the directory input loads as a single source.
- One-song folder still adds a playlist entry.
- MDX plus matching PDX selection preserves pairing.
- Empty/cancelled selection preserves the current notice.
- No page errors; both buttons fit the mobile layout.

The native Android OS picker is not emulated by this test. Device confirmation is still needed. Development branch: `codex/local-file-selection`; production remains unchanged pending that confirmation.
