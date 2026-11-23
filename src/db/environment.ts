/**
 * StitchPilot Enterprise — Runtime Environment & IndexedDB Diagnostics
 */

export interface RuntimeEnvironmentReport {
  isBrowser: boolean;
  hasWindow: boolean;
  hasIndexedDB: boolean;
  indexedDBType: string;
  hasIDBKeyRange: boolean;
  isIframe: boolean;
  origin: string;
  href: string;
  userAgent: string;
  securityError: string | null;
  canAccessStorage: boolean;
}

/**
 * Probes the current runtime environment without crashing.
 * Distinguishes Node.js server execution from browser execution,
 * and detects iframe storage partitioning/sandboxing restrictions.
 */
export function inspectRuntimeEnvironment(): RuntimeEnvironmentReport {
  const hasWindow = typeof window !== 'undefined';
  const isBrowser = hasWindow && typeof document !== 'undefined';

  let hasIndexedDB = false;
  let indexedDBType = 'undefined';
  let hasIDBKeyRange = false;
  let isIframe = false;
  let origin = 'unknown';
  let href = '';
  let userAgent = 'Node.js runtime';
  let securityError: string | null = null;
  let canAccessStorage = false;

  if (hasWindow) {
    userAgent = window.navigator?.userAgent || 'Unknown Browser';
    href = window.location?.href || '';
    origin = window.location?.origin || '';

    // Check iframe embedding
    try {
      isIframe = window.self !== window.top;
    } catch {
      // Accessing window.top threw cross-origin error, meaning it is definitely inside an iframe
      isIframe = true;
    }

    // Check window.indexedDB
    try {
      if ('indexedDB' in window && window.indexedDB !== null && window.indexedDB !== undefined) {
        hasIndexedDB = true;
        indexedDBType = typeof window.indexedDB;
        canAccessStorage = true;
      } else {
        hasIndexedDB = false;
        indexedDBType = typeof (window as any).indexedDB;
      }
    } catch (err: any) {
      securityError = err?.message || 'Access to window.indexedDB threw SecurityError';
      hasIndexedDB = false;
      canAccessStorage = false;
    }

    // Check window.IDBKeyRange
    try {
      if ('IDBKeyRange' in window && window.IDBKeyRange !== null && window.IDBKeyRange !== undefined) {
        hasIDBKeyRange = true;
      }
    } catch {
      hasIDBKeyRange = false;
    }
  }

  return {
    isBrowser,
    hasWindow,
    hasIndexedDB,
    indexedDBType,
    hasIDBKeyRange,
    isIframe,
    origin,
    href,
    userAgent,
    securityError,
    canAccessStorage,
  };
}
