import { Upload } from 'lucide-react';
import WeekSummaryList from './WeekSummaryList';
import WeekDetail, { WeekDetailPlaceholder } from './WeekDetail';
import { Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from './ui';

/**
 * Schedule workspace: pick a week, read its allocation.
 *
 * The selected week lives in the URL (/schedule/:week) so a planner can link to
 * or refresh a specific week.
 */
export default function ScheduleView({ weeksQuery, selectedWeek, runId, navigate }) {
  if (weeksQuery.isLoading && !weeksQuery.data) {
    return (
      <Card>
        <LoadingState label="Loading planning weeks…" />
      </Card>
    );
  }

  if (weeksQuery.isError) {
    return (
      <Card>
        <ErrorState
          title="Unable to load the schedule"
          error={weeksQuery.error}
          onRetry={weeksQuery.retry}
        />
      </Card>
    );
  }

  const { weeks = [], issuesSummary = [] } = weeksQuery.data || {};

  if (weeks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Upload}
          title="No planning run selected"
          description="Upload a production schedule workbook to generate an allocation plan."
          action={
            <Button variant="primary" icon={Upload} onClick={() => navigate('/upload')}>
              Upload a schedule
            </Button>
          }
        />
      </Card>
    );
  }

  const known = weeks.map((w) => String(w.weekColumn));
  const activeWeek = selectedWeek && known.includes(selectedWeek) ? selectedWeek : null;
  const unknownWeek = selectedWeek && !known.includes(selectedWeek);

  const selectWeek = (weekColumn) => navigate(`/schedule/${encodeURIComponent(weekColumn)}`);

  return (
    <div className="space-y-6">
      <section aria-labelledby="week-select-heading">
        <SectionHeader
          title="Planning weeks"
          description="Select a week to see its part-level allocation."
        />
        <h2 id="week-select-heading" className="sr-only">
          Select a planning week
        </h2>
        <WeekSummaryList
          weeks={weeks}
          issuesSummary={issuesSummary}
          selectedWeek={activeWeek}
          onSelect={selectWeek}
        />
      </section>

      {unknownWeek && (
        <Card>
          <EmptyState
            title={`Week "${selectedWeek}" is not in this run`}
            description={`This run contains ${known.join(', ')}.`}
            action={<Button variant="primary" onClick={() => selectWeek(known[0])}>Open {known[0]}</Button>}
          />
        </Card>
      )}

      {!activeWeek && !unknownWeek && (
        <WeekDetailPlaceholder weekCount={weeks.length} onSelectFirst={() => selectWeek(known[0])} />
      )}

      {/* key remounts the detail on week change so no stale rows survive */}
      {activeWeek && <WeekDetail key={activeWeek} week={activeWeek} runId={runId} />}
    </div>
  );
}
