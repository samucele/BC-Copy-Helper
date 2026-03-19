import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, expect, test } from "@playwright/test";

import { buildHostPattern, buildScenarioUrl, loadLocalE2EConfig, LOCAL_CONFIG_PATH } from "./config.js";
import { prepareExtensionForE2E } from "./prepare-extension.js";

const localConfig = loadLocalE2EConfig({ allowMissing: true });
const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";

async function hasElement(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function getBusinessCentralFrame(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const candidate = page.frames().find((frame) => frame.url().includes("runinframe=1"));
    if (candidate) {
      return candidate;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("Timed out waiting for the Business Central content iframe.");
}

async function maybeAuthenticate(page, config, targetUrl) {
  const { usernameSelector, passwordSelector, submitSelector } = config.login;
  const hasUsernameField = await hasElement(page, usernameSelector);
  const hasPasswordField = await hasElement(page, passwordSelector);

  if (!hasUsernameField || !hasPasswordField) {
    return;
  }

  if (!config.credentials.username || !config.credentials.password) {
    throw new Error(
      `A login page was detected at ${targetUrl}, but credentials.username or credentials.password is empty in ${LOCAL_CONFIG_PATH}.`
    );
  }

  await page.locator(usernameSelector).fill(config.credentials.username);
  await page.locator(passwordSelector).fill(config.credentials.password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator(submitSelector).first().click()
  ]);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function findScenarioTarget(frame, scenario, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const candidates = frame.locator(scenario.targetSelector);
    const target = scenario.targetText
      ? candidates.filter({ hasText: scenario.targetText }).first()
      : candidates.first();

    if ((await target.count()) > 0) {
      return target;
    }

    await frame.page().waitForTimeout(500);
  }

  throw new Error(
    `Could not find a matching target for scenario "${scenario.name}" using selector "${scenario.targetSelector}".`
  );
}

async function waitForScenarioReady(frame, scenario, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await frame.locator(scenario.readySelector).count()) > 0) {
      return;
    }

    await frame.page().waitForTimeout(500);
  }

  throw new Error(
    `Timed out waiting for scenario "${scenario.name}" to become ready using selector "${scenario.readySelector}".`
  );
}

