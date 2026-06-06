import { useState, useEffect } from 'react';

const API  = 'http://localhost:8080';
const OPTS = { credentials: 'include' };

const METHOD_LABELS = {
  cash:                 'Cash',
  credit_card:          'Credit Card',
  electronic_payment:   'Electronic Payment',
};

export default function SalesPage({ user, onLogout, onNavigate }) {
  const [sales, setSales]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [searchTerm, setSearch] = useState('');
  const [lightboxSrc, setLightbox] = useState(null);

  useEffect(() => {
    fetch(`${API}/sales`, OPTS)
      .then(r => r.json())
      .then(data => {
        setSales(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const filtered = (Array.isArray(sales) ? sales : []).filter(s => {
    const q = searchTerm.toLowerCase();
    return (
      s.barcode?.toLowerCase().includes(q)       ||
      s.prefix?.toLowerCase().includes(q)        ||
      s.size?.toLowerCase().includes(q)          ||
      s.sold_by?.toLowerCase().includes(q)       ||
      s.sale_method?.toLowerCase().includes(q)   ||
      String(s.total_price).includes(q)          ||
      new Date(s.sold_at).toLocaleDateString().includes(q)
    );
  });

  // Summary totals from filtered rows
  const totalRevenue = filtered.reduce((sum, s) => sum + parseFloat(s.total_price || 0), 0);
  const totalUnits   = filtered.reduce((sum, s) => sum + (s.quantity || 0), 0);

  async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', ...OPTS });
    onLogout();
  }

  return (
    <div className="app-wrapper">

      {/* ── Image lightbox ── */}
      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img className="lightbox-img" src={lightboxSrc} alt="Full size" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="app-nav">
        <div className="nav-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="nav-title">Sales</span>
            <button className="nav-link-btn" onClick={() => onNavigate('inventory')}>← Inventory</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="nav-user">👤 {user.username}</span>
            {user.type === 'admin' && (
              <button className="btn" onClick={() => onNavigate('admin')}>Admin</button>
            )}
            <button className="btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="content">

        {/* Search + summary bar */}
        <div className="sales-toolbar">
          <div className="inv-search-row" style={{ flex: 1 }}>
            <input
              className="search-input"
              type="text"
              placeholder="Search by barcode, prefix, size, method, seller, price, date..."
              value={searchTerm}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="btn">Search</button>
          </div>
          {!loading && !error && (
            <div className="sales-summary">
              <span className="sales-summary-item">
                <strong>{filtered.length}</strong> sale{filtered.length !== 1 ? 's' : ''}
              </span>
              <span className="sales-summary-sep">|</span>
              <span className="sales-summary-item">
                <strong>{totalUnits}</strong> unit{totalUnits !== 1 ? 's' : ''}
              </span>
              <span className="sales-summary-sep">|</span>
              <span className="sales-summary-item">
                Total: <strong>${totalRevenue.toFixed(2)}</strong>
              </span>
            </div>
          )}
        </div>

        {loading && <div className="status-msg loading">Loading sales...</div>}
        {error   && <div className="status-msg error">Error: {error}</div>}

        {!loading && !error && (
          filtered.length === 0
            ? <p>{searchTerm ? 'No sales match your search.' : 'No sales recorded yet.'}</p>
            : (
              <div className="table-wrapper">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Image</th>
                      <th>Barcode</th>
                      <th>Prefix</th>
                      <th>Size</th>
                      <th>Type</th>
                      <th>Style</th>
                      <th>Texture</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                      <th>Method</th>
                      <th>Sold By</th>
                      <th>Sale Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => (
                      <tr key={s.sale_id}>
                        <td style={{ color: '#888', fontSize: 11 }}>{s.sale_id}</td>
                        <td>
                          {s.image_url
                            ? <img
                                className="item-img item-img-clickable"
                                src={`${API}${s.image_url}`}
                                alt={s.prefix}
                                onClick={() => setLightbox(`${API}${s.image_url}`)}
                              />
                            : <span className="no-img">—</span>}
                        </td>
                        <td className="barcodes">{s.barcode}</td>
                        <td><strong>{s.prefix}</strong></td>
                        <td>{s.size}</td>
                        <td>{s.type_code}</td>
                        <td>{s.style_code}</td>
                        <td>{s.texture_code}</td>
                        <td className="count">{s.quantity}</td>
                        <td>${parseFloat(s.price_per_unit).toFixed(2)}</td>
                        <td><strong>${parseFloat(s.total_price).toFixed(2)}</strong></td>
                        <td>
                          <span className={`method-badge method-${s.sale_method}`}>
                            {METHOD_LABELS[s.sale_method] || s.sale_method}
                          </span>
                        </td>
                        <td>{s.sold_by || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {new Date(s.sold_at).toLocaleDateString()}<br />
                          <span style={{ color: '#888', fontSize: 11 }}>
                            {new Date(s.sold_at).toLocaleTimeString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>

      <footer className="server-info">
        <div className="server-inner">Server: {API}</div>
      </footer>
    </div>
  );
}
