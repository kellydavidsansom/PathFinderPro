require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./database');

// Import routes
const indexRoutes = require('./routes/index');
const borrowerRoutes = require('./routes/borrowers');
const knowledgeRoutes = require('./routes/knowledge');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
