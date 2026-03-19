import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { createChromeMock } from "../helpers/chrome.js";
import { loadBrowserScript } from "../helpers/load-script.js";

const offscreenScriptPath = path.join(process.cwd(), "src", "offscreen", "offscreen.js");

function setupOffscreenScript() {
  const dom = new JSDOM(
    `<!doctype html><html><body><textarea id="copy-target" aria-hidden="true"></textarea></body></html>`
  );
  const chrome = createChromeMock();
  const execCommand = vi.fn(() => true);

  dom.window.document.execCommand = execCommand;

  const context = loadBrowserScript(offscreenScriptPath, {
    window: dom.window,
    document: dom.window.document,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    chrome
  });

  return {
    context,
    document: dom.window.document,
    execCommand
  };
}

describe("offscreen clipboard helper", () => {
  it("copies text into the offscreen textarea and clears the value afterward", async () => {
    const { context, document, execCommand } = setupOffscreenScript();
    const textArea = document.getElementById("copy-target");

    await context.copyText("Copied from offscreen");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textArea.value).toBe("");
  });

  it("throws when the clipboard target textarea is missing", async () => {
    const dom = new JSDOM(`<!doctype html><html><body></body></html>`);
    const chrome = createChromeMock();
    dom.window.document.execCommand = vi.fn(() => true);
    const context = loadBrowserScript(offscreenScriptPath, {
      window: dom.window,
      document: dom.window.document,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      chrome
    });

    await expect(context.copyText("Copied from offscreen")).rejects.toThrow("Clipboard target element not found.");
  });

  it("throws when execCommand returns false", async () => {
    const { context } = setupOffscreenScript();
    const failingDom = new JSDOM(
      `<!doctype html><html><body><textarea id="copy-target" aria-hidden="true"></textarea></body></html>`
    );
    failingDom.window.document.execCommand = vi.fn(() => false);
    const failingContext = loadBrowserScript(offscreenScriptPath, {
      window: failingDom.window,
      document: failingDom.window.document,
      HTMLTextAreaElement: failingDom.window.HTMLTextAreaElement,
      chrome: createChromeMock()
    });

    await expect(failingContext.copyText("Copied from offscreen")).rejects.toThrow(
      "document.execCommand('copy') returned false."
    );
    await expect(context.copyText("Copied from offscreen")).resolves.toBeUndefined();
  });

  it("rejects empty clipboard text", async () => {
    const { context } = setupOffscreenScript();

    await expect(context.copyText("   ")).rejects.toThrow("Missing clipboard text.");
  });
});
