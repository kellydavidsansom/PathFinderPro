const express = require('express');
const router = express.Router();
const db = require('../database');
const { calculateBorrowerMetrics } = require('./borrowers');

// ============================================
// ZAPIER INTEGRATION ENDPOINTS
// ============================================

// API Key authentication middleware for Zapier
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validKey = process.env.ZAPIER_API_KEY;

  if (!validKey) {
    // If no API key is configured, allow access (for initial setup)
    console.warn('ZAPIER_API_KEY not configured - API endpoints are unprotected');
    return next();
  }

  if (apiKey !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// Format borrower data for Zapier/Arive compatibility
function formatBorrowerForZapier(b, calculations) {
  // Format date to YYYY-MM-DD
  const formatDate = (date) => {
    if (!date) return '';
    // If already in YYYY-MM-DD format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    // Try to parse and format
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    return d.toISOString().split('T')[0];
  };

  // Map military status to Arive format (no spaces, camelCase)
  const mapMilitaryStatus = (status) => {
    const map = {
      'None': null,
      'Active Duty': 'ActiveDuty',
      'Veteran': 'Veteran',
      'Reserve/National Guard': 'ReserveNationalGuardNeverActivated'
    };
    return map[status] || null;
  };

  // Map home buying stage to Arive format
  const mapHomeBuyingStage = (stage) => {
    const map = {
      'Just Getting Started': 'GETTING_STARTED',
      'Making Offers': 'MAKING_OFFERS',
      'Found a House/Offer Pending': 'FOUND_A_HOUSE_OR_OFFER_PENDING',
      'Under Contract': 'UNDER_CONTRACT'
    };
    return map[stage] || 'GETTING_STARTED';
  };

  // Map years since bankruptcy/foreclosure
  const mapYearsSince = (value) => {
    if (!value || value === 'Never') return null;
    if (value === 'Within 2 years' || value === 'Within 3 years') return 1;
    if (value === '2+ years ago') return 3;
    if (value === '3+ years ago') return 4;
    return null;
  };

  // Map property usage/occupancy to Arive format (no spaces)
  const mapPropertyUsage = (occupancy) => {
    const map = {
      'Primary Residence': 'PrimaryResidence',
      'Second Home': 'SecondHome',
      'Investment': 'Investment'
    };
    return map[occupancy] || null;
  };

  // Map current housing to Arive Occupancy Type format
  const mapCurrentHousing = (housing) => {
    const map = {
      'Own': 'Own',
      'Rent': 'Rent',
      'Living Rent Free': 'LivingRentFree'
    };
    return map[housing] || 'Rent';
  };

  // Map state name to 2-letter code
  const mapStateCode = (state) => {
    const stateCodes = {
      'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
      'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
      'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
      'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
      'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
      'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
      'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
      'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
      'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
      'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
      'District of Columbia': 'DC'
    };
    // If already a 2-letter code, return as-is
    if (state && state.length === 2) return state.toUpperCase();
    return stateCodes[state] || state;
  };

  return {
    ...b,
    calculations,
    // Formatted fields for Arive
    zapier: {
      // Boolean conversions
      first_time_homebuyer: b.first_time_homebuyer ? true : false,
      has_coborrower: b.has_coborrower ? true : false,
      currently_owning_home: b.first_time_homebuyer ? false : true,
      planning_to_sell_home: b.planning_to_sell_home ? true : false,

      // Date formatting
      birth_date: formatDate(b.date_of_birth),
      co_birth_date: formatDate(b.co_date_of_birth),

      // Military status (Arive format: ActiveDuty, Veteran, ReserveNationalGuardNeverActivated)
      military_service_type: mapMilitaryStatus(b.military_status),
      co_military_service_type: mapMilitaryStatus(b.co_military_status),

      // Home buying stage
      home_buying_stage: mapHomeBuyingStage(b.home_buying_stage),

      // Years since events
      years_since_bankruptcy: mapYearsSince(b.bankruptcy),
      years_since_foreclosure: mapYearsSince(b.foreclosure),

      // Subject property TBD indicator
      subject_property_tbd: !b.subject_property_street,

      // Current housing / Occupancy Type (Arive format: Own, Rent, LivingRentFree)
      occupancy_type: mapCurrentHousing(b.current_housing),

      // Property Usage Type (Arive format: PrimaryResidence, SecondHome, Investment)
      property_usage_type: mapPropertyUsage(b.occupancy),

      // Property value (works for both purchase and refi)
      property_value: b.loan_purpose === 'Refinance' ? b.property_value : b.purchase_price,

      // Arive-compatible IDs (pass through directly since form now stores Arive IDs)
      mortgage_type: b.preferred_loan_type || null,  // Conventional, VA, FHA, USDARuralDevelopment, NonQM
      property_type: b.property_type || null,  // SINGLE_FAMILY_DETACHED, TWO_UNIT, etc.
      employment_type: b.employment_type || null,  // employed, self-employed, retired, active military duty, unemployed
      co_employment_type: b.co_employment_type || null,

      // Loan amount (ensure positive)
      base_loan_amount: Math.max(0, calculations.loanAmount || 0),

      // Monthly rent (only if renting)
      monthly_rent: mapCurrentHousing(b.current_housing) === 'Rent' ? (b.monthly_rent || 0) : null,

      // State codes (2-letter format)
      borrower_state: mapStateCode(b.state),
      property_state: mapStateCode(b.property_state),

      // Lien position (default to FirstLien for most mortgages)
      lien_position: 'FirstLien',

      // Impound waiver (default to None Waived)
      impound_waiver: 'None Waived',

      // Loan purpose
      loan_purpose: b.loan_purpose || 'Purchase',

      // Refinance-specific fields
      refinance_type: b.refinance_type || null,  // Rate/Term, Cash Out
      cash_out_purpose: b.cash_out_purpose || null,
      current_interest_rate: b.current_interest_rate || null,

      // Income/Liability
      annual_income: calculations.annualIncome || 0,
      total_monthly_liability: calculations.totalMonthlyDebts || 0,

      // Monthly costs
      monthly_insurance: calculations.monthlyInsurance || 0,
      monthly_taxes: calculations.monthlyTaxes || 0,
      monthly_hoa: calculations.monthlyHOA || 0
    }
  };
}

// Get all borrowers ready for export (for Zapier polling trigger)
router.get('/zapier/borrowers', apiKeyAuth, (req, res) => {
  const database = db.getDb();
  const status = req.query.status || 'qualified';

  const borrowers = database.prepare(`
    SELECT * FROM borrowers
    WHERE status = ?
    ORDER BY updated_at DESC
    LIMIT 100
  `).all(status);

  // Parse JSON and add calculations
  const results = borrowers.map(b => {
    b.employers = JSON.parse(b.employers || '[]');
    b.other_income = JSON.parse(b.other_income || '[]');
    b.co_employers = JSON.parse(b.co_employers || '[]');
    b.co_other_income = JSON.parse(b.co_other_income || '[]');
    b.assets = JSON.parse(b.assets || '[]');
    b.debts = JSON.parse(b.debts || '[]');

    const calculations = calculateBorrowerMetrics(b);
    return formatBorrowerForZapier(b, calculations);
  });

  res.json(results);
});

// Get single borrower with full data (for Zapier)
router.get('/zapier/borrower/:id', apiKeyAuth, (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);

  res.json(formatBorrowerForZapier(borrower, calculations));
});

