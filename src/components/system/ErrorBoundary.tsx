import { Component, type ErrorInfo, type ReactNode } from 'react';

const recoveryLogo = new URL('../../../assets/branding/knoux-logo-night.png', import.meta.url).href;

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

  private handleCopyDiagnostic = (): void => {
    const diagnostic = JSON.stringify({
      product: 'KNOUX Player X',
      failure: this.state.error?.name ?? 'RendererError',
      runtime: document.documentElement.dataset.runtime ?? 'unknown',
      capturedAt: new Date().toISOString(),
    }, null, 2);
    void navigator.clipboard?.writeText(diagnostic);
  };

  public render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="knoux-fatal-error" role="alert">
        <section className="knoux-fatal-error__panel">
          <img src={recoveryLogo} alt="" aria-hidden="true" />
          <span className="knoux-fatal-error__eyebrow">KNOUX RECOVERY MODE</span>
          <h1>The interface encountered an unexpected error.</h1>
          <p>
            Your local media and projects remain unchanged. Reload the interface
            to restore KNOUX Player X.
          </p>
          <p className="knoux-fatal-error__reference">Diagnostic class: {this.state.error.name}</p>
          <div className="knoux-fatal-error__actions">
            <button type="button" onClick={this.handleReload}>Reload KNOUX Player X</button>
            <button type="button" onClick={this.handleCopyDiagnostic}>Copy safe diagnostic</button>
          </div>
        </section>
      </main>
    );
  }
}
