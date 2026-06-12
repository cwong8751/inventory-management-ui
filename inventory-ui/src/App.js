import { useState, useEffect } from 'react';
import LoginPage     from './pages/LoginPage';
import InventoryPage from './pages/InventoryPage';
import AdminPage     from './pages/AdminPage';
import SalesPage     from './pages/SalesPage';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);   // null=loading, false=guest, object=authed
  const [page, setPage] = useState('inventory');
  const API = process.env.REACT_APP_BACKEND_API_URL || 'http://localhost:8080';

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data || false))
      .catch(() => setUser(false));
  }, [API]);

  if (user === null) {
    return <div className="app-loading"><span>Loading...</span></div>;
  }

  if (user === false) {
    return <LoginPage onLogin={setUser} />;
  }

  const commonProps = {
    user,
    onLogout:   () => setUser(false),
    onNavigate: setPage,
  };

  if (page === 'admin' && user.type === 'admin') {
    return <AdminPage {...commonProps} />;
  }

  if (page === 'sales') {
    return <SalesPage {...commonProps} />;
  }

  return <InventoryPage {...commonProps} />;
}
