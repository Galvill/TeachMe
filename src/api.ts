import type { Catalog, CourseDetail, PageDetail, ProjectProgress, QuizDetail } from "../shared/types";

/** Thrown by every request helper below on a non-2xx response. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Encode a single path segment; used to build slug segments of a URL. */
function encodeSlug(slug: string): string {
  return encodeURIComponent(slug);
}

/** Encode a page path, keeping `/` as a segment separator. */
function encodePagePath(pagePath: string): string {
  return pagePath.split("/").map(encodeURIComponent).join("/");
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // fall through to the generic message below
  }
  return `HTTP ${res.status}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function getCatalog(): Promise<Catalog> {
  return request<Catalog>("/api/catalog");
}

export function getCourse(slug: string): Promise<CourseDetail> {
  return request<CourseDetail>(`/api/courses/${encodeSlug(slug)}`);
}

export function getPage(slug: string, path: string): Promise<PageDetail> {
  return request<PageDetail>(`/api/courses/${encodeSlug(slug)}/pages/${encodePagePath(path)}`);
}

export function getQuiz(slug: string): Promise<QuizDetail> {
  return request<QuizDetail>(`/api/quizzes/${encodeSlug(slug)}`);
}

export function getProgress(): Promise<ProjectProgress> {
  return request<ProjectProgress>("/api/progress");
}

export function putProgress(p: ProjectProgress): Promise<void> {
  return request<void>("/api/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
}
