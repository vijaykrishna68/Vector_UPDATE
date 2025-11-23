import React, { useEffect, useState } from 'react';
import { fetchWeekDetail } from '../api';

const WeekDetail = ({ weekColumn }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!weekColumn) return;
    setLoading(true);
    setError(null);
    fetchWeekDetail(weekColumn)
      .then(res => setData(res))
      .catch(err => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [weekColumn]);

  if (!weekColumn) return <div className="text-sm text-gray-600">Select a week to view details</div>;
  if (loading) return <div className="text-sm text-gray-600">Loading week detail...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const dateHeaders = (data.lineDays && data.lineDays.length > 0) ? data.lineDays.map(d => d.dateHeader) : [];

  return (
    <div className="bg-white rounded shadow p-4">
      <h3 className="text-lg font-medium mb-3">Week {weekColumn} — Part Allocation</h3>
      <div className="overflow-auto">
        <table className="min-w-full text-sm border">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-2 border">SPEC</th>
              <th className="p-2 border">Line</th>
              <th className="p-2 border">Weekly Qty</th>
              {dateHeaders.map((h, idx) => (
                <th key={idx} className="p-2 border">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.parts.map((p, idx) => (
              <tr key={idx} className="even:bg-gray-50">
                <td className="p-2 border">{p.spec}</td>
                <td className="p-2 border">{p.originalLine}</td>
                <td className="p-2 border">{p.weeklyQty}</td>
                {dateHeaders.map((h, dIdx) => {
                  const alloc = (p.allocations || []).find(a => a.dayIndex === dIdx);
                  return <td key={dIdx} className="p-2 border text-center">{alloc ? alloc.qty : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WeekDetail;
