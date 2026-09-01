import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../services/api';
import { AuditIcon, SearchIcon } from '../../components/Icons';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/audit-logs')
      .then((res) => {
        setLogs(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const filtered = logs.filter((l) => {
    const q = searchTerm.toLowerCase();
    return (
      l.audit_id.toString().includes(q) ||
      (l.user_name && l.user_name.toLowerCase().includes(q)) ||
      (l.action && l.action.toLowerCase().includes(q)) ||
      (l.table_name && l.table_name.toLowerCase().includes(q)) ||
      (l.role && l.role.toLowerCase().includes(q))
    );
  });

  return (
    <Layout>
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <AuditIcon size={22} />
            <span>Immutable System Audit Trail</span>
          </h2>
          <p className="section-subtitle">Database mutation events, administrative actions, and merchant activity logs</p>
        </div>
        <div style={{ position: 'relative', width: '280px' }}>
          <input
            type="text"
            placeholder="Search audit trail..."
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
                <th>Event ID</th>
                <th>Operator</th>
                <th>Access Role</th>
                <th>Operation</th>
                <th>Target Entity</th>
                <th>Record Ref</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '36px' }}>Loading audit trail...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '36px' }}>No audit records found.</td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l.audit_id}>
                    <td><strong>#{l.audit_id}</strong></td>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{l.user_name || 'System / Auto'}</td>
                    <td>
                      <span className="badge info">{l.role || 'SYSTEM'}</span>
                    </td>
                    <td>
                      <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, color: '#0f172a' }}>
                        {l.action}
                      </code>
                    </td>
                    <td><span style={{ color: '#475569' }}>{l.table_name}</span></td>
                    <td><code>{l.record_id ?? '—'}</code></td>
                    <td>{new Date(l.action_time).toLocaleString('en-IN')}</td>
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
