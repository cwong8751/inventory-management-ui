import { useState, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_BACKEND_API_URL || 'http://localhost:8080';
const OPTS = { credentials: 'include' };

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function AdminPage({ user, onLogout, onNavigate }) {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  // Edit modal state
  const [editingUser, setEditingUser] = useState(null);
  const [editEmail, setEditEmail]     = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editType, setEditType]       = useState('user');
  const [editError, setEditError]     = useState(null);
  const [editLoading, setEditLoading] = useState(false);

  // Delete modal state
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]   = useState(null);

  // Create modal state
  const [showCreate, setShowCreate]         = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail]       = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createType, setCreateType]         = useState('user');
  const [createError, setCreateError]       = useState(null);
  const [createLoading, setCreateLoading]   = useState(false);

  const loadUsers = useCallback(() => {
    setLoading(true);
    fetch(`${API}/admin/users`, OPTS)
      .then(res => res.json())
      .then(data => { setUsers(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ── Edit ───────────────────────────────────────────────────────────────────
  function openEdit(u) {
    setEditingUser(u);
    setEditEmail(u.email);
    setEditPassword('');
    setEditType(u.type);
    setEditError(null);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    setEditError(null);
    setEditLoading(true);
    const body = { email: editEmail, type: editType };
    if (editPassword) body.password = editPassword;
    try {
      const res = await fetch(`${API}/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...OPTS,
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error); return; }
      setEditingUser(null);
      loadUsers();
    } catch {
      setEditError('Server error');
    } finally {
      setEditLoading(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      const res = await fetch(`${API}/admin/users/${deletingUser.id}`, {
        method: 'DELETE',
        ...OPTS,
      });
      const data = await res.json();
      if (!res.ok) { setDeleteError(data.error); return; }
      setDeletingUser(null);
      loadUsers();
    } catch {
      setDeleteError('Server error');
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  function openCreate() {
    setCreateUsername('');
    setCreateEmail('');
    setCreatePassword('');
    setCreateType('user');
    setCreateError(null);
    setShowCreate(true);
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    setCreateError(null);
    setCreateLoading(true);
    try {
      const res = await fetch(`${API}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: createUsername, email: createEmail, password: createPassword, type: createType }),
        ...OPTS,
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error); return; }
      setShowCreate(false);
      loadUsers();
    } catch {
      setCreateError('Server error');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', ...OPTS });
    onLogout();
  }

  return (
    <div className="app-wrapper">

      {/* ── Edit modal ── */}
      {editingUser && (
        <Modal title={`Edit User: ${editingUser.username}`} onClose={() => setEditingUser(null)}>
          <form onSubmit={handleEditSubmit}>
            {editError && <div className="login-error">{editError}</div>}
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select className="form-input" value={editType} onChange={e => setEditType(e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="form-group">
              <label>New Password <span className="form-hint muted">(leave blank to keep current)</span></label>
              <input className="form-input" type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditingUser(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={editLoading}>
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete modal ── */}
      {deletingUser && (
        <Modal title="Delete User" onClose={() => setDeletingUser(null)}>
          {deleteError && <div className="login-error">{deleteError}</div>}
          <p style={{ margin: '0 0 8px' }}>Delete user <strong>{deletingUser.username}</strong>?</p>
          <p style={{ margin: '0 0 16px', color: '#c62828' }}>This cannot be undone.</p>
          <div className="form-actions">
            <button className="btn" onClick={() => setDeletingUser(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <Modal title="Create New User" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreateSubmit}>
            {createError && <div className="login-error">{createError}</div>}
            <div className="form-group">
              <label>Username</label>
              <input className="form-input" type="text" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required autoComplete="off" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" value={createEmail} onChange={e => setCreateEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select className="form-input" value={createType} onChange={e => setCreateType(e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={createLoading}>
                {createLoading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Nav ── */}
      <nav className="app-nav">
        <div className="nav-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="nav-title">Admin Panel</span>
            <button className="nav-link-btn" onClick={() => onNavigate('inventory')}>← Inventory</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="nav-user">👤 {user.username}</span>
            <button className="btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="content">
        <div className="admin-toolbar">
          <h2 className="admin-section-title">User Management</h2>
          <button className="btn btn-primary" onClick={openCreate}>+ New User</button>
        </div>

        {loading && <div className="status-msg loading">Loading users...</div>}
        {error   && <div className="status-msg error">Error: {error}</div>}

        {!loading && !error && (
          <div className="table-wrapper">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`role-badge role-${u.type}`}>{u.type}</span>
                    </td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <button className="btn btn-primary" onClick={() => openEdit(u)}>Edit</button>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={() => { setDeleteError(null); setDeletingUser(u); }}
                        disabled={u.id === user.id}
                        title={u.id === user.id ? 'Cannot delete yourself' : ''}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="server-info">
        <div className="server-inner">&copy; Inventory Management System</div>
      </footer>
    </div>
  );
}
