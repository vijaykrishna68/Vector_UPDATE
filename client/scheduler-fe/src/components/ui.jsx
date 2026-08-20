import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { formatInt, formatPercent } from '../lib/format';

/**
 * The shared visual language. Every component composes these instead of styling
 * itself, so spacing, borders, typography and status treatment stay consistent.
 *
 * Design intent: industrial and restrained. Thin borders over shadows, flat
 * surfaces, tabular numerals for every figure, tight vertical rhythm, no
 * gradients or decorative motion. Focus rings are always visible for keyboard use.
 */

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

/* ------------------------------------------------------------------ surfaces */

/**
 * `selected` applies the brand-colored selected treatment centrally, so any
 * consumer that needs a "this one is chosen" card state (e.g. a week or run
 * picker) gets the same border/ring instead of styling it ad hoc.
 */
export function Card({ children, className = '', as: Tag = 'div', selected = false, ...rest }) {
  return (
    <Tag
      className={`border bg-white ${
        selected ? 'border-brand-700 ring-1 ring-brand-700' : 'border-slate-200'
      } ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function SectionHeader({ title, description, actions, level = 2 }) {
  const Heading = `h${level}`;
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <Heading className="text-sm font-semibold tracking-wide text-slate-900 uppercase">{title}</Heading>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small uppercase label used above figures and in definition lists. */
export function Label({ children, className = '' }) {
  return (
    <span className={`text-[11px] font-medium tracking-wider text-slate-500 uppercase ${className}`}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- figures */

/**
 * `size`: 'lg' is reserved for the one or two true headline figures on a page
 * (e.g. the dashboard's allocated/demand ratio). Ordinary figures should keep
 * using `emphasis` or the default — a page with several "lg" stats has no
 * hierarchy left to show.
 */
export function Stat({ label, value, unit, hint, emphasis = false, size }) {
  const valueSize =
    size === 'lg'
      ? 'text-4xl font-semibold'
      : emphasis
        ? 'text-2xl font-semibold'
        : 'text-xl font-medium';
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono tabular-nums tracking-tight text-slate-900 ${valueSize}`}>{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Horizontal meter. `tone` is a bg-* class from STATUS, never colour alone. */
export function Meter({ value, tone = 'bg-slate-400', label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden bg-slate-100"
    >
      <div className={`h-full transition-[width] duration-500 ease-out ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The recurring "capacity" visual: percentage, a rail (built on Meter), and the
 * used/available minute figures underneath. This is Vector Allocation's one
 * visual language for capacity, reused on the dashboard hero, production-line
 * panels and planning-week summaries so it reads the same everywhere.
 *
 * `size="lg"` is for the single dashboard hero rail; every other usage should
 * stay at the default size.
 */
export function CapacityRail({ usedMinutes = 0, capacityMinutes = 0, label, size = 'md', tone = 'bg-brand-600' }) {
  const used = Number(usedMinutes) || 0;
  const capacity = Number(capacityMinutes) || 0;
  const pct = capacity > 0 ? (used / capacity) * 100 : null;
  const available = Math.max(0, capacity - used);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        {label ? <Label>{label}</Label> : <span />}
        <span
          className={`font-mono tabular-nums text-slate-900 ${
            size === 'lg' ? 'text-2xl font-semibold' : 'text-sm font-semibold'
          }`}
        >
          {pct === null ? '—' : formatPercent(pct)}
        </span>
      </div>
      <div className={size === 'lg' ? 'mt-2' : 'mt-1.5'}>
        <Meter value={pct ?? 0} tone={pct === null ? 'bg-slate-300' : tone} label={label || 'Capacity utilisation'} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
        <span>
          <span className="font-mono tabular-nums text-slate-700">{formatInt(used)}</span> min used
        </span>
        <span>
          <span className="font-mono tabular-nums text-slate-700">{formatInt(available)}</span> min available
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- badges */

/**
 * Status badge. Always renders symbol + text so status never depends on colour.
 * @param {{ status: {label: string, symbol: string, badge: string} }} props
 */
export function StatusBadge({ status, children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.badge} ${className}`}
    >
      <span aria-hidden="true" className="text-[9px] leading-none">
        {status.symbol}
      </span>
      {children || status.label}
    </span>
  );
}

export function Badge({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- buttons */

const BUTTON_VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-300',
  secondary:
    'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300'
};

export function Button({ children, variant = 'secondary', className = '', icon: Icon, ...rest }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${FOCUS_RING} ${className}`}
      {...rest}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- view states */

export function LoadingState({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="p-6" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-4 space-y-2" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-3 bg-slate-100" style={{ width: `${88 - i * 14}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, action }) {
  const detail = error?.message || 'An unexpected error occurred.';
  const canRetry = onRetry && (error?.isRetryable ?? true);

  return (
    <div className="p-6" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{detail}</p>
          {(error?.code || error?.requestId) && (
            <p className="mt-2 font-mono text-xs text-slate-400">
              {error.code}
              {error.requestId ? ` · request ${error.requestId}` : ''}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            {canRetry && (
              <Button onClick={onRetry} icon={RefreshCw}>
                Retry
              </Button>
            )}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="px-6 py-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- tables */

/**
 * Scroll container for tables. Wide schedules scroll inside this element, never
 * the page. Pass a max-height (e.g. "max-h-[70vh]") to make sticky headers and a
 * sticky first column actually stick while scrolling long schedules.
 */
export function TableShell({ children, className = '' }) {
  return (
    <div className={`overflow-auto ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left', sticky = false, className = '', scope = 'col', ...rest }) {
  const alignment = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      scope={scope}
      className={`border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-600 uppercase ${alignment} ${
        sticky ? 'sticky left-0 z-20 bg-slate-50' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', numeric = false, sticky = false, className = '', ...rest }) {
  const alignment = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td
      className={`border-b border-slate-100 px-3 py-1.5 text-slate-800 ${alignment} ${
        numeric ? 'font-mono tabular-nums' : ''
      } ${sticky ? 'sticky left-0 z-10 bg-white' : ''} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
