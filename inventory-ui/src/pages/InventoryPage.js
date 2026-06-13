import { useState, useEffect, useRef } from 'react';

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
    unit_number: unit,
  };
}

const API       = process.env.REACT_APP_BACKEND_API_URL || 'http://localhost:8080';
const OPTS      = { credentials: 'include' };
const DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true';

export default function InventoryPage({ user, onLogout, onNavigate }) {
  // ── Inventory state ─────────────────────────────────────────────────────────
  const [clothingItems, setClothingItems] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [searchTerm, setSearchTerm]       = useState('');

  // ── Add form state ──────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm]               = useState(false);
  const [addBarcode, setAddBarcode]                 = useState('');
  const [addParsed, setAddParsed]                   = useState(null);
  const [prefixExists, setPrefixExists]             = useState(null);
  const [prefixCheckLoading, setPrefixCheckLoading] = useState(false);
  const [scannedImage, setScannedImage]             = useState(null); // base64 from scanner
  const [addError, setAddError]                     = useState(null);

  // ── Image lightbox state ─────────────────────────────────────────────────────
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // ── Delete / Sale state ─────────────────────────────────────────────────────
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletingUnit, setDeletingUnit]     = useState(null);
  const [showSaleForm, setShowSaleForm]     = useState(false);
  const [saleItem, setSaleItem]             = useState(null);
  const [saleError, setSaleError]           = useState(null);
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  // ── Scanner sidebar state ────────────────────────────────────────────────────
  const [qrData, setQrData]                   = useState(null);
  const [scannerConnected, setScannerConnected] = useState(false);
  const esRef                                  = useRef(null);

  // ── Filtered inventory ───────────────────────────────────────────────────────
  const filteredItems = clothingItems.filter(item =>
    item.prefix.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sizes?.some(s =>
      s.size.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.units?.some(u => u.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  );

  // ── Load inventory ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/clothing-items`, OPTS)
      .then(res => res.json())
      .then(data => { setClothingItems(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // ── QR code + initial scanner status ────────────────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) return;

    fetch(`${API}/scanner/qr`, OPTS)
      .then(r => r.json())
      .then(setQrData)
      .catch(() => {});

    fetch(`${API}/scanner/status`, OPTS)
      .then(r => r.json())
      .then(d => setScannerConnected(d.connected > 0))
      .catch(() => {});
  }, []);

  // ── SSE — scanner events ─────────────────────────────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) return;

    const es = new EventSource(`${API}/scanner/events`, { withCredentials: true });

    es.addEventListener('scanner-status', (e) => {
      const { connected } = JSON.parse(e.data);
      setScannerConnected(connected > 0);
    });

    es.addEventListener('scan-data', (e) => {
      const data = JSON.parse(e.data);

      if (data.barcode != null) {
        const barcode = String(data.barcode).trim();
        openAddModalWithBarcode(barcode);
      }

      if (data.image != null) {
        setScannedImage(data.image);
      }
    });

    esRef.current = es;
    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add form helpers ─────────────────────────────────────────────────────────
  function openAddModalWithBarcode(barcode) {
    const parsed = parseBarcode(barcode);
    setAddBarcode(barcode);
    setAddParsed(parsed);
    setAddError(null);
    setScannedImage(null);
    setPrefixExists(null);
    setShowAddForm(true);

    if (parsed) {
      setPrefixCheckLoading(true);
      fetch(`${API}/prefix-check/${parsed.prefix}`, OPTS)
        .then(r => r.json())
        .then(d => { setPrefixExists(d.exists); setPrefixCheckLoading(false); })
        .catch(() => setPrefixCheckLoading(false));
    }
  }

  function handleBarcodeChange(e) {
    const val = e.target.value.toUpperCase();
    setAddBarcode(val);
    setPrefixExists(null);
    const parsed = parseBarcode(val);
    setAddParsed(parsed);
    if (parsed) {
      setPrefixCheckLoading(true);
      fetch(`${API}/prefix-check/${parsed.prefix}`, OPTS)
        .then(r => r.json())
        .then(d => { setPrefixExists(d.exists); setPrefixCheckLoading(false); })
        .catch(() => setPrefixCheckLoading(false));
    }
  }

  function handleAddFormClose() {
    setShowAddForm(false);
    setAddBarcode('');
    setAddParsed(null);
    setPrefixExists(null);
    setScannedImage(null);
    setAddError(null);
  }

  async function handleAddFormSubmit(e) {
    e.preventDefault();
    setAddError(null);
    const formData = new FormData(e.target);
    formData.set('barcode', addBarcode);

    // If prefix is new and scanner sent an image but no file was manually chosen, attach the scanned image
    if (scannedImage && prefixExists === false && !formData.get('image')?.size) {
      try {
        const b64    = scannedImage.startsWith('data:') ? scannedImage.split(',')[1] : scannedImage;
        const binary = atob(b64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        formData.set('image', new Blob([bytes], { type: 'image/jpeg' }), `${addParsed?.prefix || 'scan'}.jpg`);
      } catch { /* if conversion fails, server will error if image is truly needed */ }
    }

    try {
      const res  = await fetch(`${API}/scan`, { method: 'POST', body: formData, ...OPTS });
      const data = await res.json();
      if (!res.ok || data.error) { setAddError(data.error || 'Failed to add item'); return; }
      const items = await fetch(`${API}/clothing-items`, OPTS).then(r => r.json());
      setClothingItems(items);
      handleAddFormClose();
    } catch {
      setAddError('Server error');
    }
  }

  function handleDeleteSubmit(e) {
    e.preventDefault();
    fetch(`${API}/clothing-items/${deletingUnit.id}`, { method: 'DELETE', ...OPTS })
      .then(r => r.json())
      .then(() => fetch(`${API}/clothing-items`, OPTS).then(r => r.json()))
      .then(data => { setClothingItems(data); setShowDeleteForm(false); })
      .catch(err => setError(err.message));
  }

  async function handleSaleSubmit(e) {
    e.preventDefault();
    setSaleError(null);
    const fd = new FormData(e.target);
    try {
      const res = await fetch(`${API}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clothing_item_id: selectedUnitId,
          quantity:         parseInt(fd.get('quantity'), 10),
          price_per_unit:   parseFloat(fd.get('price')),
          sale_method:      fd.get('sale_method'),
        }),
        ...OPTS,
      });
      const data = await res.json();
      if (!res.ok) { setSaleError(data.error || 'Sale failed'); return; }
      setShowSaleForm(false);
      setSaleError(null);
    } catch {
      setSaleError('Server error');
    }
  }

  async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', ...OPTS });
    onLogout();
  }

  return (
    <div className="app-wrapper">

      {/* ── Image lightbox ── */}
      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img className="lightbox-img" src={lightboxSrc} alt="Full size" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── Add form modal ── */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className={`modal ${scannedImage ? 'modal-wide' : ''}`}>
            <div className="modal-header">
              <h3>Add Item to Inventory</h3>
              <button className="modal-close" onClick={handleAddFormClose} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAddFormSubmit}>
                {addError && <div className="login-error">{addError}</div>}

                <div className="scanner-modal-cols">
                  <div>
                    <div className="form-group">
                      <label htmlFor="add-barcode">Barcode</label>
                      <input
                        id="add-barcode"
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

                    {/* New prefix — need image */}
                    {addParsed && prefixExists === false && !scannedImage && (
                      <div className="form-group">
                        <span className="form-hint warn" style={{ display: 'block', marginBottom: 8 }}>
                          ⚠ New prefix "{addParsed.prefix}" — please attach an image.
                        </span>
                        <label htmlFor="image">Item Image</label>
                        <input id="image" className="form-input" name="image" type="file" accept="image/*" required />
                      </div>
                    )}

                    {/* New prefix — scanner image available */}
                    {addParsed && prefixExists === false && scannedImage && (
                      <div className="form-group">
                        <span className="form-hint ok" style={{ display: 'block', marginBottom: 8 }}>
                          ✓ Scanner image will be used for new prefix "{addParsed.prefix}".
                        </span>
                        <label htmlFor="image">Override with a different image (optional):</label>
                        <input id="image" className="form-input" name="image" type="file" accept="image/*" />
                      </div>
                    )}

                    {/* Existing prefix */}
                    {addParsed && prefixExists === true && (
                      <div className="form-group">
                        <span className="form-hint muted">Existing prefix "{addParsed.prefix}" — image already on file.</span>
                      </div>
                    )}
                  </div>

                  {/* Scanner image preview */}
                  {scannedImage && (
                    <div className="scanner-img-preview-wrap">
                      <p className="scanner-img-label">Scanner Image</p>
                      <img
                        className="scanner-img-preview"
                        src={scannedImage.startsWith('data:') ? scannedImage : `data:image/jpeg;base64,${scannedImage}`}
                        alt="Scanned"
                      />
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button type="button" className="btn" onClick={handleAddFormClose}>Cancel</button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!addParsed || prefixExists === null || prefixCheckLoading}
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
                {saleError && <div className="login-error">{saleError}</div>}
                <p style={{ margin: '0 0 12px' }}>
                  Item: <strong>{saleItem.prefix}</strong> &mdash; Size: <strong>{saleItem.size}</strong>
                  <br />
                  <span style={{ color: '#555' }}>{saleItem.count} unit{saleItem.count !== 1 ? 's' : ''} available</span>
                </p>
                <div className="form-group">
                  <label htmlFor="sale-unit">Sale Unit (Barcode)</label>
                  <select
                    id="sale-unit"
                    className="form-input"
                    value={selectedUnitId ?? ''}
                    onChange={e => setSelectedUnitId(Number(e.target.value))}
                    required
                  >
                    {(saleItem.units || []).map(u => (
                      <option key={u.id} value={u.id}>{u.barcode}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="sale-qty">Quantity</label>
                  <input id="sale-qty" className="form-input" type="number" name="quantity" placeholder="Qty" min={1} max={saleItem.count} defaultValue={1} required />
                </div>
                <div className="form-group">
                  <label htmlFor="sale-price">Price per Unit</label>
                  <input id="sale-price" className="form-input" type="number" name="price" placeholder="0.00" step="0.01" min={0} required />
                </div>
                <div className="form-group">
                  <label htmlFor="sale-method">Sale Method</label>
                  <select id="sale-method" className="form-input" name="sale_method" required>
                    <option value="">— Select method —</option>
                    <option value="cash">Cash</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="electronic_payment">Electronic Payment</option>
                  </select>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => { setShowSaleForm(false); setSaleError(null); }}>Cancel</button>
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
            <button className="btn" onClick={() => onNavigate('sales')}>Sales</button>
            {user.type === 'admin' && (
              <button className="btn" onClick={() => onNavigate('admin')}>Admin</button>
            )}
            <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>+ Add Item</button>
            <button className="btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* ── Two-column layout ── */}
      <div className="inventory-layout">

        {/* ── Left sidebar: Scanner ── */}
        <aside className="inv-sidebar">

          {DEMO_MODE ? (
            <div className="demo-mode-notice">
              <div className="demo-mode-badge">DEMO MODE</div>
              <p className="demo-mode-text">
                Under demo mode, the connection with mobile scanner devices is not available.
              </p>
            </div>
          ) : (
            <>
              {/* Scanner connection status */}
              <div className="scanner-status-box">
                <span className={`scanner-dot ${scannerConnected ? 'dot-on' : 'dot-off'}`} />
                <span className={`scanner-status-text ${scannerConnected ? 'status-on' : 'status-off'}`}>
                  {scannerConnected ? 'Scanner Connected' : 'Scanner Disconnected'}
                </span>
              </div>

              {/* QR Code */}
              <div className="sidebar-section-header">Connection QR Code</div>
              <div className="sidebar-qr-body">
                <p className="scanner-help">
                  Connect scanner to the same Wi-Fi, then scan this QR code.
                </p>
                {qrData ? (
                  <div className="qr-block">
                    <img src={qrData.qr} alt="QR Code" className="qr-img" />
                    <code className="qr-url">{qrData.url}</code>
                  </div>
                ) : (
                  <div className="qr-placeholder">Loading QR...</div>
                )}
              </div>
            </>
          )}

          {/* ── Pending Scans (hidden for now) ── */}
          {/*
          <div className="sidebar-section-header" style={{ marginTop: 12 }}>Pending Scans</div>
          <div className="sidebar-section-body scanner-panel-scroll">
            {scanQueue.length === 0 ? (
              <p className="scanner-empty">No pending scans.</p>
            ) : (
              <ul className="scan-queue-list">
                {scanQueue.map(s => (
                  <li key={s.id} className="scan-queue-item">
                    <div className="scan-queue-left">
                      {s.image && (
                        <img
                          className="scan-queue-thumb"
                          src={s.image.startsWith('data:') ? s.image : `data:image/jpeg;base64,${s.image}`}
                          alt=""
                        />
                      )}
                      <span className="scan-queue-barcode">{s.barcode}</span>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAddModalWithBarcode(s.barcode)}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          */}

          {/* ── Device Log (hidden for now) ── */}
          {/*
          <div className="sidebar-section-header" style={{ marginTop: 12 }}>Device Log</div>
          <div className="sidebar-section-body scanner-panel-scroll">
            {logEntries.length === 0 ? (
              <p className="scanner-empty">No log entries yet.</p>
            ) : (
              <ul className="scanner-log-list">
                {logEntries.map(e => (
                  <li key={e.id} className="scanner-log-entry">
                    <span className="scanner-log-time">{e.time}</span>
                    <span className="scanner-log-msg">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          */}

        </aside>

        {/* ── Right: Inventory table ── */}
        <div className="inv-main">

          {/* Search bar */}
          <div className="inv-search-row">
            <input
              className="search-input"
              type="text"
              placeholder="Search by prefix, type code, size, or barcode..."
              onChange={e => setSearchTerm(e.target.value)}
            />
            <button className="btn">Search</button>
          </div>

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
                                ? <img
                                    className="item-img item-img-clickable"
                                    src={`${API}${item.image_url}`}
                                    alt={item.prefix}
                                    onClick={() => setLightboxSrc(`${API}${item.image_url}`)}
                                  />
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
                                  const defaultUnit = sizeGroup.units[sizeGroup.units.length - 1];
                                  setSaleItem({
                                    prefix: item.prefix,
                                    size:   sizeGroup.size,
                                    count:  sizeGroup.count,
                                    units:  sizeGroup.units,
                                  });
                                  setSelectedUnitId(defaultUnit.id);
                                  setSaleError(null);
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
      </div>

      {/* ── Footer ── */}
      <footer className="server-info">
        <div className="server-inner">Server: {API}</div>
      </footer>
    </div>
  );
}
