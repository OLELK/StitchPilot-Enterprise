import React, { useState } from 'react';
import { PlantSettings } from '../../types';
import { 
  Sliders, 
  CheckCircle2, 
  RotateCcw, 
  ShieldAlert, 
  Factory, 
  Clock, 
  Settings as SettingsIcon,
  Cpu,
  Layers
} from 'lucide-react';

interface SettingsViewProps {
  settings: PlantSettings;
  onSaveSettings: (updatedSettings: PlantSettings) => void;
  onResetDefaults: () => void;
  onOpenDbModal?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetDefaults,
  onOpenDbModal,
}) => {
  const [formData, setFormData] = useState<PlantSettings>(settings);
  const [isSavedToast, setIsSavedToast] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setIsSavedToast(true);
    setTimeout(() => {
      setIsSavedToast(false);
    }, 3000);
  };

  const handleReset = () => {
    onResetDefaults();
    setIsSavedToast(true);
    setTimeout(() => {
      setIsSavedToast(false);
    }, 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <span>Plant & Manufacturing Configuration</span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
              Facility SP-04
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure floor line tolerances, standard allowed minute (SAM) baselines, and shift schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 text-xs font-mono transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Facility Identification */}
        <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-800 text-xs font-bold text-zinc-200">
            <Factory className="w-4 h-4 text-amber-400" />
            <span>Facility Identification & Division</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Facility Name
              </label>
              <input
                type="text"
                value={formData.plantName}
                onChange={(e) => setFormData({ ...formData, plantName: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Plant ERP Code
              </label>
              <input
                type="text"
                value={formData.plantCode}
                onChange={(e) => setFormData({ ...formData, plantCode: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Operating Apparel Division
              </label>
              <input
                type="text"
                value={formData.division}
                onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Shift & Line Capacity */}
        <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-800 text-xs font-bold text-zinc-200">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>Shift Cadence & Output Targets</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Active Production Shift
              </label>
              <select
                value={formData.activeShift}
                onChange={(e) => setFormData({ ...formData, activeShift: e.target.value as any })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:border-amber-500 focus:outline-hidden"
              >
                <option value="Shift A (07:00 - 15:30)">Shift A (07:00 - 15:30)</option>
                <option value="Shift B (15:30 - 23:00)">Shift B (15:30 - 23:00)</option>
                <option value="Shift C (23:00 - 07:00)">Shift C (23:00 - 07:00)</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Planned Daily Output (pcs)
              </label>
              <input
                type="number"
                value={formData.plannedDailyOutput}
                onChange={(e) => setFormData({ ...formData, plannedDailyOutput: parseInt(e.target.value, 10) || 0 })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Active Sewing Lines
              </label>
              <input
                type="number"
                min="1"
                max="24"
                value={formData.sewingLinesConfigured}
                onChange={(e) => setFormData({ ...formData, sewingLinesConfigured: parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Quality & DHU Parameters */}
        <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-800 text-xs font-bold text-zinc-200">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Quality DHU (Defects per Hundred Units) Thresholds</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-zinc-400 text-[11px]">
                  Standard DHU Tolerance Threshold
                </label>
                <span className="text-amber-400 font-bold">{formData.dhuToleranceLimit}%</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="6.0"
                step="0.1"
                value={formData.dhuToleranceLimit}
                onChange={(e) => setFormData({ ...formData, dhuToleranceLimit: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Default factory ceiling. DHU readings above this highlight in yellow warning.
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-zinc-400 text-[11px]">
                  Critical Stop-Line Escalation Limit
                </label>
                <span className="text-rose-400 font-bold">{formData.criticalDhuAlertThreshold}%</span>
              </div>
              <input
                type="range"
                min="3.0"
                max="10.0"
                step="0.1"
                value={formData.criticalDhuAlertThreshold}
                onChange={(e) => setFormData({ ...formData, criticalDhuAlertThreshold: parseFloat(e.target.value) })}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Requires mandatory line pause for mechanic needle change and QA manager sign-off.
              </p>
            </div>
          </div>
        </div>

        {/* Section 4: Apparel Industrial Automation Toggles */}
        <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm space-y-3">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-800 text-xs font-bold text-zinc-200">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Floor Automation & Tracking Protocols</span>
          </div>

          <div className="space-y-3 text-xs">
            <label className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors">
              <div>
                <span className="font-semibold text-zinc-200 block">Automatic Defect Escalation</span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  Notify line mechanic and QA auditor when 3 consecutive garments fail inspection.
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.autoDefectEscalation}
                onChange={(e) => setFormData({ ...formData, autoDefectEscalation: e.target.checked })}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors">
              <div>
                <span className="font-semibold text-zinc-200 block">RFID Bundle Tracking</span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  Log cut-part bundles at each sewing workstation with electronic QR/RFID chips.
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.rfidBundleTracking}
                onChange={(e) => setFormData({ ...formData, rfidBundleTracking: e.target.checked })}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Form Submission */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono transition-all shadow-md"
          >
            <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            Save Plant Configuration
          </button>
        </div>
      </form>

      {/* Section 5: IndexedDB Foundation Management & Verification */}
      <div className="p-4 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800 text-xs font-bold text-zinc-200">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-amber-500/10 text-amber-400">
              <Layers className="w-4 h-4" />
            </span>
            <span>Local Database Architecture (Dexie.js / IndexedDB)</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
            Phase 2A Foundation Active
          </span>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed font-mono">
          StitchPilot Enterprise uses a 15-entity normalized IndexedDB database. Stock balances are derived strictly from the <code className="text-amber-400">inventory_transactions</code> ledger. No separate mutable stock fields exist.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 text-[10px] block">Database Architecture</span>
            <span className="text-zinc-200 font-bold block mt-0.5">15 IndexedDB Tables</span>
            <span className="text-[10px] text-zinc-500">Repository Layer Pattern</span>
          </div>
          <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 text-[10px] block">Inventory Accounting</span>
            <span className="text-emerald-400 font-bold block mt-0.5">Strict Ledger Truth</span>
            <span className="text-[10px] text-zinc-500">Non-negative stock rules</span>
          </div>
          <div className="p-3 rounded bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 text-[10px] block">Test Verification</span>
            <span className="text-amber-400 font-bold block mt-0.5">4 Automated Tests</span>
            <span className="text-[10px] text-zinc-500">Tests A, B, C, D</span>
          </div>
        </div>

        {onOpenDbModal && (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onOpenDbModal}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-400 rounded-md text-xs font-bold font-mono transition-colors border border-zinc-700"
            >
              Open Database Diagnostic & Test Suite
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Toast */}
      {isSavedToast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-zinc-100 border border-emerald-500/50 rounded-md shadow-2xl text-xs font-mono">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Plant configurations saved and applied across production lines.</span>
        </div>
      )}
    </div>
  );
};
