// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders title", () => {
    const { container } = render(<App />);
    expect(container.textContent).toContain("TeachMe");
  });
});
