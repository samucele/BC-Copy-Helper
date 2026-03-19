import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createChromeMock } from "../helpers/chrome.js";
import { loadBrowserScript } from "../helpers/load-script.js";

const serviceWorkerPath = path.join(process.cwd(), "src", "background", "service_worker.js");
const expectedMatchPatterns = [
  "https://businesscentral.dynamics.com/*",
  "https://*.businesscentral.dynamics.com/*"
];

function setupServiceWorker(chromeOverrides = {}) {
  const chrome = createChromeMock(chromeOverrides);
  const context = loadBrowserScript(serviceWorkerPath, {
    chrome
  });

  return { chrome, context };
}

describe("background service worker", () => {
  it("registers install, startup, and context-menu listeners on load", () => {
    const { chrome } = setupServiceWorker();

    expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  it("creates the copy context menu for supported Business Central hosts", () => {
    const { chrome, context } = setupServiceWorker();

    context.ensureContextMenu();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(1);

    const [menuOptions] = chrome.contextMenus.create.mock.calls[0];
    expect(menuOptions).toMatchObject({
      id: "bc_copy_cell_value",
      title: "Copy BC cell value",
      contexts: ["all"],
      documentUrlPatterns: expectedMatchPatterns
    });
  });

  it("sends extracted text to the offscreen copy pipeline", async () => {
    const { chrome, context } = setupServiceWorker({
      tabs: {
        sendMessage: vi.fn(async () => ({ ok: true, value: "Copied from grid" }))
      }
    });

    await context.handleCopyMenuClick({}, 7);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "bc_copy_cell_value" }, undefined);
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "offscreen_copy_text",
      text: "Copied from grid"
    });
  });

  it("forwards frameId when the click comes from an iframe", async () => {
    const { chrome, context } = setupServiceWorker({
      tabs: {
        sendMessage: vi.fn(async () => ({ ok: true, value: "Copied from frame" }))
      }
    });

    await context.handleCopyMenuClick({ frameId: 3 }, 7);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "bc_copy_cell_value" }, { frameId: 3 });
  });

  it("does not attempt clipboard copy when content extraction returns no value", async () => {
    const { chrome, context } = setupServiceWorker({
      tabs: {
        sendMessage: vi.fn(async () => ({ ok: false, reason: "empty-value" }))
      }
    });

    await context.handleCopyMenuClick({}, 7);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("serializes concurrent offscreen creation through the shared in-flight promise", async () => {
    let resolveCreateDocument;
    const createDocumentPromise = new Promise((resolve) => {
      resolveCreateDocument = resolve;
    });
    const { chrome, context } = setupServiceWorker({
      offscreen: {
        createDocument: vi.fn(() => createDocumentPromise)
      }
    });

    const firstCall = context.ensureOffscreenDocument();
    const secondCall = context.ensureOffscreenDocument();

    await vi.waitFor(() => {
      expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
    });

    resolveCreateDocument();
    await Promise.all([firstCall, secondCall]);

    await context.ensureOffscreenDocument();
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(2);
  });

  it("reuses an existing offscreen document when one is already open", async () => {
    const { chrome, context } = setupServiceWorker({
      runtime: {
        getContexts: vi.fn(async () => [{}])
      }
    });

    await context.ensureOffscreenDocument();

    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("throws when the offscreen copy response indicates failure", async () => {
    const { context } = setupServiceWorker({
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: false, error: "Clipboard denied" }))
      }
    });

    await expect(context.copyTextWithOffscreenDocument("Copied from grid")).rejects.toThrow("Clipboard denied");
  });
});
