import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

import { buildScenarioUrl, loadLocalE2EConfig } from "./config.js";
import { prepareExtensionForE2E } from "./prepare-extension.js";

const config = loadLocalE2EConfig();
const pagesToDump = [
  {
    name: "customers",
    path: "?page=22"
  },
  {
    name: "items",
    path: "?page=31"
  }
];

function quote(value) {
  return JSON.stringify(value);
}

async function hasElement(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function maybeAuthenticate(page, currentConfig, targetUrl) {
  const { usernameSelector, passwordSelector, submitSelector } = currentConfig.login;
  const hasUsernameField = await hasElement(page, usernameSelector);
  const hasPasswordField = await hasElement(page, passwordSelector);

  if (!hasUsernameField || !hasPasswordField) {
    return;
  }

  await page.locator(usernameSelector).fill(currentConfig.credentials.username);
  await page.locator(passwordSelector).fill(currentConfig.credentials.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator(submitSelector).first().click()
  ]);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
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

async function ensureListLayout(frame, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const page = frame.page();

  while (Date.now() < deadline) {
    if ((await frame.locator("td[role='gridcell']").count()) > 0) {
      return;
    }

    const toggle = frame
      .locator(
        'button[title="View layout options"], button[aria-label*="Tiles layout selected" i], button[title*="layout" i]'
      )
      .first();

    if ((await toggle.count()) === 0) {
      await page.waitForTimeout(500);
      continue;
    }

    await toggle.click();

    const switched = await frame.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll("button, a, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']")
      );
      const listOption = candidates.find((element) => {
        const text = `${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${
          element.getAttribute("title") || ""
        }`.toLowerCase();

        return text.includes("show as list") || text === "list" || text.includes(" list ");
      });

      if (!(listOption instanceof HTMLElement)) {
        return false;
      }

      listOption.click();
      return true;
    });

    if (!switched) {
      await page.waitForTimeout(500);
      continue;
    }

    await page.waitForTimeout(4000);

    if ((await frame.locator("td[role='gridcell']").count()) > 0) {
      return;
    }
  }

  throw new Error("Timed out switching the Business Central page to list layout.");
}

async function getBusinessCentralFrameId(serviceWorker, tabId, frameUrl) {
  return serviceWorker.evaluate(
    async ({ currentTabId, currentFrameUrl }) => {
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

async function getActiveTabId(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    if (!activeTab || typeof activeTab.id !== "number") {
      throw new Error("The extension service worker could not resolve the active tab.");
    }

    return activeTab.id;
  });
}

async function extractValueForFrame(serviceWorker, tabId, frameId) {
  return serviceWorker.evaluate(async ({ currentTabId, currentFrameId }) => {
    const response = await chrome.tabs.sendMessage(
      currentTabId,
      {
        type: "bc_copy_cell_value"
      },
      {
        frameId: currentFrameId
      }
    );

    if (!response?.ok || !response.value) {
      return response;
    }

    try {
      await self.copyTextWithOffscreenDocument(response.value);
      return {
        ...response,
        copyOk: true
      };
    } catch (error) {
      return {
        ...response,
        copyOk: false,
        copyError: error?.message || String(error)
      };
    }
  }, { currentTabId: tabId, currentFrameId: frameId });
}

async function triggerSyntheticContextTarget(frame, candidateIndex) {
  return frame.evaluate((index) => {
    const candidates = Array.from(
      document.querySelectorAll("td[role='gridcell'] a.stringcontrol-read.value, td[role='gridcell'] span.stringcontrol-read.value")
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight;
    });

    const element = candidates[index];
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const cell = element.closest("td[role='gridcell']");
    const colId = cell?.getAttribute("col-id") || "";
    const headerCell = colId ? document.querySelector(`th[col-id='${colId}']`) : null;

    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2
      })
    );

    return {
      headerText: (headerCell?.textContent || cell?.getAttribute("aria-label") || "").trim(),
      visibleText: (element.textContent || "").trim(),
      title: (element.getAttribute("title") || "").trim()
    };
  }, candidateIndex);
}

async function collectPageFields(page, serviceWorker, pageDefinition) {
  const targetUrl = buildScenarioUrl(config, pageDefinition);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await maybeAuthenticate(page, config, targetUrl);

  const frame = await getBusinessCentralFrame(page);
  await ensureListLayout(frame);

  const activeTabId = await getActiveTabId(serviceWorker);
  const frameId = await getBusinessCentralFrameId(serviceWorker, activeTabId, frame.url());

  const visibleCandidateCount = await frame.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("td[role='gridcell'] a.stringcontrol-read.value, td[role='gridcell'] span.stringcontrol-read.value")
    );
    return candidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight;
    }).slice(0, 30).length;
  });

  const results = [];
  for (let index = 0; index < visibleCandidateCount; index += 1) {
    const field = await triggerSyntheticContextTarget(frame, index);
    if (!field) {
      continue;
    }

    if (!field.visibleText && !field.title) {
      continue;
    }

    const response = await extractValueForFrame(serviceWorker, activeTabId, frameId);
    if (!response?.ok || !response.value) {
      continue;
    }

    results.push({
      header: field.headerText,
      visibleText: field.visibleText,
      title: field.title,
      copiedValue: response.value,
      copyOk: response.copyOk !== false,
      copyError: response.copyError || ""
    });
  }

  return results;
}

const { extensionRoot, cleanup } = await prepareExtensionForE2E(config.baseUrl.replace(/\/BC\/?$/, "") + "/*");
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bc-copy-helper-dump-"));

const browserContext = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: process.env.PLAYWRIGHT_HEADLESS === "1",
  args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
});

try {
  const serviceWorker = browserContext.serviceWorkers()[0] ?? (await browserContext.waitForEvent("serviceworker"));
  const page =
    browserContext.pages().find((candidate) => !candidate.url().startsWith("chrome-extension://")) ??
    (await browserContext.newPage());

  for (const pageDefinition of pagesToDump) {
    const fields = await collectPageFields(page, serviceWorker, pageDefinition);
    console.log(`PAGE ${pageDefinition.name.toUpperCase()}`);
    for (const field of fields) {
      console.log(
        `${quote(field.header)} | visible=${quote(field.visibleText)} | title=${quote(field.title)} | copied=${quote(field.copiedValue)}`
      );
    }
    console.log("");
  }
} finally {
  await browserContext.close();
  await cleanup();
  await fs.rm(userDataDir, { recursive: true, force: true });
}
