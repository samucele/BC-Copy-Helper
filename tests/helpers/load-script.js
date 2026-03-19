import fs from "node:fs";
import vm from "node:vm";

export function loadBrowserScript(filePath, globals = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const contextGlobals = {
    console,
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
    ...globals
  };

  contextGlobals.globalThis = contextGlobals;
  contextGlobals.self = contextGlobals.self || contextGlobals;

  const context = vm.createContext(contextGlobals);
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);

  return context;
}
