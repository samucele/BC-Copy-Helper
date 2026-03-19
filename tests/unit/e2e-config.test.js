import { describe, expect, it } from "vitest";

import { buildScenarioUrl } from "../e2e/config.js";

describe("E2E config URL building", () => {
  it("encodes company names with spaces using %20", () => {
    const url = buildScenarioUrl(
      {
        baseUrl: "http://saas274cz/BC",
        tenant: "default",
        company: "CRONUS CZ"
      },
      {
        path: "?page=22"
      }
    );

    expect(url).toContain("tenant=default");
    expect(url).toContain("company=CRONUS%20CZ");
    expect(url).not.toContain("company=CRONUS+CZ");
  });

  it("preserves an explicit company query parameter already present in the scenario path", () => {
    const url = buildScenarioUrl(
      {
        baseUrl: "http://saas274cz/BC",
        tenant: "default",
        company: "CRONUS CZ"
      },
      {
        path: "?page=22&company=My%20Custom%20Company"
      }
    );

    expect(url).toContain("company=My%20Custom%20Company");
    expect(url).not.toContain("company=CRONUS%20CZ");
  });
});
