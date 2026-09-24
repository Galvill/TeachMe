import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getCatalog,
  getCourse,
  getPage,
  getProgress,
  getQuiz,
  putProgress,
} from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getCatalog fetches /api/catalog and returns the parsed body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { project: "p", repoRoot: "/r", courses: [], quizzes: [], errors: [], warnings: [] }));
    const catalog = await getCatalog();
    expect(fetchMock).toHaveBeenCalledWith("/api/catalog", undefined);
    expect(catalog.project).toBe("p");
  });

  it("getCourse encodes the slug", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await getCourse("a b/c");
    expect(fetchMock).toHaveBeenCalledWith("/api/courses/a%20b%2Fc", undefined);
  });

  it("getPage encodes each path segment but keeps the slashes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await getPage("intro", "ch 1/page one.md");
    expect(fetchMock).toHaveBeenCalledWith("/api/courses/intro/pages/ch%201/page%20one.md", undefined);
  });

  it("getQuiz encodes the slug", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await getQuiz("quiz one");
    expect(fetchMock).toHaveBeenCalledWith("/api/quizzes/quiz%20one", undefined);
  });

  it("getProgress fetches /api/progress", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { courses: {}, quizzes: {} }));
    const progress = await getProgress();
    expect(fetchMock).toHaveBeenCalledWith("/api/progress", undefined);
    expect(progress).toEqual({ courses: {}, quizzes: {} });
  });

  it("putProgress PUTs the whole object and resolves on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await putProgress({ courses: {}, quizzes: {} });
    expect(fetchMock).toHaveBeenCalledWith("/api/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courses: {}, quizzes: {} }),
    });
  });

  it("throws ApiError with status and the body's error string on non-2xx", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: "Not found" }));
    await expect(getCatalog()).rejects.toMatchObject({ status: 404, message: "Not found" });
    await expect(getCatalog()).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to 'HTTP <status>' when the body has no error string", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    await expect(getCatalog()).rejects.toMatchObject({ status: 500, message: "HTTP 500" });
  });
});
