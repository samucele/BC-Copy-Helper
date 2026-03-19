# BC Copy Helper

`BC Copy Helper` is a Manifest V3 browser extension that adds a `Copy BC cell value` context-menu action to Microsoft Dynamics 365 Business Central list grids.

It is currently intended for unpacked local installation in Chrome and Edge. The project is focused on one job: copying a single visible Business Central cell value reliably, including iframe-hosted pages.

`BC Copy Helper` is not affiliated with Microsoft.

## Project Layout

- `manifest.json`: extension metadata, permissions, and content script registration
- `src/background/service_worker.js`: creates the context-menu item and forwards copy requests to the active tab
- `src/content/content.js`: records the most recent right-click target and extracts a list-grid cell value
- `src/offscreen/offscreen.html` and `src/offscreen/offscreen.js`: extension-owned clipboard path for reliable MV3 copying
- `tests/unit/*.test.js`: fast unit coverage for content extraction and extension runtime helpers
- `tests/e2e/docker.spec.js`: Playwright smoke tests against a local Docker Business Central web client
- `tests/e2e/local.config.example.json`: example local-only E2E configuration file for Docker URL, company, credentials, and page targets

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

- `contextMenus`: adds the `Copy BC cell value` menu item
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
3. Right-click a normal grid cell and choose `Copy BC cell value`.
4. Paste into a text field and verify the value.
5. Repeat with a hyperlink cell and a truncated cell if available.

If you changed the manifest or scripts, reload the unpacked extension before testing again.

## Automated Tests

The repo now includes two test layers:

- `npm test`: fast unit tests with `Vitest` and `JSDOM`
- `npm run test:e2e`: browser smoke tests with `Playwright` against a local Docker Business Central web client

### Install test tooling

1. Install Node.js if it is not already available.
2. Run `npm install`
3. For browser smoke tests, run `npx playwright install chromium`

### Local Docker E2E configuration

Browser smoke tests read local-only settings from `tests/e2e/local.config.json`, which is gitignored on purpose so Docker credentials and environment-specific URLs never get committed.

Create it by copying the example file:

```bash
copy tests\e2e\local.config.example.json tests\e2e\local.config.json
```

Then update the following values:

- `baseUrl`: your Docker web client root, for example `http://saas274cz/BC`
- `tenant`: the BC tenant name, typically `default` for local Docker
- `company`: the company to open during the smoke tests
- `credentials`: the username and password for the Docker environment, if the web client prompts for login
- `scenarios`: the list pages and target cells to validate

### What the browser smoke tests cover

Keep the E2E matrix small and focused on list pages only:

- one plain-text list-cell scenario for the base copy flow
- one title-backed or truncated-value scenario
- one hyperlink-cell scenario
- optional extra scenarios that are stable in your local Docker data set

Each scenario in `tests/e2e/local.config.json` should point at a real list page and a stable target cell, using:

- `path`: the relative page path or query string
- `targetSelector`: the selector for the cell content to right-click
- `targetText`: optional text used to choose the correct element when a selector matches multiple cells
- `expectedClipboard`: the value the extension should copy

### Running the tests

- Run `npm test` for the fast unit suite
- Run `npm run test:e2e` for the local Docker browser smoke suite
- Run `npm run test:all` to run both suites back to back

The browser smoke tests load a temporary test copy of the extension with your local Docker host added to the manifest and background menu match patterns. The production extension files stay unchanged.

## Development Notes

- The extension is intentionally narrow in scope and currently optimized for Business Central online domains.
- Store packaging, icons, and broader configuration can be added later without changing the core copy flow.
