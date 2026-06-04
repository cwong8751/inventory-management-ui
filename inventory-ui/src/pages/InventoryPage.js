import { useState, useEffect } from 'react';

// ─── Barcode parser ───────────────────────────────────────────────────────────
function parseBarcode(barcode) {
  if (!barcode || barcode.length < 7) return null;
  if (barcode[3].toUpperCase() !== 'D') return null;
  const afterMarker = barcode.slice(4);
  const size = afterMarker.slice(0, -2).toUpperCase();
  const unit = parseInt(afterMarker.slice(-2), 10);
  if (!size || isNaN(unit)) return null;
  return {
    prefix:       barcode.slice(0, 3).toUpperCase(),
    type_code:    barcode[0].toUpperCase(),
    style_code:   barcode[1].toUpperCase(),
    texture_code: barcode[2].toUpperCase(),
    size,
    unit_number: unit
  };
}

const API = 'http://localhost:8080';
const OPTS = { credentials: 'include' };

export default function InventoryPage({ user, onLogout, onNavigate }) {
  const [clothingItems, setClothingItems] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [searchTerm, setSearchTerm]       = useState('');

  const [showAddForm, setShowAddForm]               = useState(false);
  const [addBarcode, setAddBarcode]                 = useState('');
  const [addParsed, setAddParsed]                   = useState(null);
  const [prefixExists, setPrefixExists]             = useState(null);
  const [prefixCheckLoading, setPrefixCheckLoading] = useState(false);

  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletingUnit, setDeletingUnit]     = useState(null);

  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleItem, setSaleItem]         = useState(null);

  const filteredItems = clothingItems.filter(item =>
    item.prefix.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sizes?.some(s =>
      s.size.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.units?.some(u => u.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  );

  useEffect(() => {
    fetch(`${API}/clothing-items`, OPTS)
      .then(res => res.json())
      .then(data => { setClothingItems(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  function handleBarcodeChange(e) {
    const val = e.target.value.toUpperCase();
    setAddBarcode(val);
    setPrefixExists(null);
    const parsed = parseBarcode(val);
    setAddParsed(parsed);
    if (parsed) {
      setPrefixCheckLoading(true);
      fetch(`${API}/prefix-check/${parsed.prefix}`, OPTS)
        .then(res => res.json())
        .then(data => { setPrefixExists(data.exists); setPrefixCheckLoading(false); })
        .catch(() => { setPrefixCheckLoading(false); });
    }
  }

  function handleAddFormClose() {
    setShowAddForm(false);
    setAddBarcode('');
    setAddParsed(null);
    setPrefixExists(null);
  }

  function handleAddFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    formData.set('barcode', addBarcode);
    fetch(`${API}/scan`, { method: 'POST', body: formData, ...OPTS })
      .then(res => res.json())
      .then(newUnit => {
        if (newUnit.error) { setError(newUnit.error); return; }
        return fetch(`${API}/clothing-items`, OPTS)
          .then(res => res.json())
          .then(data => { setClothingItems(data); handleAddFormClose(); });
      })
      .catch(err => setError(err.message));
  }

  function handleDeleteSubmit(e) {
    e.preventDefault();
    fetch(`${API}/clothing-items/${deletingUnit.id}`, { method: 'DELETE', ...OPTS })
      .then(res => res.json())
      .then(() =>
        fetch(`${API}/clothing-items`, OPTS)
          .then(res => res.json())
          .then(data => { setClothingItems(data); setShowDeleteForm(false); })
      )
      .catch(err => setError(err.message));
  }

  function handleSaleSubmit(e) {
    e.preventDefault();
    // TODO: wire up to a sales endpoint
    setShowSaleForm(false);
  }

  async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', ...OPTS });
    onLogout();
  }

  return (
    <div className="app-wrapper">

      {/* ── Add form modal ── */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Scan New Item</h3>
              <button className="modal-close" onClick={handleAddFormClose} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAddFormSubmit}>
                <div className="form-group">
                  <label htmlFor="barcode">Barcode</label>
                  <input
                    id="barcode"
                    className="form-input"
                    name="barcode"
                    type="text"
                    placeholder="e.g. ABCDM28"
                    value={addBarcode}
                    onChange={handleBarcodeChange}
                    required
                  />
                  {addBarcode && !addParsed && (
                    <span className="form-hint error">Invalid barcode format. Expected e.g. ABCDM01 or ABCDXL12.</span>
                  )}
                  {addParsed && (
                    <span className="form-hint ok">
                      ✓ Prefix: {addParsed.prefix} &nbsp;|&nbsp; Size: {addParsed.size} &nbsp;|&nbsp; Unit: {String(addParsed.unit_number).padStart(2, '0')}
                    </span>
                  )}
                  {prefixCheckLoading && <span className="form-hint muted">Checking prefix...</span>}
                </div>

                {addParsed && prefixExists === false && (
                  <div className="form-group">
                    <span className="form-hint warn" style={{ display: 'block', marginBottom: 8 }}>
                      ⚠ New prefix "{addParsed.prefix}" — please attach an image.
                    </span>
                    <label htmlFor="image">Item Image</label>
                    <input id="image" className="form-input" name="image" type="file" accept="image/*" required />
                  </div>
                )}
                {addParsed && prefixExists === true && (
                  <div className="form-group">
                    <span className="form-hint muted">Existing prefix "{addParsed.prefix}" — image already on file.</span>
                  </div>
                )}

                <div className="form-actions">
                  <button type="button" className="btn" onClick={handleAddFormClose}>Cancel</button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!addParsed || prefixExists === null}
                  >
                    Add to Inventory
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {showDeleteForm && deletingUnit && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Delete Unit</h3>
              <button className="modal-close" onClick={() => setShowDeleteForm(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleDeleteSubmit}>
                <p style={{ margin: '0 0 8px' }}>
                  Remove unit <strong>{deletingUnit.barcode}</strong> from inventory?
                </p>
                <p style={{ margin: '0 0 16px', color: '#c62828' }}>This action cannot be undone.</p>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => setShowDeleteForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-danger">Delete</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Sale form modal ── */}
      {showSaleForm && saleItem && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Make Sale</h3>
              <button className="modal-close" onClick={() => setShowSaleForm(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSaleSubmit}>
                <p style={{ margin: '0 0 12px' }}>
                  Item: <strong>{saleItem.prefix}</strong> &mdash; Size: <strong>{saleItem.size}</strong>
                  <br />
                  <span style={{ color: '#555' }}>{saleItem.count} unit{saleItem.count !== 1 ? 's' : ''} available</span>
                </p>
                <div className="form-group">
                  <label htmlFor="sale-qty">Quantity</label>
                  <input id="sale-qty" className="form-input" type="number" name="quantity" placeholder="Qty" min={1} max={saleItem.count} required />
                </div>
                <div className="form-group">
                  <label htmlFor="sale-price">Price</label>
                  <input id="sale-price" className="form-input" type="number" name="price" placeholder="0.00" step="0.01" required />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => setShowSaleForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-sale">Confirm Sale</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Top nav ── */}
      <nav className="app-nav">
        <div className="nav-inner">
          <span className="nav-title">Inventory Management</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="nav-user">👤 {user.username}</span>
            {user.type === 'admin' && (
              <button className="btn" onClick={() => onNavigate('admin')}>Admin</button>
            )}
            <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>+ Add Item</button>
            <button className="btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* ── Search bar ── */}
      <div className="search-bar">
        <div className="search-inner">
          <input
            className="search-input"
            type="text"
            placeholder="Search by prefix, type code, size, or barcode..."
            onChange={e => setSearchTerm(e.target.value)}
          />
          <button className="btn" onClick={() => {}}>Search</button>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="content">
        {loading && <div className="status-msg loading">Loading inventory...</div>}
        {error   && <div className="status-msg error">Error: {error}</div>}

        {!loading && !error && (
          filteredItems.length === 0
            ? <p>No items found.</p>
            : (
              <div className="table-wrapper">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Type</th>
                      <th>Style</th>
                      <th>Texture</th>
                      <th>Image</th>
                      <th>Size</th>
                      <th>Units</th>
                      <th>Barcodes</th>
                      <th>First Added</th>
                      <th>Delete</th>
                      <th>Sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.flatMap(item =>
                      item.sizes.map(sizeGroup => (
                        <tr key={`${item.prefix}-${sizeGroup.size}`}>
                          <td><strong>{item.prefix}</strong></td>
                          <td>{item.type_code}</td>
                          <td>{item.style_code}</td>
                          <td>{item.texture_code}</td>
                          <td>
                            {item.image_url
                              ? <img className="item-img" src={`${API}${item.image_url}`} alt={item.prefix} />
                              : <span className="no-img">—</span>}
                          </td>
                          <td>{sizeGroup.size}</td>
                          <td className="count">{sizeGroup.count}</td>
                          <td className="barcodes">{sizeGroup.units.map(u => u.barcode).join(', ')}</td>
                          <td>{new Date(sizeGroup.units[0].created_at).toLocaleDateString()}</td>
                          <td>
                            <button
                              className="btn btn-danger"
                              onClick={() => {
                                const lastUnit = sizeGroup.units[sizeGroup.units.length - 1];
                                setDeletingUnit(lastUnit);
                                setShowDeleteForm(true);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                          <td>
                            <button
                              className="btn btn-sale"
                              onClick={() => {
                                setSaleItem({ prefix: item.prefix, size: sizeGroup.size, count: sizeGroup.count });
                                setShowSaleForm(true);
                              }}
                            >
                              Sale
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="server-info">
        <div className="server-inner">Server: {API}</div>
      </footer>
    </div>
  );
}
