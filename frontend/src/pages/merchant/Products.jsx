import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { ProductsIcon, SearchIcon } from '../../components/Icons';

export default function MerchantProducts() {
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/products')
      .then((res) => {
        setProducts(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const filtered = products.filter((p) => {
    const q = searchTerm.toLowerCase();
    return (
      p.product_name.toLowerCase().includes(q) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <ProductsIcon size={22} />
            <span>Product Catalog & Official Rates</span>
          </h2>
          <p className="section-subtitle">Official cooperative price index and standard retail product list</p>
        </div>
        <div style={{ position: 'relative', width: '260px' }}>
          <input
            type="text"
            placeholder="Search price list..."
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
                <th>Product Description</th>
                <th>Category</th>
                <th>Selling Unit</th>
                <th>Official Retail Price</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '36px' }}>Loading price list...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '36px' }}>No products found matching "{searchTerm}"</td>
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
