import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { StockIcon } from '../../components/Icons';

export default function Stock() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    product_id: '',
    quantity: '',
    cost_per_unit: '',
    entry_date: new Date().toISOString().slice(0, 10)
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/products').then((res) => setProducts(res.data));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.post('/inventory/stock', {
        product_id: Number(form.product_id),
        quantity: Number(form.quantity),
        cost_per_unit: Number(form.cost_per_unit),
        entry_date: form.entry_date
      });
      setMessage('✅ Incoming stock batch logged successfully and inventory balance updated.');
      setForm({ ...form, quantity: '', cost_per_unit: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record incoming stock');
    } finally {
      setLoading(false);
    }
  }

  const selectedProd = products.find(p => p.product_id === Number(form.product_id));
  const estimatedCost = (Number(form.quantity) || 0) * (Number(form.cost_per_unit) || 0);

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <StockIcon size={22} />
            <span>Record Incoming Stock Batch</span>
          </h2>
          <p className="section-subtitle">Log new shipments received from dairy processing plants or farmers</p>
        </div>
      </div>

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">⚠️ {error}</div>}

      <div className="card-panel" style={{ maxWidth: '560px' }}>
        <div className="card-panel-header">
          <div className="card-panel-title">📦 Stock Inflow Entry</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Select Product Received</label>
            <select
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              required
            >
              <option value="">Choose dairy product...</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>
                  {p.product_name} ({p.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Received Quantity {selectedProd ? `(${selectedProd.unit})` : ''}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 50"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Cost per Unit (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 32.00"
                value={form.cost_per_unit}
                onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="field">
            <label>Inflow Receipt Date</label>
            <input
              type="date"
              value={form.entry_date}
              onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
              required
            />
          </div>

          {estimatedCost > 0 && (
            <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '14px 0', fontSize: '13px' }}>
              <span style={{ color: '#64748b' }}>Total Batch Value: </span>
              <strong style={{ color: '#047857', fontSize: '16px' }}>₹{estimatedCost.toFixed(2)}</strong>
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '10px' }}>
            {loading ? 'Recording Stock...' : '+ Record Stock Inflow'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
