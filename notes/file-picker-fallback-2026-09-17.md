# Plain single-file picker fallback — 2026-09-17

## Updated report

The native picker mitigation still did not open a picker on the affected carrier Xperia 5 V. Both file and folder controls failed. The owner reports Chrome and Android are current for the device (exact version numbers unknown). Other apps can select files via an intermediate Files icon, so this is not evidence that all device file selection is broken. No physical Xperia trace has been captured, and no carrier-specific cause is established.

Chromium's Android [SelectFileDialog](https://chromium.googlesource.com/chromium/src/+/HEAD/ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java) passes MIME restrictions and the multiple-selection flag into Android chooser requests. Removing these parameters offers a smaller controlled test, not a proven fix for this device.

## Change

Kept the regular file/folder controls and loaders unchanged. Added a collapsed 「ファイル選択が開かない場合」 section with a visible native single-file input: no accept, multiple, directory, invisible overlay, or scripted picker activation. It uses the existing source loader, allowing MDR/MDX first and PDX via a second selection. Unsupported extensions still receive the existing rejection notice. The section explains that a Files icon, if shown, should be selected.

No audio, MIDI, seeking, SoundFont or playlist-engine code changed. The user previously stated only production can be used for affected-device testing and explicitly requested production updates for this issue; this follow-up is intended for that same test flow.

## Validation

The generated-fixture browser regression covers normal arrow/file/folder controls plus the fallback, while programmatic file-input click is blocked. It verifies the fallback's unrestricted single-file attributes, opening the chooser, loading MDX, adding its PDX later, and rejecting an unsupported file without replacing the current source. Existing folder, pair selection, keyboard, drop and cancellation checks remain covered. Chromium and WebKit passed; both TypeScript checks passed. Physical Xperia behavior remains unverified.
