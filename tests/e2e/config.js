import fs from "node:fs";
import path from "node:path";

export const LOCAL_CONFIG_PATH = path.join(process.cwd(), "tests", "e2e", "local.config.json");
export const LOCAL_CONFIG_EXAMPLE_PATH = path.join(process.cwd(), "tests", "e2e", "local.config.example.json");

export function buildHostPattern(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.origin}/*`;
}

export function buildScenarioUrl(config, scenario) {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(scenario.path ?? scenario.url, baseUrl);

  if (config.tenant && !url.searchParams.has("tenant")) {
    url.searchParams.set("tenant", config.tenant);
  }

  if (config.company && !url.searchParams.has("company")) {
    url.searchParams.set("company", config.company);
  }

  return url.toString().replace(/\+/g, "%20");
}

export function loadLocalE2EConfig(options = {}) {
  const { allowMissing = false } = options;

  if (!fs.existsSync(LOCAL_CONFIG_PATH)) {
    if (allowMissing) {
      return null;
    }

    throw new Error(
      `Missing ${LOCAL_CONFIG_PATH}. Copy ${LOCAL_CONFIG_EXAMPLE_PATH} and fill in your local Docker values.`
    );
  }

  const rawConfig = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, "utf8"));
  return validateConfig(rawConfig);
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireNonEmptyString(value, fieldName) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(`Expected "${fieldName}" to be a non-empty string in ${LOCAL_CONFIG_PATH}.`);
  }

  return normalizedValue;
}

function validateScenario(rawScenario, index) {
  const scenarioName = requireNonEmptyString(rawScenario?.name, `scenarios[${index}].name`);
  const scenarioPath = requireNonEmptyString(
    rawScenario?.path ?? rawScenario?.url,
    `scenarios[${index}].path`
  );
  const targetSelector = requireNonEmptyString(
    rawScenario?.targetSelector,
    `scenarios[${index}].targetSelector`
  );
  const expectedClipboard = requireNonEmptyString(
    rawScenario?.expectedClipboard,
    `scenarios[${index}].expectedClipboard`
  );

  return {
    name: scenarioName,
    path: scenarioPath,
    targetSelector,
    targetText: normalizeOptionalString(rawScenario?.targetText),
    readySelector: normalizeOptionalString(rawScenario?.readySelector) || targetSelector,
    expectedClipboard
  };
}

function validateConfig(rawConfig) {
  const scenarios = Array.isArray(rawConfig?.scenarios) ? rawConfig.scenarios : [];

  if (scenarios.length === 0) {
    throw new Error(`Expected "scenarios" to contain at least one entry in ${LOCAL_CONFIG_PATH}.`);
  }

  return {
    baseUrl: requireNonEmptyString(rawConfig?.baseUrl, "baseUrl"),
    tenant: normalizeOptionalString(rawConfig?.tenant) || "default",
    company: requireNonEmptyString(rawConfig?.company, "company"),
    credentials: {
      username: normalizeOptionalString(rawConfig?.credentials?.username),
      password: normalizeOptionalString(rawConfig?.credentials?.password)
    },
    login: {
      usernameSelector:
        normalizeOptionalString(rawConfig?.login?.usernameSelector) || "input[name='UserName']",
      passwordSelector:
        normalizeOptionalString(rawConfig?.login?.passwordSelector) || "input[name='Password']",
      submitSelector:
        normalizeOptionalString(rawConfig?.login?.submitSelector) ||
        "button[type='submit'], input[type='submit']"
    },
    scenarios: scenarios.map((scenario, index) => validateScenario(scenario, index))
  };
}
