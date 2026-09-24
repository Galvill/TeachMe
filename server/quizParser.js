/** @typedef {import('../shared/types.js').ParsedQuestion} ParsedQuestion */

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^##(?!#)\s+(.+?)\s*$/;
const OPTION_RE = /^-\s*\[([ xX])\]\s*(.*)$/;

/**
 * Locate level-2 (`## `) headings in `lines`, ignoring any that fall inside
 * fenced code blocks (backtick or tilde fences).
 * @param {string[]} lines
 * @returns {{ index: number; name: string }[]}
 */
function findHeadings(lines) {
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_RE.exec(line);
    if (match) headings.push({ index: i, name: match[1] });
  }
  return headings;
}

/**
 * Parse the body of a question Markdown file (frontmatter already stripped)
 * into its prompt, options, and explanation.
 * @param {string} body
 * @returns {ParsedQuestion}
 */
export function parseQuestion(body) {
  const lines = body.split(/\r?\n/);
  const headings = findHeadings(lines);

  /** @type {string[]} */
  const errors = [];

  const optionsHeading = headings.find(
    (h) => h.name.toLowerCase() === "options",
  );

  if (!optionsHeading) {
    errors.push('Missing "## Options" section');
    return {
      prompt: body.trim(),
      options: [],
      multi: false,
      explanation: findExplanation(lines, headings),
      errors,
    };
  }

  const prompt = lines.slice(0, optionsHeading.index).join("\n").trim();

  const nextHeadingAfterOptions = headings.find(
    (h) => h.index > optionsHeading.index,
  );
  const optionsEnd = nextHeadingAfterOptions
    ? nextHeadingAfterOptions.index
    : lines.length;
  const optionLines = lines.slice(optionsHeading.index + 1, optionsEnd);

  /** @type {{ md: string; correct: boolean }[]} */
  const options = [];
  for (const line of optionLines) {
    if (line.trim() === "") continue;
    const match = OPTION_RE.exec(line.trim());
    if (match) {
      options.push({ md: match[2].trim(), correct: match[1] !== " " });
    } else {
      errors.push(`Unexpected line in Options: "${line.trim()}"`);
    }
  }

  if (options.length < 2) {
    errors.push("Needs at least 2 options");
  }
  const correctCount = options.filter((o) => o.correct).length;
  if (correctCount === 0) {
    errors.push("No correct option marked");
  }

  return {
    prompt,
    options,
    multi: correctCount > 1,
    explanation: findExplanation(lines, headings),
    errors,
  };
}

/**
 * @param {string[]} lines
 * @param {{ index: number; name: string }[]} headings
 * @returns {string | null}
 */
function findExplanation(lines, headings) {
  const explanationHeading = headings.find(
    (h) => h.name.toLowerCase() === "explanation",
  );
  if (!explanationHeading) return null;

  const nextHeadingAfterExplanation = headings.find(
    (h) => h.index > explanationHeading.index,
  );
  const explanationEnd = nextHeadingAfterExplanation
    ? nextHeadingAfterExplanation.index
    : lines.length;

  return lines
    .slice(explanationHeading.index + 1, explanationEnd)
    .join("\n")
    .trim();
}
