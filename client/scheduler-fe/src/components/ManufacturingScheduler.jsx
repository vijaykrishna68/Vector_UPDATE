import React, { useState, useEffect } from "react";
import Header from "./Header";
import Dashboard from "./Dashboard";
import FileUpload from "./FileUpload";
import WeekSummaryList from "./WeekSummaryList";
import WeekDetail from "./WeekDetail";
import { fetchWeeks } from '../api';

const ManufacturingScheduler = () => {
  const [currentView, setCurrentView] = useState("dashboard");
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);

  useEffect(() => {
    if (currentView === 'schedule') {
      fetchWeeks().then(r => {
        setWeeks(r.weeks || []);
      }).catch(() => setWeeks([]));
    }
  }, [currentView]);


  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentView={currentView} setCurrentView={setCurrentView} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === "dashboard" && (<Dashboard />)}
        {currentView === "upload" && <FileUpload />}
        {currentView === "schedule" && (
          <div className="space-y-6">
            <WeekSummaryList weeks={weeks} onSelectWeek={(w) => setSelectedWeek(w)} />
            {selectedWeek && (
              <div className="mt-6">
                <WeekDetail weekColumn={selectedWeek} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ManufacturingScheduler;
