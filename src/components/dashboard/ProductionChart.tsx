import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Line,
  ComposedChart
} from 'recharts';
import { HourlyProduction } from '../../types';

interface ProductionChartProps {
  data: HourlyProduction[];
}

export const ProductionChart: React.FC<ProductionChartProps> = ({ data }) => {
  const [chartMode, setChartMode] = useState<'output' | 'efficiency'>('output');

  // Custom Dark Industrial Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-950 border border-zinc-700/80 p-3 rounded-md shadow-xl font-mono text-xs space-y-1.5">
          <div className="text-zinc-300 font-semibold border-b border-zinc-800 pb-1">
            Floor Slot: {label} hrs
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <span
                  className="w-2 h-2 rounded-xs"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}:
              </span>
              <span className="font-bold text-zinc-100 tabular-nums">
                {entry.value.toLocaleString()} {chartMode === 'output' ? 'pcs' : '%'}
              </span>
            </div>
          ))}
          {chartMode === 'output' && (
            <div className="pt-1 text-[11px] text-zinc-400 border-t border-zinc-800 flex justify-between">
              <span>Variance:</span>
              <span className={payload[0].value >= payload[1].value ? 'text-emerald-400' : 'text-amber-400'}>
                {payload[0].value >= payload[1].value ? '+' : ''}
                {(payload[0].value - payload[1].value).toLocaleString()} pcs
              </span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm">
      {/* Chart Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="text-sm font-bold text-zinc-200 tracking-tight flex items-center gap-2">
            <span>Production Overview</span>
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60">
              Shift A Actual vs Target
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Hourly line output across 6 sewing lines (08:00 - 15:00)
          </p>
        </div>

        {/* View Toggle Tabs */}
        <div className="flex items-center gap-1 p-1 bg-zinc-950 rounded-md border border-zinc-800/80 shrink-0">
          <button
            onClick={() => setChartMode('output')}
            className={`px-3 py-1 text-xs font-mono font-medium rounded transition-all ${
              chartMode === 'output'
                ? 'bg-zinc-800 text-amber-400 shadow-xs border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Output (pcs)
          </button>
          <button
            onClick={() => setChartMode('efficiency')}
            className={`px-3 py-1 text-xs font-mono font-medium rounded transition-all ${
              chartMode === 'efficiency'
                ? 'bg-zinc-800 text-amber-400 shadow-xs border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Efficiency (%)
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 sm:h-72 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          {chartMode === 'output' ? (
            <BarChart
              data={data}
              margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
              barGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                fontFamily="JetBrains Mono"
              />
              <YAxis
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                fontFamily="JetBrains Mono"
                tickFormatter={(val) => `${val}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', fontFamily: 'JetBrains Mono', paddingTop: '10px' }}
                iconType="rect"
              />
              <Bar
                name="Actual Output"
                dataKey="actualPcs"
                fill="#f59e0b"
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                name="Target Benchmark"
                dataKey="targetPcs"
                fill="#3f3f46"
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          ) : (
            <ComposedChart
              data={data}
              margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                fontFamily="JetBrains Mono"
              />
              <YAxis
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                fontFamily="JetBrains Mono"
                domain={[60, 120]}
                tickFormatter={(val) => `${val}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', fontFamily: 'JetBrains Mono', paddingTop: '10px' }}
              />
              <Bar
                name="Line Efficiency"
                dataKey="efficiency"
                fill="#10b981"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
              <Line
                type="monotone"
                name="Defect Rate (DHU x20)"
                dataKey={(d) => Math.round(d.dhu * 20)}
                stroke="#f43f5e"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f43f5e' }}
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Chart Footer Industrial Annotation */}
      <div className="pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between text-[11px] font-mono text-zinc-400 gap-2">
        <div className="flex items-center gap-3">
          <span>Target Cumulative: <strong className="text-zinc-200">8,800 pcs</strong></span>
          <span>·</span>
          <span>Shift Actual: <strong className="text-amber-400">8,450 pcs</strong></span>
        </div>
        <div className="text-zinc-400">
          Peak Hour: 14:00 (1,220 pcs / 101.6% efficiency)
        </div>
      </div>
    </div>
  );
};
