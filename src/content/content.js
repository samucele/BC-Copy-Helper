const COPY_MESSAGE_TYPE = "bc_copy_cell_value";
const LAST_CONTEXT_MAX_AGE_MS = 10000;

let lastContextTarget = null;
let lastContextTimestamp = 0;

document.addEventListener(
  "contextmenu",
  (event) => {
    lastContextTarget = normalizeTarget(event.target);
    lastContextTimestamp = Date.now();
  },
  true
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== COPY_MESSAGE_TYPE) {
    return false;
  }

  handleExtractRequest()
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      console.debug("Cell value extraction failed.", error);
      sendResponse({ ok: false, reason: "extract-failed" });
    });

  return true;
});

async function handleExtractRequest() {
  if (!lastContextTarget || Date.now() - lastContextTimestamp > LAST_CONTEXT_MAX_AGE_MS) {
    return { ok: false, reason: "no-recent-context-target" };
  }

  const cell = findSupportedGridCell(lastContextTarget);
  if (!cell) {
    return { ok: false, reason: "unsupported-target" };
  }

  const value = extractCellValue(cell, lastContextTarget);
  if (!value) {
    return { ok: false, reason: "empty-value" };
  }

  return { ok: true, value };
}

function normalizeTarget(target) {
  if (!target) {
    return null;
  }

  if (target.nodeType === Node.ELEMENT_NODE) {
    return target;
  }

  if (target.nodeType === Node.TEXT_NODE) {
    return target.parentElement;
  }

  return null;
}

function findSupportedGridCell(target) {
  const element = normalizeTarget(target);
  if (!element || typeof element.closest !== "function") {
    return null;
  }

  const cell = element.closest("td[role='gridcell']");
  if (!cell) {
    return null;
  }

  const gridContainer = cell.closest(
    ".ms-nav-grid-vertical-container, table.ms-nav-grid-data-table, .ms-nav-scrollable, [role='grid']"
  );

  return gridContainer ? cell : null;
}

function extractCellValue(cell, target) {
  const candidates = [];
  addCandidate(candidates, target ? target.closest("span.stringcontrol-read.value[title]") : null);
  addCandidate(candidates, target ? target.closest("span.stringcontrol-read.value") : null);
  addCandidate(candidates, target ? target.closest("a[title]") : null);
  addCandidate(candidates, target ? target.closest("a") : null);
  addCandidate(candidates, cell.querySelector("span.stringcontrol-read.value[title]"));
  addCandidate(candidates, cell.querySelector("span.stringcontrol-read.value"));
  addCandidate(candidates, cell.querySelector("a[title]"));
  addCandidate(candidates, cell.querySelector("a"));
  addCandidate(candidates, cell.querySelector("[title]"));
  addCandidate(candidates, cell.querySelector("[aria-label]"));

  for (const candidate of candidates) {
    const bestValue = getBestCandidateValue(candidate);
    if (bestValue) {
      return bestValue;
    }
  }

  return null;
}

function addCandidate(candidates, candidate) {
  if (!candidate || candidates.includes(candidate)) {
    return;
  }

  candidates.push(candidate);
}

function getBestCandidateValue(element) {
  const title = getTrimmedAttribute(element, "title");
  const ariaLabel = getTrimmedAttribute(element, "aria-label");
  const text = getTrimmedText(element);
  const safeText = getSafeTextValue(text);
  const safeTitle = getSafeAttributeValue(title);
  const safeAriaLabel = getSafeAttributeValue(ariaLabel);

  if (safeText && safeTitle && normalizeWhitespace(safeTitle) !== normalizeWhitespace(safeText)) {
    if (isMetadataOnlyTitleSuffix(safeText, safeTitle)) {
      return safeText;
    }

    return safeTitle;
  }

  if (safeText) {
    return safeText;
  }

  if (safeTitle) {
    return safeTitle;
  }

  if (safeAriaLabel) {
    return safeAriaLabel;
  }

  return null;
}

function getSafeTextValue(value) {
  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue || looksLikeBlankValue(normalizedValue)) {
    return "";
  }

  return normalizedValue;
}

function getSafeAttributeValue(value) {
  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue || looksLikeActionLabel(normalizedValue) || looksLikeBlankValue(normalizedValue)) {
    return "";
  }

  return normalizedValue;
}

function isMetadataOnlyTitleSuffix(text, title) {
  if (!text || !title || !title.startsWith(text)) {
    return false;
  }

  const suffix = title.slice(text.length);
  if (!suffix.trim()) {
    return false;
  }

  return /^\s*(\([^)]*\)|\[[^\]]*\])(\s*(\([^)]*\)|\[[^\]]*\]))*$/i.test(suffix);
}

function getTrimmedAttribute(element, attributeName) {
  if (!element || typeof element.getAttribute !== "function") {
    return "";
  }

  return (element.getAttribute(attributeName) || "").trim();
}

function getTrimmedText(element) {
  if (!element) {
    return "";
  }

  const rawText =
    typeof element.innerText === "string"
      ? element.innerText
      : typeof element.textContent === "string"
        ? element.textContent
        : "";

  return normalizeWhitespace(rawText);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeActionLabel(value) {
  const normalizedValue = normalizeWhitespace(value).toLowerCase();
  if (!normalizedValue) {
    return false;
  }

  if (/^(open|show|send|email|mail|call|dial|open in|launch|navigate to|go to|compose|write)\b/.test(normalizedValue)) {
    return true;
  }

  return [
    "open details",
    "open record",
    "open item",
    "show more",
    "show details",
    "look up",
    "lookup",
    "drill down",
    "assist edit",
    "choose",
    "select"
  ].some((phrase) => normalizedValue.startsWith(phrase));
}

function looksLikeBlankValue(value) {
  const normalizedValue = normalizeWhitespace(value).toLowerCase();

  return normalizedValue === "(blank)" || normalizedValue === "blank";
}
