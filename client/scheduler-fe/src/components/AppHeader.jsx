import { CalendarRange, Factory, History, Upload } from 'lucide-react';
import { VIEWS } from '../lib/useRoute';
import { FOCUS_RING } from './ui';
import { formatTimestamp, shortId } from '../lib/format';
import { statusForHealth } from '../lib/status';

const NAV = [
  { view: VIEWS.DASHBOARD, label: 'Dashboard', href: '/dashboard', icon: Factory },
  { view: VIEWS.SCHEDULE, label: 'Schedule', href: '/schedule', icon: CalendarRange },
  { view: VIEWS.UPLOAD, label: 'Upload', href: '/upload', icon: Upload },
  { view: VIEWS.RUNS, label: 'History', href: '/history', icon: History }
];

/**
 * Three destinations, one run indicator. Anchors are real links so middle-click
 * and browser navigation behave normally; onClick keeps it a client-side swap.
 */
export default function AppHeader({ view, navigate, run }) {
  const runStatus = run?.id ? statusForHealth(run.health) : null;

  return (
    <header className="border-b border-paper-300 bg-paper-50">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-accent-600">
            <Factory className="h-4 w-4 text-white" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-paper-900">Vector Allocation</p>
            <p className="text-[11px] font-medium tracking-wide text-paper-500">Production Planning System</p>
          </div>
        </div>

        <nav aria-label="Main" className="-mx-1 flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.view === view;
            return (
              <a
                key={item.view}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  navigate(item.href);
                }}
                className={`inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  active
                    ? 'bg-accent-50 text-accent-800'
                    : 'text-paper-600 hover:bg-paper-150 hover:text-paper-900'
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-xs">
          {run?.id ? (
            <a
              href="/history"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate('/history');
              }}
              className={`block text-right ${FOCUS_RING} hover:bg-paper-150`}
              title={`Run ${run.id}${run.sourceFilename ? ` — ${run.sourceFilename}` : ''} · view run history`}
            >
              <span className="flex items-center justify-end gap-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${runStatus.dot}`} />
                <span className={`text-[11px] font-semibold tracking-wider uppercase ${runStatus.text}`}>
                  {runStatus.label}
                </span>
              </span>
              <span className="mt-0.5 block font-mono text-paper-800">
                Run #{shortId(run.id)}
                <span className="ml-2 font-sans text-paper-500">{formatTimestamp(run.createdAt)}</span>
              </span>
            </a>
          ) : (
            <span className="text-paper-400">No planning run</span>
          )}
        </div>
      </div>
    </header>
  );
}
