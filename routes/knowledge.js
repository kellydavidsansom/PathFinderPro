const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { fetchWithBrowser, closeBrowser, isAvailable: isHeadlessAvailable } = require('../services/headlessBrowser');

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
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
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
  const { name, url, auto_scrape, scrape_frequency, requires_js, wait_selector } = req.body;

  const result = database.prepare(`
    INSERT INTO knowledge_sources (type, name, url, auto_scrape, scrape_frequency, requires_js, wait_selector)
    VALUES ('url', ?, ?, ?, ?, ?, ?)
  `).run(name, url, auto_scrape ? 1 : 0, scrape_frequency || 'weekly', requires_js ? 1 : 0, wait_selector || null);

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
    const cheerio = await import('cheerio');
    let html;

    // Use headless browser for JS-required sites
    if (source.requires_js) {
      const headlessAvailable = await isHeadlessAvailable();
      if (!headlessAvailable) {
        return res.status(500).json({ error: 'Headless browser not available but site requires JavaScript. Check PUPPETEER_EXECUTABLE_PATH.' });
      }

      console.log(`[Knowledge] Using headless browser for: ${source.url}`);
      html = await fetchWithBrowser(source.url, {
        timeout: 45000,
        waitTime: 3000,
        waitForSelector: source.wait_selector || null
      });

      // Close browser after scraping
      await closeBrowser();
    } else {
      // Standard fetch for static pages
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PathFinderPro/1.0)'
        },
        timeout: 30000
      });

      if (!response.ok) {
        return res.status(500).json({ error: `Failed to fetch: ${response.status}` });
      }

      html = await response.text();
    }

    const $ = cheerio.load(html);

    // Remove scripts and styles
    $('script, style, nav, footer, header').remove();

    // Get main content
    const content = $('main, article, .content, body').first().text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 500000); // Limit content size

    database.prepare(`
      UPDATE knowledge_sources
      SET content = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(content, req.params.id);

    res.json({ success: true, content_length: content.length, used_headless: !!source.requires_js });
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'Failed to scrape URL: ' + error.message });
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
      content = pdfData.text.substring(0, 500000); // Limit content size
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
  console.log('[Webhook] Received email webhook');
  console.log('[Webhook] Body keys:', Object.keys(req.body));
  console.log('[Webhook] Full body:', JSON.stringify(req.body, null, 2));

  const database = db.getDb();

  // Mailgun can send different field names depending on route configuration
  const sender = req.body.sender || req.body.from || req.body.From;
  const subject = req.body.subject || req.body.Subject;
  const body = req.body['body-plain'] || req.body['body-text'] || req.body.text || '';

  console.log('[Webhook] Parsed - sender:', sender, 'subject:', subject, 'body length:', body?.length || 0);

  if (sender && subject) {
    try {
      database.prepare(`
        INSERT INTO received_emails (from_address, subject, body)
        VALUES (?, ?, ?)
      `).run(sender, subject, body || '');
      console.log('[Webhook] Email saved successfully');
    } catch (err) {
      console.error('[Webhook] Database error:', err);
    }
  } else {
    console.log('[Webhook] Missing sender or subject, email not saved');
  }

  res.status(200).send('OK');
});

module.exports = router;
