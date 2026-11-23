import React, { useState, useEffect } from 'react';
import { Menu, Clock, Factory, Download, Bell, CheckCircle2, Database } from 'lucide-react';
import { NavigationTab } from '../../types';

interface TopNavbarProps {
  currentTab: NavigationTab;
  onOpenMobileMenu: () => void;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenDbModal: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  currentTab,
  onOpenMobileMenu,
  onSelectTab,
  onOpenDbModal,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleExportReport = () => {
    setToastMessage('Exporting shift manufacturing summary (CSV)...');
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const getTabLabel = (tab: NavigationTab) => {
    switch (tab) {
      case 'dashboard':
        return 'Floor Dashboard';
      case 'orders':
        return 'Apparel Production Orders';
      case 'bom-mrp':
        return 'Style BOM & Order MRP';
      case 'costing':
        return 'Garment Costing & FOB';
      case 'inventory':
        return 'Raw Fabric & Trims Inventory';
      case 'settings':
        return 'Manufacturing Configuration';
    }
  };

  return (
    <>
      <header className="sticky top-0 z-20 h-14 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 px-4 md:px-6 flex items-center justify-between gap-4">
        {/* Left Section: Mobile Toggle & Brand / Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 truncate">
            {/* Primary Brand Display */}
            <span className="text-sm md:text-base font-bold tracking-tight text-white whitespace-nowrap">
              StitchPilot Enterprise
            </span>

            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">/</span>

            <span className="text-xs md:text-sm font-medium text-amber-400/90 hidden sm:inline truncate font-mono">
              {getTabLabel(currentTab)}
            </span>
          </div>
        </div>

        {/* Center / Right Section: Industrial Shift Telemetry & Actions */}
        <div className="flex items-center gap-3 md:gap-4 shrink-0">
          {/* Shift & Floor Status */}
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-zinc-300 font-semibold">Shift A</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-400">07:00–15:30</span>
          </div>

          {/* Real-time Clock */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-zinc-400 bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800/60">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span className="tabular-nums font-medium text-zinc-300">{currentTime || '08:00:00'}</span>
          </div>

          {/* Facility Location Badge */}
          <div className="hidden xl:flex items-center gap-1.5 text-xs text-zinc-400">
            <Factory className="w-3.5 h-3.5 text-zinc-500" />
            <span className="font-mono text-[11px] text-zinc-300">Plant Dhaka-04</span>
          </div>

          {/* Database Diagnostics Trigger */}
          <button
            onClick={onOpenDbModal}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-amber-300 hover:text-amber-200 border border-amber-500/40 rounded-md text-xs font-mono transition-colors shadow-xs"
            title="Inspect IndexedDB Entities & Run Phase 2A Tests"
          >
            <Database className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">DB Diagnostic (15 Entities)</span>
            <span className="sm:hidden">DB</span>
          </button>

          {/* Quick Action Button: Export Shift Report */}
          <button
            onClick={handleExportReport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700/80 rounded-md text-xs font-medium transition-colors shadow-xs"
            title="Download Shift Production Log"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Export Shift Log</span>
            <span className="sm:hidden">Log</span>
          </button>
        </div>
      </header>

      {/* Industrial Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-zinc-100 border border-amber-500/50 rounded-md shadow-xl text-xs font-mono">
          <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};
