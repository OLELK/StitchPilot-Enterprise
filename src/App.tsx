import React, { useState, useEffect, useCallback } from 'react';
import { NavigationTab, PlantSettings } from './types';
import { DEFAULT_PLANT_SETTINGS } from './data/mockData';
import { Sidebar } from './components/layout/Sidebar';
import { TopNavbar } from './components/layout/TopNavbar';
import { DashboardView } from './components/pages/DashboardView';
import { OrdersView } from './components/pages/OrdersView';
import { BomMrpView } from './components/pages/BomMrpView';
import { CostingView } from './components/costing/CostingView';
import { InventoryView } from './components/pages/InventoryView';
import { SettingsView } from './components/pages/SettingsView';
import { DatabaseDiagnosticModal } from './components/common/DatabaseDiagnosticModal';
import { systemRepo } from './db/repositories';

// Database Hooks
import { useDatabase } from './db/hooks/useDatabase';
import { useDashboardData } from './db/hooks/useDashboardData';
import { useInventoryData } from './db/hooks/useInventoryData';
import { useOrdersData } from './db/hooks/useOrdersData';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState<boolean>(false);
  const [plantSettings, setPlantSettings] = useState<PlantSettings>(DEFAULT_PLANT_SETTINGS);

  // 1. Database Lifecycle & Diagnostic Hook
  const {
    isReady: isDbReady,
    isLoading: isDbLoading,
    error: dbError,
    status: dbStatus,
    refreshStatus: refreshDbStatus,
    reseedDatabase,
  } = useDatabase();

  // Load persisted PlantSettings from IndexedDB system_metadata when ready
  const loadPersistedSettings = useCallback(async () => {
    if (!isDbReady) return;
    try {
      const stored = await systemRepo.getPlantSettings();
      setPlantSettings(stored);
    } catch (err) {
      console.error('[App] Failed to load persisted plant settings:', err);
    }
  }, [isDbReady]);

  useEffect(() => {
    loadPersistedSettings();
  }, [loadPersistedSettings]);

  // 2. Live Dashboard Data from IndexedDB
  const {
    metrics: dashboardMetrics,
    hourlyData: dashboardHourlyData,
    lines: dashboardLines,
    summaryMeta: dashboardSummaryMeta,
    isLoading: isDashboardLoading,
    error: dashboardError,
    refreshDashboard,
  } = useDashboardData(isDbReady, plantSettings);

  // 3. Live Inventory Ledger Data from IndexedDB
  const {
    materials,
    stockBalances,
    isLoading: isInventoryLoading,
    postTransaction,
    createMaterial,
    refreshInventory,
  } = useInventoryData(isDbReady);

  // 4. Live Orders & Merchandising Data from IndexedDB (Phase 2B)
  const {
    orders: dbOrders,
    buyers,
    styles,
    statistics: orderStats,
    createOrder,
    updateOrder,
    updateOrderStatus,
    cancelOrder,
    getOrderItems,
    createBuyer,
    updateBuyer,
    createStyle,
    updateStyle,
    refreshOrders,
  } = useOrdersData(isDbReady);

  const handleCreateOrder = async (orderData: any, items: any[]) => {
    const res = await createOrder(orderData, items);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleUpdateOrder = async (orderId: string, updates: any, items?: any[]) => {
    const res = await updateOrder(orderId, updates, items);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleUpdateOrderStatus = async (orderId: string, status: any, reason?: string) => {
    const res = await updateOrderStatus(orderId, status, reason);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleCancelOrder = async (orderId: string, reason: string) => {
    const res = await cancelOrder(orderId, reason);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleCreateBuyer = async (buyer: any) => {
    const res = await createBuyer(buyer);
    await refreshDbStatus();
    return res;
  };

  const handleUpdateBuyer = async (id: string, updates: any) => {
    const res = await updateBuyer(id, updates);
    await refreshDbStatus();
    return res;
  };

  const handleCreateStyle = async (style: any) => {
    const res = await createStyle(style);
    await refreshDbStatus();
    return res;
  };

  const handleUpdateStyle = async (id: string, updates: any) => {
    const res = await updateStyle(id, updates);
    await refreshDbStatus();
    return res;
  };

  const handlePostTransaction = async (params: any) => {
    const res = await postTransaction(params);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleCreateMaterial = async (material: any, initialQty?: number) => {
    const res = await createMaterial(material, initialQty);
    await refreshDashboard();
    await refreshDbStatus();
    return res;
  };

  const handleSaveSettings = async (updated: PlantSettings): Promise<PlantSettings> => {
    const persisted = await systemRepo.savePlantSettings(updated);
    setPlantSettings(persisted);
    return persisted;
  };

  const handleResetSettings = async (): Promise<PlantSettings> => {
    const restored = await systemRepo.resetPlantSettings();
    setPlantSettings(restored);
    return restored;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-row">
      {/* Dark Industrial Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        orderCount={orderStats.activeOrders}
        inventoryCount={stockBalances.length}
        plantSettings={plantSettings}
        summaryMeta={dashboardSummaryMeta}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Navbar */}
        <TopNavbar
          currentTab={currentTab}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onSelectTab={setCurrentTab}
          onOpenDbModal={() => setIsDbModalOpen(true)}
          plantSettings={plantSettings}
        />

        {/* View Content Canvas */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {currentTab === 'dashboard' && (
            <DashboardView
              metrics={dashboardMetrics}
              hourlyData={dashboardHourlyData}
              lines={dashboardLines}
              summaryMeta={dashboardSummaryMeta}
              plantSettings={plantSettings}
              onNavigateTab={setCurrentTab}
              isDbLoading={isDashboardLoading || isDbLoading}
              dbError={dbError || dashboardError}
              onOpenDbModal={() => setIsDbModalOpen(true)}
            />
          )}

          {currentTab === 'orders' && (
            <OrdersView
              orders={dbOrders}
              buyers={buyers}
              styles={styles}
              stats={orderStats}
              onCreateOrder={handleCreateOrder}
              onUpdateOrder={handleUpdateOrder}
              onUpdateOrderStatus={handleUpdateOrderStatus}
              onCancelOrder={handleCancelOrder}
              onGetOrderItems={getOrderItems}
              onCreateBuyer={handleCreateBuyer}
              onUpdateBuyer={handleUpdateBuyer}
              onCreateStyle={handleCreateStyle}
              onUpdateStyle={handleUpdateStyle}
            />
          )}

          {currentTab === 'bom-mrp' && (
            <BomMrpView
              orders={dbOrders}
              styles={styles}
              buyers={buyers}
              materials={materials}
              isDbReady={isDbReady}
              onBomMutated={refreshDbStatus}
            />
          )}

          {currentTab === 'costing' && (
            <CostingView
              styles={styles}
              orders={dbOrders}
              buyers={buyers}
              materials={materials}
              isDbReady={isDbReady}
              onCostingMutated={refreshDbStatus}
            />
          )}

          {currentTab === 'inventory' && (
            <InventoryView
              balances={stockBalances}
              onPostTransaction={handlePostTransaction}
              onCreateMaterial={handleCreateMaterial}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              settings={plantSettings}
              onSaveSettings={handleSaveSettings}
              onResetDefaults={handleResetSettings}
              onOpenDbModal={() => setIsDbModalOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Database Diagnostics & Test Verification Modal */}
      <DatabaseDiagnosticModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        status={dbStatus}
        onReseed={async () => {
          await reseedDatabase();
          await loadPersistedSettings();
          await refreshDashboard();
          await refreshInventory();
          await refreshOrders();
        }}
        onRefresh={async () => {
          await refreshDbStatus();
          await loadPersistedSettings();
          await refreshDashboard();
          await refreshInventory();
          await refreshOrders();
        }}
      />
    </div>
  );
}
