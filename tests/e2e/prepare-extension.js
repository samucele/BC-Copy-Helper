import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function addUnique(items, value) {
  return items.includes(value) ? items : [...items, value];
}

function patchServiceWorkerMatchPatterns(source, hostPattern) {
  const pattern = /const BC_MATCH_PATTERNS = \[\s*([\s\S]*?)\s*\];/m;
  const match = source.match(pattern);

  if (!match) {
    throw new Error("Unable to locate BC_MATCH_PATTERNS in the test copy of service_worker.js.");
  }

  const existingPatterns = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  const updatedPatterns = addUnique(existingPatterns, hostPattern);
  const replacement = `const BC_MATCH_PATTERNS = [\n${updatedPatterns
    .map((item) => `  "${item}"`)
    .join(",\n")}\n];`;

  return source.replace(pattern, replacement);
}

export async function prepareExtensionForE2E(hostPattern) {
  const extensionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bc-copy-helper-extension-"));
  const sourceRoot = process.cwd();

  await fs.cp(path.join(sourceRoot, "src"), path.join(extensionRoot, "src"), {
    recursive: true
  });

  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, "manifest.json"), "utf8"));

  manifest.permissions = addUnique(manifest.permissions ?? [], "tabs");
  manifest.permissions = addUnique(manifest.permissions ?? [], "webNavigation");
  manifest.host_permissions = addUnique(manifest.host_permissions ?? [], hostPattern);
  manifest.content_scripts = (manifest.content_scripts ?? []).map((entry) => ({
    ...entry,
    matches: addUnique(entry.matches ?? [], hostPattern)
  }));

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const serviceWorkerPath = path.join(extensionRoot, "src", "background", "service_worker.js");
  const serviceWorkerSource = await fs.readFile(serviceWorkerPath, "utf8");
  await fs.writeFile(
    serviceWorkerPath,
    patchServiceWorkerMatchPatterns(serviceWorkerSource, hostPattern),
    "utf8"
  );

  return {
    extensionRoot,
    async cleanup() {
      await fs.rm(extensionRoot, {
        recursive: true,
        force: true
      });
    }
  };
}
