import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import api from '../services/api';
import { MilkDropLogo } from '../components/Icons';

export default function Login() {
  const [identifier, setIdentifier] = useState('M1');
  const [password, setPassword] = useState('P1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState('M1');

  const { login } = useAuth();
  const navigate = useNavigate();

  function handleMerchantSelect(code) {
    setSelectedMerchant(code);
    setError('');
    if (code === 'M1') {
      setIdentifier('M1');
      setPassword('P1');
    } else if (code === 'M2') {
      setIdentifier('M2');
      setPassword('P2');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { identifier, password });
      login(res.data.token, res.data.user);

      if (res.data.user.role === 'ADMIN' || res.data.user.role === 'OWNER') {
        navigate('/admin/dashboard');
      } else {
        navigate('/merchant/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-box">
        <div className="login-logo-badge">
          <MilkDropLogo size={36} />
        </div>

        <h1 className="login-title">DairyHub System</h1>
        <p className="login-subtitle">Cooperative Dairy & Merchant Management Platform</p>

        {/* Quick Sign-In Selector — strictly 2 Merchants (M1 & M2) */}
        <div className="role-switcher-container">
          <label className="role-switcher-label">Quick Sign-In Selector</label>
          <div className="role-switcher-tabs" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              type="button"
              className={`role-tab-btn ${selectedMerchant === 'M1' ? 'active' : ''}`}
              onClick={() => handleMerchantSelect('M1')}
            >
              🌅 Koteshwar (M1)
            </button>
            <button
              type="button"
              className={`role-tab-btn ${selectedMerchant === 'M2' ? 'active' : ''}`}
              onClick={() => handleMerchantSelect('M2')}
            >
              🌆 Lakshmaiah (M2)
            </button>
          </div>
        </div>

        {error && <div className="error-msg">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Merchant ID / Email</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setSelectedMerchant('');
              }}
              placeholder="e.g. M1, M2 or Email"
              required
            />
          </div>

          <div className="field">
            <label>Password / Access Code</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g. P1, P2 or Password"
              required
            />
          </div>

          <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '14px', padding: '12px' }}>
            {loading ? 'Authenticating...' : '🔐 Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '18px', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
          <button
            type="button"
            onClick={() => {
              setIdentifier('premsaisurisetty@gmail.com');
              setPassword('0206');
              setSelectedMerchant('');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            👑 Quick fill Admin / Owner login
          </button>
        </div>
      </div>
    </div>
  );
}
