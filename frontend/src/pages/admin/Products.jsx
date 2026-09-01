import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { ProductsIcon, SearchIcon } from '../../components/Icons';

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product_name: '', category: '', unit: '', selling_price: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    api.get('/products')
      .then((res) => {
        setProducts(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Failed to load products');
        setLoading(false);
      });
  }

  useEffect(load, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.post('/products', { ...form, selling_price: Number(form.selling_price) });
      setSuccess(`Product "${form.product_name}" added to catalog successfully.`);
      setForm({ product_name: '', category: '', unit: '', selling_price: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add product');
    }
  }

  const filtered = products.filter((p) => {
    const q = searchTerm.toLowerCase();
    return (
      p.product_name.toLowerCase().includes(q) ||
      (p.category && p.category.toLowerCase().includes(q)) ||
      (p.unit && p.unit.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <ProductsIcon size={22} />
            <span>Product Catalog & Base Pricing</span>
          </h2>
          <p className="section-subtitle">Maintain standardized milk products, standardized units, and standard cooperative retail rates</p>
        </div>
      </div>

      {success && <div className="success-msg">✅ {success}</div>}
      {error && <div className="error-msg">⚠️ {error}</div>}

      <div className="card-panel">
        <div className="card-panel-header">
          <div className="card-panel-title">📦 Add New Catalog Product</div>
        </div>
        <form onSubmit={handleAdd}>
          <div className="form-grid">
            <div className="field">
              <label>Product Name</label>
              <input
                placeholder="e.g. Full Cream Milk 500ml"
                value={form.product_name}
                onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Category</label>
              <input
                placeholder="e.g. Milk, Butter, Ghee, Paneer"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Measurement Unit</label>
              <input
                placeholder="e.g. Litre, Packet, Kg"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Selling Price (₹)</label>
              <input
                placeholder="0.00"
                type="number"
                step="0.01"
                min="0"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                required
              />
            </div>
          </div>
          <button className="btn-primary" type="submit">
            + Save Product to Catalog
          </button>
        </form>
      </div>

      <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-panel-header" style={{ padding: '18px 24px', margin: 0 }}>
          <div className="card-panel-title">Active Products List</div>
          <div style={{ position: 'relative', width: '240px' }}>
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '32px', padding: '6px 12px 6px 32px', fontSize: '13px' }}
            />
            <div style={{ position: 'absolute', left: '10px', top: '8px', color: '#94a3b8' }}>
              <SearchIcon size={14} />
            </div>
          </div>
        </div>

        <div className="table-responsive" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Category</th>
                <th>Measurement Unit</th>
                <th>Official Retail Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '36px' }}>Loading catalog...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '36px' }}>No matching products found.</td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.product_id}>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>🥛 {p.product_name}</td>
                    <td>
                      <span className="badge info">{p.category}</span>
                    </td>
                    <td>{p.unit}</td>
                    <td style={{ fontWeight: 700, color: '#047857', fontSize: '15px' }}>
                      ₹{Number(p.selling_price).toFixed(2)}
                    </td>
                    <td>
                      <span className={`badge ${p.status === 'ACTIVE' ? 'success' : 'failed'}`}>
                        {p.status}
                      </span>
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
