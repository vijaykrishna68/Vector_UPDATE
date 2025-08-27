import { BarChart3, Users, CheckCircle, AlertTriangle } from 'lucide-react';
import ProductionLineCard from './ProductionLineCard';

const Dashboard = ({ productionLines, selectedLine, setSelectedLine }) => {
  const totalCapacity = productionLines.reduce((sum, line) => sum + parseInt(line.capacity.split('/')[0]), 0);
  const totalAlerts = productionLines.reduce((sum, line) => sum + line.alerts.length, 0);
  const avgEfficiency = Math.round(productionLines.reduce((sum, line) => sum + line.efficiency, 0) / productionLines.length);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <BarChart3 className="h-8 w-8 text-blue-600" />
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Total Production</p>
            <p className="text-2xl font-bold text-gray-900">{totalCapacity}/12000</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <Users className="h-8 w-8 text-green-600" />
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Avg Efficiency</p>
            <p className="text-2xl font-bold text-gray-900">{avgEfficiency}%</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <CheckCircle className="h-8 w-8 text-blue-600" />
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Active Lines</p>
            <p className="text-2xl font-bold text-gray-900">{productionLines.length}/{productionLines.length}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Alerts</p>
            <p className="text-2xl font-bold text-gray-900">{totalAlerts}</p>
          </div>
        </div>
      </div>

      {/* Production Lines Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-max">
        {productionLines.map(line => (
          <ProductionLineCard
            key={line.id}
            line={line}
            isExpanded={selectedLine === line.id}
            onClick={setSelectedLine}
          />
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
