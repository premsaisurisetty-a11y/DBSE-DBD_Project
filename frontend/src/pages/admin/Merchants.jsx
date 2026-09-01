import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { MerchantsIcon, SearchIcon } from '../../components/Icons';

export default function Merchants() {
  const [merchants, setMerchants] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    api.get('/merchants')
      .then((res) => {
        setMerchants(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Failed to load merchants');
        setLoading(false);
      });
  }

  useEffect(load, []);

  async function toggleStatus(id, currentStatus) {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.put(`/merchants/${id}/status`, { status: newStatus });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update merchant status');
    }
  }

  const filtered = merchants.filter((m) => {
    const q = searchTerm.toLowerCase();
    return (
      (m.shop_name && m.shop_name.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.phone && m.phone.toLowerCase().includes(q)) ||
      (m.address && m.address.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <MerchantsIcon size={22} />
            <span>Merchants Directory</span>
          </h2>
          <p className="section-subtitle">Manage registered dairy franchise outlets, contact records, and access status</p>
        </div>
        <div style={{ position: 'relative', width: '280px' }}>
          <input
            type="text"
            placeholder="Search merchants..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '34px' }}
          />
          <div style={{ position: 'absolute', left: '11px', top: '12px', color: '#94a3b8' }}>
            <SearchIcon size={16} />
          </div>
        </div>
      </div>

      {error && <div className="error-msg">⚠️ {error}</div>}

      <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-responsive" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Merchant Operator</th>
                <th>Merchant ID</th>
                <th>Assigned Shift</th>
                <th>Franchise Counter / Shop</th>
                <th>Phone Contact</th>
                <th>Email Account</th>
                <th>Operating Address</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '36px' }}>Loading merchants...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '36px' }}>No merchants found.</td>
                </tr>
              ) : (
                filtered.map((m) => (
                  <tr key={m.merchant_id}>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: m.shift === 'MORNING' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '13px'
                        }}>
                          {m.merchant_name ? m.merchant_name[0] : 'M'}
                        </div>
                        <span>{m.merchant_name || `Merchant #${m.merchant_id}`}</span>
                      </div>
                    </td>
                    <td>
                      <code style={{
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        color: '#0f172a',
                        fontSize: '13px',
                        border: '1px solid #e2e8f0'
                      }}>
                        {m.merchant_code || `M${m.merchant_id}`}
                      </code>
                    </td>
                    <td>
                      {m.shift === 'MORNING' ? (
                        <span className="badge" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                          🌅 Morning Shift (6 AM - 2 PM)
                        </span>
                      ) : (
                        <span className="badge" style={{ background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }}>
                          🌆 Evening Shift (2 PM - 10 PM)
                        </span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600, color: '#334155' }}>
                      {m.shop_name}
                    </td>
                    <td>{m.phone}</td>
                    <td><span style={{ color: '#475569' }}>{m.email}</span></td>
                    <td style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.address}
                    </td>
                    <td>
                      <span className={`badge ${m.status === 'ACTIVE' ? 'success' : 'failed'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={m.status === 'ACTIVE' ? 'btn-danger-outline' : 'btn-success-outline'}
                        onClick={() => toggleStatus(m.merchant_id, m.status)}
                      >
                        {m.status === 'ACTIVE' ? 'Deactivate' : 'Activate Access'}
                      </button>
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
