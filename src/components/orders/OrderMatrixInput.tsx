import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { OrderItemEntity } from '../../db/types';

export interface MatrixRow {
  color: string;
  quantities: Record<string, number>;
}

interface OrderMatrixInputProps {
  orderId: string;
  initialItems?: OrderItemEntity[];
  onChange: (items: OrderItemEntity[], grandTotal: number) => void;
  disabled?: boolean;
}

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const EMPTY_ITEMS: OrderItemEntity[] = [];

function buildMatrixFromItems(initialItems: OrderItemEntity[]): {
  sizes: string[];
  rows: MatrixRow[];
} {
  if (initialItems.length > 0) {
    const colorMap = new Map<string, Record<string, number>>();
    const encounteredSizes = new Set<string>();

    initialItems.forEach((item) => {
      encounteredSizes.add(item.size);
      if (!colorMap.has(item.color)) {
        colorMap.set(item.color, {});
      }
      colorMap.get(item.color)![item.size] = item.quantity;
    });

    const mergedSizes = Array.from(new Set([...DEFAULT_SIZES, ...encounteredSizes]));
    const rows = Array.from(colorMap.entries()).map(([color, quantities]) => ({
      color,
      quantities,
    }));

    return { sizes: mergedSizes, rows };
  }

  return {
    sizes: [...DEFAULT_SIZES],
    rows: [
      {
        color: 'Black Core',
        quantities: { XS: 500, S: 1000, M: 1500, L: 1000, XL: 500, XXL: 200 },
      },
    ],
  };
}

