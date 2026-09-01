import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { PaymentsIcon, SearchIcon } from '../../components/Icons';

const statusClass = { SUCCESS: 'success', FAILED: 'failed', PENDING: 'pending', REFUNDED: 'pending' };

export default function MerchantPayments() {
  const [payments, setPayments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/payments')
      .then((res) => {
        setPayments(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const filtered = payments.filter((p) => {
    const q = searchTerm.toLowerCase();
    return (
      p.sale_id.toString().includes(q) ||
      p.payment_method.toLowerCase().includes(q) ||
      (p.transaction_ref && p.transaction_ref.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <PaymentsIcon size={22} />
            <span>My Payment Transactions</span>
          </h2>
          <p className="section-subtitle">Real-time history of customer collections and payment statuses</p>
        </div>
        <div style={{ position: 'relative', width: '260px' }}>
          <input
            type="text"
            placeholder="Search payments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '34px' }}
          />
          <div style={{ position: 'absolute', left: '11px', top: '12px', color: '#94a3b8' }}>
            <SearchIcon size={16} />
          </div>
        </div>
      </div>

      <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-responsive" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Sale ID</th>
                <th>Payment Mode</th>
                <th>Amount Billed</th>
                <th>Txn Reference</th>
                <th>Payment Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '36px' }}>Loading payments...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '36px' }}>No payments found.</td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.payment_id}>
                    <td><strong>Sale #{p.sale_id}</strong></td>
                    <td>
                      {p.payment_method === 'CASH' ? (
                        <span className="badge" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontWeight: 700 }}>
                          💵 CASH
                        </span>
                      ) : p.payment_method === 'UPI' ? (
                        <span className="badge" style={{ background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', fontWeight: 700 }}>
                          📱 UPI
                        </span>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{p.payment_method}</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700, color: '#047857', fontSize: '15px' }}>
                      ₹{Number(p.amount).toFixed(2)}
                    </td>
                    <td>
                      {p.transaction_ref ? (
                        <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', fontSize: '12px' }}>
                          {p.transaction_ref}
                        </code>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${statusClass[p.payment_status] || 'info'}`}>
                        {p.payment_status}
                      </span>
                    </td>
                    <td>{new Date(p.payment_date).toLocaleString('en-IN')}</td>
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
