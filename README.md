# BC Copy Helper

`BC Copy Helper` is a Manifest V3 browser extension that adds a `Copy cell value` context-menu action to Microsoft Dynamics 365 Business Central list grids.

It is currently intended for unpacked local installation in Chrome and Edge. The project is focused on one job: copying a single visible Business Central cell value reliably, including iframe-hosted pages.

`BC Copy Helper` is not affiliated with Microsoft.

## Project Layout

- `manifest.json`: extension metadata, permissions, and content script registration
- `src/background/service_worker.js`: creates the context-menu item and forwards copy requests to the active tab
- `src/content/content.js`: records the most recent right-click target and extracts a list-grid cell value
- `src/offscreen/offscreen.html` and `src/offscreen/offscreen.js`: extension-owned clipboard path for reliable MV3 copying

This is a good default structure for a small no-build browser extension: keep `manifest.json` at the extension root, then group runtime code by responsibility under `src/`.

## Install

### Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

### Edge

1. Open `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

## What It Supports

- Business Central list-grid body cells only
- Copying visible text from standard cells
- Preferring the fuller `title` value when it differs from visible text
- Basic hyperlink fallbacks while filtering common action labels such as `Open record ...`
- Top document and iframe scenarios through `all_frames`

## Permissions And Privacy

- `contextMenus`: adds the `Copy cell value` menu item
- `clipboardWrite`: allows the extension to place the extracted value on the clipboard
- `offscreen`: uses an extension-owned hidden document for reliable clipboard writes in MV3
- host access to `businesscentral.dynamics.com`: required so the content script can read the Business Central grid DOM where you right-click

The extension does not send data to any server, include analytics, or make outbound network calls.

## Known Limitations

- No custom toast or other in-page UI
- No options page or tenant configuration UI
- No keyboard shortcuts
- No support for non-grid surfaces such as headers, tiles, charts, or factboxes
- Empty cells intentionally no-op when no safe cell value is found
- Selector maintenance may be required if Microsoft changes the Business Central DOM

## Quick Test

1. Load the extension in Chrome or Edge.
2. Open a Business Central list page.
3. Right-click a normal grid cell and choose `Copy cell value`.
4. Paste into a text field and verify the value.
5. Repeat with a hyperlink cell and a truncated cell if available.

If you changed the manifest or scripts, reload the unpacked extension before testing again.

## Development Notes

- The extension is intentionally narrow in scope and currently optimized for Business Central online domains.
- Store packaging, icons, and broader configuration can be added later without changing the core copy flow.
