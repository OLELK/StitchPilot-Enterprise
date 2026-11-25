import React, { useState, useEffect, useRef } from 'react';
import { PlantSettings } from '../../types';
import {
  CheckCircle2,
  RotateCcw,
  ShieldAlert,
  Factory,
  Clock,
  Cpu,
  Layers,
  AlertTriangle,
  X,
} from 'lucide-react';

interface SettingsViewProps {
  settings: PlantSettings;
  onSaveSettings: (updatedSettings: PlantSettings) => Promise<PlantSettings> | PlantSettings | void;
  onResetDefaults: () => Promise<PlantSettings> | PlantSettings | void;
  onOpenDbModal?: () => void;
}

interface FieldValidationErrors {
  plantName?: string;
  plantCode?: string;
  division?: string;
  plannedDailyOutput?: string;
  sewingLinesConfigured?: string;
}

type ToastState = {
  type: 'saved' | 'reset';
  message: string;
} | null;

function validatePlannedDailyOutputInput(raw: string): { valid: boolean; value?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Planned daily output is required. Enter 0 or a positive whole number.',
    };
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || !/^-?\d+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Planned daily output must be a whole number of 0 or greater.',
    };
  }
  if (numeric < 0) {
    return {
      valid: false,
      error: 'Planned daily output cannot be negative. Enter 0 or a positive whole number.',
    };
  }
  return { valid: true, value: numeric };
}

