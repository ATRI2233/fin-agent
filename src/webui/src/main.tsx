import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#121212',
          color: '#F0F0F0',
          fontFamily: "'DM Sans', -apple-system, system-ui, sans-serif",
          gap: 16,
          padding: 24,
        }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#B0B0B0', fontSize: 14, maxWidth: 480, textAlign: 'center' }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {this.state.error && (
            <pre style={{
              background: '#1A1A1A',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              color: '#D47070',
              maxWidth: 600,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 24px',
              borderRadius: 10,
              border: 'none',
              background: '#6B8EC4',
              color: '#FFF',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
