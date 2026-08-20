import { CalendarRange, Factory, History, Upload } from 'lucide-react';
import { VIEWS } from '../lib/useRoute';
import { FOCUS_RING } from './ui';
import { formatTimestamp, shortId } from '../lib/format';

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
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center bg-slate-900">
            <Factory className="h-4 w-4 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900">Vector Allocation</span>
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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  active
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
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
              className={`block text-right ${FOCUS_RING} hover:bg-slate-50`}
              title={`Run ${run.id}${run.sourceFilename ? ` — ${run.sourceFilename}` : ''} · view run history`}
            >
              <span className="block text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                Active run
              </span>
              <span className="block font-mono text-slate-800">
                {shortId(run.id)}
                <span className="ml-2 font-sans text-slate-500">{formatTimestamp(run.createdAt)}</span>
              </span>
            </a>
          ) : (
            <span className="text-slate-400">No planning run</span>
          )}
        </div>
      </div>
    </header>
  );
}
