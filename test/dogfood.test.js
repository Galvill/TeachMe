import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadContent } from "../server/content.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("dogfood course", () => {
  it("dogfood content is clean", () => {
    const content = loadContent(path.join(repoRoot, ".teachme"), { repoRoot });
    expect(content.errors).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(content.courses.map((c) => c.slug)).toContain("how-teachme-works");
  });
});
