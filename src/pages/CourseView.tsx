import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { CourseDetail, PageDetail, TocItem } from "../../shared/types";
import { ApiError, getCourse, getPage } from "../api";
import { useCatalog } from "../catalog";
import Markdown from "../components/Markdown";
import Pager from "../components/Pager";
import SourcesFooter from "../components/SourcesFooter";
import Toc from "../components/Toc";
import { coursePath, neighbors } from "../courseNav";
import { markVisited } from "../progress";
import { useProgress } from "../ProgressProvider";

export { neighbors } from "../courseNav";

const QUIZ_PREFIX = "_quiz/";
const DRAWER_BREAKPOINT = 860;

type CourseState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; course: CourseDetail };

type PageState =
  | { status: "loading" }
  | { status: "error"; kind: "not-found" | "other"; message?: string }
  | { status: "ready"; page: PageDetail };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Directory portion of a content-relative file path (posix). */
function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= DRAWER_BREAKPOINT;
}

/**
 * Placeholder for a `_quiz/<quizSlug>` TOC item: Task 5 replaces this body
 * with the inline QuizRunner. Kept as its own function so that swap touches
 * only this spot.
 */
function QuizPlaceholder({ quizSlug, title }: { quizSlug: string; title: string }) {
  return (
    <div className="card">
      <p className="card__meta">Quiz</p>
      <h1>{title}</h1>
      <p>
        <Link to={`/quizzes/${encodeURIComponent(quizSlug)}`} className="button button--primary">
          Open quiz
        </Link>
      </p>
    </div>
  );
}

export default function CourseView() {
  const params = useParams<{ slug: string; "*"?: string }>();
  const slug = params.slug as string;
  const rawPath = params["*"];
  const path = rawPath && rawPath.length > 0 ? rawPath : null;
  const quizSlug = path && path.startsWith(QUIZ_PREFIX) ? path.slice(QUIZ_PREFIX.length) : null;

  const { progress, update } = useProgress();
  const catalog = useCatalog();
  const navigate = useNavigate();

  const [courseState, setCourseState] = useState<CourseState>({ status: "loading" });
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen());

  useEffect(() => {
    let cancelled = false;
    setCourseState({ status: "loading" });
    getCourse(slug)
      .then((course) => {
        if (!cancelled) setCourseState({ status: "ready", course });
      })
      .catch((err: unknown) => {
        if (!cancelled) setCourseState({ status: "error", message: messageOf(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (path === null || quizSlug !== null) return;
    let cancelled = false;
    setPageState({ status: "loading" });
    getPage(slug, path)
      .then((page) => {
        if (cancelled) return;
        setPageState({ status: "ready", page });
        update((p) => markVisited(p, slug, path));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setPageState({ status: "error", kind: "not-found" });
        } else {
          setPageState({ status: "error", kind: "other", message: messageOf(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, path, quizSlug, update]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (isNarrowScreen()) setSidebarOpen(false);
  }, [slug, path]);

  const toc = courseState.status === "ready" ? courseState.course.toc : [];
  const { prev, next } = path === null ? { prev: null, next: toc[0] ?? null } : neighbors(toc, path);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "ArrowLeft" && prev) {
        navigate(coursePath(slug, prev.path));
      } else if (e.key === "ArrowRight" && next) {
        navigate(coursePath(slug, next.path));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [slug, prev, next, navigate]);

  if (courseState.status === "loading") {
    return (
      <main className="page center-message">
        <p role="status">Loading…</p>
      </main>
    );
  }
  if (courseState.status === "error") {
    return (
      <main className="page center-message">
        <p role="alert">{courseState.message}</p>
      </main>
    );
  }

  const course = courseState.course;

  function renderLanding() {
    const lastPage = progress.courses[slug]?.lastPage ?? null;
    const startItem = toc[0] ?? null;
    const href = lastPage
      ? coursePath(slug, lastPage)
      : startItem
        ? coursePath(slug, startItem.path)
        : `/courses/${encodeURIComponent(slug)}`;
    return (
      <>
        <h1>{course.title}</h1>
        <Markdown source={course.intro} baseDir={`courses/${slug}`} />
        {startItem && (
          <p>
            <Link to={href} className="button button--primary">
              {lastPage ? "Continue" : "Start"}
            </Link>
          </p>
        )}
      </>
    );
  }

  function renderQuiz(slugOfQuiz: string) {
    const item = toc.find((i) => i.path === path);
    return <QuizPlaceholder quizSlug={slugOfQuiz} title={item?.title ?? slugOfQuiz} />;
  }

  function renderPage() {
    if (pageState.status === "loading") {
      return <p role="status">Loading…</p>;
    }
    if (pageState.status === "error") {
      if (pageState.kind === "not-found") {
        return (
          <div className="center-message">
            <h1>Page not found</h1>
            <p>
              <Link to={`/courses/${encodeURIComponent(slug)}`}>Back to {course.title}</Link>
            </p>
          </div>
        );
      }
      return <p role="alert">{pageState.message}</p>;
    }

    const page = pageState.page;
    const item: TocItem | undefined = toc.find((i) => i.path === path);
    const pageItems = toc.filter((i) => i.type === "page");
    const n = pageItems.findIndex((i) => i.path === path) + 1;
    const m = pageItems.length;

    return (
      <>
        <p className="breadcrumb">
          {item?.section ? `${item.section} · ` : ""}Lesson {n} of {m}
        </p>
        <h1>{page.title}</h1>
        <Markdown source={page.body} baseDir={dirname(page.file)} />
        <SourcesFooter sources={page.sources} repoRoot={catalog.repoRoot} />
      </>
    );
  }

  const showPager = path === null || quizSlug !== null || pageState.status === "ready";

  return (
    <div className={`course-layout${sidebarOpen ? "" : " is-collapsed"}`}>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <Toc
        courseSlug={slug}
        courseTitle={course.title}
        toc={toc}
        currentPath={path}
        open={sidebarOpen}
        onNavigate={() => {
          if (isNarrowScreen()) setSidebarOpen(false);
        }}
      />
      <main className="course-main page">
        <button
          type="button"
          className="sidebar-toggle icon-button"
          aria-label={sidebarOpen ? "Collapse table of contents" : "Expand table of contents"}
          aria-expanded={sidebarOpen}
          aria-controls="course-toc"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          ☰
        </button>
        {path === null ? renderLanding() : quizSlug !== null ? renderQuiz(quizSlug) : renderPage()}
        {showPager && <Pager courseSlug={slug} prev={prev} next={next} />}
      </main>
    </div>
  );
}