// Get MISMO XML for a borrower (for Zapier to send to Arive)
router.get('/zapier/borrower/:id/mismo', apiKeyAuth, (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);
  const xml = generateMISMOXML(borrower, calculations);

  // Return as JSON with XML string (easier for Zapier to handle)
  res.json({
    borrower_id: borrower.id,
    borrower_name: `${borrower.first_name} ${borrower.last_name}`,
    mismo_xml: xml
  });
});

// Mark borrower as exported (update status after Zapier sends to Arive)
router.post('/zapier/borrower/:id/exported', apiKeyAuth, (req, res) => {
  const database = db.getDb();

  database.prepare(`
    UPDATE borrowers
    SET status = 'exported', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  res.json({ success: true, message: 'Borrower marked as exported' });
});

// Webhook subscription management (store Zapier webhook URLs)
router.post('/zapier/webhooks', apiKeyAuth, (req, res) => {
  const database = db.getDb();
  const { webhook_url, event_type } = req.body;

  // Create webhooks table if not exists
  database.exec(`
    CREATE TABLE IF NOT EXISTS zapier_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_url TEXT NOT NULL,
      event_type TEXT DEFAULT 'borrower.qualified',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const result = database.prepare(`
    INSERT INTO zapier_webhooks (webhook_url, event_type)
    VALUES (?, ?)
  `).run(webhook_url, event_type || 'borrower.qualified');

  res.json({ success: true, webhook_id: result.lastInsertRowid });
});

// Delete webhook subscription
router.delete('/zapier/webhooks/:id', apiKeyAuth, (req, res) => {
  const database = db.getDb();
  database.prepare('DELETE FROM zapier_webhooks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Internal endpoint for "Send to Arive" button (no API key required)
router.post('/borrower/:id/send-to-arive', async (req, res) => {
  const database = db.getDb();
  const ariveService = require('../services/arive');

  // Get borrower data
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);

  if (!borrower) {
    return res.status(404).json({ success: false, error: 'Borrower not found' });
  }

  // Parse JSON fields
  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);

  try {
    // Send directly to Arive API
    const ariveResponse = await ariveService.createLead(borrower, calculations);

    // Update status to exported
    database.prepare(`
      UPDATE borrowers
      SET status = 'exported', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    console.log('Lead sent to Arive:', ariveResponse);

    res.json({
      success: true,
      message: 'Lead sent to Arive successfully',
      ariveLeadId: ariveResponse.ariveLeadId,
      deepLinkURL: ariveResponse.deepLinkURL
    });

  } catch (error) {
    console.error('Arive API Error:', error.message);

    // Fall back to marking as qualified (for Zapier polling)
    database.prepare(`
      UPDATE borrowers
      SET status = 'qualified', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    // Trigger webhooks as fallback
    await triggerWebhooks('borrower.qualified', { borrower, calculations });

    res.json({
      success: true,
      message: 'Marked as qualified (Arive direct send failed: ' + error.message + ')',
      fallback: true
    });
  }
});

// Mark borrower as qualified via Zapier (requires API key)
router.post('/zapier/borrower/:id/qualify', apiKeyAuth, async (req, res) => {
  const database = db.getDb();

  // Update status
  database.prepare(`
    UPDATE borrowers
    SET status = 'qualified', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  // Get borrower data
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);

  if (borrower) {
    borrower.employers = JSON.parse(borrower.employers || '[]');
    borrower.other_income = JSON.parse(borrower.other_income || '[]');
    borrower.assets = JSON.parse(borrower.assets || '[]');
    borrower.debts = JSON.parse(borrower.debts || '[]');

    const calculations = calculateBorrowerMetrics(borrower);

    // Trigger webhooks
    await triggerWebhooks('borrower.qualified', { borrower, calculations });
  }

  res.json({ success: true, message: 'Borrower qualified and webhooks triggered' });
});

// Helper function to trigger webhooks
async function triggerWebhooks(eventType, data) {
  const database = db.getDb();

  try {
    // Check if webhooks table exists
    const tableExists = database.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='zapier_webhooks'
    `).get();

    if (!tableExists) return;

    const webhooks = database.prepare(`
      SELECT * FROM zapier_webhooks WHERE event_type = ?
    `).all(eventType);

    for (const webhook of webhooks) {
      try {
        const fetch = (await import('node-fetch')).default;
        await fetch(webhook.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString(),
            data
          })
        });
        console.log(`Webhook triggered: ${webhook.webhook_url}`);
      } catch (err) {
        console.error(`Webhook failed: ${webhook.webhook_url}`, err.message);
      }
    }
  } catch (err) {
    console.error('Error triggering webhooks:', err);
  }
}

