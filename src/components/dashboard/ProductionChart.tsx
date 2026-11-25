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
  ComposedChart,
} from 'recharts';
import { HourlyProduction } from '../../types';

interface ProductionChartProps {
  data: HourlyProduction[];
  shiftLabel?: string;
  shiftWindowLabel?: string;
  reportingDate?: string;
  isHistoricalDate?: boolean;
  isSimulatedShiftData?: boolean;
  reportingLineCount?: number;
  totalLineCount?: number;
}

interface ProductionChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | null;
    color?: string;
    payload?: HourlyProduction;
  }>;
  label?: string;
  chartMode: 'output' | 'efficiency';
  reportingDate?: string;
}

export const ProductionChartTooltip: React.FC<ProductionChartTooltipProps> = ({
  active,
  payload,
  label,
  chartMode,
  reportingDate,
}) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const slotData = payload[0]?.payload;
  const isUnloggedInterval =
    slotData !== undefined &&
    (slotData.eventCount === 0 || (slotData.eventCount === undefined && slotData.targetPcs === null));
  const isConfiguredZeroTarget =
    !isUnloggedInterval && slotData !== undefined && slotData.targetPcs === 0;

  return (
    <div
      data-testid="production-chart-tooltip"
      className="bg-zinc-950 border border-zinc-700/80 p-3 rounded-md shadow-xl font-mono text-xs space-y-1.5"
    >
      <div className="text-zinc-300 font-semibold border-b border-zinc-800 pb-1">
        Floor Slot: {label} hrs{reportingDate ? ` · ${reportingDate}` : ''}
      </div>

      {isUnloggedInterval && (
        <div className="text-[11px] text-zinc-400 italic">
          No production events logged for this interval
        </div>
      )}

      {chartMode === 'output' && slotData ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2 h-2 rounded-xs bg-amber-500" />
              Actual Output:
            </span>
            <span className="font-bold text-zinc-100 tabular-nums">
              {slotData.actualPcs.toLocaleString()} pcs
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2 h-2 rounded-xs bg-zinc-600" />
              Target Benchmark:
            </span>
            {slotData.targetPcs === null ? (
              <span className="text-zinc-500">No target data (N/A)</span>
            ) : isConfiguredZeroTarget ? (
              <span className="font-bold text-zinc-200 tabular-nums">0 pcs (configured)</span>
            ) : (
              <span className="font-bold text-zinc-100 tabular-nums">
                {slotData.targetPcs.toLocaleString()} pcs
              </span>
            )}
          </div>
          <div className="pt-1 text-[11px] text-zinc-400 border-t border-zinc-800 flex justify-between gap-4">
            <span>Variance:</span>
            {slotData.targetPcs !== null && slotData.targetPcs > 0 ? (
              <span
                className={
                  slotData.actualPcs >= slotData.targetPcs
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }
              >
                {slotData.actualPcs >= slotData.targetPcs ? '+' : ''}
                {(slotData.actualPcs - slotData.targetPcs).toLocaleString()} pcs
              </span>
            ) : (
              <span className="text-zinc-500">N/A</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 flex justify-between gap-4">
            <span>Slot Efficiency:</span>
            <span className="text-zinc-200 font-semibold">
              {slotData.efficiency !== null
                ? `${slotData.efficiency.toFixed(1)}%`
                : isConfiguredZeroTarget
                ? 'N/A (zero target)'
                : 'N/A'}
            </span>
          </div>
        </>
      ) : (
        payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span
                className="w-2 h-2 rounded-xs"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}:
            </span>
            <span className="font-bold text-zinc-100 tabular-nums">
              {entry.value === null || entry.value === undefined
                ? 'N/A'
                : `${Number(entry.value).toLocaleString()} %`}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

export const ProductionChart: React.FC<ProductionChartProps> = ({
  data,
  shiftLabel = 'Active Shift',
  shiftWindowLabel,
  reportingDate,
  isHistoricalDate = false,
  isSimulatedShiftData = false,
  reportingLineCount = 0,
  totalLineCount = 0,
}) => {
  const [chartMode, setChartMode] = useState<'output' | 'efficiency'>('output');

  const slotsWithTarget = data.filter((slot) => slot.targetPcs !== null);
  const targetCumulative: number | null =
    slotsWithTarget.length > 0
      ? slotsWithTarget.reduce((sum, slot) => sum + (slot.targetPcs ?? 0), 0)
      : null;
  const actualCumulative = data.reduce((sum, slot) => sum + (slot.actualPcs || 0), 0);
  const shiftEfficiency =
    targetCumulative !== null && targetCumulative > 0
      ? Math.round((actualCumulative / targetCumulative) * 1000) / 10
      : null;

  const loggedSlots = data.filter(
    (slot) => (slot.eventCount ?? (slot.actualPcs > 0 || slot.targetPcs !== null ? 1 : 0)) > 0
  );
  const peakSlot =
    loggedSlots.length > 0
      ? loggedSlots.reduce(
          (best, slot) => (slot.actualPcs > best.actualPcs ? slot : best),
          loggedSlots[0]
        )
      : null;

  const windowBadge = shiftWindowLabel
    ? `${shiftLabel} (${shiftWindowLabel})`
    : shiftLabel;

  const dateBadgeText = reportingDate
    ? [
        isHistoricalDate ? `Historical · ${reportingDate}` : reportingDate,
        isSimulatedShiftData ? 'Demo Data' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const formatPeakTarget = (targetPcs: number | null): string => {
    if (targetPcs === null) return 'No target data';
    if (targetPcs === 0) return '0 pcs target (configured)';
    return `${targetPcs.toLocaleString()} pcs target`;
  };



  return (
    <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm">
      {/* Chart Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="text-sm font-bold text-zinc-200 tracking-tight flex flex-wrap items-center gap-2">
            <span>Production Overview</span>
            <span
              data-testid="production-chart-shift-badge"
              className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/60"
            >
              {windowBadge} Actual vs Target
            </span>
            {dateBadgeText && (
              <span
                data-testid="production-chart-date-badge"
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  isHistoricalDate
                    ? 'text-amber-300 bg-amber-950/60 border-amber-700/60'
                    : 'text-amber-400/90 bg-zinc-950 border-zinc-800'
                }`}
              >
                {dateBadgeText}
              </span>
            )}
          </div>
          <p data-testid="production-chart-subtitle" className="text-xs text-zinc-400 mt-0.5">
            {data.length > 0 ? (
              <>
                {`Shift intervals (${data[0].hour}–${data[data.length - 1].hour}) · ${reportingLineCount} reporting line${reportingLineCount === 1 ? '' : 's'} of ${totalLineCount} configured`}
                {isHistoricalDate && reportingDate
                  ? ` · No production events logged today (showing latest logged shift on ${reportingDate}${
                      isSimulatedShiftData ? ' · simulated demo data' : ''
                    })`
                  : ''}
              </>
            ) : (
              `No hourly production events recorded for ${windowBadge}${reportingDate ? ` on ${reportingDate}` : ''}`
            )}
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
        {data.length === 0 ? (
          <div
            data-testid="production-chart-empty"
            className="h-full w-full flex flex-col items-center justify-center rounded border border-dashed border-zinc-800 bg-zinc-950/40 text-center px-4"
          >
            <span className="text-xs font-mono font-semibold text-zinc-300">
              No Hourly Production Data Available
            </span>
            <span className="text-[11px] font-mono text-zinc-500 mt-1">
              No persisted output events fall within {windowBadge}
              {reportingDate ? ` on ${reportingDate}` : ''}.
            </span>
          </div>
        ) : (
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
                <Tooltip
                  content={
                    <ProductionChartTooltip chartMode={chartMode} reportingDate={reportingDate} />
                  }
                />
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
                  domain={[0, 120]}
                  tickFormatter={(val) => `${val}%`}
                />
                <Tooltip
                  content={
                    <ProductionChartTooltip chartMode={chartMode} reportingDate={reportingDate} />
                  }
                />
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
                  dataKey={(d: HourlyProduction) => (d.dhu !== null ? Math.round(d.dhu * 20) : null)}
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#f43f5e' }}
                  connectNulls={false}
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Chart Footer Industrial Annotation */}
      <div
        data-testid="production-chart-footer"
        className="pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between text-[11px] font-mono text-zinc-400 gap-2"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Shift Target:{' '}
            <strong className="text-zinc-200 tabular-nums">
              {targetCumulative === null
                ? 'No target data (N/A)'
                : targetCumulative === 0
                ? '0 pcs (configured)'
                : `${targetCumulative.toLocaleString()} pcs`}
            </strong>
          </span>
          <span>·</span>
          <span>
            Logged Actual:{' '}
            <strong className="text-amber-400 tabular-nums">
              {actualCumulative.toLocaleString()} pcs
            </strong>
          </span>
          <span>·</span>
          <span>
            Shift Efficiency:{' '}
            <strong className="text-zinc-200 tabular-nums">
              {shiftEfficiency !== null ? `${shiftEfficiency.toFixed(1)}%` : 'N/A'}
            </strong>
          </span>
        </div>
        <div className="text-zinc-400">
          {peakSlot
            ? `Peak Hour: ${peakSlot.hour} (${peakSlot.actualPcs.toLocaleString()} / ${formatPeakTarget(
                peakSlot.targetPcs
              )} · ${peakSlot.efficiency !== null ? `${peakSlot.efficiency.toFixed(1)}% eff.` : 'N/A eff.'})`
            : 'Peak Hour: N/A'}
        </div>
      </div>
    </div>
  );
};
