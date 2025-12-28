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

  // Map military status to Arive format
  const mapMilitaryStatus = (status) => {
    const map = {
      'None': null,
      'Active Duty': 'Active Duty',
      'Veteran': 'Veteran',
      'Reserve/National Guard': 'Reserve National Guard Never Activated'
    };
    return map[status] || null;
  };

  // Map home buying stage to Arive format
  const mapHomeBuyingStage = (stage) => {
    const map = {
      'Just Getting Started': 'GETTING_STARTED',
      'Making Offers': 'MAKING_OFFERS',
      'Found a House/Offer Pending': 'OFFER_PENDING',
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

      // Military status
      military_service_type: mapMilitaryStatus(b.military_status),
      co_military_service_type: mapMilitaryStatus(b.co_military_status),

      // Home buying stage
      home_buying_stage: mapHomeBuyingStage(b.home_buying_stage),

      // Years since events
      years_since_bankruptcy: mapYearsSince(b.bankruptcy),
      years_since_foreclosure: mapYearsSince(b.foreclosure),

      // Subject property TBD indicator
      subject_property_tbd: !b.subject_property_street,

      // Occupancy type mapping
      occupancy_type: b.current_housing || 'Rent',

      // Property value (works for both purchase and refi)
      property_value: b.loan_purpose === 'Refinance' ? b.property_value : b.purchase_price
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

  res.json({ success: true, message: 'Borrower marked as qualified' });
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

// Helper functions
function buildAnalysisPrompt(borrower, calculations, knowledge) {
  return `You are a mortgage loan officer assistant analyzing a borrower's qualification profile.

BORROWER DATA:
Name: ${borrower.first_name} ${borrower.last_name}
${borrower.has_coborrower ? `Co-Borrower: ${borrower.co_first_name} ${borrower.co_last_name}` : 'No co-borrower'}

INCOME:
- Total Monthly Gross Income: $${calculations.totalMonthlyIncome.toFixed(2)}
- Annual Income: $${calculations.annualIncome.toFixed(2)}

EMPLOYMENT:
${borrower.employers.map(e => `- ${e.employer_name}: ${e.position}, ${e.employment_type}`).join('\n') || 'No employment data'}

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

Please provide a comprehensive analysis including:
1. **Loan Program Recommendations**: Which programs (Conventional, FHA, VA, USDA) would be best for this borrower and why
2. **Strengths**: What makes this borrower a strong candidate
3. **Concerns**: Any red flags or challenges to address
4. **Down Payment Assistance**: Utah-specific DPA programs they may qualify for (Utah Housing, Salt Lake County, etc.)
5. **Suggested Next Steps**: Specific actions needed before application

Format your response in clear sections with headers.`;
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
