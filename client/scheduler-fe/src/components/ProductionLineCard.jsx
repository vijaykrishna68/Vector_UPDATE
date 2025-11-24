const ProductionLineCard = ({ line, isExpanded, onClick }) => {
  const usagePct = line.capacityMinutes > 0 ? (line.usedMinutes / line.capacityMinutes) * 100 : 0;
  return (
    <div
      className={`rounded-lg shadow-sm border p-6 cursor-pointer transition-all duration-300 hover:shadow-md ${
        isExpanded ? 'col-span-2 row-span-2' : ''
      } ${
        line.color === 'Green'
          ? 'bg-green-50 border-green-200'
          : line.color === 'Blue'
          ? 'bg-blue-50 border-blue-200'
          : line.color === 'Yellow'
          ? 'bg-yellow-50 border-yellow-200'
          : line.color === 'Orange'
          ? 'bg-red-50 border-red-200'
          : 'bg-white border-gray-200'
      }`}
      onClick={() => onClick(line.id)}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{line.name}</h3>
        <span className="px-2 py-1 text-xs font-medium rounded-full border bg-white text-gray-700">Active</span>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Efficiency</span>
          <span className="text-sm font-medium text-gray-900">{line.efficiency}%</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Minutes Used</span>
          <span className="text-sm font-medium text-gray-900">{(Number(line.usedMinutes) || 0).toFixed(2)}/{(Number(line.capacityMinutes) || 0).toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Working Days</span>
          <span className="text-sm font-medium text-gray-900">{line.workingDays}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Parts Scheduled</span>
          <span className="text-sm font-medium text-gray-900">{line.scheduledSum}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Avg Parts/Day</span>
          <span className="text-sm font-medium text-gray-900">{line.avgPartsPerDay}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2" title={`Usage ${usagePct.toFixed(1)}%`}>
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${usagePct}%` }}
          ></div>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-6 border-t pt-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Weekly Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-1 pr-4 font-medium">Week</th>
                    <th className="py-1 pr-4 font-medium">Allocated</th>
                    <th className="py-1 pr-4 font-medium">Remaining</th>
                    <th className="py-1 pr-4 font-medium">Efficiency</th>
                    <th className="py-1 pr-4 font-medium">Avg Parts/Day</th>
                    <th className="py-1 pr-4 font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {line.weeks.map((w,i) => (
                    <tr key={i} className="border-t border-gray-200">
                      <td className="py-1 pr-4">{w.weekColumn}</td>
                      <td className="py-1 pr-4">{w.allocatedParts}</td>
                      <td className="py-1 pr-4">{w.remainingParts}</td>
                      <td className="py-1 pr-4">{w.efficiency}%</td>
                      <td className="py-1 pr-4">{w.avgPartsPerDay}</td>
                      <td className="py-1 pr-4">{w.workingDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </div>
      )}
    </div>
  );
};

export default ProductionLineCard;
