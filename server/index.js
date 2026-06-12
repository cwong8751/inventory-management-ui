const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const QRCode     = require('qrcode');
const ip         = require('ip');

const app        = express();
const httpServer = http.createServer(app);

// ─── Socket.IO (scanner devices connect here) ─────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 100e6,
});

// ─── SSE broadcast helpers ─────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(line);
  }
}

function emitLog(message) {
  broadcast('scanner-log', { message, timestamp: new Date().toISOString() });
}

// ─── Socket.IO handlers ───────────────────────────────────────────────────────
let connectedScanners = 0;

io.on('connection', (socket) => {
  const deviceId = socket.handshake.query.deviceId || socket.id;
  connectedScanners++;
  broadcast('scanner-status', { connected: connectedScanners });
  emitLog(`Device connected [${deviceId}]`);

  socket.on('scan-data', (data) => {
    broadcast('scan-data', data);
  });

  socket.on('barcode', (data) => {
    const barcode = String(data).trim();
    broadcast('scan-data', { barcode });
    emitLog(`Device [${deviceId}] scanned barcode: ${barcode}`);
  });

  socket.on('image', (data, ack) => {
    broadcast('scan-data', { image: data });
    emitLog(`Device [${deviceId}] sent image (${Math.round(data.length / 1024)} kb)`);
    if (typeof ack === 'function') ack({ status: 'image received' });
  });

  socket.on('status', (status) => {
    emitLog(`Device [${deviceId}] status: ${status}`);
  });

  socket.on('disconnect', (reason) => {
    connectedScanners = Math.max(0, connectedScanners - 1);
    broadcast('scanner-status', { connected: connectedScanners });
    emitLog(`Device disconnected [${deviceId}] — ${reason}`);
  });
});

// ─── Express middleware ───────────────────────────────────────────────────────
app.use(cors({
  origin: 'https://inventory-management-ui-pi.vercel.app',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'inv-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const prefix = (req.body.barcode || '').slice(0, 3).toUpperCase();
    const ext    = path.extname(file.originalname);
    cb(null, `${prefix}${ext}`);
  },
});
const upload = multer({ storage });

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     'localhost',
  port:     5432,
  database: 'inventory_db',
  user:     'inventory_admin',
  password: '12345',
});