// ============================================
// EXISTING ENDPOINTS
// ============================================

// Claude AI Analysis
router.post('/analyze/:borrowerId', async (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.borrowerId);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  // Parse JSON fields
  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);

  // Get knowledge context
  const knowledgeContext = database.prepare(`
    SELECT content FROM knowledge_sources
    WHERE content IS NOT NULL AND content != ''
    ORDER BY last_updated DESC
    LIMIT 10
  `).all().map(k => k.content).join('\n\n');

  const prompt = buildAnalysisPrompt(borrower, calculations, knowledgeContext);

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const analysis = response.content[0].text;

    // Cache the analysis
    database.prepare(`
      UPDATE borrowers
      SET ai_analysis = ?, ai_analysis_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(analysis, req.params.borrowerId);

    res.json({ analysis });
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

// Chat with Claude
router.post('/chat/:borrowerId', async (req, res) => {
  const database = db.getDb();
  const { message } = req.body;

  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.borrowerId);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  // Parse JSON fields
  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.co_employers = JSON.parse(borrower.co_employers || '[]');
  borrower.co_other_income = JSON.parse(borrower.co_other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);

  // Get chat history
  const chatHistory = database.prepare(`
    SELECT role, content FROM chat_history
    WHERE borrower_id = ?
    ORDER BY created_at ASC
    LIMIT 20
  `).all(req.params.borrowerId);

  // Get knowledge context
  const knowledgeContext = database.prepare(`
    SELECT content FROM knowledge_sources
    WHERE content IS NOT NULL AND content != ''
    ORDER BY last_updated DESC
    LIMIT 5
  `).all().map(k => k.content).join('\n\n');

  // Save user message
  database.prepare(`
    INSERT INTO chat_history (borrower_id, role, content)
    VALUES (?, 'user', ?)
  `).run(req.params.borrowerId, message);

  const systemPrompt = buildChatSystemPrompt(borrower, calculations, knowledgeContext);

  const messages = chatHistory.map(m => ({
    role: m.role,
    content: m.content
  }));
  messages.push({ role: 'user', content: message });

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages
    });

    const reply = response.content[0].text;

    // Save assistant response
    database.prepare(`
      INSERT INTO chat_history (borrower_id, role, content)
      VALUES (?, 'assistant', ?)
    `).run(req.params.borrowerId, reply);

    res.json({ reply });
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Failed to get response' });
  }
});

// MISMO 3.4 XML Export
router.get('/export/mismo/:borrowerId', (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.borrowerId);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  // Parse JSON fields
  borrower.employers = JSON.parse(borrower.employers || '[]');
  borrower.other_income = JSON.parse(borrower.other_income || '[]');
  borrower.assets = JSON.parse(borrower.assets || '[]');
  borrower.debts = JSON.parse(borrower.debts || '[]');

  const calculations = calculateBorrowerMetrics(borrower);
  const xml = generateMISMOXML(borrower, calculations);

  res.set('Content-Type', 'application/xml');
  res.set('Content-Disposition', `attachment; filename="${borrower.last_name || 'borrower'}_MISMO.xml"`);
  res.send(xml);
});

// Download Analysis as PDF
router.get('/analysis/:borrowerId/pdf', async (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.borrowerId);

  if (!borrower || !borrower.ai_analysis) {
    return res.status(404).json({ error: 'Analysis not found' });
  }

  try {
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');

    // Build filename: PathFinderPro-ClearPathUtah-Lastname-Firstname.pdf
    const cleanName = (name) => (name || '').replace(/[^a-zA-Z\s-]/g, '').replace(/\s+/g, '').trim();
    const lastName = cleanName(borrower.last_name) || 'Client';
    const firstName = cleanName(borrower.first_name) || '';
    const filename = firstName
      ? `PathFinderPro-ClearPathUtah-${lastName}-${firstName}.pdf`
      : `PathFinderPro-ClearPathUtah-${lastName}.pdf`;

    const pageWidth = 612;
    const pageHeight = 792;

    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

    // Add background color to every page
    const addBackground = () => {
      doc.save();
      doc.rect(0, 0, pageWidth, pageHeight).fill('#F5F0E8');
      doc.restore();
    };

    // Add background to first page
    addBackground();

    // Add background to subsequent pages
    doc.on('pageAdded', addBackground);

    res.setHeader('Content-Type', 'application/pdf');
    // Use both filename and filename* for better browser compatibility
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    doc.pipe(res);

    // Image paths
    const imagesPath = path.join(__dirname, '..', 'public', 'images');
    const logoPath = path.join(imagesPath, 'logo-actual.png');  // Real PNG (logo.png was WebP)
    const clearpathLogoPath = path.join(imagesPath, 'clearpath-logo.png');
    const reviewsPath = path.join(imagesPath, 'reviews.png');

    // Try to parse as JSON (new format)
    let parsed = null;
    try {
      parsed = JSON.parse(borrower.ai_analysis);
    } catch (e) {
      parsed = null;
    }

    // ===== HEADER =====
    let currentY = 40;

    // Logo and PATHFINDER PRO title
    // Calculate text widths for centering (with letter spacing)
    const letterSpacing = 3;
    doc.fontSize(20).font('Helvetica');  // Thinner font (not Bold)
    const pathWidth = doc.widthOfString('PATH') + (3 * letterSpacing);
    const finderWidth = doc.widthOfString('FINDER') + (5 * letterSpacing);
    const proWidth = doc.widthOfString(' PRO') + (3 * letterSpacing);
    const totalTextWidth = pathWidth + finderWidth + proWidth;
    const logoWidth = 35;
    const logoGap = 12;
    const totalWidth = logoWidth + logoGap + totalTextWidth;
    const startX = (pageWidth - totalWidth) / 2;

    // Draw logo
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, startX, currentY, { width: logoWidth });
      } catch (e) {
        console.error('Logo image error:', e.message);
      }
    }

    // Draw "PATH" in dark gray with letter spacing (thin font)
    let textX = startX + logoWidth + logoGap;
    const textY = currentY + 8;
    doc.fontSize(20).font('Helvetica').fillColor('#333333');
    doc.text('P', textX, textY, { continued: true, characterSpacing: letterSpacing });
    doc.text('A', { continued: true, characterSpacing: letterSpacing });
    doc.text('T', { continued: true, characterSpacing: letterSpacing });
    doc.text('H', { continued: true, characterSpacing: letterSpacing });

    // Draw "FINDER" in red with letter spacing
    doc.fillColor('#c0392b');
    doc.text('F', { continued: true, characterSpacing: letterSpacing });
    doc.text('I', { continued: true, characterSpacing: letterSpacing });
    doc.text('N', { continued: true, characterSpacing: letterSpacing });
    doc.text('D', { continued: true, characterSpacing: letterSpacing });
    doc.text('E', { continued: true, characterSpacing: letterSpacing });
    doc.text('R', { continued: true, characterSpacing: letterSpacing });

    // Draw " PRO" in dark gray with letter spacing
    doc.fillColor('#333333');
    doc.text(' ', { continued: true, characterSpacing: letterSpacing });
    doc.text('P', { continued: true, characterSpacing: letterSpacing });
    doc.text('R', { continued: true, characterSpacing: letterSpacing });
    doc.text('O', { continued: false });

    currentY = currentY + 38;

    // Subtitle centered
    doc.fontSize(10).fillColor('#666666').font('Helvetica');
    doc.text('by ClearPath Utah Mortgage', 50, currentY, { width: pageWidth - 100, align: 'center' });

    currentY = doc.y + 10;

    // Agent info - Kelly Sansom bold, rest normal, phone in olive
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333');
    const infoY = currentY;
    // Build the line with mixed styling
    const line1 = 'Kelly Sansom';
    const line1b = ' - Your Mortgage Specialist | NMLS #2510508 | ';
    const phone = '(801) 891-1846';
    const line1c = ' | clearpathutah.com |';

    // Calculate total width for centering
    doc.font('Helvetica-Bold');
    const w1 = doc.widthOfString(line1);
    doc.font('Helvetica');
    const w2 = doc.widthOfString(line1b);
    const w3 = doc.widthOfString(phone);
    const w4 = doc.widthOfString(line1c);
    const totalLineWidth = w1 + w2 + w3 + w4;
    const lineStartX = (pageWidth - totalLineWidth) / 2;

    doc.font('Helvetica-Bold').fillColor('#333333');
    doc.text(line1, lineStartX, infoY, { continued: true });
    doc.font('Helvetica').fillColor('#444444');
    doc.text(line1b, { continued: true });
    doc.fillColor('#8f8c83');  // Olive color for phone
    doc.text(phone, { continued: true });
    doc.fillColor('#444444');
    doc.text(line1c, { continued: false });

    // Email on next line centered in olive
    doc.fillColor('#8f8c83');
    doc.text('hello@clearpathutah.com', 50, doc.y + 2, { width: pageWidth - 100, align: 'center' });

    // Divider
    currentY = doc.y + 8;
    doc.strokeColor('#8FA38F').lineWidth(0.75);
    doc.moveTo(50, currentY).lineTo(pageWidth - 50, currentY).stroke();
    doc.y = currentY + 12;

    // ===== CONTENT =====
    const margin = 60;
    const contentWidth = pageWidth - (margin * 2);

    if (parsed && parsed.clientLetter) {
      const letter = parsed.clientLetter;

      // Greeting - just "Dear FirstName," with body styling (no last name, no phone)
      const firstName = borrower.first_name || 'Valued Client';
      doc.fontSize(11).fillColor('#333333').font('Helvetica');
      doc.text(`Dear ${firstName},`, margin);
      doc.moveDown(0.8);

      // Introduction
      if (letter.introduction) {
        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(letter.introduction, margin, doc.y, { width: contentWidth, lineGap: 3 });
        doc.moveDown(1.2);
      }

      // Helper for sections
      const renderSection = (title, items, numbered) => {
        if (!items || !items.length) return;

        // Section title with underline
        doc.fontSize(11).fillColor('#2a2a2a').font('Helvetica-Bold');
        doc.text(title, margin);
        const titleWidth = doc.widthOfString(title);
        doc.strokeColor('#8FA38F').lineWidth(1.5);
        doc.moveTo(margin, doc.y + 2).lineTo(margin + titleWidth, doc.y + 2).stroke();
        doc.moveDown(0.5);

        // Items - strip any existing bullets/numbers from the text
        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        items.forEach((item, i) => {
          // Remove leading bullets, dashes, or numbers like "1.", "1)", "•", "-"
          const cleanItem = item.replace(/^[\s]*[-•*]\s*/, '').replace(/^[\s]*\d+[.)]\s*/, '').trim();
          const prefix = numbered ? `${i+1}. ` : '• ';
          doc.text(prefix + cleanItem, margin, doc.y, { width: contentWidth, lineGap: 2 });
          doc.moveDown(0.3);
        });
        doc.moveDown(0.8);
      };

      renderSection('YOUR HIGHLIGHTS', letter.highlights, false);
      renderSection('ROOM FOR IMPROVEMENT', letter.improvements, false);
      renderSection('OPTIONS TO STRENGTHEN YOUR PROFILE', letter.options, true);

      // ClearPath Forward
      if (letter.clearpath) {
        doc.fontSize(11).fillColor('#2a2a2a').font('Helvetica-Bold');
        doc.text('YOUR CLEARPATH FORWARD', margin);
        const titleWidth = doc.widthOfString('YOUR CLEARPATH FORWARD');
        doc.strokeColor('#8FA38F').lineWidth(1.5);
        doc.moveTo(margin, doc.y + 2).lineTo(margin + titleWidth, doc.y + 2).stroke();
        doc.moveDown(0.6);

        // Calculate box height
        doc.fontSize(11).font('Helvetica');
        const textHeight = doc.heightOfString(letter.clearpath, { width: contentWidth - 30 });
        const boxHeight = textHeight + 24;
        const boxY = doc.y;

        // Draw box with left accent
        doc.rect(margin, boxY, contentWidth, boxHeight).fill('#EDF2ED');
        doc.rect(margin, boxY, 5, boxHeight).fill('#8FA38F');

        // Text inside box
        doc.fillColor('#333333');
        doc.text(letter.clearpath, margin + 18, boxY + 12, { width: contentWidth - 30, lineGap: 2 });
        doc.y = boxY + boxHeight + 15;
      }

      // Closing
      if (letter.closing) {
        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(letter.closing, margin, doc.y, { width: contentWidth, lineGap: 2 });
        doc.moveDown(0.8);
      }

      // Signature block
      doc.fontSize(11).fillColor('#333333').font('Helvetica');
      doc.text('Warmly,', margin);
      doc.moveDown(0.5);
      doc.text('Kelly Sansom', margin);
      doc.text('Your Mortgage Specialist', margin);
      doc.text('(801) 891-1846', margin);
      doc.text('hello@clearpathutah.com', margin);
    } else {
      // Old format
      const clean = borrower.ai_analysis.replace(/[#*]/g, '');
      doc.fontSize(11).fillColor('#333333').font('Helvetica');
      doc.text(clean, margin, doc.y, { width: contentWidth, lineGap: 4 });
    }

    // ===== FOOTER =====
    // Small space after signature
    doc.moveDown(1.5);

    // Check if we need a new page for footer (need ~120px for footer content)
    const footerNeeded = 120;
    if (doc.y > pageHeight - footerNeeded - 30) {
      doc.addPage();
    }

    // Footer flows from current position
    let footerY = doc.y;

    // Divider line
    doc.strokeColor('#e0e0e0').lineWidth(0.5);
    doc.moveTo(50, footerY).lineTo(pageWidth - 50, footerY).stroke();
    footerY += 10;

    // Left logo (20% larger)
    if (fs.existsSync(clearpathLogoPath)) {
      try { doc.image(clearpathLogoPath, 55, footerY, { width: 60 }); } catch(e) {}
    }

    // Center text
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#8f8c83');
    doc.text('CLEARPATH UTAH MORTGAGE', 180, footerY, { width: 250, align: 'center' });
    doc.fontSize(8).fillColor('#666666').font('Helvetica');
    doc.text('(801) 891-1846 | hello@clearpathutah.com', 180, footerY + 14, { width: 250, align: 'center' });
    doc.text('NMLS #2510508 | FAIR LENDER | FAIR HOUSING', 180, footerY + 26, { width: 250, align: 'center' });

    // Right logo (20% larger)
    if (fs.existsSync(reviewsPath)) {
      try { doc.image(reviewsPath, pageWidth - 130, footerY, { width: 66 }); } catch(e) {}
    }

    // Disclaimer below footer
    doc.y = footerY + 55;
    doc.fontSize(7).fillColor('#999999');
    doc.text('Powered by Capital Financial Group, Inc. – NMLS #3146. Information subject to change without notice. This is not an offer for extension of credit or a commitment to lend. Equal Housing Lender.',
      50, doc.y, { width: pageWidth - 100, align: 'center' });

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
  }
});

// Email Analysis to Client
router.post('/analysis/:borrowerId/email', async (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.borrowerId);
  const { clientEmail } = req.body;

  if (!borrower || !borrower.ai_analysis) {
    return res.status(404).json({ error: 'Analysis not found' });
  }

  if (!clientEmail) {
    return res.status(400).json({ error: 'Client email is required' });
  }

  try {
    const nodemailer = require('nodemailer');

    // Create transporter - using environment variables for SMTP config
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Format analysis for email
    const analysisHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; border-bottom: 1px solid #e0e0e0;">
          <h1 style="margin: 0;">
            <span style="color: #000;">PATH</span><span style="color: #f90000;">FINDER</span> <span style="color: #000;">PRO</span>
          </h1>
          <p style="color: #666; margin: 5px 0;">Loan Qualification Analysis</p>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${borrower.first_name || 'Valued Client'},</p>
          <p>Please find below your personalized loan qualification analysis from ClearPath Utah Mortgage.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
          <div style="line-height: 1.6;">
            ${borrower.ai_analysis.replace(/\n/g, '<br>')}
          </div>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
          <p>If you have any questions, please don't hesitate to reach out.</p>
          <p>Best regards,<br>Kelly<br>ClearPath Utah Mortgage<br>(801) 891-1846<br>hello@clearpathutah.com</p>
        </div>
      </div>
    `;

    // Send to client
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'PathFinder Pro <noreply@clearpathutah.com>',
      to: clientEmail,
      cc: 'hello@clearpathutah.com', // Always CC Kelly
      subject: `Your Loan Qualification Analysis - PathFinder Pro`,
      html: analysisHtml
    });

    res.json({ success: true, message: `Email sent to ${clientEmail}` });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ error: 'Failed to send email. Please check SMTP configuration.' });
  }
});

