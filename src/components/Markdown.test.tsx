// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const codeToHtml = vi.fn();
const mermaidRender = vi.fn();
const mermaidInitialize = vi.fn();

vi.mock("shiki", () => ({
  codeToHtml: (...args: unknown[]) => codeToHtml(...args),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mermaidInitialize(...args),
    render: (...args: unknown[]) => mermaidRender(...args),
  },
}));

import Markdown, { resolveContentUrl } from "./Markdown";

describe("resolveContentUrl", () => {
  it("joins and normalizes a relative path under baseDir", () => {
    expect(resolveContentUrl("lessons/01", "img.png")).toBe("/content/lessons/01/img.png");
  });

  it("resolves ../ segments", () => {
    expect(resolveContentUrl("lessons/01", "../assets/img.png")).toBe("/content/lessons/assets/img.png");
  });

  it("clamps at the content root when .. would escape it", () => {
    expect(resolveContentUrl("lessons", "../../../etc/passwd")).toBe("/content/etc/passwd");
  });

  it("leaves absolute URLs with a scheme untouched", () => {
    expect(resolveContentUrl("lessons/01", "https://example.com/img.png")).toBe("https://example.com/img.png");
    expect(resolveContentUrl("lessons/01", "data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("leaves root-relative and fragment URLs untouched", () => {
    expect(resolveContentUrl("lessons/01", "/static/img.png")).toBe("/static/img.png");
    expect(resolveContentUrl("lessons/01", "#section")).toBe("#section");
  });
});

describe("Markdown", () => {
  beforeEach(() => {
    codeToHtml.mockReset();
    mermaidRender.mockReset();
    mermaidInitialize.mockReset();
  });

  afterEach(() => {
    document.body.querySelectorAll('[id^="mermaid-"], [id^="dmermaid-"]').forEach((el) => el.remove());
  });

  it("renders gfm table", () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    render(<Markdown source={source} baseDir="" />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1" })).toBeTruthy();
  });

  it("rewrites relative image", () => {
    render(<Markdown source="![alt text](img.png)" baseDir="lessons/01" />);
    const img = screen.getByRole("img", { name: "alt text" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/content/lessons/01/img.png");
  });

  it("leaves absolute image URLs untouched", () => {
    render(<Markdown source="![alt](https://example.com/img.png)" baseDir="lessons/01" />);
    const img = screen.getByRole("img", { name: "alt" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://example.com/img.png");
  });

  it("opens external links in a new tab", () => {
    render(<Markdown source="[ext](https://example.com)" baseDir="" />);
    const link = screen.getByRole("link", { name: "ext" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("mermaid failure shows source", async () => {
    mermaidRender.mockRejectedValue(new Error("Parse error on line 1"));
    const source = ["```mermaid", "graph TD", "  a --> b", "```"].join("\n");
    render(<Markdown source={source} baseDir="" />);

    await waitFor(() => expect(screen.getByText("Parse error on line 1")).toBeTruthy());
    const pre = screen.getByText(/graph TD/);
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("a --> b");
  });

  it("unknown language falls back", async () => {
    codeToHtml.mockRejectedValue(new Error("Unknown language"));
    const source = ["```notalang", "const x = 1;", "```"].join("\n");
    render(<Markdown source={source} baseDir="" />);

    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());
    const pre = await screen.findByText(/const x = 1;/);
    expect(pre.tagName).toBe("CODE");
    expect(pre.closest("pre")).toBeTruthy();
    expect(pre.closest("pre")?.innerHTML).not.toContain("shiki");
  });

  it("highlights known languages with shiki", async () => {
    codeToHtml.mockResolvedValue('<pre class="shiki"><code><span>const</span></code></pre>');
    const source = ["```js", "const x = 1;", "```"].join("\n");
    const { container } = render(<Markdown source={source} baseDir="" />);

    await waitFor(() => expect(container.querySelector("pre.shiki")).toBeTruthy());
    expect(codeToHtml).toHaveBeenCalledWith("const x = 1;\n", expect.objectContaining({ lang: "js" }));
  });

  it("renders inline code unchanged", () => {
    render(<Markdown source="use `foo()` here" baseDir="" />);
    const code = screen.getByText("foo()");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).toBeNull();
  });
});
