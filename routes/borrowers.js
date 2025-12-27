const express = require('express');
const router = express.Router();
const db = require('../database');

// Update borrower data (auto-save from frontend)
router.post('/:id/save', (req, res) => {
  const database = db.getDb();
  const borrowerId = req.params.id;
  const data = req.body;

  // Build dynamic update query based on provided fields
  const allowedFields = [
    'first_name', 'last_name', 'phone', 'email',
    'street_address', 'city', 'state', 'zip',
    'date_of_birth', 'ssn', 'marital_status', 'dependents',
    'citizenship_status', 'first_time_homebuyer',
    'has_coborrower', 'co_first_name', 'co_last_name', 'co_phone', 'co_email',
    'co_street_address', 'co_city', 'co_state', 'co_zip',
    'co_date_of_birth', 'co_ssn', 'co_marital_status', 'co_dependents',
    'co_citizenship_status',
    'employers', 'other_income', 'co_employers', 'co_other_income',
    'assets', 'debts',
    'purchase_price', 'down_payment_amount', 'down_payment_percent',
    'property_type', 'occupancy', 'property_state', 'property_county',
    'property_taxes_annual', 'hoa_monthly', 'insurance_annual', 'interest_rate',
    'credit_score', 'co_credit_score', 'late_payments_12', 'late_payments_24',
    'bankruptcy', 'foreclosure', 'collections', 'collections_amount',
    'status'
  ];

  const updates = [];
  const values = [];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      // Stringify JSON fields
      if (['employers', 'other_income', 'co_employers', 'co_other_income', 'assets', 'debts'].includes(field)) {
        values.push(JSON.stringify(data[field]));
      } else {
        values.push(data[field]);
      }
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(borrowerId);

    const sql = `UPDATE borrowers SET ${updates.join(', ')} WHERE id = ?`;
    database.prepare(sql).run(...values);
  }

  // Return updated calculations
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(borrowerId);
  const calculations = calculateBorrowerMetrics(borrower);

  res.json({ success: true, calculations });
});

// Get borrower data
router.get('/:id', (req, res) => {
  const database = db.getDb();
  const borrower = database.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);

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

  res.json({ borrower, calculations });
});

