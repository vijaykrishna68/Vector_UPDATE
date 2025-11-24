import React, { useEffect, useState } from 'react';
import { fetchWeeks } from '../api';
import ProductionLineCard from './ProductionLineCard';

function colorForEfficiency(e) {
  if (e >= 85) return 'Green';
  if (e >= 70) return 'Blue';
  if (e >= 55) return 'Yellow';
  return 'Orange';
}

function buildAggregates(weeks) {
  const map = {};
  weeks.forEach(w => {
    (w.lines || []).forEach(l => {
      if (!map[l.line]) {
        map[l.line] = {
          id: String(l.line),
          name: `Line ${l.line}`,
          usedMinutes: 0,
          capacityMinutes: 0,
          scheduledSum: 0,
          remainingParts: 0,
          weeks: [],
          workingDaysSet: new Set()
        };
      }
      const entry = map[l.line];
      entry.usedMinutes += l.usedMinutes || 0;
      entry.capacityMinutes += l.capacityMinutes || 0;
      entry.scheduledSum += l.allocatedParts || 0;
      entry.remainingParts += l.remainingParts || 0;
      for (let d = 0; d < (l.workingDays || 0); d++) entry.workingDaysSet.add(d);
      entry.weeks.push({
        weekColumn: w.weekColumn,
        allocatedParts: l.allocatedParts || 0,
        remainingParts: l.remainingParts || 0,
        efficiency: l.efficiency || 0,
        avgPartsPerDay: l.avgPartsPerDay || 0,
        workingDays: l.workingDays || 0
      });
    });
  });
  return Object.values(map).map(entry => {
    const efficiency = entry.capacityMinutes > 0 ? +( (entry.usedMinutes / entry.capacityMinutes) * 100 ).toFixed(2) : 0;
    const workingDays = entry.workingDaysSet.size;
    const avgPartsPerDay = workingDays > 0 ? +(entry.scheduledSum / workingDays).toFixed(2) : 0;
    return {
      id: entry.id,
      name: entry.name,
      efficiency,
      color: colorForEfficiency(efficiency),
      usedMinutes: entry.usedMinutes,
      capacityMinutes: entry.capacityMinutes,
      workingDays,
      scheduledSum: entry.scheduledSum,
      avgPartsPerDay,
      weeks: entry.weeks
    };
  }).sort((a,b) => a.id.localeCompare(b.id));
}

const Dashboard = () => {
  const [lines, setLines] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        const data = await fetchWeeks();
        const weeks = data.weeks || [];
        setLines(buildAggregates(weeks));
      } catch (e) {
        setError('Failed to load line metrics');
      } finally { setLoading(false); }
    }
    load();
  }, []);

  const totalUsed = lines.reduce((s,l) => s + (Number(l.usedMinutes) || 0), 0);
  const totalCapacity = lines.reduce((s,l) => s + (Number(l.capacityMinutes) || 0), 0);
  const avgEfficiency = lines.length ? Math.round(lines.reduce((s,l)=> s + l.efficiency,0)/lines.length) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-600">Total Minutes Used</p>
          <p className="text-2xl font-bold text-gray-900">{totalUsed.toFixed(2)}/{totalCapacity.toFixed(2)}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-600">Avg Efficiency</p>
          <p className="text-2xl font-bold text-gray-900">{avgEfficiency}%</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-600">Active Lines</p>
          <p className="text-2xl font-bold text-gray-900">{lines.length}/{lines.length}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-sm font-medium text-gray-600">Total Parts Scheduled</p>
          <p className="text-2xl font-bold text-gray-900">{lines.reduce((s,l)=> s + l.scheduledSum,0)}</p>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading...</div>}
      {error && <div className="text-sm text-red-500">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-max">
        {lines.map(line => (
          <ProductionLineCard
            key={line.id}
            line={line}
            isExpanded={expanded === line.id}
            onClick={() => setExpanded(expanded === line.id ? null : line.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
