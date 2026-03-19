import { vi } from "vitest";

function createEvent() {
  const listeners = [];

  return {
    listeners,
    addListener: vi.fn((listener) => {
      listeners.push(listener);
    })
  };
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function mergeInto(target, source) {
  if (!source) {
    return target;
  }

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
      continue;
    }

    target[key] = value;
  }

  return target;
}

export function createChromeMock(overrides = {}) {
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: createEvent(),
      onMessage: createEvent(),
      onStartup: createEvent(),
      sendMessage: vi.fn(async () => ({ ok: true })),
      getContexts: vi.fn(async () => []),
      getURL: vi.fn((resourcePath) => `chrome-extension://test/${resourcePath}`)
    },
    contextMenus: {
      removeAll: vi.fn((callback) => callback?.()),
      create: vi.fn((options, callback) => callback?.()),
      onClicked: createEvent()
    },
    offscreen: {
      createDocument: vi.fn(async () => {})
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: true, value: "" }))
    }
  };

  return mergeInto(chrome, overrides);
}
