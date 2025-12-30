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
