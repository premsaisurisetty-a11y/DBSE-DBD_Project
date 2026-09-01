import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { SalesIcon, PaymentsIcon, StockIcon, InventoryIcon } from '../../components/Icons';

export default function MerchantDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/discrepancies/summary/merchant')
      .then((res) => {
        setSummary(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Failed to load summary');
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">Shop Performance Overview</h2>
          <p className="section-subtitle">Monitor today's transactions, live stock on hand, and recent orders</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Link to="/merchant/sales" className="btn-primary">+ New Sale</Link>
          <Link to="/merchant/stock" className="btn-secondary">+ Stock In</Link>
        </div>
      </div>

      {error && <div className="error-msg">⚠️ {error}</div>}

      {loading ? (
        <div className="empty-state">
          <div className="empty-state-text">Loading shop statistics...</div>
        </div>
      ) : summary ? (
        <>
          <div className="cards-grid">
            <div className="stat-card">
              <div className="stat-card-top">
                <span className="label">Today's Transactions</span>
                <div className="stat-icon-wrapper stat-icon-indigo">
                  <SalesIcon size={20} />
                </div>
              </div>
              <div className="value">{summary.todays_sale_count || 0}</div>
              <div className="stat-card-footer">
                <span>Orders completed today</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <span className="label">Today's Revenue</span>
                <div className="stat-icon-wrapper stat-icon-emerald">
                  <PaymentsIcon size={20} />
                </div>
              </div>
              <div className="value">₹{Number(summary.todays_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div className="stat-card-footer">
                <span>Total amount billed today</span>
              </div>
            </div>

            <div className={`stat-card ${Number(summary.pending_payments) > 0 ? 'alert' : ''}`}>
              <div className="stat-card-top">
                <span className="label">Pending Payments</span>
                <div className="stat-icon-wrapper stat-icon-amber">
                  <StockIcon size={20} />
                </div>
              </div>
              <div className="value">₹{Number(summary.pending_payments || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div className="stat-card-footer">
                <span>Awaiting customer/coop clearance</span>
              </div>
            </div>
          </div>

          <div className="card-panel">
            <div className="card-panel-header">
              <div className="card-panel-title">
                <InventoryIcon size={18} />
                <span>Current Stock on Hand</span>
              </div>
              <Link to="/merchant/inventory" className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                View Full Inventory →
              </Link>
            </div>
            {summary.inventory && summary.inventory.length > 0 ? (
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Quantity Available</th>
                      <th>Stock Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.inventory.map((i, idx) => {
                      const qty = Number(i.quantity_available);
                      const isLow = qty <= 10;
                      return (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{i.product_name}</td>
                          <td style={{ fontWeight: 700, fontSize: '15px' }}>{qty}</td>
                          <td>
                            <span className={`badge ${isLow ? 'pending' : 'success'}`}>
                              {isLow ? 'Low Stock' : 'In Stock'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-text">No inventory recorded yet. Add incoming stock to get started!</div>
              </div>
            )}
          </div>

          <div className="card-panel">
            <div className="card-panel-header">
              <div className="card-panel-title">
                <SalesIcon size={18} />
                <span>Recent Transactions</span>
              </div>
              <Link to="/merchant/sales" className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                All Sales History →
              </Link>
            </div>
            {summary.recent_sales && summary.recent_sales.length > 0 ? (
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Sale ID</th>
                      <th>Date & Time</th>
                      <th>Total Billed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent_sales.map((s) => (
                      <tr key={s.sale_id}>
                        <td><strong>#{s.sale_id}</strong></td>
                        <td>{new Date(s.sale_date).toLocaleString('en-IN')}</td>
                        <td style={{ fontWeight: 600 }}>₹{Number(s.total_amount).toFixed(2)}</td>
                        <td>
                          <span className={`badge ${s.sale_status === 'COMPLETED' ? 'success' : 'pending'}`}>
                            {s.sale_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-text">No sales recorded yet today.</div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </Layout>
  );
}