// Helper functions
function buildAnalysisPrompt(borrower, calculations, knowledge) {
  const borrowerName = `${borrower.first_name || ''} ${borrower.last_name || ''}`.trim() || 'Valued Client';
  const borrowerPhone = borrower.phone || '';

  return `You are helping Kelly Sansom, a mortgage loan officer at ClearPath Utah Mortgage, analyze a borrower's qualification profile.

BORROWER DATA:
Name: ${borrowerName}
Phone: ${borrowerPhone}
${borrower.has_coborrower ? `Co-Borrower: ${borrower.co_first_name} ${borrower.co_last_name}` : 'No co-borrower'}

INCOME:
- Total Monthly Gross Income: $${calculations.totalMonthlyIncome.toFixed(2)}
- Annual Income: $${calculations.annualIncome.toFixed(2)}

EMPLOYMENT:
${borrower.employers.map(e => {
  const status = e.is_previous ? '(PREVIOUS)' : '(CURRENT)';
  const timeAtJob = (e.years_at_job || e.months_at_job)
    ? ` - ${e.years_at_job || 0} years, ${e.months_at_job || 0} months`
    : '';
  return `- ${e.employer_name}: ${e.position}, ${e.employment_type} ${status}${timeAtJob}`;
}).join('\n') || 'No employment data'}

ASSETS:
- Total Assets: $${calculations.totalAssets.toFixed(2)}
- Liquid Assets: $${calculations.liquidAssets.toFixed(2)}

DEBTS:
- Total Monthly Debt Payments: $${calculations.totalMonthlyDebts.toFixed(2)}
- Current DTI (before housing): ${calculations.currentDTI.toFixed(1)}%

PROPERTY:
- Loan Purpose: ${borrower.loan_purpose || 'Purchase'}
${borrower.loan_purpose === 'Refinance' ? `- Property Value: $${borrower.property_value || 0}
- Current Loan Balance: $${borrower.current_loan_balance || 0}
- Refinance Type: ${borrower.refinance_type || 'Rate/Term'}
${borrower.cash_out_amount ? `- Cash Out Amount: $${borrower.cash_out_amount}` : ''}
${borrower.cash_out_purpose ? `- Cash Out Purpose: ${borrower.cash_out_purpose}` : ''}` : `- Purchase Price: $${borrower.purchase_price || 0}
- Down Payment: $${borrower.down_payment_amount || 0}`}
- Loan Amount: $${calculations.loanAmount.toFixed(2)}
- LTV: ${calculations.ltv.toFixed(1)}%
- Property Type: ${borrower.property_type || 'Not specified'}
- Occupancy: ${borrower.occupancy || 'Not specified'}
- County: ${borrower.property_county || 'Not specified'}

PROPOSED PAYMENT:
- Est. Monthly PITI: $${calculations.totalPITI.toFixed(2)}
- Front-End DTI: ${calculations.frontEndDTI.toFixed(1)}%
- Back-End DTI: ${calculations.backEndDTI.toFixed(1)}%

CREDIT:
- Credit Score: ${borrower.credit_score || 'Not provided'}
${borrower.has_coborrower ? `- Co-Borrower Score: ${borrower.co_credit_score || 'Not provided'}` : ''}
- Late Payments (12 mo): ${borrower.late_payments_12 ? 'Yes' : 'No'}
- Late Payments (24 mo): ${borrower.late_payments_24 ? 'Yes' : 'No'}
- Bankruptcy: ${borrower.bankruptcy || 'Never'}
- Foreclosure: ${borrower.foreclosure || 'Never'}
- Collections: ${borrower.collections ? `Yes ($${borrower.collections_amount})` : 'No'}

MAX PURCHASE POWER:
- At 43% DTI: $${calculations.maxPurchase43.toFixed(0)}
- At 45% DTI: $${calculations.maxPurchase45.toFixed(0)}
- At 50% DTI: $${calculations.maxPurchase50.toFixed(0)}

ESTIMATED CASH TO CLOSE: $${calculations.cashToClose.toFixed(2)}

${knowledge ? `RELEVANT PROGRAM KNOWLEDGE:\n${knowledge.substring(0, 3000)}` : ''}

Please respond with a JSON object containing TWO parts:

1. "loanOfficerSummary" - A quick reference for the loan officer with these fields (each should be an array of brief bullet points, 2-4 items each):
   - strengths: What makes this borrower strong
   - weaknesses: Areas of concern
   - primaryRecommendation: Best loan program recommendation (1-2 sentences)
   - secondaryOptions: Alternative programs to consider
   - concernsToAddress: Issues that need to be resolved
   - borrowerOptions: What the borrower could do to improve their position
   - suggestedNextSteps: Immediate action items

2. "clientLetter" - A warm, professional letter FROM Kelly TO the client. Structure it EXACTLY like this:
   - greeting: "Dear ${borrowerName}," on its own line, then "${borrowerPhone}" on the next line if phone exists
   - introduction: A thank you for allowing me to run some numbers. Explain this analysis is a starting point to help them understand where they stand in terms of home readiness. Keep it warm and encouraging. (2-3 sentences)
   - highlights: Section titled "YOUR HIGHLIGHTS" - What's working in their favor (3-5 bullet points, positive and encouraging)
   - improvements: Section titled "ROOM FOR IMPROVEMENT" - Areas that could be stronger (2-4 bullet points, constructive not negative)
   - options: Section titled "OPTIONS TO STRENGTHEN YOUR PROFILE" - Specific actionable things they could do (3-5 numbered items with brief explanations)
   - clearpath: Section titled "YOUR CLEARPATH FORWARD" - A roadmap paragraph giving them clear next steps to be successful in home buying. Be specific and actionable. End on an encouraging note.
   - closing: "I'm here to help guide you every step of the way. Please don't hesitate to reach out with any questions."
   - signature: "Warmly," then "Kelly Sansom" then "Your Mortgage Specialist" then "(801) 891-1846" then "hello@clearpathutah.com"

Return ONLY valid JSON, no markdown code blocks. Example structure:
{
  "loanOfficerSummary": {
    "strengths": ["point 1", "point 2"],
    "weaknesses": ["point 1"],
    "primaryRecommendation": "FHA loan due to...",
    "secondaryOptions": ["Conventional with...", "Utah Housing..."],
    "concernsToAddress": ["DTI is high", "Need reserves"],
    "borrowerOptions": ["Pay down car loan", "Add co-borrower income"],
    "suggestedNextSteps": ["Get pre-approval letter", "Connect with realtor"]
  },
  "clientLetter": {
    "greeting": "Dear John Smith,\\n(801) 555-1234",
    "introduction": "Thank you for...",
    "highlights": ["Strong credit score of 720", "Stable employment history"],
    "improvements": ["DTI is on the higher side", "Limited reserves"],
    "options": ["1. Pay down your car loan...", "2. Consider adding..."],
    "clearpath": "Based on your profile, here's your path forward...",
    "closing": "I'm here to help...",
    "signature": "Warmly,\\nKelly Sansom\\nYour Mortgage Specialist\\n(801) 891-1846\\nhello@clearpathutah.com"
  }
}`;
}

