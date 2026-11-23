import React from 'react';
import { ProductionMetric, HourlyProduction, LineFloorStatus, NavigationTab } from '../../types';
import { MetricCard } from '../dashboard/MetricCard';
import { ProductionChart } from '../dashboard/ProductionChart';
import { LineStatusTable } from '../dashboard/LineStatusTable';
import { AlertTriangle, ArrowRight, Gauge, CheckCircle2, ChevronRight, Database, Server, RefreshCw } from 'lucide-react';

interface DashboardViewProps {
  metrics: ProductionMetric[];
  hourlyData: HourlyProduction[];
  lines: LineFloorStatus[];
  onNavigateTab: (tab: NavigationTab) => void;
  isDbLoading?: boolean;
  dbError?: string | null;
  onOpenDbModal?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  metrics,
  hourlyData,
  lines,
  onNavigateTab,
  isDbLoading,
  dbError,
  onOpenDbModal,
}) => {
  return (
    <div className="space-y-6">
      {/* Database Error Banner if any */}
      {dbError && (
        <div className="p-4 rounded-lg bg-rose-950/90 border border-rose-800 text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs font-mono">
              <div className="font-bold text-rose-100 text-sm">Database Initialization Failure</div>
              <p className="mt-1 text-rose-300">{dbError}</p>
            </div>
          </div>
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-rose-900 hover:bg-rose-800 text-white rounded text-xs font-mono whitespace-nowrap shrink-0 border border-rose-700 transition-colors"
          >
            Open in Standalone Window ↗
          </a>
        </div>
      )}

      {/* Database Foundation Live Status Strip */}
      <div className="p-2.5 px-4 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 text-zinc-300">
          <Database className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-zinc-200">Local Database:</span>
          <span className="text-emerald-400">IndexedDB Active (Dexie.js)</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">15 Entities · Single Ledger Truth</span>
        </div>

        <div className="flex items-center gap-3">
          {isDbLoading ? (
            <span className="text-amber-400 flex items-center gap-1.5 text-[11px]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Syncing Ledger...
            </span>
          ) : (
            <span className="text-zinc-400 text-[11px]">
              Persisted Locally
            </span>
          )}
          {onOpenDbModal && (
            <button
              onClick={onOpenDbModal}
              className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors cursor-pointer"
            >
              Run 4 Verification Tests
            </button>
          )}
        </div>
      </div>

      {/* Top Banner / Floor Status Alert */}
      <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <span>Shift A Live Monitoring Notice</span>
              <span className="text-[10px] font-mono uppercase bg-amber-950 text-amber-400 px-1.5 py-0.5 rounded border border-amber-800/60">
                DHU 3.2 Tolerance
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 max-w-2xl leading-relaxed">
              Line 03 reported skipped stitches on style ST-318 (Cotton Pique Polo). Needle gauge inspection scheduled. Lines 01, 02, 04, and 06 are operating within nominal 95%+ efficiency benchmarks.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigateTab('orders')}
            className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-medium border border-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            Inspect POs
            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
          </button>
        </div>
      </div>

      {/* The Four Required Metric Cards */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">Key Performance Indicators</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.id}
              metric={metric}
              onClick={() => {
                if (metric.id === 'total_orders') onNavigateTab('orders');
                if (metric.id === 'inventory_items') onNavigateTab('inventory');
              }}
            />
          ))}
        </div>
      </section>

      {/* Production Overview Chart Section */}
      <section aria-labelledby="chart-heading">
        <h2 id="chart-heading" className="sr-only">Production Overview Chart</h2>
        <ProductionChart data={hourlyData} />
      </section>

      {/* Floor Lines Status Table */}
      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="sr-only">Sewing Floor Lines Status</h2>
        <LineStatusTable lines={lines} />
      </section>
    </div>
  );
};
