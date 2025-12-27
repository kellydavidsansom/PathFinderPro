const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.NODE_ENV === 'production'
      ? '/data/knowledge'
      : path.join(__dirname, '..', 'data', 'knowledge');

    // Ensure directory exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Get all knowledge sources
router.get('/', (req, res) => {
  const database = db.getDb();

  const urls = database.prepare(`
    SELECT * FROM knowledge_sources WHERE type = 'url' ORDER BY name
  `).all();

  const pdfs = database.prepare(`
    SELECT * FROM knowledge_sources WHERE type = 'pdf' ORDER BY last_updated DESC
  `).all();

  const emails = database.prepare(`
    SELECT * FROM received_emails ORDER BY received_at DESC
  `).all();

  res.json({ urls, pdfs, emails });
});

// Add URL source
router.post('/url', (req, res) => {
  const database = db.getDb();
  const { name, url, auto_scrape, scrape_frequency } = req.body;

  const result = database.prepare(`
    INSERT INTO knowledge_sources (type, name, url, auto_scrape, scrape_frequency)
    VALUES ('url', ?, ?, ?, ?)
  `).run(name, url, auto_scrape ? 1 : 0, scrape_frequency || 'weekly');

  res.json({ success: true, id: result.lastInsertRowid });
});

// Scrape URL
router.post('/url/:id/scrape', async (req, res) => {
  const database = db.getDb();
  const source = database.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(req.params.id);

  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const cheerio = await import('cheerio');

    const response = await fetch(source.url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts and styles
    $('script, style, nav, footer, header').remove();

    // Get main content
    const content = $('main, article, .content, body').first().text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000); // Limit content size

    database.prepare(`
      UPDATE knowledge_sources
      SET content = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(content, req.params.id);

    res.json({ success: true, content_length: content.length });
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'Failed to scrape URL' });
  }
});

// Delete URL source
router.delete('/url/:id', (req, res) => {
  const database = db.getDb();
  database.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Upload PDF
router.post('/pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const database = db.getDb();

  try {
    // Try to extract text from PDF
    let content = '';
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      content = pdfData.text.substring(0, 50000); // Limit content size
    } catch (pdfError) {
      console.error('PDF parse error:', pdfError);
      content = '[PDF content could not be extracted]';
    }

    const result = database.prepare(`
      INSERT INTO knowledge_sources (type, name, url, content)
      VALUES ('pdf', ?, ?, ?)
    `).run(req.file.originalname, req.file.path, content);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

// Delete PDF
router.delete('/pdf/:id', (req, res) => {
  const database = db.getDb();
  const source = database.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(req.params.id);

  if (source && source.url) {
    try {
      fs.unlinkSync(source.url);
    } catch (e) {
      console.error('Could not delete file:', e);
    }
  }

  database.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Process email
router.post('/email/:id/process', (req, res) => {
  const database = db.getDb();
  const email = database.prepare('SELECT * FROM received_emails WHERE id = ?').get(req.params.id);

  if (!email) {
    return res.status(404).json({ error: 'Email not found' });
  }

  // Add email content to knowledge sources
  const result = database.prepare(`
    INSERT INTO knowledge_sources (type, name, content)
    VALUES ('email', ?, ?)
  `).run(`Email: ${email.subject}`, email.body);

  // Mark email as processed
  database.prepare('UPDATE received_emails SET processed = 1 WHERE id = ?').run(req.params.id);

  res.json({ success: true, knowledge_id: result.lastInsertRowid });
});

// Delete email
router.delete('/email/:id', (req, res) => {
  const database = db.getDb();
  database.prepare('DELETE FROM received_emails WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Get combined knowledge context for Claude
router.get('/context', (req, res) => {
  const database = db.getDb();

  const sources = database.prepare(`
    SELECT name, content, type, last_updated
    FROM knowledge_sources
    WHERE content IS NOT NULL AND content != ''
    ORDER BY last_updated DESC
  `).all();

  let context = 'KNOWLEDGE REPOSITORY:\n\n';
  for (const source of sources) {
    context += `--- ${source.name} (${source.type}, updated ${source.last_updated}) ---\n`;
    context += source.content + '\n\n';
  }

  res.json({ context, source_count: sources.length });
});

// Mailgun webhook handler
router.post('/webhook', express.urlencoded({ extended: false }), (req, res) => {
  const database = db.getDb();

  const { sender, subject, 'body-plain': body } = req.body;

  if (sender && subject) {
    database.prepare(`
      INSERT INTO received_emails (from_address, subject, body)
      VALUES (?, ?, ?)
    `).run(sender, subject, body || '');
  }

  res.status(200).send('OK');
});

module.exports = router;
