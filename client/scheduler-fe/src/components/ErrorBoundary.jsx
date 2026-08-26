import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Catches render-time failures so one broken component cannot blank the whole
 * application — which is exactly what used to happen when WeekDetail read an
 * undefined array from a mismatched API response.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console for diagnosis; there is no error-reporting backend.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-[3px] border border-critical-200 bg-paper-50 p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-critical-600" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-paper-900">This view failed to render</h1>
              <p className="mt-1 text-sm text-paper-600">
                The rest of the application is still running. Try again, or reload the page.
              </p>
              <p className="mt-3 font-mono text-xs break-words text-paper-400">{String(error.message || error)}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="rounded-[3px] bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-[3px] bg-paper-50 px-3 py-1.5 text-sm font-medium text-paper-800 ring-1 ring-inset ring-paper-300 hover:bg-paper-150 focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Reload
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
