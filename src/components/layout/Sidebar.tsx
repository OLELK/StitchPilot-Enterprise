import React from 'react';
import { 
  LayoutDashboard, 
  ClipboardList, 
  Layers, 
  Settings, 
  Factory, 
  X, 
  ChevronRight,
  ShieldAlert,
  Activity,
  ListTree,
  BadgeDollarSign
} from 'lucide-react';
import { NavigationTab } from '../../types';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isOpen: boolean;
  onClose: () => void;
  orderCount: number;
  inventoryCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onClose,
  orderCount,
  inventoryCount,
}) => {
  const navItems = [
    {
      id: 'dashboard' as NavigationTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
      description: 'Floor KPI & Output'
    },
    {
      id: 'orders' as NavigationTab,
      label: 'Orders',
      icon: ClipboardList,
      badge: `${orderCount}`,
      description: 'Active Apparel POs'
    },
    {
      id: 'bom-mrp' as NavigationTab,
      label: 'BOM & MRP',
      icon: ListTree,
      badge: null,
      description: 'Style BOM & Order MRP'
    },
    {
      id: 'costing' as NavigationTab,
      label: 'Costing',
      icon: BadgeDollarSign,
      badge: null,
      description: 'Style & Order FOB Costing'
    },
    {
      id: 'inventory' as NavigationTab,
      label: 'Inventory',
      icon: Layers,
      badge: `${inventoryCount}`,
      description: 'Fabrics, Trims & Notions'
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Settings',
      icon: Settings,
      badge: null,
      description: 'Plant & DHU Baseline'
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200 border-r border-zinc-800/80 w-64 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-zinc-950 shadow-md font-bold text-lg tracking-wider">
            <Factory className="w-5 h-5 text-zinc-950 stroke-[2.2]" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>StitchPilot</span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 font-medium border border-zinc-700/50">
                ERP
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono tracking-tight">
              Facility 04 · Knit & Fleece
            </div>
          </div>
        </div>

        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
          aria-label="Close sidebar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Options */}
      <div className="px-3 py-4 flex-1 overflow-y-auto space-y-1">
        <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
          Manufacturing Modules
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
                onClose();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-all group ${
                isActive
                  ? 'bg-zinc-800/90 text-white border border-zinc-700/70 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                />
                <div className="truncate">
                  <div className="text-xs font-semibold tracking-tight truncate">
                    {item.label}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {item.description}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {item.badge && (
                  <span
                    className={`text-[11px] font-mono px-1.5 py-0.2 rounded font-medium ${
                      isActive
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                        : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    isActive ? 'text-amber-400 opacity-100' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                  }`}
                />
              </div>
            </button>
          );
        })}

        {/* Industrial telemetry summary card */}
        <div className="mt-6 pt-4 border-t border-zinc-800/80 px-3">
          <div className="p-3 rounded-md bg-zinc-900/60 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                Floor Status
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-medium">
                6 Lines Active
              </span>
            </div>

            <div className="space-y-1 text-[11px] font-mono text-zinc-300">
              <div className="flex justify-between text-zinc-400">
                <span>Shift A Target:</span>
                <span className="text-zinc-200">10,000 pcs</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Cut-to-Ship:</span>
                <span className="text-zinc-200">98.4%</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tolerance DHU:</span>
                <span className="text-amber-400 font-semibold">3.2 / 3.0</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Industrial Footer Operator Card */}
      <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/80">
        <div className="flex items-center gap-3 p-2 rounded-md bg-zinc-900/80 border border-zinc-800/60">
          <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center font-mono font-bold text-xs text-amber-400 border border-zinc-700/60 shrink-0">
            SP
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-200 truncate">
              Floor Supervisor
            </div>
            <div className="text-[10px] font-mono text-zinc-400 truncate">
              Shift A · Lines 01-06
            </div>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="System Online" />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer Container */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  );
};
