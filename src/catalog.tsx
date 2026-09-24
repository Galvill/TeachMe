import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Catalog } from "../shared/types";
import { getCatalog } from "./api";

const CatalogContext = createContext<Catalog | null>(null);

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; catalog: Catalog };

/** Fetches the catalog once and provides it; renders a centered message while loading or on failure. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getCatalog()
      .then((catalog) => {
        if (!cancelled) setState({ status: "ready", catalog });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p role="status" className="center-message">Loading…</p>;
  }
  if (state.status === "error") {
    return <p role="alert" className="center-message">Could not load content: {state.message}</p>;
  }
  return <CatalogContext.Provider value={state.catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("useCatalog must be used within a CatalogProvider");
  return catalog;
}
