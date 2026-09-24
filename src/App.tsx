import { Link, Route, Routes, useLocation } from "react-router";
import { CatalogProvider, useCatalog } from "./catalog";
import ErrorBanner from "./components/ErrorBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import ThemeToggle from "./components/ThemeToggle";
import CourseView from "./pages/CourseView";
import Home from "./pages/Home";
import QuizView from "./pages/QuizView";
import { ProgressProvider } from "./ProgressProvider";
import { SidebarProvider, SidebarToggle } from "./sidebar";

function Header() {
  const catalog = useCatalog();
  return (
    <header className="app-header">
      <div className="app-header__start">
        <SidebarToggle />
        <Link to="/" className="app-header__brand">
          TeachMe <span className="app-header__sep">·</span> <span className="app-header__project">{catalog.project}</span>
        </Link>
      </div>
      <ThemeToggle />
    </header>
  );
}

function NotFound() {
  return (
    <main className="page center-message">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  );
}

function Shell() {
  const catalog = useCatalog();
  const location = useLocation();
  return (
    <SidebarProvider>
      <Header />
      <ErrorBanner errors={catalog.errors} warnings={catalog.warnings} />
      <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/courses/:slug" element={<CourseView />} />
          <Route path="/courses/:slug/*" element={<CourseView />} />
          <Route path="/quizzes/:slug" element={<QuizView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <ProgressProvider>
      <CatalogProvider>
        <Shell />
      </CatalogProvider>
    </ProgressProvider>
  );
}