pool.connect((err, client, release) => {
  if (err) console.error('DB connection error:', err.message);
  else { console.log('Connected to PostgreSQL!'); release(); }
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });
  try {
    const result = await pool.query(
      `SELECT id, username, password, email, type FROM inventory_schema.users WHERE username = $1`,
      [username]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid username or password' });

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid username or password' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.type     = user.type;
    res.json({ id: user.id, username: user.username, email: user.email, type: user.type });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/auth/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const result = await pool.query(
      `SELECT id, username, email, type FROM inventory_schema.users WHERE id = $1`,
      [req.session.userId]
    );
    if (result.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── SCANNER ENDPOINTS ────────────────────────────────────────────────────────

// SSE stream — browser listens here for real-time scanner events
app.get('/scanner/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Current connected scanner count (for page load before first SSE event)
app.get('/scanner/status', requireAuth, (req, res) => {
  res.json({ connected: connectedScanners });
});

// QR code pointing to LAN IP:PORT so phones can find the socket server
app.get('/scanner/qr', requireAuth, async (req, res) => {
  const localIp  = ip.address();
  const url      = `http://${localIp}:${PORT}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 256 });
  res.json({ url, qr: qrDataUrl });
});

// Kick all connected scanner devices (admin only)
app.post('/scanner/restart', requireAdmin, async (req, res) => {
  emitLog('Server restarting — all devices kicked');
  io.disconnectSockets(true);
  const localIp   = ip.address();
  const url       = `http://${localIp}:${PORT}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 256 });
  res.json({ url, qr: qrDataUrl });
});

// ─── INVENTORY ROUTES (protected) ────────────────────────────────────────────

app.get('/prefix-check/:prefix', requireAuth, async (req, res) => {
  try {
    const prefix = req.params.prefix.toUpperCase();
    const result = await pool.query(
      `SELECT prefix FROM inventory_schema.clothing_images WHERE prefix = $1`,
      [prefix]
    );
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

function parseBarcode(barcode) {
  if (!barcode || barcode.length < 7) throw new Error('Barcode too short');
  if (barcode[3] !== 'D') throw new Error('4th character must be D');

  const prefix       = barcode.slice(0, 3).toUpperCase();
  const type_code    = barcode[0].toUpperCase();
  const style_code   = barcode[1].toUpperCase();
  const texture_code = barcode[2].toUpperCase();
  const afterMarker  = barcode.slice(4);
  const unit_number  = parseInt(afterMarker.slice(-2), 10);
  const size         = afterMarker.slice(0, -2).toUpperCase();

  if (!size)        throw new Error('Could not parse size from barcode');
  if (isNaN(unit_number)) throw new Error('Could not parse unit number from barcode');

  return { prefix, type_code, style_code, texture_code, size, unit_number };
}

app.post('/scan', requireAuth, upload.single('image'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

    const parsed = parseBarcode(barcode.toUpperCase());

    await client.query('BEGIN');

    const prefixCheck = await client.query(
      `SELECT prefix, image_url FROM inventory_schema.clothing_images WHERE prefix = $1`,
      [parsed.prefix]
    );

    let image_url;

    if (prefixCheck.rows.length === 0) {
      if (!req.file) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This is a new clothing prefix. An image is required for the first scan.'
        });
      }
      image_url = `/uploads/${req.file.filename}`;
      await client.query(
        `INSERT INTO inventory_schema.clothing_images (prefix, image_url) VALUES ($1, $2)`,
        [parsed.prefix, image_url]
      );
    } else {
      image_url = prefixCheck.rows[0].image_url;
    }

    const barcodeCheck = await client.query(
      `SELECT id FROM inventory_schema.clothing_items WHERE barcode = $1`,
      [barcode.toUpperCase()]
    );
    if (barcodeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This barcode has already been scanned' });
    }

    const result = await client.query(
      `INSERT INTO inventory_schema.clothing_items
         (barcode, image_prefix, type_code, style_code, texture_code, size, unit_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        barcode.toUpperCase(),
        parsed.prefix,
        parsed.type_code,
        parsed.style_code,
        parsed.texture_code,
        parsed.size,
        parsed.unit_number,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], image_url });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/clothing-items', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ci.image_prefix   AS prefix,
        img.image_url,
        ci.type_code,
        ci.style_code,
        ci.texture_code,
        ci.size,
        COUNT(*)::int      AS count,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id',          ci.id,
            'barcode',     ci.barcode,
            'unit_number', ci.unit_number,
            'created_at',  ci.created_at
          ) ORDER BY ci.unit_number
        ) AS units
      FROM inventory_schema.clothing_items ci
      JOIN inventory_schema.clothing_images img ON img.prefix = ci.image_prefix
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_schema.sales s WHERE s.clothing_item_id = ci.id
      )
      GROUP BY ci.image_prefix, img.image_url, ci.type_code, ci.style_code, ci.texture_code, ci.size
      ORDER BY ci.image_prefix, ci.size
    `);

    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.prefix]) {
        grouped[row.prefix] = {
          prefix:       row.prefix,
          image_url:    row.image_url,
          type_code:    row.type_code,
          style_code:   row.style_code,
          texture_code: row.texture_code,
          sizes: [],
        };
      }
      grouped[row.prefix].sizes.push({ size: row.size, count: row.count, units: row.units });
    }
    res.json(Object.values(grouped));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/clothing-items/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const itemResult = await client.query(
      `DELETE FROM inventory_schema.clothing_items WHERE id = $1 RETURNING *`,
      [id]
    );
    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    const deletedItem = itemResult.rows[0];
    const remaining   = await client.query(
      `SELECT COUNT(*) FROM inventory_schema.clothing_items WHERE image_prefix = $1`,
      [deletedItem.image_prefix]
    );

    if (parseInt(remaining.rows[0].count, 10) === 0) {
      await client.query(
        `DELETE FROM inventory_schema.clothing_images WHERE prefix = $1`,
        [deletedItem.image_prefix]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Deleted successfully', item: deletedItem });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// ─── SALES ROUTES ────────────────────────────────────────────────────────────

// POST /sales — record a new sale
app.post('/sales', requireAuth, async (req, res) => {
  const { clothing_item_id, quantity, price_per_unit, sale_method } = req.body;

  if (!clothing_item_id || !quantity || price_per_unit == null || !sale_method) {
    return res.status(400).json({ error: 'clothing_item_id, quantity, price_per_unit, and sale_method are required' });
  }
  const validMethods = ['cash', 'credit_card', 'electronic_payment'];
  if (!validMethods.includes(sale_method)) {
    return res.status(400).json({ error: `sale_method must be one of: ${validMethods.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO inventory_schema.sales (clothing_item_id, quantity, price_per_unit, sale_method, sold_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [clothing_item_id, quantity, price_per_unit, sale_method, req.session.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /sales — list all sales with full item + image details
app.get('/sales', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id                                        AS sale_id,
        s.quantity,
        s.price_per_unit,
        s.total_price,
        s.sale_method,
        s.sold_at,
        u.username                                  AS sold_by,
        ci.id                                       AS item_id,
        ci.barcode,
        ci.image_prefix                             AS prefix,
        ci.type_code,
        ci.style_code,
        ci.texture_code,
        ci.size,
        ci.unit_number,
        img.image_url
      FROM inventory_schema.sales s
      JOIN inventory_schema.clothing_items  ci  ON ci.id  = s.clothing_item_id
      JOIN inventory_schema.clothing_images img ON img.prefix = ci.image_prefix
      LEFT JOIN inventory_schema.users      u   ON u.id   = s.sold_by
      ORDER BY s.sold_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, type, created_at FROM inventory_schema.users ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/admin/users', requireAdmin, async (req, res) => {
  const { username, password, email, type } = req.body;
  if (!username || !password || !email || !type)
    return res.status(400).json({ error: 'username, password, email, and type are required' });
  if (!['admin', 'user'].includes(type))
    return res.status(400).json({ error: 'type must be "admin" or "user"' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO inventory_schema.users (username, password, email, type)
       VALUES ($1,$2,$3,$4)
       RETURNING id, username, email, type, created_at`,
      [username, hashed, email, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Username or email already exists' });
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { email, password, type } = req.body;
  if (!email && !password && !type)
    return res.status(400).json({ error: 'Provide at least one field to update' });
  if (type && !['admin', 'user'].includes(type))
    return res.status(400).json({ error: 'type must be "admin" or "user"' });
  try {
    const sets = [], vals = [];
    let i = 1;
    if (email)    { sets.push(`email = $${i++}`);    vals.push(email); }
    if (type)     { sets.push(`type = $${i++}`);     vals.push(type); }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      sets.push(`password = $${i++}`);
      vals.push(hashed);
    }
    vals.push(id);
    const result = await pool.query(
      `UPDATE inventory_schema.users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, username, email, type, created_at`,
      vals
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Email already in use' });
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.session.userId)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const result = await pool.query(
      `DELETE FROM inventory_schema.users WHERE id = $1 RETURNING id, username`,
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Deleted', user: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT} (all interfaces)`);
  console.log(`Scanner devices can connect to: http://${ip.address()}:${PORT}`);
});
