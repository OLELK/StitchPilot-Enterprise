import React, { useState } from 'react';
import { ListTree, Calculator } from 'lucide-react';
import { BuyerEntity, MaterialEntity, StyleEntity } from '../../db/types';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';
import { StyleBomEditorView } from '../bom/StyleBomEditorView';
import { OrderMrpView } from '../mrp/OrderMrpView';

export type BomMrpSubTab = 'bom' | 'mrp';

interface BomMrpViewProps {
  orders?: OrderWithDetails[];
  styles: StyleEntity[];
  buyers: BuyerEntity[];
  materials: MaterialEntity[];
  isDbReady: boolean;
  initialSubTab?: BomMrpSubTab;
  onBomMutated?: () => Promise<void> | void;
}

export const BomMrpView: React.FC<BomMrpViewProps> = ({
  orders = [],
  styles,
  buyers,
  materials,
  isDbReady,
  initialSubTab = 'bom',
  onBomMutated,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<BomMrpSubTab>(initialSubTab);
  const [deepLinkStyleId, setDeepLinkStyleId] = useState<string | null>(null);

  const handleOpenStyleBom = (styleId: string) => {
    setDeepLinkStyleId(styleId);
    setActiveSubTab('bom');
  };

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="text-[11px] font-mono text-amber-400 font-semibold flex items-center gap-2">
            <span>StitchPilot Commercial ERP</span>
            <span className="text-zinc-600">/</span>
            <span>{activeSubTab === 'bom' ? 'Phase 3A · Stage 4A' : 'Phase 3A · Stage 4B'}</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight mt-0.5">
            {activeSubTab === 'bom'
              ? 'Style Bill of Materials (BOM)'
              : 'Order Material Requirements Planning (MRP)'}
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            {activeSubTab === 'bom'
              ? 'Manage style component consumption, UOM conversions, wastage allowances, colour & size applicability, and version history.'
              : 'Calculate read-only individual and consolidated multi-order material requirements, cutting reconciliations, and procurement shortages.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 shrink-0">
          {/* Sub-module Segmented Navigation */}
          <div
            className="inline-flex items-center p-1 rounded-md bg-zinc-900 border border-zinc-800"
            role="tablist"
            aria-label="BOM and MRP sub-modules"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'bom'}
              data-testid="bom-mrp-subtab-bom"
              onClick={() => setActiveSubTab('bom')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                activeSubTab === 'bom'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <ListTree className="w-3.5 h-3.5" />
              <span>Style BOM Editor</span>
              <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                ({styles.length})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'mrp'}
              data-testid="bom-mrp-subtab-mrp"
              onClick={() => setActiveSubTab('mrp')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                activeSubTab === 'mrp'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Order MRP</span>
              <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                ({orders.length})
              </span>
            </button>
          </div>

          <div className="hidden xl:flex items-center gap-3 text-xs font-mono text-zinc-400 tabular-nums">
            <span>
              Styles: <strong className="text-zinc-200">{styles.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Materials: <strong className="text-zinc-200">{materials.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Orders: <strong className="text-zinc-200">{orders.length}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Active Sub-module Workspace */}
      {activeSubTab === 'bom' ? (
        <StyleBomEditorView
          styles={styles}
          buyers={buyers}
          materials={materials}
          isDbReady={isDbReady}
          initialStyleId={deepLinkStyleId}
          onBomMutated={onBomMutated}
        />
      ) : (
        <OrderMrpView
          orders={orders}
          styles={styles}
          buyers={buyers}
          isDbReady={isDbReady}
          onOpenStyleBom={handleOpenStyleBom}
        />
      )}
    </div>
  );
};
