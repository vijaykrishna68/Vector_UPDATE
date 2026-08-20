import { useCallback, useState } from 'react';
import AppHeader from './components/AppHeader';
import Dashboard from './components/Dashboard';
import ScheduleView from './components/ScheduleView';
import FileUpload from './components/FileUpload';
import RunHistory from './components/RunHistory';
import ErrorBoundary from './components/ErrorBoundary';
import { Button, Card, EmptyState } from './components/ui';
import { fetchWeeks } from './api';
import { useAsync } from './lib/useAsync';
import { useRoute, VIEWS } from './lib/useRoute';

const RUN_STORAGE_KEY = 'vector.activeRunId';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const PAGE_TITLES = {
  [VIEWS.DASHBOARD]: 'Production dashboard',
  [VIEWS.SCHEDULE]: 'Production schedule',
  [VIEWS.UPLOAD]: 'Upload production schedule',
  [VIEWS.RUNS]: 'Planning run history',
  [VIEWS.NOT_FOUND]: 'Page not found'
};

/** Restore a previously chosen run, ignoring anything malformed. */
function readStoredRunId() {
  try {
    const value = sessionStorage.getItem(RUN_STORAGE_KEY);
    return value && OBJECT_ID.test(value) ? value : null;
  } catch {
    return null; // private mode / storage disabled
  }
}

/**
 * Application shell: owns the route and the active planning run, and loads the
 * week summaries once so the dashboard and schedule share one request.
 */
export default function App() {
  const { view, week, navigate } = useRoute();

  // Set explicitly after an upload (or restored from this tab's session). When
  // null the backend resolves the most recent run and tells us which one it used.
  const [explicitRunId, setExplicitRunId] = useState(readStoredRunId);

  const weeksQuery = useAsync(
    (signal) => fetchWeeks({ runId: explicitRunId, signal }),
    `weeks:${explicitRunId || 'latest'}`
  );

  const run = weeksQuery.data?.run || null;
  // Once the run is resolved, every subsequent request names it explicitly rather
  // than relying on "latest", so a concurrent upload cannot switch views mid-session.
  const activeRunId = run?.id || explicitRunId || null;

  /**
   * Make a run the active one for this tab. Used both after an upload and when a
   * run is picked from the history. Selecting a run only changes what this tab
   * requests — it never mutates any run.
   */
  const selectRun = useCallback((newRunId) => {
    if (!newRunId) return;
    setExplicitRunId(newRunId);
    try {
      sessionStorage.setItem(RUN_STORAGE_KEY, newRunId);
    } catch {
      // Non-fatal: the run id still lives in component state for this session.
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <AppHeader view={view} navigate={navigate} run={run} />

      <main id="main" className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Every view needs a top-level heading. The visible hierarchy starts at
            the section level, so this names the page for assistive tech. */}
        <h1 className="sr-only">{PAGE_TITLES[view] || 'Vector Allocation'}</h1>

        <ErrorBoundary key={view}>
          {view === VIEWS.DASHBOARD && (
            <Dashboard weeksQuery={weeksQuery} navigate={navigate} />
          )}

          {view === VIEWS.SCHEDULE && (
            <ScheduleView
              weeksQuery={weeksQuery}
              selectedWeek={week}
              runId={activeRunId}
              navigate={navigate}
            />
          )}

          {view === VIEWS.UPLOAD && <FileUpload onRunCreated={selectRun} navigate={navigate} />}

          {view === VIEWS.RUNS && (
            <RunHistory
              activeRunId={activeRunId}
              navigate={navigate}
              onSelectRun={(id) => {
                selectRun(id);
                navigate('/dashboard');
              }}
            />
          )}

          {view === VIEWS.NOT_FOUND && (
            <Card>
              <EmptyState
                title="Page not found"
                description="That address does not match any view in this application."
                action={
                  <Button variant="primary" onClick={() => navigate('/dashboard')}>
                    Go to dashboard
                  </Button>
                }
              />
            </Card>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
