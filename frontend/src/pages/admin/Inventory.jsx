import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { InventoryIcon, SearchIcon } from '../../components/Icons';

export default function AdminInventory() {
  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/inventory')
      .then((res) => {
        setInventory(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const filtered = inventory.filter((i) => {
    const q = searchTerm.toLowerCase();
    return (
      (i.shop_name && i.shop_name.toLowerCase().includes(q)) ||
      (i.product_name && i.product_name.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <InventoryIcon size={22} />
            <span>Global Cooperative Inventory</span>
          </h2>
          <p className="section-subtitle">Real-time stock balance aggregated across all merchant distribution outlets</p>
        </div>
        <div style={{ position: 'relative', width: '280px' }}>
          <input
            type="text"
            placeholder="Filter by shop or product..."
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
                <th>Franchise Outlet</th>
                <th>Dairy Product</th>
                <th>Available Quantity</th>
                <th>Stock Level Status</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '36px' }}>Loading global inventory...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '36px' }}>No inventory records found.</td>
                </tr>
              ) : (
                filtered.map((i) => {
                  const qty = Number(i.quantity_available);
                  const isLow = qty <= 10;
                  const isOut = qty <= 0;
                  return (
                    <tr key={i.inventory_id}>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>🏬 {i.shop_name}</td>
                      <td>🥛 {i.product_name}</td>
                      <td style={{ fontWeight: 700, fontSize: '15px' }}>{qty}</td>
                      <td>
                        <span className={`badge ${isOut ? 'failed' : isLow ? 'pending' : 'success'}`}>
                          {isOut ? 'Depleted' : isLow ? 'Low Stock Alert' : 'Healthy Stock'}
                        </span>
                      </td>
                      <td>{new Date(i.last_updated).toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
