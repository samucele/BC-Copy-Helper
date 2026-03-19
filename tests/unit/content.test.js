import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { createChromeMock } from "../helpers/chrome.js";
import { loadBrowserScript } from "../helpers/load-script.js";

const contentScriptPath = path.join(process.cwd(), "src", "content", "content.js");

function buildGridMarkup(cellContent) {
  return `
    <div class="ms-nav-grid-vertical-container">
      <table class="ms-nav-grid-data-table">
        <tbody>
          <tr>
            <td role="gridcell">
              ${cellContent}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function setupContentScript(cellContent) {
  return setupContentScriptWithBody(buildGridMarkup(cellContent));
}

function setupContentScriptWithBody(bodyMarkup) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyMarkup}</body></html>`, {
    url: "http://saas274cz/BC"
  });
  const chrome = createChromeMock();
  const context = loadBrowserScript(contentScriptPath, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Element: dom.window.Element,
    Text: dom.window.Text,
    chrome,
    Date
  });

  return {
    context,
    document: dom.window.document,
    window: dom.window
  };
}

describe("content script extraction", () => {
  it("normalizes text-node targets back to their element", () => {
    const { context, document } = setupContentScript(
      `<span class="stringcontrol-read value">Customer Name</span>`
    );
    const span = document.querySelector("span");
    const textNode = span.firstChild;

    expect(context.normalizeTarget(textNode)).toBe(span);
  });

  it("returns null when normalizeTarget receives no usable DOM target", () => {
    const { context, document } = setupContentScript(`<span class="stringcontrol-read value">Customer Name</span>`);

    expect(context.normalizeTarget(null)).toBeNull();
    expect(context.normalizeTarget(document)).toBeNull();
  });

  it("finds the nearest supported grid cell for nested cell content", () => {
    const { context, document } = setupContentScript(
      `<div class="wrapper"><span class="stringcontrol-read value">Customer Name</span></div>`
    );
    const target = document.querySelector("span.stringcontrol-read.value");
    const cell = document.querySelector("td[role='gridcell']");

    expect(context.findSupportedGridCell(target)).toBe(cell);
  });

  it("rejects grid cells that are not inside a supported grid container", () => {
    const { context, document } = setupContentScriptWithBody(`
      <table>
        <tbody>
          <tr>
            <td role="gridcell">
              <span class="stringcontrol-read value">Customer Name</span>
            </td>
          </tr>
        </tbody>
      </table>
    `);
    const target = document.querySelector("span.stringcontrol-read.value");

    expect(context.findSupportedGridCell(target)).toBeNull();
  });

  it("prefers a non-action title when the visible text is truncated", () => {
    const { context, document } = setupContentScript(
      `<span class="stringcontrol-read value" title="Athens Desk, Wide">Athens Desk</span>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const span = document.querySelector("span.stringcontrol-read.value");

    expect(context.extractCellValue(cell, span)).toBe("Athens Desk, Wide");
  });

  it("normalizes whitespace in extracted text values", () => {
    const { context, document } = setupContentScript(
      `<span class="stringcontrol-read value">  First\n\tSecond   Third  </span>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const span = document.querySelector("span.stringcontrol-read.value");

    expect(context.extractCellValue(cell, span)).toBe("First Second Third");
  });

  it("falls back to visible link text when the title looks like an action label", () => {
    const { context, document } = setupContentScript(`<a title="Open record Customer 10000">10000</a>`);
    const cell = document.querySelector("td[role='gridcell']");
    const link = document.querySelector("a");

    expect(context.extractCellValue(cell, link)).toBe("10000");
  });

  it("falls back to visible link text when the title starts with open details", () => {
    const { context, document } = setupContentScript(
      `<a class="stringcontrol-read value" title="Open details for &quot;Inventory&quot; &quot;-54&quot;">-54</a>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const link = document.querySelector("a");

    expect(context.extractCellValue(cell, link)).toBe("-54");
  });

  it("falls back to visible email text when the title is an email action", () => {
    const { context, document } = setupContentScript(
      `<a class="stringcontrol-read value" title="Send email to adatum@example.com">adatum@example.com</a>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const link = document.querySelector("a");

    expect(context.extractCellValue(cell, link)).toBe("adatum@example.com");
  });

  it("falls back to visible text when the title says open in outlook", () => {
    const { context, document } = setupContentScript(
      `<a class="stringcontrol-read value" title="Open in Outlook for adatum@example.com">adatum@example.com</a>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const link = document.querySelector("a");

    expect(context.extractCellValue(cell, link)).toBe("adatum@example.com");
  });

  it("ignores blank helper titles when no meaningful text is present", () => {
    const { context, document } = setupContentScript(`<a title="Show more about &quot;&quot;"></a>`);
    const cell = document.querySelector("td[role='gridcell']");
    const link = document.querySelector("a");

    expect(context.extractCellValue(cell, link)).toBeNull();
  });

  it("prefers visible text when the title only appends metadata in parentheses", () => {
    const { context, document } = setupContentScript(
      `<span class="stringcontrol-read value" title="19,032.00 (currency displayed in CZK)">19,032.00</span>`
    );
    const cell = document.querySelector("td[role='gridcell']");
    const span = document.querySelector("span.stringcontrol-read.value");

    expect(context.extractCellValue(cell, span)).toBe("19,032.00");
  });

  it("falls back to aria-label when text and title do not produce a safe value", () => {
    const { context, document } = setupContentScript(`<button aria-label="Customer 10000"></button>`);
    const cell = document.querySelector("td[role='gridcell']");
    const button = document.querySelector("button");

    expect(context.extractCellValue(cell, button)).toBe("Customer 10000");
  });

  it("prefers the target-specific candidate over unrelated cell-level candidates", () => {
    const { context, document } = setupContentScript(`
      <span class="stringcontrol-read value" title="Unrelated cell title">Visible cell text</span>
      <a title="Customer 10000"><span class="click-target">10000</span></a>
    `);
    const cell = document.querySelector("td[role='gridcell']");
    const clickTarget = document.querySelector("span.click-target");

    expect(context.extractCellValue(cell, clickTarget)).toBe("Customer 10000");
  });

  it("filters action-like labels even when they come from aria-label fallback", () => {
    const { context, document } = setupContentScript(`<button aria-label="Open record Customer 10000"></button>`);
    const cell = document.querySelector("td[role='gridcell']");
    const button = document.querySelector("button");

    expect(context.extractCellValue(cell, button)).toBeNull();
  });

  it("extracts the current cell value from the most recent contextmenu target", async () => {
    const { context, document, window } = setupContentScript(
      `<span class="stringcontrol-read value" title="School of Fine Art">School</span>`
    );
    const span = document.querySelector("span.stringcontrol-read.value");

    span.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true
      })
    );

    await expect(context.handleExtractRequest()).resolves.toEqual({
      ok: true,
      value: "School of Fine Art"
    });
  });

  it("returns an unsupported-target reason when the recent click is outside a supported grid cell", async () => {
    const { context, document, window } = setupContentScriptWithBody(`
      <div id="outside-target">Outside target</div>
      ${buildGridMarkup(`<span class="stringcontrol-read value">Inside Grid</span>`)}
    `);
    const outsideTarget = document.getElementById("outside-target");

    outsideTarget.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true
      })
    );

    await expect(context.handleExtractRequest()).resolves.toEqual({
      ok: false,
      reason: "unsupported-target"
    });
  });

  it("returns a no-recent-context-target reason before any right-click is recorded", async () => {
    const { context } = setupContentScript(`<span class="stringcontrol-read value">Customer Name</span>`);

    await expect(context.handleExtractRequest()).resolves.toEqual({
      ok: false,
      reason: "no-recent-context-target"
    });
  });

  it("returns an empty-value reason when no safe candidate is found", async () => {
    const { context, document, window } = setupContentScript(`<div class="cell-host"></div>`);
    const cell = document.querySelector("td[role='gridcell']");

    cell.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true
      })
    );

    await expect(context.handleExtractRequest()).resolves.toEqual({
      ok: false,
      reason: "empty-value"
    });
  });
});
