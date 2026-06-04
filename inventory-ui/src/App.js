import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import InventoryPage from './pages/InventoryPage';
import AdminPage from './pages/AdminPage';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);   // null=loading, false=guest, object=authed
  const [page, setPage] = useState('inventory');

  useEffect(() => {
    fetch('http://localhost:8080/auth/me', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data || false))
      .catch(() => setUser(false));
  }, []);

  if (user === null) {
    return <div className="app-loading"><span>Loading...</span></div>;
  }

  if (user === false) {
    return <LoginPage onLogin={setUser} />;
  }

  // Only admins can reach the admin page; everyone else falls back to inventory
  if (page === 'admin' && user.type === 'admin') {
    return (
      <AdminPage
        user={user}
        onLogout={() => setUser(false)}
        onNavigate={setPage}
      />
    );
  }

  return (
    <InventoryPage
      user={user}
      onLogout={() => setUser(false)}
      onNavigate={setPage}
    />
  );
}
