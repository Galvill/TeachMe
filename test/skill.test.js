import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { parseQuestion } from "../server/quizParser.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(repoRoot, "skill/teachme-authoring");
const skillMd = path.join(skillDir, "SKILL.md");
const formatMd = path.join(skillDir, "reference/format.md");

/**
 * Bodies of every ```md / ````md fenced block in `text`. A fence closes on a
 * line holding exactly the same backtick run, so a 4-backtick fence may
 * contain inner ``` fences.
 * @param {string} text
 * @returns {string[]}
 */
function mdFences(text) {
  const re = /^(`{3,4})md[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm;
  /** @type {string[]} */
  const bodies = [];
  /** @type {RegExpExecArray | null} */
  let match;
  while ((match = re.exec(text))) bodies.push(match[2]);
  return bodies;
}

describe("teachme-authoring skill", () => {
  it("skill frontmatter", () => {
    const { data } = matter(fs.readFileSync(skillMd, "utf8"), {});
    expect(data.name).toBe("teachme-authoring");
    expect(typeof data.description).toBe("string");
    expect(data.description).toMatch(/^Use when/);
  });

  it("format examples parse", () => {
    const questions = mdFences(fs.readFileSync(formatMd, "utf8")).filter((body) =>
      body.includes("## Options"),
    );
    expect(questions.length).toBeGreaterThan(0);
    for (const body of questions) {
      const { content } = matter(body, {});
      const parsed = parseQuestion(content);
      expect(parsed.errors, body).toEqual([]);
    }
  });

  it("referenced files exist", () => {
    const text = fs.readFileSync(skillMd, "utf8");
    const refs = new Set(
      [...text.matchAll(/(?:reference|examples)\/[\w./-]*/g)].map((m) =>
        m[0].replace(/\.+$/, ""),
      ),
    );
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(fs.existsSync(path.join(skillDir, ref)), ref).toBe(true);
    }
  });
});
