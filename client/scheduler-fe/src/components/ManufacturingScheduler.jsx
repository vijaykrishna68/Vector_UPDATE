import React, { useState, useEffect } from "react";
import Header from "./Header";
import Dashboard from "./Dashboard";
import FileUpload from "./FileUpload";
import WeekSummaryList from "./WeekSummaryList";
import WeekDetail from "./WeekDetail";
import { fetchWeeks } from '../api';

const ManufacturingScheduler = () => {
  const [selectedLine, setSelectedLine] = useState(null);
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

  // 🔹 Mock production data
  const productionLines = [
    {
      id: 1,
      name: "Line A",
      status: "active",
      efficiency: 85,
      color: "Green",
      capacity: "2800/3000",
      items: [
        {
          id: "ITM001",
          customer: "ABC Corp",
          cycleTime: 45,
          workingEfficiency: 90,
          dropEfficiency: 5,
          actualMinutes: 380,
          totalMinutes: 480,
          date: "2025-08-22",
        },
        {
          id: "ITM002",
          customer: "XYZ Ltd",
          cycleTime: 32,
          workingEfficiency: 88,
          dropEfficiency: 7,
          actualMinutes: 420,
          totalMinutes: 480,
          date: "2025-08-22",
        },
        {
          id: "ITM003",
          customer: "DEF Inc",
          cycleTime: 28,
          workingEfficiency: 92,
          dropEfficiency: 3,
          actualMinutes: 440,
          totalMinutes: 480,
          date: "2025-08-22",
        },
      ],
      alerts: [],
    },
    {
      id: 2,
      name: "Line B",
      status: "active",
      efficiency: 92,
      color: "Blue",
      capacity: "2950/3000",
      items: [
        {
          id: "ITM004",
          customer: "GHI Co",
          cycleTime: 55,
          workingEfficiency: 95,
          dropEfficiency: 2,
          actualMinutes: 460,
          totalMinutes: 480,
          date: "2025-08-22",
        },
        {
          id: "ITM005",
          customer: "JKL Group",
          cycleTime: 38,
          workingEfficiency: 89,
          dropEfficiency: 6,
          actualMinutes: 400,
          totalMinutes: 480,
          date: "2025-08-22",
        },
      ],
      alerts: [],
    },
    {
      id: 3,
      name: "Line C",
      status: "warning",
      efficiency: 78,
      color :"Yellow",
      capacity: "2200/3000",
      items: [
        {
          id: "ITM006",
          customer: "MNO Ltd",
          cycleTime: 42,
          workingEfficiency: 82,
          dropEfficiency: 8,
          actualMinutes: 350,
          totalMinutes: 480,
          date: "2025-08-22",
        },
        {
          id: "INVALID",
          customer: "PQR Corp",
          cycleTime: 0,
          workingEfficiency: 0,
          dropEfficiency: 0,
          actualMinutes: 0,
          totalMinutes: 480,
          date: "2025-08-22",
        },
      ],
      alerts: ["Invalid Item: INVALID - Product not found in feasibility data"],
    },
    {
      id: 4,
      name: "Line D",
      status: "active",
      efficiency: 88,
      color:"Orange",
      capacity: "2700/3000",
      items: [
        {
          id: "ITM007",
          customer: "STU Inc",
          cycleTime: 35,
          workingEfficiency: 91,
          dropEfficiency: 4,
          actualMinutes: 430,
          totalMinutes: 480,
          date: "2025-08-22",
        },
        {
          id: "ITM008",
          customer: "VWX Co",
          cycleTime: 48,
          workingEfficiency: 86,
          dropEfficiency: 9,
          actualMinutes: 390,
          totalMinutes: 480,
          date: "2025-08-22",
        },
      ],
      alerts: [],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentView={currentView} setCurrentView={setCurrentView} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === "dashboard" && (
          <Dashboard
            productionLines={productionLines}
            selectedLine={selectedLine}
            setSelectedLine={setSelectedLine}
          />
        )}
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
