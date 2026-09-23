// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SourcesFooter from "./SourcesFooter";

describe("SourcesFooter", () => {
  it("links a POSIX repo root without a double slash", () => {
    render(<SourcesFooter sources={["src/app.ts"]} repoRoot="/home/me/repo" />);
    expect(screen.getByRole("link", { name: "src/app.ts" }).getAttribute("href")).toBe(
      "vscode://file/home/me/repo/src/app.ts",
    );
  });

  it("links a Windows-style repo root with forward slashes", () => {
    render(<SourcesFooter sources={["src/app.ts"]} repoRoot={"C:\\Users\\me\\repo"} />);
    expect(screen.getByRole("link", { name: "src/app.ts" }).getAttribute("href")).toBe(
      "vscode://file/C:/Users/me/repo/src/app.ts",
    );
  });

  it("renders nothing without sources", () => {
    const { container } = render(<SourcesFooter sources={[]} repoRoot="/r" />);
    expect(container.innerHTML).toBe("");
  });
});
