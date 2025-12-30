const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Determine database path
// Use RAILWAY_VOLUME_MOUNT_PATH if volume is attached, otherwise use local data dir
function getDbPath() {
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;

  if (volumePath) {
    // Railway volume is attached
    const dbDir = volumePath;
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    return path.join(dbDir, 'pathfinder.db');
  }

  // Local development or no volume attached - use app directory
  const localDir = path.join(__dirname, 'data');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  return path.join(localDir, 'pathfinder.db');
}

const dbPath = getDbPath();
let db;

function getDb() {
  if (!db) {
    console.log('Opening database at:', dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initialize() {
  const database = getDb();

  // Borrowers table
  database.exec(`
    CREATE TABLE IF NOT EXISTS borrowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'draft',

      -- Primary Borrower Info
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email TEXT,
      street_address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      date_of_birth TEXT,
      ssn TEXT,
      marital_status TEXT,
      dependents INTEGER DEFAULT 0,
      citizenship_status TEXT,
      first_time_homebuyer INTEGER DEFAULT 0,
      military_status TEXT DEFAULT 'None',
      employment_type TEXT,
      current_housing TEXT DEFAULT 'Rent',
      monthly_rent REAL,
      planning_to_sell_home INTEGER DEFAULT 0,

      -- Co-Borrower Info
      has_coborrower INTEGER DEFAULT 0,
      co_first_name TEXT,
      co_last_name TEXT,
      co_phone TEXT,
      co_email TEXT,
      co_street_address TEXT,
      co_city TEXT,
      co_state TEXT,
      co_zip TEXT,
      co_date_of_birth TEXT,
      co_ssn TEXT,
      co_marital_status TEXT,
      co_dependents INTEGER DEFAULT 0,
      co_citizenship_status TEXT,
      co_military_status TEXT DEFAULT 'None',
      co_employment_type TEXT,

      -- Income (JSON arrays for multiple employers/sources)
      employers JSON DEFAULT '[]',
      other_income JSON DEFAULT '[]',
      co_employers JSON DEFAULT '[]',
      co_other_income JSON DEFAULT '[]',

      -- Assets (JSON array)
      assets JSON DEFAULT '[]',

      -- Debts (JSON array)
      debts JSON DEFAULT '[]',

      -- Property Info
      loan_purpose TEXT DEFAULT 'Purchase',
      purchase_price REAL,
      down_payment_amount REAL,
      down_payment_percent REAL,
      property_type TEXT,
      occupancy TEXT,
      property_state TEXT DEFAULT 'Utah',
      property_county TEXT,
      property_taxes_annual REAL,
      hoa_monthly REAL,
      insurance_annual REAL,
      interest_rate REAL DEFAULT 7.0,
      subject_property_street TEXT,
      subject_property_city TEXT,
      subject_property_zip TEXT,
      home_buying_stage TEXT DEFAULT 'Just Getting Started',
      preferred_loan_type TEXT,

      -- Refinance Info
      refinance_type TEXT,
      property_value REAL,
      current_loan_balance REAL,
      current_interest_rate REAL,
      cash_out_amount REAL,
      cash_out_purpose TEXT,

      -- Credit Info
      credit_score INTEGER,
      co_credit_score INTEGER,
      late_payments_12 INTEGER DEFAULT 0,
      late_payments_24 INTEGER DEFAULT 0,
      bankruptcy TEXT DEFAULT 'Never',
      foreclosure TEXT DEFAULT 'Never',
      collections INTEGER DEFAULT 0,
      collections_amount REAL,

      -- AI Analysis Cache
      ai_analysis TEXT,
      ai_analysis_updated DATETIME
    )
  `);

  // Knowledge sources table
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT,
      content TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      auto_scrape INTEGER DEFAULT 0,
      scrape_frequency TEXT DEFAULT 'weekly'
    )
  `);

  // Chat history table
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      borrower_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE
    )
  `);

  // Received emails table
  database.exec(`
    CREATE TABLE IF NOT EXISTS received_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_address TEXT,
      subject TEXT,
      body TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed INTEGER DEFAULT 0
    )
  `);

  // Add new columns if they don't exist (migration for existing databases)
  const addColumnIfNotExists = (table, column, definition) => {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Added column ${column} to ${table}`);
    } catch (e) {
      // Column already exists, ignore
    }
  };

  // New borrower fields (added Dec 2025)
  addColumnIfNotExists('borrowers', 'military_status', "TEXT DEFAULT 'None'");
  addColumnIfNotExists('borrowers', 'employment_type', 'TEXT');
  addColumnIfNotExists('borrowers', 'current_housing', "TEXT DEFAULT 'Rent'");
  addColumnIfNotExists('borrowers', 'monthly_rent', 'REAL');
  addColumnIfNotExists('borrowers', 'planning_to_sell_home', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('borrowers', 'co_military_status', "TEXT DEFAULT 'None'");
  addColumnIfNotExists('borrowers', 'co_employment_type', 'TEXT');
  addColumnIfNotExists('borrowers', 'subject_property_street', 'TEXT');
  addColumnIfNotExists('borrowers', 'subject_property_city', 'TEXT');
  addColumnIfNotExists('borrowers', 'subject_property_zip', 'TEXT');
  addColumnIfNotExists('borrowers', 'home_buying_stage', "TEXT DEFAULT 'Just Getting Started'");
  addColumnIfNotExists('borrowers', 'preferred_loan_type', "TEXT");

  // Refinance fields (if not already added)
  addColumnIfNotExists('borrowers', 'loan_purpose', "TEXT DEFAULT 'Purchase'");
  addColumnIfNotExists('borrowers', 'refinance_type', 'TEXT');
  addColumnIfNotExists('borrowers', 'property_value', 'REAL');
  addColumnIfNotExists('borrowers', 'current_loan_balance', 'REAL');
  addColumnIfNotExists('borrowers', 'current_interest_rate', 'REAL');
  addColumnIfNotExists('borrowers', 'cash_out_amount', 'REAL');
  addColumnIfNotExists('borrowers', 'cash_out_purpose', 'TEXT');

  // Knowledge source fields for JS-required sites
  addColumnIfNotExists('knowledge_sources', 'requires_js', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('knowledge_sources', 'wait_selector', 'TEXT');

  console.log('Database initialized successfully');
  return database;
}

module.exports = {
  getDb,
  initialize
};
