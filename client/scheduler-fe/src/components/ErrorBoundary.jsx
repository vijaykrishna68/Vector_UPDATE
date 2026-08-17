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
        <div className="border border-red-200 bg-white p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-900">This view failed to render</h1>
              <p className="mt-1 text-sm text-slate-600">
                The rest of the application is still running. Try again, or reload the page.
              </p>
              <p className="mt-3 font-mono text-xs break-words text-slate-400">{String(error.message || error)}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="bg-white px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
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
