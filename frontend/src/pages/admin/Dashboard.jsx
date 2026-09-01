import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { MerchantsIcon, SalesIcon, PaymentsIcon, DiscrepanciesIcon } from '../../components/Icons';

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/discrepancies/summary/admin')
      .then((res) => {
        setSummary(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Failed to load summary statistics');
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">Executive Overview</h2>
          <p className="section-subtitle">Real-time cooperative performance, revenue metrics, and fraud checks</p>
        </div>
      </div>

      {error && <div className="error-msg">⚠️ {error}</div>}

      {loading ? (
        <div className="empty-state">
          <div className="empty-state-text">Loading cooperative metrics...</div>
        </div>
      ) : summary ? (
        <>
          <div className="cards-grid">
            <div className="stat-card">
              <div className="stat-card-top">
                <span className="label">Registered Merchants</span>
                <div className="stat-icon-wrapper stat-icon-indigo">
                  <MerchantsIcon size={20} />
                </div>
              </div>
              <div className="value">{summary.total_merchants}</div>
              <div className="stat-card-footer">
                <span>Active dairy distribution points</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <span className="label">Gross Sales Billed</span>
                <div className="stat-icon-wrapper stat-icon-emerald">
                  <SalesIcon size={20} />
                </div>
              </div>
              <div className="value">₹{Number(summary.total_sales).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div className="stat-card-footer">
                <span>Total invoices generated</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <span className="label">Collected Revenue</span>
                <div className="stat-icon-wrapper stat-icon-teal">
                  <PaymentsIcon size={20} />
                </div>
              </div>
              <div className="value">₹{Number(summary.total_revenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div className="stat-card-footer">
                <span>Verified successful payments</span>
              </div>
            </div>

            <div className={`stat-card ${summary.payment_discrepancies > 0 ? 'alert' : ''}`}>
              <div className="stat-card-top">
                <span className="label">Payment Flags</span>
                <div className="stat-icon-wrapper stat-icon-rose">
                  <DiscrepanciesIcon size={20} />
                </div>
              </div>
              <div className="value">{summary.payment_discrepancies}</div>
              <div className="stat-card-footer">
                {summary.payment_discrepancies > 0 ? (
                  <Link to="/admin/discrepancies" style={{ color: '#ef4444', fontWeight: 600, textDecoration: 'none' }}>
                    Review flagged payments →
                  </Link>
                ) : (
                  <span>All payments reconciled</span>
                )}
              </div>
            </div>

            <div className={`stat-card ${summary.stock_discrepancies > 0 ? 'alert' : ''}`}>
              <div className="stat-card-top">
                <span className="label">Stock Variance Flags</span>
                <div className="stat-icon-wrapper stat-icon-amber">
                  <DiscrepanciesIcon size={20} />
                </div>
              </div>
              <div className="value">{summary.stock_discrepancies}</div>
              <div className="stat-card-footer">
                {summary.stock_discrepancies > 0 ? (
                  <Link to="/admin/discrepancies" style={{ color: '#d97706', fontWeight: 600, textDecoration: 'none' }}>
                    Review stock variances →
                  </Link>
                ) : (
                  <span>Inventory matching expected levels</span>
                )}
              </div>
            </div>
          </div>

          <div className="card-panel">
            <div className="card-panel-header">
              <div className="card-panel-title">⚡ Quick Management Shortcuts</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Link to="/admin/merchants" className="btn-secondary">🏬 Manage Merchants</Link>
              <Link to="/admin/products" className="btn-secondary">📦 Catalog & Pricing</Link>
              <Link to="/admin/sales" className="btn-secondary">🛒 Review All Sales</Link>
              <Link to="/admin/discrepancies" className="btn-secondary">⚠️ Fraud & Anomaly Center</Link>
              <Link to="/admin/audit-logs" className="btn-secondary">📜 Audit Trail</Link>
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
}
