import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';

import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import Merchants from './pages/admin/Merchants';
import AdminProducts from './pages/admin/Products';
import AdminSales from './pages/admin/Sales';
import AdminPayments from './pages/admin/Payments';
import AdminInventory from './pages/admin/Inventory';
import Discrepancies from './pages/admin/Discrepancies';
import AuditLogs from './pages/admin/AuditLogs';

import MerchantDashboard from './pages/merchant/Dashboard';
import MerchantProducts from './pages/merchant/Products';
import Stock from './pages/merchant/Stock';
import MerchantInventory from './pages/merchant/Inventory';
import MerchantSales from './pages/merchant/Sales';
import MerchantPayments from './pages/merchant/Payments';

function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Allow OWNER to access ADMIN routes (owner has admin privileges)
  if (role && !(user.role === role || (role === 'ADMIN' && user.role === 'OWNER'))) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/admin/dashboard" element={<ProtectedRoute role="ADMIN"><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/merchants" element={<ProtectedRoute role="ADMIN"><Merchants /></ProtectedRoute>} />
      <Route path="/admin/products" element={<ProtectedRoute role="ADMIN"><AdminProducts /></ProtectedRoute>} />
      <Route path="/admin/sales" element={<ProtectedRoute role="ADMIN"><AdminSales /></ProtectedRoute>} />
      <Route path="/admin/payments" element={<ProtectedRoute role="ADMIN"><AdminPayments /></ProtectedRoute>} />
      <Route path="/admin/inventory" element={<ProtectedRoute role="ADMIN"><AdminInventory /></ProtectedRoute>} />
      <Route path="/admin/discrepancies" element={<ProtectedRoute role="ADMIN"><Discrepancies /></ProtectedRoute>} />
      <Route path="/admin/audit-logs" element={<ProtectedRoute role="ADMIN"><AuditLogs /></ProtectedRoute>} />

      <Route path="/merchant/dashboard" element={<ProtectedRoute role="MERCHANT"><MerchantDashboard /></ProtectedRoute>} />
      <Route path="/merchant/products" element={<ProtectedRoute role="MERCHANT"><MerchantProducts /></ProtectedRoute>} />
      <Route path="/merchant/stock" element={<ProtectedRoute role="MERCHANT"><Stock /></ProtectedRoute>} />
      <Route path="/merchant/inventory" element={<ProtectedRoute role="MERCHANT"><MerchantInventory /></ProtectedRoute>} />
      <Route path="/merchant/sales" element={<ProtectedRoute role="MERCHANT"><MerchantSales /></ProtectedRoute>} />
      <Route path="/merchant/payments" element={<ProtectedRoute role="MERCHANT"><MerchantPayments /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to={user ? (user.role === 'ADMIN' ? '/admin/dashboard' : '/merchant/dashboard') : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
