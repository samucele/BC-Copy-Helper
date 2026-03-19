const MENU_ID_COPY_CELL = "bc_copy_cell_value";
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
const OFFSCREEN_COPY_MESSAGE_TYPE = "offscreen_copy_text";
const BC_MATCH_PATTERNS = [
  "https://businesscentral.dynamics.com/*",
  "https://*.businesscentral.dynamics.com/*"
];
let creatingOffscreenDocument = null;

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("Failed to clear existing menu items.", chrome.runtime.lastError.message);
    }

    chrome.contextMenus.create(
      {
        id: MENU_ID_COPY_CELL,
        title: "Copy BC cell value",
        contexts: ["all"],
        documentUrlPatterns: BC_MATCH_PATTERNS
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn("Failed to create context menu.", chrome.runtime.lastError.message);
        }
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID_COPY_CELL || !tab || typeof tab.id !== "number") {
    return;
  }

  void handleCopyMenuClick(info, tab.id);
});

async function handleCopyMenuClick(info, tabId) {
  const messageOptions =
    typeof info.frameId === "number"
      ? { frameId: info.frameId }
      : undefined;

  let response;

  try {
    response = await chrome.tabs.sendMessage(tabId, { type: MENU_ID_COPY_CELL }, messageOptions);
  } catch (error) {
    console.debug("No frame handled the copy request.", error);
    return;
  }

  if (!response || !response.ok || !response.value) {
    console.debug("Copy cell value did not produce text.", response?.reason || "unknown-reason");
    return;
  }

  try {
    await copyTextWithOffscreenDocument(response.value);
    console.debug("Copied Business Central cell value.");
  } catch (error) {
    console.error("Failed to copy Business Central cell value.", error);
  }
}

async function copyTextWithOffscreenDocument(text) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_COPY_MESSAGE_TYPE,
    target: "offscreen",
    text
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Offscreen copy failed.");
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (typeof chrome.runtime.getContexts === "function") {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      return;
    }
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Copy extracted Business Central cell values to the clipboard."
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}
