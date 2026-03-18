const OFFSCREEN_COPY_MESSAGE_TYPE = "offscreen_copy_text";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen" || message.type !== OFFSCREEN_COPY_MESSAGE_TYPE) {
    return false;
  }

  copyText(message.text)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

async function copyText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Missing clipboard text.");
  }

  const textArea = document.getElementById("copy-target");
  if (!(textArea instanceof HTMLTextAreaElement)) {
    throw new Error("Clipboard target element not found.");
  }

  textArea.value = text;
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  const copied = document.execCommand("copy");
  textArea.value = "";

  if (!copied) {
    throw new Error("document.execCommand('copy') returned false.");
  }
}