// Delete borrower
router.delete('/:id', (req, res) => {
  const database = db.getDb();
  database.prepare('DELETE FROM borrowers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Calculate all borrower metrics
function calculateBorrowerMetrics(borrower) {
  // Parse JSON if needed
  const employers = typeof borrower.employers === 'string'
    ? JSON.parse(borrower.employers || '[]')
    : (borrower.employers || []);
  const otherIncome = typeof borrower.other_income === 'string'
    ? JSON.parse(borrower.other_income || '[]')
    : (borrower.other_income || []);
  const coEmployers = typeof borrower.co_employers === 'string'
    ? JSON.parse(borrower.co_employers || '[]')
    : (borrower.co_employers || []);
  const coOtherIncome = typeof borrower.co_other_income === 'string'
    ? JSON.parse(borrower.co_other_income || '[]')
    : (borrower.co_other_income || []);
  const assets = typeof borrower.assets === 'string'
    ? JSON.parse(borrower.assets || '[]')
    : (borrower.assets || []);
  const debts = typeof borrower.debts === 'string'
    ? JSON.parse(borrower.debts || '[]')
    : (borrower.debts || []);

  // Calculate monthly income from employers
  let monthlyEmploymentIncome = 0;
  for (const emp of employers) {
    if (emp.pay_type === 'salary') {
      monthlyEmploymentIncome += (parseFloat(emp.annual_salary) || 0) / 12;
    } else {
      monthlyEmploymentIncome += (parseFloat(emp.hourly_rate) || 0) * (parseFloat(emp.hours_per_week) || 0) * 4.333;
    }
    monthlyEmploymentIncome += parseFloat(emp.overtime_monthly) || 0;
    monthlyEmploymentIncome += parseFloat(emp.bonus_monthly) || 0;
    monthlyEmploymentIncome += parseFloat(emp.commission_monthly) || 0;
  }

  // Co-borrower employment income
  let coMonthlyEmploymentIncome = 0;
  if (borrower.has_coborrower) {
    for (const emp of coEmployers) {
      if (emp.pay_type === 'salary') {
        coMonthlyEmploymentIncome += (parseFloat(emp.annual_salary) || 0) / 12;
      } else {
        coMonthlyEmploymentIncome += (parseFloat(emp.hourly_rate) || 0) * (parseFloat(emp.hours_per_week) || 0) * 4.333;
      }
      coMonthlyEmploymentIncome += parseFloat(emp.overtime_monthly) || 0;
      coMonthlyEmploymentIncome += parseFloat(emp.bonus_monthly) || 0;
      coMonthlyEmploymentIncome += parseFloat(emp.commission_monthly) || 0;
    }
  }

  // Other income
  let monthlyOtherIncome = 0;
  for (const inc of otherIncome) {
    monthlyOtherIncome += parseFloat(inc.monthly_amount) || 0;
  }

  let coMonthlyOtherIncome = 0;
  if (borrower.has_coborrower) {
    for (const inc of coOtherIncome) {
      coMonthlyOtherIncome += parseFloat(inc.monthly_amount) || 0;
    }
  }

  const totalMonthlyIncome = monthlyEmploymentIncome + coMonthlyEmploymentIncome + monthlyOtherIncome + coMonthlyOtherIncome;
  const annualIncome = totalMonthlyIncome * 12;

  // Calculate assets
  let totalAssets = 0;
  let liquidAssets = 0;
  for (const asset of assets) {
    const balance = parseFloat(asset.balance) || 0;
    totalAssets += balance;
    if (!['401(k)/IRA'].includes(asset.type)) {
      liquidAssets += balance;
    }
  }

  // Calculate debts
  let totalMonthlyDebts = 0;
  for (const debt of debts) {
    totalMonthlyDebts += parseFloat(debt.monthly_payment) || 0;
  }

  // Property calculations
  const purchasePrice = parseFloat(borrower.purchase_price) || 0;
  const downPaymentAmount = parseFloat(borrower.down_payment_amount) || 0;
  const loanAmount = purchasePrice - downPaymentAmount;
  const ltv = purchasePrice > 0 ? (loanAmount / purchasePrice) * 100 : 0;

  // Calculate monthly PITI
  const interestRate = parseFloat(borrower.interest_rate) || 7.0;
  const monthlyRate = interestRate / 100 / 12;
  const numPayments = 360; // 30-year fixed

  let principalAndInterest = 0;
  if (loanAmount > 0 && monthlyRate > 0) {
    principalAndInterest = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
  }

  const monthlyTaxes = (parseFloat(borrower.property_taxes_annual) || 0) / 12;
  const monthlyInsurance = (parseFloat(borrower.insurance_annual) || 0) / 12;
  const monthlyHOA = parseFloat(borrower.hoa_monthly) || 0;

  const totalPITI = principalAndInterest + monthlyTaxes + monthlyInsurance + monthlyHOA;

  // DTI calculations
  const frontEndDTI = totalMonthlyIncome > 0 ? (totalPITI / totalMonthlyIncome) * 100 : 0;
  const backEndDTI = totalMonthlyIncome > 0 ? ((totalMonthlyDebts + totalPITI) / totalMonthlyIncome) * 100 : 0;
  const currentDTI = totalMonthlyIncome > 0 ? (totalMonthlyDebts / totalMonthlyIncome) * 100 : 0;

  // Max purchase power calculations
  const calculateMaxPurchase = (targetDTI) => {
    if (totalMonthlyIncome <= 0) return 0;
    const maxTotalPayment = (totalMonthlyIncome * targetDTI / 100) - totalMonthlyDebts;
    const maxPITI = maxTotalPayment;
    const maxPI = maxPITI - monthlyTaxes - monthlyInsurance - monthlyHOA;
    if (maxPI <= 0 || monthlyRate <= 0) return 0;
    const maxLoan = maxPI * (Math.pow(1 + monthlyRate, numPayments) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, numPayments));
    const downPaymentPercent = purchasePrice > 0 ? (downPaymentAmount / purchasePrice) : 0.03;
    return maxLoan / (1 - downPaymentPercent);
  };

  // Estimated cash to close
  const closingCosts = loanAmount * 0.03; // Estimate 3% closing costs
  const prepaidItems = (monthlyTaxes + monthlyInsurance) * 6; // 6 months escrow
  const cashToClose = downPaymentAmount + closingCosts + prepaidItems;

  return {
    // Income
    monthlyEmploymentIncome,
    coMonthlyEmploymentIncome,
    monthlyOtherIncome,
    coMonthlyOtherIncome,
    totalMonthlyIncome,
    annualIncome,

    // Assets
    totalAssets,
    liquidAssets,

    // Debts
    totalMonthlyDebts,
    currentDTI,

    // Property
    loanAmount,
    ltv,
    principalAndInterest,
    monthlyTaxes,
    monthlyInsurance,
    monthlyHOA,
    totalPITI,

    // DTI
    frontEndDTI,
    backEndDTI,

    // Max purchase
    maxPurchase43: calculateMaxPurchase(43),
    maxPurchase45: calculateMaxPurchase(45),
    maxPurchase50: calculateMaxPurchase(50),

    // Cash to close
    cashToClose
  };
}

module.exports = router;
module.exports.calculateBorrowerMetrics = calculateBorrowerMetrics;
