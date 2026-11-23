import { useState, useEffect, useCallback } from 'react';
import { systemRepo } from '../repositories';
import { DatabaseStatus } from '../repositories/SystemRepository';
import { inspectRuntimeEnvironment, RuntimeEnvironmentReport } from '../environment';

export function useDatabase() {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [envReport, setEnvReport] = useState<RuntimeEnvironmentReport | null>(null);

  const init = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // 1. Inspect runtime environment first
    const report = inspectRuntimeEnvironment();
    setEnvReport(report);

    // 2. Validate environment capability
    if (!report.isBrowser) {
      setError('StitchPilot Enterprise database requires a browser environment. Server-side runtime detected.');
      setIsReady(false);
      setIsLoading(false);
      return;
    }

    if (!report.hasIndexedDB) {
      let msg = 'IndexedDB API is missing in this browser context.';
      if (report.securityError) {
        msg = `IndexedDB access blocked by browser security policy: ${report.securityError}`;
      } else if (report.isIframe) {
        msg = `IndexedDB API is restricted inside this embedded preview iframe (storage partitioning or sandbox restriction). Please open the application in a standalone browser window.`;
      }
      setError(msg);
      setIsReady(false);
      setIsLoading(false);
      return;
    }

    // 3. Initialize & Seed database
    try {
      // Seed demo records only if database is empty or not yet initialized
      await systemRepo.initializeAndSeedIfEmpty();

      // Query diagnostic status
      const dbStatus = await systemRepo.getDatabaseStatus();
      setStatus(dbStatus);
      setIsReady(true);
      setError(null);
    } catch (err: any) {
      console.error('[StitchPilot DB] Initialization Error:', err);
      const errMsg = err?.message || 'Failed to initialize IndexedDB.';
      setError(errMsg);
      setIsReady(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  const reseed = useCallback(async () => {
    setIsLoading(true);
    try {
      await systemRepo.purgeAndReseed();
      const dbStatus = await systemRepo.getDatabaseStatus();
      setStatus(dbStatus);
    } catch (err: any) {
      setError(err?.message || 'Failed to reseed database.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isReady,
    isLoading,
    error,
    status,
    envReport,
    refreshStatus: init,
    reseedDatabase: reseed,
  };
}
