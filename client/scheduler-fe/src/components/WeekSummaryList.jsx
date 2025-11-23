import React from 'react';

const WeekSummaryList = ({ weeks, onSelectWeek }) => {
  if (!weeks || weeks.length === 0) return <div className="text-sm text-gray-600">No weeks available</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {weeks.map(w => (
        <div key={w.weekColumn} className="p-4 bg-white rounded shadow border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{w.weekColumn}</div>
              <div className="text-xs text-gray-500">SUM: {w.SUM} • Count: {w.CountOfParts}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Days: {w.actualWorkingDays}</div>
            </div>
          </div>

          <div className="mt-3 text-sm">
            <div className="mb-2">Line Totals:</div>
            <ul className="text-xs text-gray-700 list-disc ml-5">
              {[1,2,3,4].map(l => (
                <li key={l}>Line {l}: allocated {w.lineTotals?.[l]?.allocated ?? 0}, remaining {w.lineTotals?.[l]?.remaining ?? 0}</li>
              ))}
            </ul>
          </div>

          <div className="mt-3 flex justify-end">
            <button onClick={() => onSelectWeek(w.weekColumn)} className="px-3 py-1 bg-blue-600 text-white text-sm rounded">View</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default WeekSummaryList;
