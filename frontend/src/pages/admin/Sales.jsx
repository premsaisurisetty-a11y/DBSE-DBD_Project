import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { SearchIcon, SalesIcon } from '../../components/Icons';

export default function AdminSales() {
  const [sales, setSales] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSaleId, setExpandedSaleId] = useState(null);
  const [saleDetails, setSaleDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/sales')
      .then((res) => {
        setSales(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const toggleDetails = async (saleId) => {
    if (expandedSaleId === saleId) {
      setExpandedSaleId(null);
    } else {
      setExpandedSaleId(saleId);
      if (!saleDetails[saleId]) {
        setLoadingDetails(true);
        try {
          const res = await api.get(`/sales/${saleId}`);
          setSaleDetails(prev => ({ ...prev, [saleId]: res.data }));
        } catch (err) {
          console.error('Failed to fetch sale details:', err);
        } finally {
          setLoadingDetails(false);
        }
      }
    }
  };

  const filteredSales = sales.filter((s) => {
    const q = searchTerm.toLowerCase();
    return (
      s.sale_id.toString().includes(q) ||
      (s.shop_name && s.shop_name.toLowerCase().includes(q)) ||
      (s.sale_status && s.sale_status.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <SalesIcon size={22} />
            <span>Master Sales Registry</span>
          </h2>
          <p className="section-subtitle">Complete registry of transactions across all merchant franchise shops</p>
        </div>
        <div style={{ position: 'relative', width: '280px' }}>
          <input
            type="text"
            placeholder="Search by ID, Shop or Status..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '34px' }}
          />
          <div style={{ position: 'absolute', left: '11px', top: '12px', color: '#94a3b8' }}>
            <SearchIcon size={16} />
          </div>
        </div>
      </div>

      <div className="card-panel" style={{ padding: '0', overflow: 'hidden' }}>
        <div className="table-responsive" style={{ border: 'none', margin: '0' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}></th>
                <th>Sale ID</th>
                <th>Shop Outlet</th>
                <th>Date & Time</th>
                <th>Subtotal</th>
                <th>Tax</th>
                <th>Discount</th>
                <th>Total Bill</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '40px' }}>
                    <div className="empty-state-text">Loading sales transactions...</div>
                  </td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '40px' }}>
                    <div className="empty-state-text">No transactions found matching "{searchTerm}"</div>
                  </td>
                </tr>
              ) : (
                filteredSales.map((s) => (
                  <React.Fragment key={s.sale_id}>
                    <tr
                      onClick={() => toggleDetails(s.sale_id)}
                      style={{ cursor: 'pointer', background: expandedSaleId === s.sale_id ? '#f8fafc' : undefined }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <span className="expand-toggle">
                          {expandedSaleId === s.sale_id ? '▼' : '▶'}
                        </span>
                      </td>
                      <td><strong>#{s.sale_id}</strong></td>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>{s.shop_name}</td>
                      <td>{new Date(s.sale_date).toLocaleString('en-IN')}</td>
                      <td>₹{Number(s.subtotal).toFixed(2)}</td>
                      <td style={{ color: '#64748b' }}>₹{Number(s.tax).toFixed(2)}</td>
                      <td style={{ color: '#64748b' }}>₹{Number(s.discount).toFixed(2)}</td>
                      <td style={{ fontWeight: 700, color: '#047857' }}>₹{Number(s.total_amount).toFixed(2)}</td>
                      <td>
                        <span className={`badge ${s.sale_status === 'COMPLETED' ? 'success' : 'pending'}`}>
                          {s.sale_status}
                        </span>
                      </td>
                    </tr>

                    {expandedSaleId === s.sale_id && (
                      <tr>
                        <td colSpan="9" style={{ padding: '0 24px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          <div className="receipt-box">
                            <div className="receipt-title">
                              🧾 Order Breakdown (Sale #{s.sale_id} — {s.shop_name})
                            </div>

                            {loadingDetails && !saleDetails[s.sale_id] ? (
                              <p style={{ padding: '10px 0', color: '#64748b' }}>Fetching item details...</p>
                            ) : saleDetails[s.sale_id]?.items && saleDetails[s.sale_id].items.length > 0 ? (
                              <>
                                <table style={{ marginTop: '10px', background: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                  <thead>
                                    <tr>
                                      <th>Product Name</th>
                                      <th style={{ textAlign: 'center' }}>Quantity</th>
                                      <th style={{ textAlign: 'right' }}>Unit Rate</th>
                                      <th style={{ textAlign: 'right' }}>Item Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {saleDetails[s.sale_id].items.map((item, idx) => (
                                      <tr key={idx}>
                                        <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                                        <td style={{ textAlign: 'center' }}>{Number(item.quantity).toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>₹{Number(item.unit_price).toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                          ₹{(Number(item.quantity) * Number(item.unit_price)).toFixed(2)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>

                                {saleDetails[s.sale_id].payment && (
                                  <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', background: '#ffffff', padding: '10px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                    <div><strong>Payment Mode:</strong> {saleDetails[s.sale_id].payment.payment_method}</div>
                                    <div>
                                      <strong>Payment Status:</strong>{' '}
                                      <span className={`badge ${saleDetails[s.sale_id].payment.payment_status === 'SUCCESS' ? 'success' : 'failed'}`}>
                                        {saleDetails[s.sale_id].payment.payment_status}
                                      </span>
                                    </div>
                                    {saleDetails[s.sale_id].payment.transaction_ref && (
                                      <div><strong>Txn Ref:</strong> <code>{saleDetails[s.sale_id].payment.transaction_ref}</code></div>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <p style={{ color: '#64748b' }}>No line items recorded for this sale.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