export const OrderMatrixInput: React.FC<OrderMatrixInputProps> = ({
  orderId,
  initialItems = EMPTY_ITEMS,
  onChange,
  disabled = false,
}) => {
  const initialMatrix = buildMatrixFromItems(initialItems);
  const [sizes, setSizes] = useState<string[]>(initialMatrix.sizes);
  const [newSizeName, setNewSizeName] = useState('');
  const [isAddingSize, setIsAddingSize] = useState(false);
  const [rows, setRows] = useState<MatrixRow[]>(initialMatrix.rows);
  const [inputErrors, setInputErrors] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Reset matrix state whenever orderId or initialItems change (prevents stale state across orders)
  useEffect(() => {
    const nextMatrix = buildMatrixFromItems(initialItems);
    setSizes(nextMatrix.sizes);
    setRows(nextMatrix.rows);
    setNewSizeName('');
    setIsAddingSize(false);
    setInputErrors(null);
  }, [orderId, initialItems]);

  // Sync out to parent with actual orderId and unique primary keys
  useEffect(() => {
    let hasNegativeOrInvalid = false;
    let hasDuplicateColor = false;
    const seenColors = new Set<string>();
    const flattenedItems: OrderItemEntity[] = [];
    let grandTotal = 0;

    rows.forEach((row, rowIdx) => {
      const color = row.color.trim() || `Color ${rowIdx + 1}`;
      const normalizedColorKey = color.toUpperCase();
      if (seenColors.has(normalizedColorKey)) {
        hasDuplicateColor = true;
      }
      seenColors.add(normalizedColorKey);

      sizes.forEach((sz) => {
        const val = row.quantities[sz] ?? 0;
        if (typeof val !== 'number' || val < 0 || !Number.isInteger(val)) {
          hasNegativeOrInvalid = true;
        }
        if (val > 0) {
          const safeColor = encodeURIComponent(color);
          const safeSize = encodeURIComponent(sz);
          flattenedItems.push({
            id: `ITM-${orderId}-${safeColor}-${safeSize}`,
            orderId,
            color,
            size: sz,
            quantity: val,
            cutQuantity: 0,
            sewnQuantity: 0,
            packedQuantity: 0,
            isSimulated: true,
            createdAt: new Date().toISOString(),
          });
          grandTotal += val;
        }
      });
    });

    if (hasNegativeOrInvalid) {
      setInputErrors('Quantities must be non-negative integers only.');
    } else if (hasDuplicateColor) {
      setInputErrors('Each colourway row must have a unique colour name.');
    } else {
      setInputErrors(null);
    }

    onChangeRef.current(flattenedItems, grandTotal);
  }, [rows, sizes, orderId]);

  const handleQuantityChange = (rowIndex: number, size: string, rawVal: string) => {
    const val = rawVal === '' ? 0 : parseInt(rawVal, 10);
    setRows((prev) => {
      const copy = [...prev];
      copy[rowIndex] = {
        ...copy[rowIndex],
        quantities: {
          ...copy[rowIndex].quantities,
          [size]: isNaN(val) ? 0 : val,
        },
      };
      return copy;
    });
  };

  const handleColorChange = (rowIndex: number, newColor: string) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[rowIndex] = {
        ...copy[rowIndex],
        color: newColor,
      };
      return copy;
    });
  };

  const addColorRow = () => {
    const defaultColor = `Colorway ${rows.length + 1}`;
    setRows((prev) => [
      ...prev,
      {
        color: defaultColor,
        quantities: sizes.reduce((acc, sz) => ({ ...acc, [sz]: 0 }), {}),
      },
    ]);
  };

  const removeColorRow = (rowIndex: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, idx) => idx !== rowIndex));
  };

  const addSizeColumn = () => {
    const trimmed = newSizeName.trim().toUpperCase();
    if (!trimmed || sizes.includes(trimmed)) return;
    setSizes((prev) => [...prev, trimmed]);
    setNewSizeName('');
    setIsAddingSize(false);
  };

  // Row and Column Totals
  const rowTotals = rows.map((r) =>
    sizes.reduce((sum, sz) => sum + (r.quantities[sz] || 0), 0)
  );

  const columnTotals = sizes.map((sz) =>
    rows.reduce((sum, r) => sum + (r.quantities[sz] || 0), 0)
  );

  const grandTotal = columnTotals.reduce((sum, val) => sum + val, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div>
          <div className="text-xs font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span>Size-Wise Order Breakdown Matrix</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Auto-Reconciled
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Define units per colourway and apparel size. The total PO quantity updates automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!disabled && (
            <button
              type="button"
              onClick={addColorRow}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-mono flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              Add Colourway
            </button>
          )}

          {!disabled && !isAddingSize && (
            <button
              type="button"
              onClick={() => setIsAddingSize(true)}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              Add Size Column
            </button>
          )}

          {isAddingSize && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="e.g. 3XL"
                value={newSizeName}
                onChange={(e) => setNewSizeName(e.target.value)}
                className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-xs font-mono text-zinc-200 uppercase"
                autoFocus
              />
              <button
                type="button"
                onClick={addSizeColumn}
                className="px-2 py-0.5 bg-amber-500 text-zinc-950 rounded text-xs font-mono font-bold"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setIsAddingSize(false)}
                className="px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 text-xs"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {inputErrors && (
        <div className="p-2 rounded bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2 font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{inputErrors}</span>
        </div>
      )}

      {/* Matrix Table */}
      <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950/80">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400 text-[11px]">
              <th className="py-2.5 px-3 min-w-[160px]">Colourway / Shade</th>
              {sizes.map((sz) => (
                <th key={sz} className="py-2.5 px-2 text-center min-w-[70px]">
                  {sz}
                </th>
              ))}
              <th className="py-2.5 px-3 text-right font-semibold text-zinc-200 min-w-[90px]">
                Row Total
              </th>
              {!disabled && <th className="py-2.5 px-2 text-center w-10"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-zinc-900/40 transition-colors">
                <td className="py-2 px-3">
                  <input
                    type="text"
                    disabled={disabled}
                    value={row.color}
                    onChange={(e) => handleColorChange(rowIdx, e.target.value)}
                    placeholder="e.g. Navy Heather"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-amber-500 rounded px-2 py-1 text-xs text-zinc-200 font-sans disabled:bg-zinc-950 disabled:border-transparent"
                  />
                </td>

                {sizes.map((sz) => (
                  <td key={sz} className="py-2 px-1 text-center">
                    <input
                      type="number"
                      disabled={disabled}
                      min="0"
                      step="1"
                      value={row.quantities[sz] ?? 0}
                      onChange={(e) => handleQuantityChange(rowIdx, sz, e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 focus:border-amber-500 rounded px-1.5 py-1 text-xs text-center tabular-nums text-zinc-100 font-mono disabled:bg-zinc-950 disabled:border-transparent"
                    />
                  </td>
                ))}

                <td className="py-2 px-3 text-right tabular-nums font-bold text-amber-300">
                  {rowTotals[rowIdx].toLocaleString()} <span className="text-[10px] text-zinc-500 font-normal">pcs</span>
                </td>

                {!disabled && (
                  <td className="py-2 px-2 text-center">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeColorRow(rowIdx)}
                        className="p-1 text-zinc-500 hover:text-rose-400 rounded hover:bg-zinc-800 transition-colors"
                        title="Remove colour row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}

            {/* Matrix Summary Row */}
            <tr className="bg-zinc-900/80 font-bold border-t-2 border-zinc-700/80 text-[11px]">
              <td className="py-2.5 px-3 text-zinc-300">Total by Size</td>
              {columnTotals.map((tot, idx) => (
                <td key={sizes[idx]} className="py-2.5 px-2 text-center tabular-nums text-zinc-200">
                  {tot.toLocaleString()}
                </td>
              ))}
              <td className="py-2.5 px-3 text-right tabular-nums text-emerald-400 text-sm">
                {grandTotal.toLocaleString()} <span className="text-[10px] text-zinc-400 font-normal">pcs</span>
              </td>
              {!disabled && <td></td>}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-1">
        <span>Active Breakdown: {rows.length} colourways × {sizes.length} sizes</span>
        <span className="text-zinc-200 font-semibold">
          PO Grand Total: <span className="text-amber-400 font-bold">{grandTotal.toLocaleString()} pcs</span>
        </span>
      </div>
    </div>
  );
};