function buildChatSystemPrompt(borrower, calculations, knowledge) {
  const isRefinance = borrower.loan_purpose === 'Refinance';

  return `You are a helpful mortgage loan officer assistant for ClearPath Utah Mortgage. You're chatting about a specific borrower's scenario.

CURRENT BORROWER CONTEXT:
- Name: ${borrower.first_name} ${borrower.last_name}
- Loan Purpose: ${borrower.loan_purpose || 'Purchase'}
- Monthly Income: $${calculations.totalMonthlyIncome.toFixed(2)}
- Monthly Debts: $${calculations.totalMonthlyDebts.toFixed(2)}
${isRefinance
    ? `- Property Value: $${borrower.property_value || 'Not specified'}
- Current Loan Balance: $${borrower.current_loan_balance || 'Not specified'}
- Refinance Type: ${borrower.refinance_type || 'Rate/Term'}
${borrower.cash_out_amount ? `- Cash Out Amount: $${borrower.cash_out_amount}` : ''}`
    : `- Target Purchase: $${borrower.purchase_price || 'Not specified'}`}
- Credit Score: ${borrower.credit_score || 'Not provided'}
- Back-End DTI: ${calculations.backEndDTI.toFixed(1)}%
- LTV: ${calculations.ltv.toFixed(1)}%
- Cash to Close Needed: $${calculations.cashToClose.toFixed(2)}
- Liquid Assets: $${calculations.liquidAssets.toFixed(2)}

${knowledge ? `PROGRAM KNOWLEDGE:\n${knowledge.substring(0, 2000)}` : ''}

Be helpful, specific, and reference the borrower's actual numbers when answering questions. If asked about programs, rates, or guidelines, provide accurate current information. Keep responses concise but informative.`;
}

