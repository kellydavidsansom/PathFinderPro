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

  // Build Arive-compatible payload
  const arivePayload = buildArivePayload(borrower, calculations);

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
          pathfinder_id: borrower.id,
          ...arivePayload
        })
      });
      console.log(`Test webhook sent to: ${webhook.webhook_url}`);
    } catch (err) {
      console.error(`Webhook failed: ${err.message}`);
    }
  }

  res.json({ success: true, message: 'Test webhook sent', borrower_id: borrower.id });
});

// Build Arive-compatible payload from PathFinder Pro data
function buildArivePayload(b, calc) {
  // Helper: format date to YYYY-MM-DD
  const formatDate = (date) => {
    if (!date) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString().split('T')[0];
  };

  // Helper: format phone to 10 digits
  const formatPhone = (phone) => {
    if (!phone) return undefined;
    return phone.replace(/\D/g, '').slice(-10);
  };

  // Helper: map state to 2-letter code
  const mapState = (state) => {
    const codes = {
      'Utah': 'UT', 'Arizona': 'AZ', 'California': 'CA', 'Colorado': 'CO',
      'Idaho': 'ID', 'Nevada': 'NV', 'Wyoming': 'WY', 'New Mexico': 'NM',
      'Texas': 'TX', 'Oregon': 'OR', 'Washington': 'WA', 'Montana': 'MT'
    };
    if (state && state.length === 2) return state.toUpperCase();
    return codes[state] || state;
  };

  // Map property type to Arive values
  const mapPropertyType = (type) => {
    const map = {
      'Single Family': 'SINGLE_FAMILY_DETACHED',
      'Condo': 'CONDO_UNDER_5_STORIES',
      'Townhouse': 'TOWNHOUSE',
      'Multi-Family (2-4)': 'TWO_UNIT',
      'Manufactured': 'MANUFACTURED_DOUBLE_WIDE'
    };
    return map[type] || undefined;
  };

  // Map homebuyingStage
  const mapStage = (stage) => {
    const map = {
      'Just Getting Started': 'GETTING_STARTED',
      'Making Offers': 'MAKING_OFFERS',
      'Found a House/Offer Pending': 'FOUND_A_HOUSE_OR_OFFER_PENDING',
      'Under Contract': 'UNDER_CONTRACT'
    };
    return map[stage] || 'GETTING_STARTED';
  };

  // Map military status
  const mapMilitary = (status) => {
    const map = {
      'Active Duty': 'ActiveDuty',
      'Veteran': 'Veteran',
      'Reserve/National Guard': 'ReserveNationalGuardNeverActivated'
    };
    return map[status] || undefined;
  };

  // Map occupancy/housing
  const mapOccupancy = (housing) => {
    const map = { 'Own': 'Own', 'Rent': 'Rent', 'Living Rent Free': 'LivingRentFree' };
    return map[housing] || 'Rent';
  };

  // Map property usage
  const mapUsage = (occ) => {
    const map = {
      'Primary Residence': 'PrimaryResidence',
      'Second Home': 'SecondHome',
      'Investment': 'Investment'
    };
    return map[occ] || undefined;
  };

  // Map refinance type
  const mapRefiType = (type) => {
    const map = { 'Rate/Term': 'NoCashOut', 'Cash Out': 'CashOut' };
    return map[type] || undefined;
  };

  // Map cash out purpose
  const mapCashoutPurpose = (purpose) => {
    const map = {
      'Debt Consolidation': 'DebtConsolidation',
      'Home Improvement': 'HomeImprovement',
      'Other': 'Other'
    };
    return map[purpose] || undefined;
  };

  // Map years since event
  const mapYears = (val) => {
    if (!val || val === 'Never') return undefined;
    if (val.includes('2 years') || val.includes('3 years')) return '1';
    if (val.includes('2+') || val.includes('3+')) return '4';
    return undefined;
  };

  // Map employment type
  const mapEmployment = (type) => {
    const map = {
      'W-2 Employee': 'employed',
      'Self-Employed': 'self-employed',
      'Retired': 'retired',
      '1099 Contractor': 'self-employed'
    };
    return map[type] || undefined;
  };

  // Build the payload matching Arive API exactly
  const payload = {
    // Required fields
    assigneeEmail: 'hello@clearpathutah.com',
    loanPurpose: b.loan_purpose || 'Purchase',

    // Lead info
    leadSource: 'PathFinder Pro',
    leadStatus: 'QUALIFIED',
    homebuyingStage: mapStage(b.home_buying_stage),
    crmReferenceId: String(b.id),

    // Loan details
    mortgageType: b.preferred_loan_type || undefined,
    baseLoanAmount: Math.max(0, calc.loanAmount || 0),
    purchasePriceOrEstimatedValue: b.loan_purpose === 'Refinance' ? b.property_value : b.purchase_price,
    propertyType: mapPropertyType(b.property_type),
    propertyUsageType: mapUsage(b.occupancy),

    // Monthly costs (as strings per API spec)
    estimatedHOIMonthly: calc.monthlyInsurance ? String(Math.round(calc.monthlyInsurance)) : undefined,
    estimatedPropertyTaxesMonthly: calc.monthlyTaxes ? String(Math.round(calc.monthlyTaxes)) : undefined,
    estimatedAssociationDuesMonthly: calc.monthlyHOA ? String(Math.round(calc.monthlyHOA)) : undefined,

    // Credit & rates
    estimatedFICO: b.credit_score ? String(b.credit_score) : undefined,
    noteRate: b.interest_rate || undefined,
    qualifyingRate: b.interest_rate || undefined,

    // Loan structure
    amortizationType: 'Fixed',
    term: 360,
    interestOnly: false,
    lienPosition: 'FirstLien',
    impoundWaiver: 'None Waived',

    // Subject property
    subjectTBDIndicator: !b.subject_property_street,
    subjectProperty: {
      lineText: b.subject_property_street || undefined,
      city: b.subject_property_city || undefined,
      county: b.property_county || undefined,
      postalCode: b.subject_property_zip || undefined,
      state: mapState(b.property_state)
    },

    // Borrower (required object)
    borrower: {
      firstName: b.first_name,
      lastName: b.last_name,
      emailAddressText: b.email,
      birthDate: formatDate(b.date_of_birth),
      mobilePhone10digit: formatPhone(b.phone),
      ssn: b.ssn ? b.ssn.replace(/\D/g, '') : undefined,
      militaryServiceType: mapMilitary(b.military_status),
      employmentType: mapEmployment(b.employment_type),
      hasRealEstate: !b.first_time_homebuyer,
      annualIncome: calc.annualIncome || 0,
      totalLiability: calc.totalMonthlyDebts || 0,
      firstTimeHomeBuyer: b.first_time_homebuyer ? true : false,
      yearsSinceForeclosure: mapYears(b.foreclosure),
      yearsSinceBankruptcy: mapYears(b.bankruptcy),
      currentlyOwningAHome: !b.first_time_homebuyer,
      planningToSellItBeforeBuying: b.planning_to_sell_home ? true : false,
      noContactRequest: false,
      emailOptOut: false,
      smsOptOut: false,
      occupancy: mapOccupancy(b.current_housing),
      monthlyRentAmt: b.current_housing === 'Rent' && b.monthly_rent ? String(b.monthly_rent) : undefined,
      hasCoBorrower: b.has_coborrower ? true : false,
      currentResidence: (b.street_address || b.city) ? {
        lineText: b.street_address || undefined,
        city: b.city || undefined,
        state: mapState(b.state),
        postalCode: b.zip || undefined
      } : undefined
    }
  };

  // Add refinance fields
  if (b.loan_purpose === 'Refinance') {
    payload.refinanceType = mapRefiType(b.refinance_type);
    payload.cashoutPurpose = mapCashoutPurpose(b.cash_out_purpose);
    payload.currentInterestRateRefi = b.current_interest_rate || undefined;
  }

  // Add co-borrower if present
  if (b.has_coborrower && b.co_first_name && b.co_last_name) {
    payload.coBorrower = {
      firstName: b.co_first_name,
      lastName: b.co_last_name,
      emailAddressText: b.co_email || undefined,
      birthDate: formatDate(b.co_date_of_birth),
      cellPhone: formatPhone(b.co_phone),
      ssn: b.co_ssn ? b.co_ssn.replace(/\D/g, '') : undefined,
      militaryServiceType: mapMilitary(b.co_military_status)
    };
  }

  // Remove undefined values
  return JSON.parse(JSON.stringify(payload));
}

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
