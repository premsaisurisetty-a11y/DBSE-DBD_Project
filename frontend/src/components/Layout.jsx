import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  DashboardIcon,
  MerchantsIcon,
  ProductsIcon,
  SalesIcon,
  PaymentsIcon,
  InventoryIcon,
  DiscrepanciesIcon,
  AuditIcon,
  StockIcon,
  LogOutIcon,
  MilkDropLogo
} from './Icons';

const ADMIN_LINKS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { to: '/admin/merchants', label: 'Merchants', icon: MerchantsIcon },
  { to: '/admin/products', label: 'Products Catalog', icon: ProductsIcon },
  { to: '/admin/sales', label: 'Sales Records', icon: SalesIcon },
  { to: '/admin/payments', label: 'Payment Ledger', icon: PaymentsIcon },
  { to: '/admin/inventory', label: 'Global Inventory', icon: InventoryIcon },
  { to: '/admin/discrepancies', label: 'Discrepancies / Fraud', icon: DiscrepanciesIcon },
  { to: '/admin/audit-logs', label: 'Audit Trail', icon: AuditIcon }
];

const MERCHANT_LINKS = [
  { to: '/merchant/dashboard', label: 'Overview', icon: DashboardIcon },
  { to: '/merchant/products', label: 'Products Price List', icon: ProductsIcon },
  { to: '/merchant/stock', label: 'Record Stock In', icon: StockIcon },
  { to: '/merchant/inventory', label: 'My Inventory', icon: InventoryIcon },
  { to: '/merchant/sales', label: 'Point of Sale (POS)', icon: SalesIcon },
  { to: '/merchant/payments', label: 'Payment History', icon: PaymentsIcon }
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const links = (user?.role === 'ADMIN' || user?.role === 'OWNER') ? ADMIN_LINKS : MERCHANT_LINKS;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Generate initials for avatar
  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase()
    : 'U';

  const roleClassName = user?.role ? user.role.toLowerCase() : 'merchant';

  // Format page title from route
  const currentLink = links.find((l) => l.to === location.pathname);
  const pageTitle = currentLink ? currentLink.label : 'Dashboard';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-container">
          <div className="brand-logo-icon">
            <MilkDropLogo size={22} />
          </div>
          <div className="brand-text">
            <h2>DairyHub</h2>
            <p>Cooperative Portal</p>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="nav-category">Navigation Menu</div>
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <Icon size={18} />
                <span>{l.label}</span>
              </NavLink>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user-pill">
            <div className="user-avatar-initials" style={{
              background: user?.shift === 'MORNING' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                          user?.shift === 'EVENING' ? 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)' :
                          undefined
            }}>
              {initials}
            </div>
            <div className="user-pill-info">
              <div className="user-pill-name">{user?.name || 'User'}</div>
              <div className="user-pill-role">
                {user?.shift === 'MORNING' ? '🌅 Morning Shift' : user?.shift === 'EVENING' ? '🌆 Evening Shift' : (user?.role || 'MERCHANT')}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out of account"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '6px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              <LogOutIcon size={15} />
            </button>
          </div>

          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '9px 14px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#fca5a5',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.22)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              e.currentTarget.style.color = '#fca5a5';
            }}
          >
            <LogOutIcon size={14} />
            <span>Sign Out / Logout</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title-area">
            <h1>{pageTitle}</h1>
            <p>Dairy & Merchant Management Cooperative System</p>
          </div>
          <div className="topbar-actions">
            {user?.shift && (
              <span className="badge" style={{
                background: user.shift === 'MORNING' ? '#fffbeb' : '#eef2ff',
                color: user.shift === 'MORNING' ? '#b45309' : '#4338ca',
                border: user.shift === 'MORNING' ? '1px solid #fde68a' : '1px solid #c7d2fe',
                fontWeight: 600
              }}>
                {user.shift === 'MORNING' ? '🌅 Morning Shift (6 AM - 2 PM)' : '🌆 Evening Shift (2 PM - 10 PM)'}
              </span>
            )}
            <span className={`role-tag ${roleClassName}`}>
              {user?.role === 'ADMIN' ? '👑 Admin' : user?.role === 'OWNER' ? '🌟 Owner' : '🏬 Merchant'}
            </span>
            <button className="logout-btn" onClick={handleLogout} title="Sign out of system">
              <LogOutIcon size={15} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