function generateMISMOXML(borrower, calculations) {
  const loanAmount = calculations.loanAmount;
  const today = new Date().toISOString().split('T')[0];
  const loanPurpose = borrower.loan_purpose || 'Purchase';
  const isRefinance = loanPurpose === 'Refinance';
  const propertyValue = isRefinance ? (borrower.property_value || 0) : (borrower.purchase_price || 0);

  // Map loan purpose to MISMO type
  let loanPurposeType = 'Purchase';
  if (isRefinance) {
    loanPurposeType = borrower.refinance_type === 'Cash-Out' ? 'CashOutRefinance' : 'NoCashOutRefinance';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ABOUT_VERSIONS>
    <ABOUT_VERSION>
      <DataVersionIdentifier>3.4</DataVersionIdentifier>
    </ABOUT_VERSION>
  </ABOUT_VERSIONS>
  <DEAL_SETS>
    <DEAL_SET>
      <DEALS>
        <DEAL>
          <LOANS>
            <LOAN>
              <LOAN_IDENTIFIERS>
                <LOAN_IDENTIFIER>
                  <LoanIdentifier>PFP-${borrower.id}</LoanIdentifier>
                  <LoanIdentifierType>LenderLoan</LoanIdentifierType>
                </LOAN_IDENTIFIER>
              </LOAN_IDENTIFIERS>
              <TERMS_OF_LOAN>
                <BaseLoanAmount>${loanAmount.toFixed(2)}</BaseLoanAmount>
                <LoanPurposeType>${loanPurposeType}</LoanPurposeType>
                <MortgageType>Conventional</MortgageType>
                <NoteAmount>${loanAmount.toFixed(2)}</NoteAmount>
                <NoteRatePercent>${borrower.interest_rate || 7.0}</NoteRatePercent>
              </TERMS_OF_LOAN>${isRefinance ? `
              <REFINANCE>
                <RefinancePrimaryPurposeType>${borrower.refinance_type === 'Cash-Out' ? 'CashOutOther' : 'RateTermRefinance'}</RefinancePrimaryPurposeType>
                ${borrower.cash_out_amount ? `<RefinanceCashOutAmount>${borrower.cash_out_amount}</RefinanceCashOutAmount>` : ''}
                ${borrower.cash_out_purpose ? `<RefinanceCashOutDeterminationType>${escapeXml(borrower.cash_out_purpose)}</RefinanceCashOutDeterminationType>` : ''}
              </REFINANCE>` : ''}
            </LOAN>
          </LOANS>
          <PARTIES>
            <PARTY>
              <INDIVIDUAL>
                <NAME>
                  <FirstName>${escapeXml(borrower.first_name || '')}</FirstName>
                  <LastName>${escapeXml(borrower.last_name || '')}</LastName>
                </NAME>
              </INDIVIDUAL>
              <ROLES>
                <ROLE>
                  <BORROWER>
                    <BORROWER_DETAIL>
                      <MaritalStatusType>${borrower.marital_status || 'Unknown'}</MaritalStatusType>
                      <DependentCount>${borrower.dependents || 0}</DependentCount>
                    </BORROWER_DETAIL>
                    <CURRENT_INCOME>
                      <CURRENT_INCOME_ITEMS>
                        <CURRENT_INCOME_ITEM>
                          <CurrentIncomeMonthlyTotalAmount>${calculations.totalMonthlyIncome.toFixed(2)}</CurrentIncomeMonthlyTotalAmount>
                        </CURRENT_INCOME_ITEM>
                      </CURRENT_INCOME_ITEMS>
                    </CURRENT_INCOME>
                    <DECLARATION>
                      <CitizenshipResidencyType>${borrower.citizenship_status || 'USCitizen'}</CitizenshipResidencyType>
                      <IntentToOccupyType>${borrower.occupancy === 'Primary Residence' ? 'Yes' : 'No'}</IntentToOccupyType>
                      <HomeownerPastThreeYearsType>${borrower.first_time_homebuyer ? 'No' : 'Yes'}</HomeownerPastThreeYearsType>
                    </DECLARATION>
                    <RESIDENCES>
                      <RESIDENCE>
                        <ADDRESS>
                          <AddressLineText>${escapeXml(borrower.street_address || '')}</AddressLineText>
                          <CityName>${escapeXml(borrower.city || '')}</CityName>
                          <StateCode>${escapeXml(borrower.state || '')}</StateCode>
                          <PostalCode>${escapeXml(borrower.zip || '')}</PostalCode>
                        </ADDRESS>
                        <RESIDENCE_DETAIL>
                          <BorrowerResidencyType>Current</BorrowerResidencyType>
                        </RESIDENCE_DETAIL>
                      </RESIDENCE>
                    </RESIDENCES>
                  </BORROWER>
                  <ROLE_DETAIL>
                    <PartyRoleType>Borrower</PartyRoleType>
                  </ROLE_DETAIL>
                </ROLE>
              </ROLES>
              <TAXPAYER_IDENTIFIERS>
                <TAXPAYER_IDENTIFIER>
                  <TaxpayerIdentifierType>SocialSecurityNumber</TaxpayerIdentifierType>
                  <TaxpayerIdentifierValue>${borrower.ssn || ''}</TaxpayerIdentifierValue>
                </TAXPAYER_IDENTIFIER>
              </TAXPAYER_IDENTIFIERS>
              <CONTACT_POINTS>
                <CONTACT_POINT>
                  <CONTACT_POINT_TELEPHONE>
                    <ContactPointTelephoneValue>${borrower.phone || ''}</ContactPointTelephoneValue>
                  </CONTACT_POINT_TELEPHONE>
                </CONTACT_POINT>
                <CONTACT_POINT>
                  <CONTACT_POINT_EMAIL>
                    <ContactPointEmailValue>${borrower.email || ''}</ContactPointEmailValue>
                  </CONTACT_POINT_EMAIL>
                </CONTACT_POINT>
              </CONTACT_POINTS>
            </PARTY>
          </PARTIES>
          <ASSETS>
            <ASSET>
              <ASSET_HOLDER>
                <NAME>
                  <FirstName>${escapeXml(borrower.first_name || '')}</FirstName>
                  <LastName>${escapeXml(borrower.last_name || '')}</LastName>
                </NAME>
              </ASSET_HOLDER>
              <ASSET_DETAIL>
                <AssetAccountIdentifier>Combined</AssetAccountIdentifier>
                <AssetCashOrMarketValueAmount>${calculations.totalAssets.toFixed(2)}</AssetCashOrMarketValueAmount>
                <AssetType>Other</AssetType>
              </ASSET_DETAIL>
            </ASSET>
          </ASSETS>
          <LIABILITIES>
            <LIABILITY>
              <LIABILITY_DETAIL>
                <LiabilityMonthlyPaymentAmount>${calculations.totalMonthlyDebts.toFixed(2)}</LiabilityMonthlyPaymentAmount>
                <LiabilityType>Other</LiabilityType>
              </LIABILITY_DETAIL>
            </LIABILITY>
          </LIABILITIES>
          <COLLATERALS>
            <COLLATERAL>
              <SUBJECT_PROPERTY>
                <ADDRESS>
                  <StateCode>${borrower.property_state || 'UT'}</StateCode>
                  <CountyName>${escapeXml(borrower.property_county || '')}</CountyName>
                </ADDRESS>
                <PROPERTY_DETAIL>
                  <PropertyEstimatedValueAmount>${propertyValue}</PropertyEstimatedValueAmount>
                  <PropertyUsageType>${borrower.occupancy || 'PrimaryResidence'}</PropertyUsageType>
                  <ConstructionMethodType>${borrower.property_type || 'SiteBuilt'}</ConstructionMethodType>
                </PROPERTY_DETAIL>
              </SUBJECT_PROPERTY>
            </COLLATERAL>
          </COLLATERALS>
        </DEAL>
      </DEALS>
    </DEAL_SET>
  </DEAL_SETS>
</MESSAGE>`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
