import React from 'react';
import { ProductionMetric } from '../../types';
import { 
  ClipboardCheck, 
  Layers, 
  Gauge, 
  AlertTriangle, 
  TrendingUp,
  Activity
} from 'lucide-react';

interface MetricCardProps {
  metric: ProductionMetric;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({ metric, onClick }) => {
  const getIcon = () => {
    switch (metric.id) {
      case 'total_orders':
        return <ClipboardCheck className="w-4 h-4 text-cyan-400" />;
      case 'production_output':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'inventory_items':
        return <Layers className="w-4 h-4 text-amber-400" />;
      case 'quality_dhu':
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      default:
        return <Activity className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getStatusBorder = () => {
    switch (metric.status) {
      case 'positive':
        return 'hover:border-emerald-500/50';
      case 'warning':
        return 'hover:border-amber-500/50';
      case 'alert':
        return 'hover:border-rose-500/50';
      default:
        return 'hover:border-zinc-700';
    }
  };

  const getValueColor = () => {
    switch (metric.id) {
      case 'total_orders':
        return 'text-white';
      case 'production_output':
        return 'text-emerald-400';
      case 'inventory_items':
        return 'text-amber-300';
      case 'quality_dhu':
        return 'text-rose-400';
      default:
        return 'text-white';
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 transition-all cursor-default select-none shadow-sm ${getStatusBorder()}`}
    >
      {/* Header: Title and Icon */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
        <span className="text-xs font-semibold text-zinc-300 tracking-tight">
          {metric.title}
        </span>
        <div className="p-1.5 rounded bg-zinc-950 border border-zinc-800">
          {getIcon()}
        </div>
      </div>

      {/* Main Metric Value */}
      <div className="pt-3 pb-1 flex items-baseline gap-2">
        <div className={`text-3xl font-mono font-bold tracking-tight tabular-nums ${getValueColor()}`}>
          {metric.value}
        </div>
        {metric.unit && (
          <span className="text-xs font-mono text-zinc-400 tracking-normal">
            {metric.unit}
          </span>
        )}
      </div>

      {/* Apparel Subtitle / Breakdown */}
      <div className="text-xs text-zinc-400 tracking-tight truncate">
        {metric.subtitle}
      </div>

      {/* Footer Benchmark / Variance */}
      <div className="mt-3 pt-2.5 border-t border-zinc-800/60 flex items-center justify-between text-[11px] font-mono">
        <span className="text-zinc-400 truncate">
          {metric.benchmark}
        </span>
        {metric.change && (
          <span className="text-zinc-300 shrink-0 ml-2 font-medium">
            {metric.change}
          </span>
        )}
      </div>
    </div>
  );
};