function validateSewingLinesInput(raw: string): { valid: boolean; value?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Active sewing lines is required (1–24).',
    };
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || !/^-?\d+$/.test(trimmed) || numeric < 1 || numeric > 24) {
    return {
      valid: false,
      error: 'Active sewing lines must be a whole number between 1 and 24.',
    };
  }
  return { valid: true, value: numeric };
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetDefaults,
  onOpenDbModal,
}) => {
  const [formData, setFormData] = useState<PlantSettings>(settings);
  const [plannedDailyOutputInput, setPlannedDailyOutputInput] = useState<string>(
    String(settings.plannedDailyOutput)
  );
  const [sewingLinesInput, setSewingLinesInput] = useState<string>(
    String(settings.sewingLinesConfigured)
  );
  const [fieldErrors, setFieldErrors] = useState<FieldValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Sync local form state whenever persisted settings load or reset
  useEffect(() => {
    setFormData(settings);
    setPlannedDailyOutputInput(String(settings.plannedDailyOutput));
    setSewingLinesInput(String(settings.sewingLinesConfigured));
    setFieldErrors({});
    setFormError(null);
  }, [settings]);

  const showToast = (nextToast: NonNullable<ToastState>) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(nextToast);
    toastTimerRef.current = setTimeout(() => {
      setToast((current) => (current === nextToast ? null : current));
      toastTimerRef.current = null;
    }, 3500);
  };

  const handlePlannedOutputChange = (raw: string) => {
    setPlannedDailyOutputInput(raw);
    const check = validatePlannedDailyOutputInput(raw);
    if (check.valid && check.value !== undefined) {
      setFormData((prev) => ({ ...prev, plannedDailyOutput: check.value! }));
      setFieldErrors((prev) => {
        const { plannedDailyOutput: _, ...rest } = prev;
        return rest;
      });
    } else {
      // Do NOT silently convert negative or invalid values into zero
      setFieldErrors((prev) => ({ ...prev, plannedDailyOutput: check.error }));
    }
  };

  const handleSewingLinesChange = (raw: string) => {
    setSewingLinesInput(raw);
    const check = validateSewingLinesInput(raw);
    if (check.valid && check.value !== undefined) {
      setFormData((prev) => ({ ...prev, sewingLinesConfigured: check.value! }));
      setFieldErrors((prev) => {
        const { sewingLinesConfigured: _, ...rest } = prev;
        return rest;
      });
    } else {
      setFieldErrors((prev) => ({ ...prev, sewingLinesConfigured: check.error }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nextErrors: FieldValidationErrors = {};
    if (!formData.plantName.trim()) {
      nextErrors.plantName = 'Facility name is required.';
    }
    if (!formData.plantCode.trim()) {
      nextErrors.plantCode = 'Plant ERP code is required.';
    }
    if (!formData.division.trim()) {
      nextErrors.division = 'Operating apparel division is required.';
    }

    const outputCheck = validatePlannedDailyOutputInput(plannedDailyOutputInput);
    if (!outputCheck.valid || outputCheck.value === undefined) {
      nextErrors.plannedDailyOutput = outputCheck.error;
    }

    const linesCheck = validateSewingLinesInput(sewingLinesInput);
    if (!linesCheck.valid || linesCheck.value === undefined) {
      nextErrors.sewingLinesConfigured = linesCheck.error;
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError(
        nextErrors.plannedDailyOutput ||
          nextErrors.sewingLinesConfigured ||
          nextErrors.plantName ||
          nextErrors.plantCode ||
          nextErrors.division ||
          'Please fix the validation errors before saving.'
      );
      return;
    }

    const payload: PlantSettings = {
      ...formData,
      plantName: formData.plantName.trim(),
      plantCode: formData.plantCode.trim(),
      division: formData.division.trim(),
      plannedDailyOutput: outputCheck.value!,
      sewingLinesConfigured: linesCheck.value!,
    };

    try {
      setIsSubmitting(true);
      const saved = await onSaveSettings(payload);
      if (saved) {
        setFormData(saved);
        setPlannedDailyOutputInput(String(saved.plannedDailyOutput));
        setSewingLinesInput(String(saved.sewingLinesConfigured));
      }
      setFieldErrors({});
      setFormError(null);
      showToast({
        type: 'saved',
        message: 'Plant configuration saved and persisted.',
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save plant configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    try {
      setIsSubmitting(true);
      setFormError(null);
      const restored = await onResetDefaults();
      if (restored) {
        setFormData(restored);
        setPlannedDailyOutputInput(String(restored.plannedDailyOutput));
        setSewingLinesInput(String(restored.sewingLinesConfigured));
      }
      setFieldErrors({});
      setIsResetConfirmOpen(false);
      showToast({
        type: 'reset',
        message: 'Plant configuration reset to factory defaults. Operational data was not modified.',
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to reset plant configuration.');
      setIsResetConfirmOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <span>Plant & Manufacturing Configuration</span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
              {settings.plantCode}
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure floor line tolerances, standard allowed minute (SAM) baselines, and shift schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="settings-reset-defaults-btn"
            onClick={() => setIsResetConfirmOpen(true)}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 hover:bg-rose-950/60 text-zinc-300 hover:text-rose-200 border border-zinc-700 hover:border-rose-700/70 text-xs font-mono transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
        </div>
      </div>

      {/* Form-level Validation Error Banner */}
      {formError && (
        <div
          data-testid="settings-validation-error"
          role="alert"
          className="p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 text-xs font-mono flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
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
                data-testid="settings-plant-name-input"
                value={formData.plantName}
                onChange={(e) => {
                  setFormData({ ...formData, plantName: e.target.value });
                  if (e.target.value.trim()) {
                    setFieldErrors((prev) => {
                      const { plantName: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                className={`w-full bg-zinc-950 border rounded px-3 py-2 text-zinc-100 font-mono focus:outline-hidden ${
                  fieldErrors.plantName
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-zinc-800 focus:border-amber-500'
                }`}
              />
              {fieldErrors.plantName && (
                <p className="text-[11px] font-mono text-rose-400 mt-1">{fieldErrors.plantName}</p>
              )}
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Plant ERP Code
              </label>
              <input
                type="text"
                data-testid="settings-plant-code-input"
                value={formData.plantCode}
                onChange={(e) => {
                  setFormData({ ...formData, plantCode: e.target.value });
                  if (e.target.value.trim()) {
                    setFieldErrors((prev) => {
                      const { plantCode: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                className={`w-full bg-zinc-950 border rounded px-3 py-2 text-zinc-100 font-mono focus:outline-hidden ${
                  fieldErrors.plantCode
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-zinc-800 focus:border-amber-500'
                }`}
              />
              {fieldErrors.plantCode && (
                <p className="text-[11px] font-mono text-rose-400 mt-1">{fieldErrors.plantCode}</p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Operating Apparel Division
              </label>
              <input
                type="text"
                data-testid="settings-division-input"
                value={formData.division}
                onChange={(e) => {
                  setFormData({ ...formData, division: e.target.value });
                  if (e.target.value.trim()) {
                    setFieldErrors((prev) => {
                      const { division: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                className={`w-full bg-zinc-950 border rounded px-3 py-2 text-zinc-100 font-mono focus:outline-hidden ${
                  fieldErrors.division
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-zinc-800 focus:border-amber-500'
                }`}
              />
              {fieldErrors.division && (
                <p className="text-[11px] font-mono text-rose-400 mt-1">{fieldErrors.division}</p>
              )}
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
                data-testid="settings-active-shift-select"
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
                min="0"
                step="1"
                data-testid="planned-daily-output-input"
                aria-invalid={Boolean(fieldErrors.plannedDailyOutput)}
                value={plannedDailyOutputInput}
                onChange={(e) => handlePlannedOutputChange(e.target.value)}
                className={`w-full bg-zinc-950 border rounded px-3 py-2 text-zinc-100 focus:outline-hidden ${
                  fieldErrors.plannedDailyOutput
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-zinc-800 focus:border-amber-500'
                }`}
              />
              {fieldErrors.plannedDailyOutput && (
                <p
                  data-testid="planned-daily-output-error"
                  className="text-[11px] text-rose-400 mt-1 leading-snug"
                >
                  {fieldErrors.plannedDailyOutput}
                </p>
              )}
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Active Sewing Lines
              </label>
              <input
                type="number"
                min="1"
                max="24"
                step="1"
                data-testid="settings-sewing-lines-input"
                aria-invalid={Boolean(fieldErrors.sewingLinesConfigured)}
                value={sewingLinesInput}
                onChange={(e) => handleSewingLinesChange(e.target.value)}
                className={`w-full bg-zinc-950 border rounded px-3 py-2 text-zinc-100 focus:outline-hidden ${
                  fieldErrors.sewingLinesConfigured
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-zinc-800 focus:border-amber-500'
                }`}
              />
              {fieldErrors.sewingLinesConfigured && (
                <p
                  data-testid="sewing-lines-error"
                  className="text-[11px] text-rose-400 mt-1 leading-snug"
                >
                  {fieldErrors.sewingLinesConfigured}
                </p>
              )}
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
        <div className="flex items-center justify-between pt-2 gap-3">
          <span className="text-[11px] font-mono text-zinc-500">
            Saving updates only plant configuration settings in local storage.
          </span>
          <button
            type="submit"
            data-testid="settings-save-btn"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono transition-all shadow-md disabled:opacity-50"
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
            <span className="text-amber-400 font-bold block mt-0.5">Automated Suite</span>
            <span className="text-[10px] text-zinc-500">Phase 2A, 2B & 3A Checks</span>
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

      {/* Reset Defaults Confirmation Modal */}
      {isResetConfirmOpen && (
        <div
          data-testid="reset-defaults-confirm-modal"
          className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                <RotateCcw className="w-4 h-4 text-amber-400" />
                <span>Confirm Reset Defaults</span>
              </div>
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
                aria-label="Close confirmation dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs font-mono text-zinc-300">
              <p className="leading-relaxed">
                Restore all plant configuration settings (facility details, active shift, planned daily output, line count, DHU thresholds, and floor toggles) to their factory defaults?
              </p>
              <div className="p-2.5 rounded bg-zinc-950 border border-emerald-900/60 text-emerald-300 text-[11px] leading-relaxed">
                Data Safety: Orders, BOMs, cost sheets, inventory transactions, and production logs will NOT be modified or deleted.
              </div>
            </div>

            <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="reset-defaults-cancel-btn"
                onClick={() => setIsResetConfirmOpen(false)}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="reset-defaults-confirm-btn"
                onClick={handleConfirmReset}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold font-mono transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Confirm Reset Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Distinct Confirmation Toast (Save vs Reset) */}
      {toast && (
        <div
          data-testid={`settings-toast-${toast.type}`}
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-zinc-100 rounded-md shadow-2xl text-xs font-mono border ${
            toast.type === 'reset' ? 'border-amber-500/60' : 'border-emerald-500/50'
          }`}
        >
          {toast.type === 'reset' ? (
            <RotateCcw className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
