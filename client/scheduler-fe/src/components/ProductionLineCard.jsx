import { AlertTriangle } from 'lucide-react';
import { getStatusColor, getEfficiencyColor } from './helpers';

const ProductionLineCard = ({ line, isExpanded, onClick }) => (
  <div 
  className={`rounded-lg shadow-sm border p-6 cursor-pointer transition-all duration-300 hover:shadow-md ${
    isExpanded ? "col-span-2 row-span-2" : ""
  } ${
    line.color === "Green"   ? "bg-green-50 border-green-200"    :
    line.color === "Blue"  ? "bg-blue-50 border-blue-200":
    line.color === "Yellow" ? "bg-yellow-50 border-yellow-200" :
    line.color === "Orange"    ? "bg-red-50 border-red-200"     :
                              "bg-white border-gray-200"
  }`}
  onClick={() => onClick(line.id)}
>
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-gray-900">{line.name}</h3>
      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(line.status)}`}>
        {line.status}
      </span>
    </div>

    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Efficiency</span>
        <span className={`text-sm font-medium ${getEfficiencyColor(line.efficiency)}`}>
          {line.efficiency}%
        </span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Capacity</span>
        <span className="text-sm font-medium text-gray-900">{line.capacity}</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
          style={{ width: `${(parseInt(line.capacity.split('/')[0]) / 3000) * 100}%` }}
        ></div>
      </div>

      {line.alerts.length > 0 && (
        <div className="flex items-center text-amber-600 text-xs mt-2">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {line.alerts.length} Alert{line.alerts.length > 1 ? 's' : ''}
        </div>
      )}
    </div>

    {isExpanded && (
      <div className="mt-6 border-t pt-4">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Production Items</h4>
        <div className="space-y-2">
          {line.items.map((item, idx) => (
            <div key={idx} className={`p-3 rounded-lg border ${item.id === 'INVALID' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><span className="font-medium">Item ID:</span> {item.id}</div>
                <div><span className="font-medium">Customer:</span> {item.customer}</div>
                <div><span className="font-medium">Cycle Time:</span> {item.cycleTime}min</div>
                <div><span className="font-medium">Working Efficiency:</span> {item.workingEfficiency}%</div>
                <div><span className="font-medium">Drop Efficiency:</span> {item.dropEfficiency}%</div>
                <div><span className="font-medium">Actual Minutes:</span> {item.actualMinutes}/{item.totalMinutes}</div>
              </div>
              {item.id === 'INVALID' && (
                <div className="mt-2 flex items-center text-red-600 text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Invalid Item - Product not found in feasibility data
                </div>
              )}
            </div>
          ))}
        </div>

        {line.alerts.length > 0 && (
          <div className="mt-4">
            <h5 className="text-sm font-medium text-gray-900 mb-2">Alerts</h5>
            {line.alerts.map((alert, idx) => (
              <div key={idx} className="flex items-center text-amber-700 text-xs bg-amber-50 p-2 rounded">
                <AlertTriangle className="h-3 w-3 mr-2" />
                {alert}
              </div>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
);

export default ProductionLineCard;
