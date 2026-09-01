import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { DiscrepanciesIcon } from '../../components/Icons';

export default function Discrepancies() {
  const [payment, setPayment] = useState([]);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/discrepancies/payment'),
      api.get('/discrepancies/stock')
    ])
      .then(([payRes, stockRes]) => {
        setPayment(payRes.data);
        setStock(stockRes.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <DiscrepanciesIcon size={22} />
            <span>Fraud & Discrepancy Monitoring</span>
          </h2>
          <p className="section-subtitle">Automated anomaly detection comparing sales vs collections and stock flow</p>
        </div>
      </div>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px 18px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '20px' }}>💡</span>
        <div style={{ fontSize: '13px', color: '#92400e' }}>
          <strong>Notice:</strong> These flags represent automated indicators generated from transactions and stock balances. Each variance should be audited and cross-checked with the merchant.
        </div>
      </div>

      {/* Payment Discrepancies */}
      <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-panel-header" style={{ padding: '18px 24px', margin: 0, background: '#fafafa' }}>
          <div className="card-panel-title">
            <span style={{ color: '#ef4444' }}>●</span>
            <span>Payment Variance (Sales vs Actual Collections)</span>
          </div>
          <span className={`badge ${payment.length > 0 ? 'failed' : 'success'}`}>
            {payment.length} Shop(s) Flagged
          </span>
        </div>

        <div className="table-responsive" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Merchant Outlet</th>
                <th>Total Billed Sales</th>
                <th>Verified Collections</th>
                <th>Uncollected Variance</th>
                <th>Action Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '30px' }}>Checking for payment anomalies...</td>
                </tr>
              ) : payment.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '30px' }}>
                    <div style={{ color: '#059669', fontWeight: 600 }}>✅ No payment discrepancies detected! All collections align.</div>
                  </td>
                </tr>
              ) : (
                payment.map((row) => (
                  <tr key={row.merchant_id}>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{row.shop_name}</td>
                    <td>₹{Number(row.total_sales).toFixed(2)}</td>
                    <td>₹{Number(row.total_successful_payments).toFixed(2)}</td>
                    <td style={{ color: '#ef4444', fontWeight: 700, fontSize: '15px' }}>
                      ₹{Number(row.discrepancy).toFixed(2)}
                    </td>
                    <td>
                      <span className="badge failed">Audit Required</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Discrepancies */}
      <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-panel-header" style={{ padding: '18px 24px', margin: 0, background: '#fafafa' }}>
          <div className="card-panel-title">
            <span style={{ color: '#d97706' }}>●</span>
            <span>Stock Reconciliation Variance (Incoming vs Sold vs Recorded)</span>
          </div>
          <span className={`badge ${stock.length > 0 ? 'pending' : 'success'}`}>
            {stock.length} Product Item(s) Flagged
          </span>
        </div>

        <div className="table-responsive" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Merchant Outlet</th>
                <th>Product Name</th>
                <th>Total Inflow</th>
                <th>Total Sold</th>
                <th>Expected Bal</th>
                <th>Actual Physical</th>
                <th>Discrepancy (Units)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '30px' }}>Checking stock ledgers...</td>
                </tr>
              ) : stock.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '30px' }}>
                    <div style={{ color: '#059669', fontWeight: 600 }}>✅ No inventory variance found across all franchise stores.</div>
                  </td>
                </tr>
              ) : (
                stock.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{row.shop_name}</td>
                    <td>{row.product_name}</td>
                    <td>{row.total_incoming}</td>
                    <td>{row.total_sold}</td>
                    <td style={{ fontWeight: 600 }}>{row.expected_stock}</td>
                    <td>{row.actual_stock}</td>
                    <td style={{ color: '#ef4444', fontWeight: 700, fontSize: '15px' }}>
                      {row.discrepancy}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
