import { BarChart3, Calendar, Download } from 'lucide-react';

const Header = ({ currentView, setCurrentView }) => (
  <header className="bg-white shadow-sm border-b border-gray-200">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center h-16">
        <div className="flex items-center">
          <BarChart3 className="h-8 w-8 text-blue-600 mr-3" />
          <h1 className="text-xl font-semibold text-gray-900">Manufacturing Scheduler</h1>
        </div>

        <nav className="flex space-x-8">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={`px-3 py-2 text-sm font-medium rounded-md ${
              currentView === 'dashboard' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setCurrentView('upload')}
            className={`px-3 py-2 text-sm font-medium rounded-md ${
              currentView === 'upload' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Upload Data
          </button>
          <button
            onClick={() => setCurrentView('schedule')}
            className={`px-3 py-2 text-sm font-medium rounded-md ${
              currentView === 'schedule' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Schedule
          </button>
        </nav>

        <div className="flex items-center space-x-4">
          <button className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors flex items-center">
            <Download className="h-4 w-4 mr-2" />
            Export Schedule
          </button>
          <div className="flex items-center text-sm text-gray-600">
            <Calendar className="h-4 w-4 mr-1" />
            {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  </header>
);

export default Header;