async function ensureListLayout(frame, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const listCellSelector = "td[role='gridcell']";
  const page = frame.page();

  while (Date.now() < deadline) {
    const listCells = frame.locator(listCellSelector);
    if ((await listCells.count()) > 0) {
      return;
    }

    const tilesToggle = frame
      .locator(
        'button[title="View layout options"], button[aria-label*="Tiles layout selected" i], button[title*="layout" i]'
      )
      .first();

    if ((await tilesToggle.count()) === 0) {
      await page.waitForTimeout(500);
      continue;
    }

    await tilesToggle.click();

    const listOption = frame
      .locator(
        'button[role="menuitemradio"]:has-text("List"), button[title*="Show as list" i], [role="menuitemradio"][title*="Show as list" i]'
      )
      .first();

    if ((await listOption.count()) === 0) {
      await page.waitForTimeout(500);
      continue;
    }

    const isAlreadySelected = (await listOption.getAttribute("aria-checked")) === "true";
    if (isAlreadySelected) {
      await page.keyboard.press("Escape");
      return;
    }

    await listOption.click();
    await page.waitForTimeout(4000);

    if ((await frame.locator(listCellSelector).count()) > 0) {
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error("Timed out switching the Business Central page to list layout.");
}

async function triggerExtensionCopy(serviceWorker, frameId) {
  await serviceWorker.evaluate(async (messageFrameId) => {
    if (typeof self.handleCopyMenuClick !== "function") {
      throw new Error("handleCopyMenuClick is not available on the extension service worker.");
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    if (!activeTab || typeof activeTab.id !== "number") {
      throw new Error("The extension service worker could not resolve the active tab.");
    }

    const info = {
      menuItemId: "bc_copy_cell_value"
    };

    if (typeof messageFrameId === "number") {
      info.frameId = messageFrameId;
    }

    await self.handleCopyMenuClick(info, activeTab.id);
  }, frameId);
}

async function getBusinessCentralFrameId(serviceWorker, tabId, frameUrl) {
  return serviceWorker.evaluate(
    async ({ currentTabId, currentFrameUrl }) => {
      if (!chrome.webNavigation?.getAllFrames) {
        throw new Error("chrome.webNavigation.getAllFrames is not available in the E2E extension context.");
      }

      const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
      const matchingFrame = frames.find((frame) => frame.url === currentFrameUrl);

      if (!matchingFrame || typeof matchingFrame.frameId !== "number") {
        throw new Error(`Could not resolve a frameId for ${currentFrameUrl}.`);
      }

      return matchingFrame.frameId;
    },
    {
      currentTabId: tabId,
      currentFrameUrl: frameUrl
    }
  );
}

async function readClipboardByPaste(page) {
  await page.evaluate(() => {
    let textArea = document.getElementById("__bc-copy-helper-clipboard-probe__");

    if (!(textArea instanceof HTMLTextAreaElement)) {
      textArea = document.createElement("textarea");
      textArea.id = "__bc-copy-helper-clipboard-probe__";
      textArea.style.position = "fixed";
      textArea.style.top = "8px";
      textArea.style.left = "8px";
      textArea.style.zIndex = "2147483647";
      document.body.appendChild(textArea);
    }

    textArea.value = "";
    textArea.focus();
  });

  const probe = page.locator("#__bc-copy-helper-clipboard-probe__");
  await probe.click();
  await page.keyboard.press(pasteShortcut);
  return probe.inputValue();
}

test.describe("local Docker browser smoke tests", () => {
  if (!localConfig) {
    test("requires local.config.json", async () => {
      test.skip(
        true,
        "Create tests/e2e/local.config.json from the example file to enable local Docker browser smoke tests."
      );
    });

    return;
  }

  let browserContext;
  let page;
  let shellPage;
  let serviceWorker;
  let extensionCleanup = async () => {};
  let userDataDir = "";

  test.beforeAll(async () => {
    const { extensionRoot, cleanup } = await prepareExtensionForE2E(buildHostPattern(localConfig.baseUrl));
    extensionCleanup = cleanup;
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bc-copy-helper-user-data-"));

    browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.PLAYWRIGHT_HEADLESS === "1",
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
    });

    serviceWorker =
      browserContext.serviceWorkers()[0] ?? (await browserContext.waitForEvent("serviceworker"));

    shellPage =
      browserContext
        .pages()
        .find((candidate) => !candidate.url().startsWith("chrome-extension://")) ??
      (await browserContext.newPage());
  });

  test.afterEach(async () => {
    if (page && page !== shellPage) {
      await page.close();
    }

    page = undefined;
  });

  test.afterAll(async () => {
    await browserContext?.close();
    await extensionCleanup();

    if (userDataDir) {
      await fs.rm(userDataDir, {
        recursive: true,
        force: true
      });
    }
  });

  for (const scenario of localConfig?.scenarios ?? []) {
    test(`copies the configured value for ${scenario.name}`, async () => {
      page = await browserContext.newPage();
      const targetUrl = buildScenarioUrl(localConfig, scenario);

      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await maybeAuthenticate(page, localConfig, targetUrl);
      const frame = await getBusinessCentralFrame(page);
      await ensureListLayout(frame);
      await waitForScenarioReady(frame, scenario);

      const target = await findScenarioTarget(frame, scenario);
      await page.bringToFront();
      await target.scrollIntoViewIfNeeded();
      await target.click({ button: "right" });
      await page.keyboard.press("Escape");

      const resolvedTabId = await serviceWorker.evaluate(async () => {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true
        });

        if (!activeTab || typeof activeTab.id !== "number") {
          throw new Error("The extension service worker could not resolve the active tab.");
        }

        return activeTab.id;
      });
      const frameId = await getBusinessCentralFrameId(serviceWorker, resolvedTabId, frame.url());

      await triggerExtensionCopy(serviceWorker, frameId);

      await expect.poll(async () => readClipboardByPaste(page)).toBe(scenario.expectedClipboard);
    });
  }
});
