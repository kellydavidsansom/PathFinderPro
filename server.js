require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const db = require('./database');

// Import routes
const indexRoutes = require('./routes/index');
const borrowerRoutes = require('./routes/borrowers');
const knowledgeRoutes = require('./routes/knowledge');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(cookieSession({
  name: 'pathfinder_session',
  keys: [process.env.SESSION_SECRET || 'pathfinder-secret-key-change-me'],
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Authentication middleware
const requireAuth = (req, res, next) => {
  // Skip auth for login page and static assets
  if (req.path === '/login' || req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images')) {
    return next();
  }

  // Skip auth for webhook endpoints
  if (req.path === '/knowledge/webhook' || req.path === '/webhook/pathfinder-knowledge') {
    return next();
  }

  // Check if password protection is enabled
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    // No password set, allow access
    return next();
  }

  // Check if authenticated
  if (req.session && req.session.authenticated) {
    return next();
  }

  // Redirect to login
  res.redirect('/login');
};

// Login routes (before auth middleware)
app.get('/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    // No password set, redirect to home
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (password === adminPassword) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Incorrect password' });
  }
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// Public webhook endpoints (before auth middleware)
const db = require('./database');
const { calculateBorrowerMetrics } = require('./routes/borrowers');

app.post('/webhooks/register', express.json(), (req, res) => {
  const database = db.getDb();
  const { url, event } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Webhook URL is required' });
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS zapier_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_url TEXT NOT NULL,
      event_type TEXT DEFAULT 'borrower.qualified',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existing = database.prepare('SELECT * FROM zapier_webhooks WHERE webhook_url = ?').get(url);
  if (existing) {
    return res.json({ success: true, message: 'Webhook already registered', webhook_id: existing.id });
  }

  const result = database.prepare('INSERT INTO zapier_webhooks (webhook_url, event_type) VALUES (?, ?)').run(url, event || 'borrower.qualified');
  console.log(`Webhook registered: ${url}`);
  res.json({ success: true, webhook_id: result.lastInsertRowid });
});

app.post('/webhooks/test', express.json(), async (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers ORDER BY id DESC LIMIT 1').get();

  if (!borrower) {
    return res.status(400).json({ error: 'No borrowers in database to test with' });
  }

  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);

  // Get webhooks and send test
  const webhooks = database.prepare("SELECT * FROM zapier_webhooks WHERE event_type = 'borrower.qualified'").all();

  const fetch = (await import('node-fetch')).default;
  for (const webhook of webhooks) {
    try {
      await fetch(webhook.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'borrower.qualified',
          timestamp: new Date().toISOString(),
          borrower_id: borrower.id,
          borrower: {
            id: borrower.id,
            first_name: borrower.first_name,
            last_name: borrower.last_name,
            email: borrower.email,
            phone: borrower.phone,
            credit_score: borrower.credit_score,
            loan_purpose: borrower.loan_purpose,
            purchase_price: borrower.purchase_price,
            down_payment_amount: borrower.down_payment_amount,
            loan_amount: calculations.loanAmount,
            monthly_income: calculations.monthlyIncome,
            annual_income: calculations.annualIncome,
            dti_ratio: calculations.dtiRatio,
            ltv_ratio: calculations.ltvRatio,
            property_type: borrower.property_type,
            occupancy: borrower.occupancy,
            military_status: borrower.military_status,
            first_time_homebuyer: borrower.first_time_homebuyer
          }
        })
      });
      console.log(`Test webhook sent to: ${webhook.webhook_url}`);
    } catch (err) {
      console.error(`Webhook failed: ${err.message}`);
    }
  }

  res.json({ success: true, message: 'Test webhook sent', borrower_id: borrower.id });
});

// Apply auth middleware to all routes below
app.use(requireAuth);

// Routes
app.use('/', indexRoutes);
app.use('/borrowers', borrowerRoutes);
app.use('/knowledge', knowledgeRoutes);
app.use('/api', apiRoutes);

// Mailgun webhook endpoint
app.post('/webhook/pathfinder-knowledge', express.json(), (req, res) => {
  const knowledgeRoutes = require('./routes/knowledge');
  // Handle incoming email - delegate to knowledge routes
  console.log('Received email webhook:', req.body);
  res.status(200).send('OK');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Initialize database and start server
db.initialize();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🏠 PathFinder Pro - Loan Qualification Tool        ║
║   ClearPath Utah Mortgage                            ║
║                                                       ║
║   Server running at http://localhost:${PORT}            ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
