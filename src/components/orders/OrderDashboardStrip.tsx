import React from 'react';
import { 
  FileText, 
  CheckCircle2, 
  Layers, 
  AlertTriangle, 
  Calendar, 
  Boxes 
} from 'lucide-react';
import { OrderStatistics } from '../../db/repositories/OrderRepository';

interface OrderDashboardStripProps {
  stats: OrderStatistics;
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
}

export const OrderDashboardStrip: React.FC<OrderDashboardStripProps> = ({
  stats,
  selectedFilter,
  onSelectFilter,
}) => {
  const cards = [
    {
      id: 'all_active',
      label: 'Active POs',
      value: stats.activeOrders,
      suffix: 'orders',
      icon: FileText,
      color: 'text-amber-400',
      border: 'hover:border-amber-500/50',
      activeBorder: 'border-amber-500 bg-amber-500/5',
      subtext: `${stats.totalPieces.toLocaleString()} total units`,
    },
    {
      id: 'DRAFT',
      label: 'Draft POs',
      value: stats.drafts,
      suffix: 'in review',
      icon: FileText,
      color: 'text-zinc-400',
      border: 'hover:border-zinc-600',
      activeBorder: 'border-zinc-500 bg-zinc-800/40',
      subtext: 'Awaiting commercial sign-off',
    },
    {
      id: 'CONFIRMED',
      label: 'Confirmed',
      value: stats.confirmed,
      suffix: 'approved',
      icon: CheckCircle2,
      color: 'text-blue-400',
      border: 'hover:border-blue-500/50',
      activeBorder: 'border-blue-500 bg-blue-500/5',
      subtext: 'Ready for fabric allocation',
    },
    {
      id: 'IN_PRODUCTION',
      label: 'In Production',
      value: stats.inProduction,
      suffix: 'on floor',
      icon: Layers,
      color: 'text-emerald-400',
      border: 'hover:border-emerald-500/50',
      activeBorder: 'border-emerald-500 bg-emerald-500/5',
      subtext: 'Cutting & sewing lines active',
    },
    {
      id: 'overdue',
      label: 'Overdue Ex-Factory',
      value: stats.overdue,
      suffix: 'delayed',
      icon: AlertTriangle,
      color: stats.overdue > 0 ? 'text-rose-400' : 'text-zinc-500',
      border: 'hover:border-rose-500/50',
      activeBorder: 'border-rose-500 bg-rose-500/10',
      subtext: stats.overdue > 0 ? 'Urgent expediting required' : 'All delivery schedules on track',
    },
    {
      id: 'upcoming_14',
      label: 'Ship Next 14 Days',
      value: stats.upcoming14Days,
      suffix: 'critical',
      icon: Calendar,
      color: 'text-cyan-400',
      border: 'hover:border-cyan-500/50',
      activeBorder: 'border-cyan-500 bg-cyan-500/5',
      subtext: 'Packing & final audit queue',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = selectedFilter === card.id;

        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectFilter(card.id === selectedFilter ? 'all' : card.id)}
            className={`p-3 rounded-lg bg-zinc-900/90 border text-left transition-all cursor-pointer ${
              isSelected
                ? `${card.activeBorder} shadow-sm ring-1 ring-amber-500/20`
                : `border-zinc-800 ${card.border} hover:bg-zinc-800/40`
            }`}
          >
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-[11px] font-mono tracking-tight">{card.label}</span>
              <Icon className={`w-3.5 h-3.5 ${card.color}`} />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-zinc-100 tabular-nums">
                {card.value}
              </span>
              <span className="text-[10px] font-mono text-zinc-500">{card.suffix}</span>
            </div>

            <div className="text-[10px] text-zinc-500 truncate mt-1">
              {card.subtext}
            </div>
          </button>
        );
      })}
    </div>
  );
};
