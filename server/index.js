const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
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
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const prefix = (req.body.barcode || '').slice(0, 3).toUpperCase();
    const ext = path.extname(file.originalname);
    cb(null, `${prefix}${ext}`);
  }
});
const upload = multer({ storage });

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'inventory_db',
  user: 'inventory_admin',
  password: '12345',
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to the database:', err.message);
  } else {
    console.log('Connected to PostgreSQL!');
    release();
  }
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.session.type !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const result = await pool.query(
      `SELECT id, username, password, email, type FROM inventory_schema.users WHERE username = $1`,
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.type     = user.type;
    res.json({ id: user.id, username: user.username, email: user.email, type: user.type });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

// GET /auth/me  — returns current session user or 401
app.get('/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
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

// ─── HELPER ───────────────────────────────────────────────────────────────────

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

  if (!size) throw new Error('Could not parse size from barcode');
  if (isNaN(unit_number)) throw new Error('Could not parse unit number from barcode');

  return { prefix, type_code, style_code, texture_code, size, unit_number };
}

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
      `INSERT INTO inventory_schema.clothing_items (barcode, image_prefix, type_code, style_code, texture_code, size, unit_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        barcode.toUpperCase(),
        parsed.prefix,
        parsed.type_code,
        parsed.style_code,
        parsed.texture_code,
        parsed.size,
        parsed.unit_number
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
          sizes: []
        };
      }
      grouped[row.prefix].sizes.push({
        size:  row.size,
        count: row.count,
        units: row.units
      });
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

    const remaining = await client.query(
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

// ─── ADMIN ROUTES (admin only) ────────────────────────────────────────────────

// GET /admin/users — list all users
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

// POST /admin/users — create a new user
app.post('/admin/users', requireAdmin, async (req, res) => {
  const { username, password, email, type } = req.body;
  if (!username || !password || !email || !type) {
    return res.status(400).json({ error: 'username, password, email, and type are required' });
  }
  if (!['admin', 'user'].includes(type)) {
    return res.status(400).json({ error: 'type must be "admin" or "user"' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO inventory_schema.users (username, password, email, type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, type, created_at`,
      [username, hashed, email, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /admin/users/:id — update email and/or password
app.put('/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { email, password, type } = req.body;
  if (!email && !password && !type) {
    return res.status(400).json({ error: 'Provide at least one field to update' });
  }
  if (type && !['admin', 'user'].includes(type)) {
    return res.status(400).json({ error: 'type must be "admin" or "user"' });
  }
  try {
    const sets = [];
    const vals = [];
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
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  // Prevent self-deletion
  if (parseInt(id, 10) === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    const result = await pool.query(
      `DELETE FROM inventory_schema.users WHERE id = $1 RETURNING id, username`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'Deleted', user: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`App listening on port ${PORT}`));
