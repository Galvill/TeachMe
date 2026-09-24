import { Component, type ReactNode } from "react";
import { Link } from "react-router";

type Props = {
  /** When this changes (e.g. the route path), a caught error is cleared. */
  resetKey: string;
  children: ReactNode;
};

type State = { error: Error | null; resetKey: string };

/** Catches render errors in routed content so one bad page never blanks the app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <main className="page center-message">
        <h1>Something went wrong displaying this page.</h1>
        <p className="error-boundary__message">{error.message}</p>
        <p>
          <Link to="/">Back to home</Link>
        </p>
      </main>
    );
  }
}
