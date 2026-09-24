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

import Mermaid, { FALLBACK_FONT_FAMILY, appFontFamily, fitViewBox } from "./Mermaid";

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

  it("widens the inserted SVG's viewBox to cover what was actually drawn", async () => {
    mermaidRender.mockResolvedValue({
      svg: '<svg viewBox="4 4 400 100" style="max-width: 400px;"><g></g></svg>',
    });
    // jsdom has no layout; pretend the live diagram paints past the right and bottom edges.
    const getBBox = vi.fn(() => ({ x: 12, y: 12, width: 480, height: 150 }) as DOMRect);
    Object.defineProperty(SVGElement.prototype, "getBBox", { value: getBBox, configurable: true });
    try {
      const { container } = render(<Mermaid code={"flowchart LR\n  a --> b"} />);
      await waitFor(() => expect(container.querySelector(".mermaid svg")).not.toBeNull());
      const svg = container.querySelector(".mermaid svg") as SVGSVGElement;
      expect(svg.getAttribute("viewBox")).toBe("4 4 496 166");
      expect(svg.style.maxWidth).toBe("496px");
    } finally {
      delete (SVGElement.prototype as Partial<SVGGraphicsElement>).getBBox;
    }
  });
});

describe("fitViewBox", () => {
  function svgWith(viewBox: string | null, bbox: { x: number; y: number; width: number; height: number }) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (viewBox !== null) svg.setAttribute("viewBox", viewBox);
    svg.getBBox = () => bbox as DOMRect;
    return svg;
  }

  it("leaves a viewBox that already covers the drawing untouched", () => {
    const svg = svgWith("4 4 936 341.3000183105469", { x: 12, y: 12, width: 920, height: 325.30002 });
    expect(fitViewBox(svg)).toBe(false);
    expect(svg.getAttribute("viewBox")).toBe("4 4 936 341.3000183105469");
  });

  it("grows the box on every side the drawing spills past, keeping Mermaid's padding", () => {
    const svg = svgWith("0 0 100 50", { x: -20, y: -10, width: 150, height: 80 });
    expect(fitViewBox(svg)).toBe(true);
    expect(svg.getAttribute("viewBox")).toBe("-28 -18 166 96");
  });

  it("never shrinks a viewBox that is larger than the drawing", () => {
    const svg = svgWith("-50 -10 1164 587", { x: 0, y: 0, width: 1064, height: 536 });
    expect(fitViewBox(svg)).toBe(false);
    expect(svg.getAttribute("viewBox")).toBe("-50 -10 1164 587");
  });

  it("does nothing without a viewBox or when nothing was laid out", () => {
    expect(fitViewBox(svgWith(null, { x: 0, y: 0, width: 10, height: 10 }))).toBe(false);
    expect(fitViewBox(svgWith("0 0 10 10", { x: 0, y: 0, width: 0, height: 0 }))).toBe(false);
  });
});
