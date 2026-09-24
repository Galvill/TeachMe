// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mermaidRender = vi.fn();
const mermaidInitialize = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mermaidInitialize(...args),
    render: (...args: unknown[]) => mermaidRender(...args),
  },
}));

import Mermaid, { FALLBACK_FONT_FAMILY, appFontFamily } from "./Mermaid";

describe("Mermaid", () => {
  beforeEach(() => {
    mermaidRender.mockResolvedValue({ svg: "<svg></svg>" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty("--font-sans");
  });

  it("falls back to the app font stack when --font-sans is unset", () => {
    expect(appFontFamily()).toBe(FALLBACK_FONT_FAMILY);
  });

  it("reads --font-sans from the document when set", () => {
    document.documentElement.style.setProperty("--font-sans", "Inter, sans-serif");
    expect(appFontFamily()).toBe("Inter, sans-serif");
  });

  it("initializes mermaid with an explicit fontFamily and SVG-text labels before rendering", async () => {
    const { container } = render(<Mermaid code={"flowchart LR\n  a --> b"} />);
    await waitFor(() => expect(container.querySelector(".mermaid svg")).not.toBeNull());
    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        fontFamily: FALLBACK_FONT_FAMILY,
        themeVariables: expect.objectContaining({ fontFamily: FALLBACK_FONT_FAMILY }),
      }),
    );
    expect(mermaidInitialize.mock.invocationCallOrder[0]).toBeLessThan(mermaidRender.mock.invocationCallOrder[0]);
  });
});
