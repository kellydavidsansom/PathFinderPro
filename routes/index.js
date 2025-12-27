const express = require('express');
const router = express.Router();
const db = require('../database');

// Home page - shows list of borrowers or new borrower form
router.get('/', (req, res) => {
  const database = db.getDb();
  const borrowers = database.prepare(`
    SELECT id, first_name, last_name, status, created_at, updated_at,
           purchase_price, credit_score
    FROM borrowers
    ORDER BY updated_at DESC
  `).all();

  res.render('index', {
    title: 'PathFinder Pro',
    borrowers
  });
});

// New borrower interview
router.get('/new', (req, res) => {
  const database = db.getDb();

  // Create a new draft borrower
  const result = database.prepare(`
    INSERT INTO borrowers (status) VALUES ('draft')
  `).run();

  res.redirect(`/interview/${result.lastInsertRowid}`);
});

// Interview page (main tabbed interface)
router.get('/interview/:id', (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare(`
    SELECT * FROM borrowers WHERE id = ?
  `).get(req.params.id);

  if (!borrower) {
    return res.redirect('/');
  }

  // Parse JSON fields
  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  // Get chat history
  const chatHistory = database.prepare(`
    SELECT * FROM chat_history
    WHERE borrower_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  res.render('interview', {
    title: `Interview - ${borrower.first_name || 'New'} ${borrower.last_name || 'Borrower'}`,
    borrower,
    chatHistory
  });
});

module.exports = router;
