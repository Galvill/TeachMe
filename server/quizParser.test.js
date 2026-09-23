import { describe, expect, it } from "vitest";
import { parseQuestion } from "./quizParser.js";

// Spec §2.6 example body, verbatim, frontmatter stripped.
const SPEC_EXAMPLE = `What does \`OrderService\` do when a payment fails?

(optional context: code, mermaid)

## Options
- [ ] Retries the charge until it succeeds
- [x] Marks the order \`PAYMENT_FAILED\` and emits \`order.failed\`
- [ ] Deletes the order

## Explanation
Shown after answering. See \`src/orders/service.ts\` → \`handlePaymentError()\`.
`;

describe("parseQuestion", () => {
  it("single choice", () => {
    const result = parseQuestion(SPEC_EXAMPLE);

    expect(result.prompt).toBe(
      "What does `OrderService` do when a payment fails?\n\n(optional context: code, mermaid)",
    );
    expect(result.options).toEqual([
      { md: "Retries the charge until it succeeds", correct: false },
      {
        md: "Marks the order `PAYMENT_FAILED` and emits `order.failed`",
        correct: true,
      },
      { md: "Deletes the order", correct: false },
    ]);
    expect(result.multi).toBe(false);
    expect(result.explanation).toBe(
      "Shown after answering. See `src/orders/service.ts` → `handlePaymentError()`.",
    );
    expect(result.errors).toEqual([]);
  });

  it("multi select", () => {
    const body = `Which are true?

## Options
- [x] First
- [x] Second
- [ ] Third
`;
    const result = parseQuestion(body);

    expect(result.multi).toBe(true);
    expect(
      result.options.filter((/** @type {{ correct: boolean }} */ o) => o.correct),
    ).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it("missing options", () => {
    const body = `Just a prompt, no options section.`;
    const result = parseQuestion(body);

    expect(result.errors).toContain('Missing "## Options" section');
  });

  it("one option", () => {
    const body = `Prompt.

## Options
- [x] Only one
`;
    const result = parseQuestion(body);

    expect(result.errors).toContain("Needs at least 2 options");
  });

  it("no correct", () => {
    const body = `Prompt.

## Options
- [ ] First
- [ ] Second
`;
    const result = parseQuestion(body);

    expect(result.errors).toContain("No correct option marked");
  });

  it("stray line", () => {
    const body = `Prompt.

## Options
- [ ] First
This line is not a task item
- [x] Second
`;
    const result = parseQuestion(body);

    expect(result.errors).toContain(
      'Unexpected line in Options: "This line is not a task item"',
    );
  });

  it("headings in code fences ignored", () => {
    const body = `Prompt with a fenced example:

\`\`\`
## Options
- [x] Not real
\`\`\`

## Options
- [ ] First
- [x] Second
`;
    const result = parseQuestion(body);

    expect(result.prompt).toBe(
      "Prompt with a fenced example:\n\n```\n## Options\n- [x] Not real\n```",
    );
    expect(result.options).toEqual([
      { md: "First", correct: false },
      { md: "Second", correct: true },
    ]);
    expect(result.errors).toEqual([]);
  });
});
