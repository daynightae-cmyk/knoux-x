import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('KNOUX renderer failure:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="knoux-fatal-error" role="alert">
        <section className="knoux-fatal-error__panel">
          <span className="knoux-fatal-error__eyebrow">KNOUX RECOVERY MODE</span>
          <h1>The interface encountered an unexpected error.</h1>
          <p>
            The media engine was not modified. Reload the renderer to restore the
            application interface.
          </p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={this.handleReload}>
            Reload KNOUX Player X
          </button>
        </section>
      </main>
    );
  }
}
