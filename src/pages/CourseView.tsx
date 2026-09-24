import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate, useParams, type NavigateFunction } from "react-router";
import type { CourseDetail, PageDetail, QuizDetail, TocItem } from "../../shared/types";
import { ApiError, getCourse, getPage, getQuiz } from "../api";
import { useCatalog } from "../catalog";
import Markdown from "../components/Markdown";
import Pager, { CATALOG_LABEL } from "../components/Pager";
import QuizRunner from "../components/QuizRunner";
import ResetCourseButton from "../components/ResetCourseButton";
import SourcesFooter from "../components/SourcesFooter";
import Toc from "../components/Toc";
import { coursePath, neighbors } from "../courseNav";
import { markVisited } from "../progress";
import { useProgress } from "../ProgressProvider";
import { isNarrowScreen, useSidebar } from "../sidebar";

export { neighbors } from "../courseNav";

const QUIZ_PREFIX = "_quiz/";

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

type QuizState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; quiz: QuizDetail };

/**
 * Renders a `_quiz/<quizSlug>` TOC item inline: fetches the quiz and runs it
 * in course context. `onContinue` (passed to QuizRunner's results screen)
 * moves to the next TOC item; on the course's last item it becomes
 * "Back to catalog" and goes to `/`, matching the pager.
 */
function InlineQuiz({
  courseSlug,
  quizSlug,
  toc,
  path,
  navigate,
}: {
  courseSlug: string;
  quizSlug: string;
  toc: TocItem[];
  path: string;
  navigate: NavigateFunction;
}) {
  const [state, setState] = useState<QuizState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getQuiz(quizSlug)
      .then((quiz) => {
        if (!cancelled) setState({ status: "ready", quiz });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: messageOf(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [quizSlug]);

  if (state.status === "loading") {
    return <p role="status">Loading…</p>;
  }
  if (state.status === "error") {
    return <p role="alert">{state.message}</p>;
  }

  const { next } = neighbors(toc, path);

  function handleContinue() {
    navigate(next ? coursePath(courseSlug, next.path) : "/");
  }

  return (
    <QuizRunner
      quiz={state.quiz}
      context={`course:${courseSlug}`}
      onContinue={handleContinue}
      continueLabel={next ? undefined : CATALOG_LABEL}
    />
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
  const { open: sidebarOpen, setOpen: setSidebarOpen, setMounted: setSidebarMounted } = useSidebar();
  const courseReady = courseState.status === "ready";

  // The header shows the TOC toggle only while this view has a TOC mounted.
  // Layout effects, so the header and sidebar never paint out of sync.
  useLayoutEffect(() => {
    if (!courseReady) return;
    setSidebarMounted(true);
    return () => setSidebarMounted(false);
  }, [courseReady, setSidebarMounted]);

  // Each course starts with the TOC open on wide screens, closed on narrow ones.
  useLayoutEffect(() => {
    setSidebarOpen(!isNarrowScreen());
  }, [slug, setSidebarOpen]);

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
  }, [slug, path, setSidebarOpen]);

  const toc = courseState.status === "ready" ? courseState.course.toc : [];
  const { prev, next } = path === null ? { prev: null, next: toc[0] ?? null } : neighbors(toc, path);
  // On the course's last TOC item (page or quiz), the pager and → lead back to the catalog.
  const atEnd = path !== null && toc.length > 0 && toc[toc.length - 1].path === path;

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
      } else if (e.key === "ArrowRight" && atEnd) {
        // Same target as the pager's "Back to catalog" link on the last item.
        navigate("/");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [slug, prev, next, atEnd, navigate]);

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
  const quizSlugs = toc.flatMap((item) => (item.type === "quiz" && item.quizSlug ? [item.quizSlug] : []));

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
          <p className="course-landing__actions">
            <Link to={href} className="button button--primary">
              {lastPage ? "Continue" : "Start"}
            </Link>
            <ResetCourseButton courseSlug={slug} courseTitle={course.title} quizSlugs={quizSlugs} />
          </p>
        )}
      </>
    );
  }

  function renderQuiz(slugOfQuiz: string) {
    return <InlineQuiz key={slugOfQuiz} courseSlug={slug} quizSlug={slugOfQuiz} toc={toc} path={path as string} navigate={navigate} />;
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
        {path === null ? renderLanding() : quizSlug !== null ? renderQuiz(quizSlug) : renderPage()}
        {showPager && <Pager courseSlug={slug} prev={prev} next={next} atEnd={atEnd} />}
      </main>
    </div>
  );
}
