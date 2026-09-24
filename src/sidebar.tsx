import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

/** Below this width the course TOC is an off-canvas drawer instead of a column. */
export const DRAWER_BREAKPOINT = 860;

export function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= DRAWER_BREAKPOINT;
}

type SidebarContextValue = {
  /** Whether the course TOC is open (column on wide screens, drawer on narrow ones). */
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** True while a course view has its TOC mounted; the header shows its toggle only then. */
  mounted: boolean;
  setMounted: (mounted: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Shares the course TOC's open state between `CourseView`, which renders the
 * sidebar, and the sticky app header, which renders the toggle for it.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => !isNarrowScreen());
  const [mounted, setMounted] = useState(false);
  const value = useMemo(() => ({ open, setOpen, mounted, setMounted }), [open, mounted]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}

/** Header button that collapses/expands the course TOC; renders nothing when no TOC is mounted. */
export function SidebarToggle() {
  const { open, setOpen, mounted } = useSidebar();
  if (!mounted) return null;
  return (
    <button
      type="button"
      className="sidebar-toggle icon-button"
      aria-label={open ? "Collapse table of contents" : "Expand table of contents"}
      aria-expanded={open}
      aria-controls="course-toc"
      onClick={() => setOpen((o) => !o)}
    >
      <span aria-hidden="true">☰</span>
    </button>
  );
}
