import React from 'react';
import { LineFloorStatus } from '../../types';
import { PlayCircle, AlertCircle, Wrench, Clock, Users } from 'lucide-react';

interface LineStatusTableProps {
  lines: LineFloorStatus[];
}

export const LineStatusTable: React.FC<LineStatusTableProps> = ({ lines }) => {
  const getStatusBadge = (status: LineFloorStatus['status']) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
            <PlayCircle className="w-3 h-3 shrink-0" />
            Running
          </span>
        );
      case 'needle-change':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60">
            <Wrench className="w-3 h-3 shrink-0" />
            Needle Change
          </span>
        );
      case 'material-wait':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-950/80 text-rose-300 border border-rose-800/60">
            <Clock className="w-3 h-3 shrink-0" />
            Fabric Wait
          </span>
        );
      case 'maintenance':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            <AlertCircle className="w-3 h-3 shrink-0" />
            Line Stoppage
          </span>
        );
    }
  };

  return (
    <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-zinc-200 tracking-tight flex items-center gap-2">
            <span>Sewing Floor Live Lines</span>
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60">
              6 Active Sections
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time hourly run-rates, operator counts, and end-of-line DHU checks
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-zinc-500" />
            174 Floor Operators
          </span>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-zinc-950/60 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
              <th className="py-2.5 px-4 font-medium">Sewing Line</th>
              <th className="py-2.5 px-3 font-medium">Buyer & Style</th>
              <th className="py-2.5 px-3 font-medium text-right">Target / hr</th>
              <th className="py-2.5 px-3 font-medium text-right">Actual / hr</th>
              <th className="py-2.5 px-3 font-medium text-right">Efficiency</th>
              <th className="py-2.5 px-3 font-medium text-right">DHU %</th>
              <th className="py-2.5 px-4 font-medium text-right">Floor Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono">
            {lines.map((line) => {
              const isEfficiencyGood = line.efficiencyPercent >= 95;
              const isDhuWarning = line.dhuPercent > 3.0;

              return (
                <tr 
                  key={line.lineId}
                  className="hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-bold text-zinc-200 text-xs tracking-tight">
                      {line.lineName}
                    </div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                      <span>{line.lineId}</span>
                      <span>·</span>
                      <span>{line.activeOperators} operators</span>
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="text-zinc-200 font-medium font-sans">
                      {line.buyer}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate max-w-xs font-sans">
                      <span className="font-mono text-amber-400/90">{line.styleCode}</span> — {line.itemType}
                    </div>
                  </td>

                  <td className="py-3 px-3 text-right tabular-nums text-zinc-400">
                    {line.targetPcsHr} pcs
                  </td>

                  <td className="py-3 px-3 text-right tabular-nums font-bold text-zinc-100">
                    {line.actualPcsHr} pcs
                  </td>

                  <td className="py-3 px-3 text-right tabular-nums">
                    <span className={`font-semibold ${isEfficiencyGood ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {line.efficiencyPercent.toFixed(1)}%
                    </span>
                  </td>

                  <td className="py-3 px-3 text-right tabular-nums">
                    <span className={`font-semibold ${isDhuWarning ? 'text-rose-400' : 'text-zinc-300'}`}>
                      {line.dhuPercent.toFixed(1)}%
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right">
                    {getStatusBadge(line.status)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
