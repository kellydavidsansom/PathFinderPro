// PathFinder Pro - Client-Side Application
// Loan Qualification Interview Tool

// Global state
let borrowerData = {};
let saveTimeout = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initAutoSave();
  initToggleButtons();
  initCoBorrowerToggle();
  initCurrentHousingToggle();
  initPayTypeToggles();
  initAssetListeners();
  initDebtListeners();
  initPropertyCalculations();
  initCreditFlags();
  initDateFormatting();
  loadBorrowerData();
});

// Date of Birth auto-formatting (04042000 -> 04/04/2000)
function initDateFormatting() {
  const dobFields = document.querySelectorAll('input[name="date_of_birth"], input[name="co_date_of_birth"]');

  dobFields.forEach(field => {
    field.addEventListener('blur', () => {
      const value = field.value.replace(/\D/g, ''); // Remove non-digits

      if (value.length === 8) {
        // Format as MM/DD/YYYY
        const formatted = value.slice(0, 2) + '/' + value.slice(2, 4) + '/' + value.slice(4, 8);
        field.value = formatted;
        // Trigger save
        scheduleAutoSave({ [field.name]: formatted });
      } else if (value.length === 6) {
        // Format as MM/DD/YY -> MM/DD/19YY or MM/DD/20YY
        const year = parseInt(value.slice(4, 6));
        const fullYear = year > 50 ? '19' + value.slice(4, 6) : '20' + value.slice(4, 6);
        const formatted = value.slice(0, 2) + '/' + value.slice(2, 4) + '/' + fullYear;
        field.value = formatted;
        scheduleAutoSave({ [field.name]: formatted });
      }
    });
  });
}

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const tabId = tab.dataset.tab + '-tab';
      document.getElementById(tabId).classList.add('active');

      // Recalculate when switching tabs
      updateAllCalculations();
    });
  });

  // Check for hash in URL and open corresponding tab
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    const targetTab = document.querySelector(`.tab[data-tab="${hash}"]`);
    if (targetTab) {
      targetTab.click();
    }
  }
}

// Auto-save functionality
function initAutoSave() {
  document.querySelectorAll('[data-autosave]').forEach(input => {
    input.addEventListener('change', () => {
      const field = input.name;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      scheduleAutoSave({ [field]: value });
    });

    input.addEventListener('input', () => {
      updateAllCalculations();
    });
  });
}

function scheduleAutoSave(data) {
  Object.assign(borrowerData, data);

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveBorrowerData(borrowerData);
    borrowerData = {};
  }, 500);
}

async function saveBorrowerData(data) {
  try {
    const response = await fetch(`/borrowers/${BORROWER_ID}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.calculations) {
      updateCalculationDisplay(result.calculations);
    }

    // Update header name if changed
    if (data.first_name || data.last_name) {
      const firstName = document.querySelector('[name="first_name"]').value || 'New';
      const lastName = document.querySelector('[name="last_name"]').value || 'Borrower';
      document.getElementById('headerBorrowerName').textContent = `${firstName} ${lastName}`;
    }
  } catch (error) {
    console.error('Auto-save error:', error);
  }
}

async function loadBorrowerData() {
  try {
    const response = await fetch(`/borrowers/${BORROWER_ID}`);
    const { borrower, calculations } = await response.json();
    updateCalculationDisplay(calculations);
  } catch (error) {
    console.error('Load error:', error);
  }
}

// Toggle Buttons
function initToggleButtons() {
  document.querySelectorAll('.toggle-btn[data-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const value = btn.dataset.value;

      // Update UI
      const group = btn.parentElement;
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Save - convert to int for boolean fields
      const saveValue = ['has_coborrower', 'collections', 'late_payments_12', 'late_payments_24', 'first_time_homebuyer'].includes(field)
        ? parseInt(value)
        : value;
      scheduleAutoSave({ [field]: saveValue });

      // Handle special cases
      if (field === 'has_coborrower') {
        toggleCoBorrowerFields(parseInt(value));
      }
      if (field === 'collections') {
        toggleCollectionsAmount(parseInt(value));
      }
      if (field === 'loan_purpose') {
        toggleLoanPurposeFields(value);
      }

      updateCreditFlags();
      updatePropertyCalculations();
    });
  });
}

// Loan Purpose Toggle (Purchase vs Refinance)
function toggleLoanPurposeFields(purpose) {
  const purchaseFields = document.getElementById('purchaseFields');
  const refinanceFields = document.getElementById('refinanceFields');

  if (purchaseFields) purchaseFields.classList.toggle('hidden', purpose === 'Refinance');
  if (refinanceFields) refinanceFields.classList.toggle('hidden', purpose !== 'Refinance');
}

// Co-Borrower Toggle
function initCoBorrowerToggle() {
  // Show/hide co-borrower sections based on initial state
  const hasCoBorrower = document.querySelector('[data-field="has_coborrower"].active')?.dataset.value === '1';
  toggleCoBorrowerFields(hasCoBorrower ? 1 : 0);
}

function toggleCoBorrowerFields(show) {
  const coBorrowerFields = document.getElementById('coBorrowerFields');
  const coIncomeSection = document.getElementById('coIncomeSection');
  const coCreditScoreGroup = document.getElementById('coCreditScoreGroup');
  const calcCoRows = document.querySelectorAll('#calcCoEmploymentRow, #calcCoOtherRow');

  if (coBorrowerFields) coBorrowerFields.classList.toggle('hidden', !show);
  if (coIncomeSection) coIncomeSection.classList.toggle('hidden', !show);
  if (coCreditScoreGroup) coCreditScoreGroup.classList.toggle('hidden', !show);
  calcCoRows.forEach(row => row.style.display = show ? 'flex' : 'none');
}

function toggleCollectionsAmount(show) {
  const group = document.getElementById('collectionsAmountGroup');
  if (group) group.classList.toggle('hidden', !show);
}

// Current Housing Toggle (Own/Rent/Living Rent Free)
function initCurrentHousingToggle() {
  const housingSelect = document.getElementById('currentHousing');
  if (housingSelect) {
    housingSelect.addEventListener('change', () => {
      toggleCurrentHousingFields(housingSelect.value);
    });
    // Initialize on load
    toggleCurrentHousingFields(housingSelect.value);
  }
}

function toggleCurrentHousingFields(housing) {
  const monthlyRentGroup = document.getElementById('monthlyRentGroup');
  const planningToSellGroup = document.getElementById('planningToSellGroup');

  if (monthlyRentGroup) {
    monthlyRentGroup.classList.toggle('hidden', housing !== 'Rent');
  }
  if (planningToSellGroup) {
    planningToSellGroup.classList.toggle('hidden', housing !== 'Own');
  }
}

// Pay Type Toggles (Salary/Hourly)
function initPayTypeToggles() {
  document.querySelectorAll('.employer-block').forEach(block => {
    setupPayTypeToggle(block);
  });
}

function setupPayTypeToggle(block) {
  const btns = block.querySelectorAll('.pay-type-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const isSalary = btn.dataset.value === 'salary';
      block.querySelector('.salary-fields').classList.toggle('hidden', !isSalary);
      block.querySelector('.hourly-fields').classList.toggle('hidden', isSalary);

      updateEmployerData();
    });
  });

  // Also listen for input changes
  block.querySelectorAll('.emp-field').forEach(input => {
    input.addEventListener('input', updateEmployerData);
    input.addEventListener('change', updateEmployerData);
  });
}

// Employer Management
function addEmployer(prefix) {
  const container = prefix === 'primary' ? document.getElementById('primaryEmployers') : document.getElementById('coEmployers');
  const index = container.querySelectorAll('.employer-block').length;

  const html = createEmployerBlockHTML(index, prefix, {});
  container.insertAdjacentHTML('beforeend', html);

  const newBlock = container.lastElementChild;
  setupPayTypeToggle(newBlock);
  updateEmployerData();
}

function removeEmployer(prefix, index) {
  const container = prefix === 'primary' ? document.getElementById('primaryEmployers') : document.getElementById('coEmployers');
  const blocks = container.querySelectorAll('.employer-block');
  if (blocks[index]) {
    blocks[index].remove();
    reindexBlocks(container, 'employer-block', prefix);
    updateEmployerData();
  }
}

function createEmployerBlockHTML(index, prefix, emp = {}) {
  return `
    <div class="employer-block" data-index="${index}" data-prefix="${prefix}">
      <div class="block-header">
        <h4>Employer ${index + 1}</h4>
        <div class="block-header-actions">
          <label class="previous-employer-label">
            <input type="checkbox" class="emp-field emp-previous" data-field="is_previous" ${emp.is_previous ? 'checked' : ''}>
            <span>Previous Employer</span>
          </label>
          <button class="btn btn-sm btn-danger" onclick="removeEmployer('${prefix}', ${index})">Remove</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Employer Name</label>
          <input type="text" class="emp-field" data-field="employer_name" value="${emp.employer_name || ''}">
        </div>
        <div class="form-group">
          <label>Position/Title</label>
          <input type="text" class="emp-field" data-field="position" value="${emp.position || ''}">
        </div>
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" class="emp-field" data-field="start_date" value="${emp.start_date || ''}">
        </div>
        <div class="form-group">
          <label>Time at Job</label>
          <div class="time-at-job-inputs">
            <input type="number" class="emp-field emp-years" data-field="years_at_job" value="${emp.years_at_job || ''}" placeholder="Years" min="0">
            <span>yrs</span>
            <input type="number" class="emp-field emp-months" data-field="months_at_job" value="${emp.months_at_job || ''}" placeholder="Months" min="0" max="11">
            <span>mos</span>
          </div>
        </div>
        <div class="form-group">
          <label>Employment Type</label>
          <select class="emp-field" data-field="employment_type">
            <option value="W-2" ${emp.employment_type === 'W-2' ? 'selected' : ''}>W-2</option>
            <option value="Self-Employed" ${emp.employment_type === 'Self-Employed' ? 'selected' : ''}>Self-Employed</option>
            <option value="1099" ${emp.employment_type === '1099' ? 'selected' : ''}>1099</option>
          </select>
        </div>
        <div class="form-group">
          <label>Pay Type</label>
          <div class="toggle-group">
            <button type="button" class="toggle-btn pay-type-btn active" data-value="salary">Salary</button>
            <button type="button" class="toggle-btn pay-type-btn" data-value="hourly">Hourly</button>
          </div>
        </div>
      </div>
      <div class="salary-fields">
        <div class="form-grid">
          <div class="form-group">
            <label>Salary</label>
            <div class="salary-input-group">
              <input type="number" class="emp-field emp-salary-amount" data-field="salary_amount" value="${emp.salary_amount || emp.annual_salary || ''}" placeholder="$0">
              <select class="emp-field emp-salary-frequency" data-field="salary_frequency">
                <option value="annual" ${(!emp.salary_frequency || emp.salary_frequency === 'annual') ? 'selected' : ''}>Annual</option>
                <option value="monthly" ${emp.salary_frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                <option value="weekly" ${emp.salary_frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Monthly (calculated)</label>
            <input type="text" class="emp-monthly-calc" readonly value="">
          </div>
        </div>
      </div>
      <div class="hourly-fields hidden">
        <div class="form-grid">
          <div class="form-group">
            <label>Hourly Rate</label>
            <input type="number" class="emp-field" data-field="hourly_rate" value="${emp.hourly_rate || ''}" step="0.01" placeholder="$0">
          </div>
          <div class="form-group">
            <label>Avg Hours/Week</label>
            <input type="number" class="emp-field" data-field="hours_per_week" value="${emp.hours_per_week || ''}" placeholder="40">
          </div>
          <div class="form-group">
            <label>Monthly (calculated)</label>
            <input type="text" class="emp-monthly-calc" readonly value="">
          </div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Overtime (monthly avg)</label>
          <input type="number" class="emp-field" data-field="overtime_monthly" value="${emp.overtime_monthly || ''}" placeholder="$0">
        </div>
        <div class="form-group">
          <label>Bonus (monthly avg)</label>
          <input type="number" class="emp-field" data-field="bonus_monthly" value="${emp.bonus_monthly || ''}" placeholder="$0">
        </div>
        <div class="form-group">
          <label>Commission (monthly avg)</label>
          <input type="number" class="emp-field" data-field="commission_monthly" value="${emp.commission_monthly || ''}" placeholder="$0">
        </div>
      </div>
    </div>
  `;
}

function updateEmployerData() {
  const primaryEmployers = collectEmployerData('primaryEmployers');
  const coEmployers = collectEmployerData('coEmployers');

  scheduleAutoSave({
    employers: primaryEmployers,
    co_employers: coEmployers
  });

  updateIncomeCalculations();
}

function collectEmployerData(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const employers = [];
  container.querySelectorAll('.employer-block').forEach(block => {
    const emp = {};
    block.querySelectorAll('.emp-field').forEach(input => {
      // Handle checkbox values
      if (input.type === 'checkbox') {
        emp[input.dataset.field] = input.checked;
      } else {
        emp[input.dataset.field] = input.value;
      }
    });

    // Get pay type
    const activePayType = block.querySelector('.pay-type-btn.active');
    emp.pay_type = activePayType ? activePayType.dataset.value : 'salary';

    // Calculate annual_salary from salary_amount and frequency for backward compatibility
    if (emp.pay_type === 'salary' && emp.salary_amount) {
      const amount = parseFloat(emp.salary_amount) || 0;
      const frequency = emp.salary_frequency || 'annual';
      if (frequency === 'annual') {
        emp.annual_salary = amount;
      } else if (frequency === 'monthly') {
        emp.annual_salary = amount * 12;
      } else if (frequency === 'weekly') {
        emp.annual_salary = amount * 52;
      }
    }

    employers.push(emp);
  });

  return employers;
}

// Other Income Management
function addOtherIncome(prefix) {
  const container = prefix === 'primary' ? document.getElementById('primaryOtherIncome') : document.getElementById('coOtherIncome');
  const index = container.querySelectorAll('.other-income-block').length;

  const html = createOtherIncomeBlockHTML(index, prefix, {});
  container.insertAdjacentHTML('beforeend', html);

  const newBlock = container.lastElementChild;
  setupOtherIncomeListeners(newBlock);
  updateOtherIncomeData();
}

function removeOtherIncome(prefix, index) {
  const container = prefix === 'primary' ? document.getElementById('primaryOtherIncome') : document.getElementById('coOtherIncome');
  const blocks = container.querySelectorAll('.other-income-block');
  if (blocks[index]) {
    blocks[index].remove();
    reindexBlocks(container, 'other-income-block', prefix);
    updateOtherIncomeData();
  }
}

function createOtherIncomeBlockHTML(index, prefix, inc = {}) {
  return `
    <div class="other-income-block" data-index="${index}" data-prefix="${prefix}">
      <div class="block-header">
        <h4>Income Source ${index + 1}</h4>
        <button class="btn btn-sm btn-danger" onclick="removeOtherIncome('${prefix}', ${index})">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Type</label>
          <select class="income-field" data-field="type">
            <option value="Self-Employment/Side Hustle">Self-Employment/Side Hustle</option>
            <option value="Rental Income">Rental Income</option>
            <option value="Retirement/Pension">Retirement/Pension</option>
            <option value="Social Security">Social Security</option>
            <option value="Child Support/Alimony">Child Support/Alimony</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group business-name-group hidden">
          <label>Business Name</label>
          <input type="text" class="income-field" data-field="business_name" value="">
        </div>
        <div class="form-group">
          <label>Monthly Amount</label>
          <input type="number" class="income-field" data-field="monthly_amount" value="" placeholder="$0">
        </div>
      </div>
    </div>
  `;
}

function setupOtherIncomeListeners(block) {
  const typeSelect = block.querySelector('[data-field="type"]');
  const businessNameGroup = block.querySelector('.business-name-group');

  typeSelect.addEventListener('change', () => {
    businessNameGroup.classList.toggle('hidden', typeSelect.value !== 'Self-Employment/Side Hustle');
    updateOtherIncomeData();
  });

  block.querySelectorAll('.income-field').forEach(input => {
    input.addEventListener('input', updateOtherIncomeData);
    input.addEventListener('change', updateOtherIncomeData);
  });
}

function updateOtherIncomeData() {
  const primaryOther = collectOtherIncomeData('primaryOtherIncome');
  const coOther = collectOtherIncomeData('coOtherIncome');

  scheduleAutoSave({
    other_income: primaryOther,
    co_other_income: coOther
  });

  updateIncomeCalculations();
}

function collectOtherIncomeData(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const incomes = [];
  container.querySelectorAll('.other-income-block').forEach(block => {
    const inc = {};
    block.querySelectorAll('.income-field').forEach(input => {
      inc[input.dataset.field] = input.value;
    });
    incomes.push(inc);
  });

  return incomes;
}

// Initialize existing other income blocks
document.querySelectorAll('.other-income-block').forEach(block => {
  setupOtherIncomeListeners(block);
});

// Assets Management
function initAssetListeners() {
  document.querySelectorAll('#assetsTable input, #assetsTable select').forEach(input => {
    input.addEventListener('change', updateAssetData);
    input.addEventListener('input', updateAssetData);
  });
}

function addAsset() {
  const tbody = document.querySelector('#assetsTable tbody');
  const index = tbody.querySelectorAll('tr').length;

  const html = `
    <tr data-index="${index}">
      <td>
        <select class="asset-type" data-index="${index}">
          <option value="Checking">Checking</option>
          <option value="Savings">Savings</option>
          <option value="401(k)/IRA">401(k)/IRA</option>
          <option value="Stocks/Investments">Stocks/Investments</option>
          <option value="Gift Funds">Gift Funds</option>
          <option value="Other">Other</option>
        </select>
      </td>
      <td><input type="text" class="asset-institution" data-index="${index}" placeholder="Institution"></td>
      <td><input type="number" class="asset-balance" data-index="${index}" placeholder="$0"></td>
      <td><button class="btn btn-sm btn-danger" onclick="removeAsset(${index})">Remove</button></td>
    </tr>
  `;

  tbody.insertAdjacentHTML('beforeend', html);

  // Add listeners to new row
  const newRow = tbody.lastElementChild;
  newRow.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('change', updateAssetData);
    input.addEventListener('input', updateAssetData);
  });
}

function removeAsset(index) {
  const tbody = document.querySelector('#assetsTable tbody');
  const rows = tbody.querySelectorAll('tr');
  if (rows[index]) {
    rows[index].remove();
    reindexTableRows(tbody);
    updateAssetData();
  }
}

function updateAssetData() {
  const assets = [];
  document.querySelectorAll('#assetsTable tbody tr').forEach(row => {
    assets.push({
      type: row.querySelector('.asset-type')?.value || '',
      institution: row.querySelector('.asset-institution')?.value || '',
      balance: parseFloat(row.querySelector('.asset-balance')?.value) || 0
    });
  });

  scheduleAutoSave({ assets });
  updateAssetCalculations(assets);
}

function updateAssetCalculations(assets) {
  let total = 0;
  let liquid = 0;

  assets.forEach(a => {
    const balance = parseFloat(a.balance) || 0;
    total += balance;
    if (a.type !== '401(k)/IRA') {
      liquid += balance;
    }
  });

  document.getElementById('calcTotalAssets').textContent = formatCurrency(total);
  document.getElementById('calcLiquidAssets').textContent = formatCurrency(liquid);
}

// Debts Management
function initDebtListeners() {
  document.querySelectorAll('#debtsTable input, #debtsTable select').forEach(input => {
    input.addEventListener('change', updateDebtData);
    input.addEventListener('input', updateDebtData);
  });
}

function addDebt() {
  const tbody = document.querySelector('#debtsTable tbody');
  const index = tbody.querySelectorAll('tr').length;

  const html = `
    <tr data-index="${index}">
      <td>
        <select class="debt-type" data-index="${index}">
          <option value="Current Rent/Mortgage">Current Rent/Mortgage</option>
          <option value="Auto Loan">Auto Loan</option>
          <option value="Student Loans">Student Loans</option>
          <option value="Credit Card">Credit Card</option>
          <option value="Personal Loan">Personal Loan</option>
          <option value="Child Support/Alimony">Child Support/Alimony</option>
          <option value="Other">Other</option>
        </select>
      </td>
      <td><input type="text" class="debt-creditor" data-index="${index}"></td>
      <td><input type="number" class="debt-balance" data-index="${index}" placeholder="$0"></td>
      <td><input type="number" class="debt-payment" data-index="${index}" placeholder="$0"></td>
      <td><button class="btn btn-sm btn-danger" onclick="removeDebt(${index})">Remove</button></td>
    </tr>
  `;

  tbody.insertAdjacentHTML('beforeend', html);

  const newRow = tbody.lastElementChild;
  newRow.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('change', updateDebtData);
    input.addEventListener('input', updateDebtData);
  });
}

function removeDebt(index) {
  const tbody = document.querySelector('#debtsTable tbody');
  const rows = tbody.querySelectorAll('tr');
  if (rows[index]) {
    rows[index].remove();
    reindexTableRows(tbody);
    updateDebtData();
  }
}

function updateDebtData() {
  const debts = [];
  document.querySelectorAll('#debtsTable tbody tr').forEach(row => {
    debts.push({
      type: row.querySelector('.debt-type')?.value || '',
      creditor: row.querySelector('.debt-creditor')?.value || '',
      balance: parseFloat(row.querySelector('.debt-balance')?.value) || 0,
      monthly_payment: parseFloat(row.querySelector('.debt-payment')?.value) || 0
    });
  });

  scheduleAutoSave({ debts });
  updateDebtCalculations(debts);
}

function updateDebtCalculations(debts) {
  let totalPayments = 0;
  debts.forEach(d => {
    totalPayments += parseFloat(d.monthly_payment) || 0;
  });

  document.getElementById('calcTotalDebts').textContent = formatCurrency(totalPayments);

  // Calculate current DTI
  const monthlyIncome = getMonthlyIncome();
  const dti = monthlyIncome > 0 ? (totalPayments / monthlyIncome) * 100 : 0;
  document.getElementById('calcCurrentDTI').textContent = dti.toFixed(1) + '%';
}

// Property Calculations
function initPropertyCalculations() {
  const priceInput = document.getElementById('purchasePrice');
  const dpAmountInput = document.getElementById('downPaymentAmount');
  const dpPercentInput = document.getElementById('downPaymentPercent');

  if (priceInput) {
    priceInput.addEventListener('input', () => {
      updatePropertyCalculations();
    });
  }

  if (dpAmountInput) {
    dpAmountInput.addEventListener('input', () => {
      const price = parseFloat(priceInput?.value) || 0;
      const amount = parseFloat(dpAmountInput.value) || 0;
      const percent = price > 0 ? ((amount / price) * 100) : 0;
      if (price > 0) {
        dpPercentInput.value = percent.toFixed(1);
      }
      // Save both amount and calculated percent
      scheduleAutoSave({
        down_payment_amount: amount,
        down_payment_percent: percent
      });
      updatePropertyCalculations();
    });
  }

  if (dpPercentInput) {
    dpPercentInput.addEventListener('input', () => {
      const price = parseFloat(priceInput?.value) || 0;
      const percent = parseFloat(dpPercentInput.value) || 0;
      const amount = Math.round(price * (percent / 100));
      dpAmountInput.value = amount;
      // Manually trigger save since programmatic value change doesn't fire change event
      scheduleAutoSave({
        down_payment_amount: amount,
        down_payment_percent: percent
      });
      updatePropertyCalculations();
    });
  }

  // Listen to other property inputs (including refinance fields)
  document.querySelectorAll('#property-tab [data-autosave]').forEach(input => {
    input.addEventListener('input', updatePropertyCalculations);
  });

  // Initialize loan purpose toggle state
  initLoanPurposeToggle();

  // Run initial calculation on page load
  setTimeout(() => updatePropertyCalculations(), 100);
}

// Initialize loan purpose toggle on page load
function initLoanPurposeToggle() {
  const activePurpose = document.querySelector('[data-field="loan_purpose"].active')?.dataset.value || 'Purchase';
  toggleLoanPurposeFields(activePurpose);
}

function updatePropertyCalculations() {
  const loanPurpose = document.querySelector('[data-field="loan_purpose"].active')?.dataset.value || 'Purchase';
  const rate = parseFloat(document.querySelector('[name="interest_rate"]')?.value) || 7.0;
  const taxesAnnual = parseFloat(document.querySelector('[name="property_taxes_annual"]')?.value) || 0;
  const insuranceAnnual = parseFloat(document.querySelector('[name="insurance_annual"]')?.value) || 0;
  const hoaMonthly = parseFloat(document.querySelector('[name="hoa_monthly"]')?.value) || 0;

  let loanAmount = 0;
  let ltv = 0;
  let propertyValue = 0;

  if (loanPurpose === 'Refinance') {
    // Refinance calculations
    propertyValue = parseFloat(document.querySelector('[name="property_value"]')?.value) || 0;
    const currentLoanBalance = parseFloat(document.querySelector('[name="current_loan_balance"]')?.value) || 0;
    const cashOutAmount = parseFloat(document.querySelector('[name="cash_out_amount"]')?.value) || 0;
    loanAmount = currentLoanBalance + cashOutAmount;
    ltv = propertyValue > 0 ? (loanAmount / propertyValue) * 100 : 0;
  } else {
    // Purchase calculations
    const price = parseFloat(document.querySelector('[name="purchase_price"]')?.value) || 0;
    const downPayment = parseFloat(document.querySelector('[name="down_payment_amount"]')?.value) || 0;
    propertyValue = price;
    loanAmount = Math.max(0, price - downPayment); // Prevent negative loan amounts
    ltv = price > 0 ? (loanAmount / price) * 100 : 0;
  }

  // Calculate P&I
  const monthlyRate = rate / 100 / 12;
  const numPayments = 360;
  let pi = 0;
  if (loanAmount > 0 && monthlyRate > 0) {
    pi = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
  }

  const monthlyTaxes = taxesAnnual / 12;
  const monthlyInsurance = insuranceAnnual / 12;
  const totalPITI = pi + monthlyTaxes + monthlyInsurance + hoaMonthly;

  // Update display
  document.getElementById('calcLoanAmount').textContent = formatCurrency(loanAmount);
  document.getElementById('calcLTV').textContent = ltv.toFixed(1) + '%';
  document.getElementById('calcPI').textContent = formatCurrency(pi);
  document.getElementById('calcTaxes').textContent = formatCurrency(monthlyTaxes);
  document.getElementById('calcInsurance').textContent = formatCurrency(monthlyInsurance);
  document.getElementById('calcHOA').textContent = formatCurrency(hoaMonthly);
  document.getElementById('calcPITI').textContent = formatCurrency(totalPITI);

  updateAllCalculations();
}

// Credit Flags
function initCreditFlags() {
  document.querySelectorAll('[name="bankruptcy"], [name="foreclosure"]').forEach(select => {
    select.addEventListener('change', updateCreditFlags);
  });
  updateCreditFlags();
}

function updateCreditFlags() {
  // Late payments
  const late12 = document.querySelector('[data-field="late_payments_12"].active')?.dataset.value === '1';
  const late24 = document.querySelector('[data-field="late_payments_24"].active')?.dataset.value === '1';
  setFlag('flag12mo', late12 ? 'red' : 'green');
  setFlag('flag24mo', late24 ? 'yellow' : 'green');

  // Bankruptcy
  const bankruptcy = document.querySelector('[name="bankruptcy"]')?.value;
  if (bankruptcy === 'Within 2 years') setFlag('flagBankruptcy', 'red');
  else if (bankruptcy === '2+ years ago') setFlag('flagBankruptcy', 'yellow');
  else setFlag('flagBankruptcy', 'green');

  // Foreclosure
  const foreclosure = document.querySelector('[name="foreclosure"]')?.value;
  if (foreclosure === 'Within 3 years') setFlag('flagForeclosure', 'red');
  else if (foreclosure === '3+ years ago') setFlag('flagForeclosure', 'yellow');
  else setFlag('flagForeclosure', 'green');

  // Collections
  const collections = document.querySelector('[data-field="collections"].active')?.dataset.value === '1';
  setFlag('flagCollections', collections ? 'yellow' : 'green');
}

function setFlag(id, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (color === 'green') el.textContent = '🟢';
  else if (color === 'yellow') el.textContent = '🟡';
  else el.textContent = '🔴';
}

// Income Calculations
function updateIncomeCalculations() {
  const primaryEmployers = collectEmployerData('primaryEmployers');
  const coEmployers = collectEmployerData('coEmployers');
  const primaryOther = collectOtherIncomeData('primaryOtherIncome');
  const coOther = collectOtherIncomeData('coOtherIncome');

  let primaryEmpIncome = 0;
  primaryEmployers.forEach(emp => {
    // Only include current employers (not previous) in the calculator
    if (!emp.is_previous) {
      primaryEmpIncome += calculateEmployerIncome(emp);
    }
  });

  let coEmpIncome = 0;
  coEmployers.forEach(emp => {
    // Only include current employers (not previous) in the calculator
    if (!emp.is_previous) {
      coEmpIncome += calculateEmployerIncome(emp);
    }
  });

  let primaryOtherIncome = 0;
  primaryOther.forEach(inc => {
    primaryOtherIncome += parseFloat(inc.monthly_amount) || 0;
  });

  let coOtherIncome = 0;
  coOther.forEach(inc => {
    coOtherIncome += parseFloat(inc.monthly_amount) || 0;
  });

  const totalMonthly = primaryEmpIncome + coEmpIncome + primaryOtherIncome + coOtherIncome;

  document.getElementById('calcPrimaryEmployment').textContent = formatCurrency(primaryEmpIncome);
  document.getElementById('calcPrimaryOther').textContent = formatCurrency(primaryOtherIncome);
  document.getElementById('calcCoEmployment').textContent = formatCurrency(coEmpIncome);
  document.getElementById('calcCoOther').textContent = formatCurrency(coOtherIncome);
  document.getElementById('calcTotalMonthly').textContent = formatCurrency(totalMonthly);
  document.getElementById('calcAnnualGross').textContent = formatCurrency(totalMonthly * 12);

  // Update monthly calculations in employer blocks
  updateEmployerMonthlyCalcs();

  updateAllCalculations();
}

function calculateEmployerIncome(emp) {
  let monthly = 0;
  if (emp.pay_type === 'salary') {
    monthly = (parseFloat(emp.annual_salary) || 0) / 12;
  } else {
    monthly = (parseFloat(emp.hourly_rate) || 0) * (parseFloat(emp.hours_per_week) || 0) * 4.333;
  }
  monthly += parseFloat(emp.overtime_monthly) || 0;
  monthly += parseFloat(emp.bonus_monthly) || 0;
  monthly += parseFloat(emp.commission_monthly) || 0;
  return monthly;
}

function updateEmployerMonthlyCalcs() {
  document.querySelectorAll('.employer-block').forEach(block => {
    const isSalary = block.querySelector('.pay-type-btn.active')?.dataset.value === 'salary';
    const calcField = block.querySelector('.emp-monthly-calc');

    if (isSalary) {
      const amount = parseFloat(block.querySelector('[data-field="salary_amount"]')?.value) || 0;
      const frequency = block.querySelector('[data-field="salary_frequency"]')?.value || 'annual';

      let monthly = 0;
      if (frequency === 'annual') {
        monthly = amount / 12;
      } else if (frequency === 'monthly') {
        monthly = amount;
      } else if (frequency === 'weekly') {
        monthly = amount * 52 / 12;
      }

      if (calcField) calcField.value = formatCurrency(monthly);
    } else {
      const hourly = parseFloat(block.querySelector('[data-field="hourly_rate"]')?.value) || 0;
      const hours = parseFloat(block.querySelector('[data-field="hours_per_week"]')?.value) || 0;
      if (calcField) calcField.value = formatCurrency(hourly * hours * 4.333);
    }
  });
}

// Get total monthly income (excludes previous employers)
function getMonthlyIncome() {
  const primaryEmployers = collectEmployerData('primaryEmployers');
  const coEmployers = collectEmployerData('coEmployers');
  const primaryOther = collectOtherIncomeData('primaryOtherIncome');
  const coOther = collectOtherIncomeData('coOtherIncome');

  let total = 0;
  primaryEmployers.forEach(emp => {
    if (!emp.is_previous) {
      total += calculateEmployerIncome(emp);
    }
  });
  coEmployers.forEach(emp => {
    if (!emp.is_previous) {
      total += calculateEmployerIncome(emp);
    }
  });
  primaryOther.forEach(inc => total += parseFloat(inc.monthly_amount) || 0);
  coOther.forEach(inc => total += parseFloat(inc.monthly_amount) || 0);

  return total;
}

// Get total monthly debts
function getMonthlyDebts() {
  let total = 0;
  document.querySelectorAll('#debtsTable tbody tr').forEach(row => {
    total += parseFloat(row.querySelector('.debt-payment')?.value) || 0;
  });
  return total;
}

// Update all calculations including summary
function updateAllCalculations() {
  const monthlyIncome = getMonthlyIncome();
  const monthlyDebts = getMonthlyDebts();

  // Get PITI
  const pitiText = document.getElementById('calcPITI')?.textContent || '$0';
  const piti = parseCurrency(pitiText);

  // DTI calculations
  const frontDTI = monthlyIncome > 0 ? (piti / monthlyIncome) * 100 : 0;
  const backDTI = monthlyIncome > 0 ? ((monthlyDebts + piti) / monthlyIncome) * 100 : 0;

  // Get other values
  const loanAmountText = document.getElementById('calcLoanAmount')?.textContent || '$0';
  const loanAmount = parseCurrency(loanAmountText);
  const ltvText = document.getElementById('calcLTV')?.textContent || '0%';

  const totalAssetsText = document.getElementById('calcTotalAssets')?.textContent || '$0';
  const totalAssets = parseCurrency(totalAssetsText);

  // Cash to close estimate
  const downPayment = parseFloat(document.querySelector('[name="down_payment_amount"]')?.value) || 0;
  const closingCosts = loanAmount * 0.03;
  const cashToClose = downPayment + closingCosts;

  // Max purchase power (returns {price, piti})
  const power43 = calculateMaxPurchase(monthlyIncome, monthlyDebts, 43);
  const power45 = calculateMaxPurchase(monthlyIncome, monthlyDebts, 45);
  const power50 = calculateMaxPurchase(monthlyIncome, monthlyDebts, 50);

  // Update summary tab
  const summaryMonthlyIncome = document.getElementById('summaryMonthlyIncome');
  const summaryMonthlyDebts = document.getElementById('summaryMonthlyDebts');
  const summaryPITI = document.getElementById('summaryPITI');
  const summaryFrontDTI = document.getElementById('summaryFrontDTI');
  const summaryBackDTI = document.getElementById('summaryBackDTI');
  const summaryLoanAmount = document.getElementById('summaryLoanAmount');
  const summaryLTV = document.getElementById('summaryLTV');
  const summaryAssets = document.getElementById('summaryAssets');
  const summaryCashToClose = document.getElementById('summaryCashToClose');
  const summaryCreditScore = document.getElementById('summaryCreditScore');
  const max43 = document.getElementById('maxPurchase43');
  const max45 = document.getElementById('maxPurchase45');
  const max50 = document.getElementById('maxPurchase50');
  const piti43 = document.getElementById('piti43');
  const piti45 = document.getElementById('piti45');
  const piti50 = document.getElementById('piti50');

  if (summaryMonthlyIncome) summaryMonthlyIncome.textContent = formatCurrency(monthlyIncome);
  if (summaryMonthlyDebts) summaryMonthlyDebts.textContent = formatCurrency(monthlyDebts);
  if (summaryPITI) summaryPITI.textContent = formatCurrency(piti);
  if (summaryFrontDTI) summaryFrontDTI.textContent = frontDTI.toFixed(1) + '%';
  if (summaryBackDTI) summaryBackDTI.textContent = backDTI.toFixed(1) + '%';
  if (summaryLoanAmount) summaryLoanAmount.textContent = formatCurrency(loanAmount);
  if (summaryLTV) summaryLTV.textContent = ltvText;
  if (summaryAssets) summaryAssets.textContent = formatCurrency(totalAssets);
  if (summaryCashToClose) summaryCashToClose.textContent = formatCurrency(cashToClose);

  const creditScore = document.querySelector('[name="credit_score"]')?.value;
  if (summaryCreditScore) summaryCreditScore.textContent = creditScore || '-';

  if (max43) max43.textContent = formatCurrency(power43.price);
  if (max45) max45.textContent = formatCurrency(power45.price);
  if (max50) max50.textContent = formatCurrency(power50.price);
  if (piti43) piti43.textContent = 'PITI: ' + formatCurrency(power43.piti) + '/mo';
  if (piti45) piti45.textContent = 'PITI: ' + formatCurrency(power45.piti) + '/mo';
  if (piti50) piti50.textContent = 'PITI: ' + formatCurrency(power50.piti) + '/mo';
}

function calculateMaxPurchase(monthlyIncome, monthlyDebts, targetDTI) {
  if (monthlyIncome <= 0) return { price: 0, piti: 0 };

  const rate = parseFloat(document.querySelector('[name="interest_rate"]')?.value) || 7.0;
  const taxesAnnual = parseFloat(document.querySelector('[name="property_taxes_annual"]')?.value) || 0;
  const insuranceAnnual = parseFloat(document.querySelector('[name="insurance_annual"]')?.value) || 0;
  const hoaMonthly = parseFloat(document.querySelector('[name="hoa_monthly"]')?.value) || 0;

  const monthlyRate = rate / 100 / 12;
  const numPayments = 360;

  const maxTotalPayment = (monthlyIncome * targetDTI / 100) - monthlyDebts;
  const monthlyTaxes = taxesAnnual / 12;
  const monthlyInsurance = insuranceAnnual / 12;
  const maxPI = maxTotalPayment - monthlyTaxes - monthlyInsurance - hoaMonthly;

  if (maxPI <= 0 || monthlyRate <= 0) return { price: 0, piti: 0 };

  const maxLoan = maxPI * (Math.pow(1 + monthlyRate, numPayments) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, numPayments));

  // Assume 3% down payment for max calculation
  const downPaymentPercent = 0.03;
  const maxPrice = maxLoan / (1 - downPaymentPercent);

  // Calculate PITI for this max purchase
  const piti = maxPI + monthlyTaxes + monthlyInsurance + hoaMonthly;

  return { price: maxPrice, piti: piti };
}

// Update calculation display from server response
function updateCalculationDisplay(calc) {
  if (!calc) return;

  // Income
  if (document.getElementById('calcPrimaryEmployment')) {
    document.getElementById('calcPrimaryEmployment').textContent = formatCurrency(calc.monthlyEmploymentIncome || 0);
  }
  if (document.getElementById('calcCoEmployment')) {
    document.getElementById('calcCoEmployment').textContent = formatCurrency(calc.coMonthlyEmploymentIncome || 0);
  }
  if (document.getElementById('calcPrimaryOther')) {
    document.getElementById('calcPrimaryOther').textContent = formatCurrency(calc.monthlyOtherIncome || 0);
  }
  if (document.getElementById('calcCoOther')) {
    document.getElementById('calcCoOther').textContent = formatCurrency(calc.coMonthlyOtherIncome || 0);
  }
  if (document.getElementById('calcTotalMonthly')) {
    document.getElementById('calcTotalMonthly').textContent = formatCurrency(calc.totalMonthlyIncome || 0);
  }
  if (document.getElementById('calcAnnualGross')) {
    document.getElementById('calcAnnualGross').textContent = formatCurrency(calc.annualIncome || 0);
  }

  // Assets
  if (document.getElementById('calcTotalAssets')) {
    document.getElementById('calcTotalAssets').textContent = formatCurrency(calc.totalAssets || 0);
  }
  if (document.getElementById('calcLiquidAssets')) {
    document.getElementById('calcLiquidAssets').textContent = formatCurrency(calc.liquidAssets || 0);
  }

  // Debts
  if (document.getElementById('calcTotalDebts')) {
    document.getElementById('calcTotalDebts').textContent = formatCurrency(calc.totalMonthlyDebts || 0);
  }
  if (document.getElementById('calcCurrentDTI')) {
    document.getElementById('calcCurrentDTI').textContent = (calc.currentDTI || 0).toFixed(1) + '%';
  }

  // DON'T overwrite property calculations from server - always use form values
  // This prevents stale server data from overwriting correct client-side calculations
  // Instead, recalculate property values from form inputs
  updatePropertyCalculations();
}

// Quick Reference Generation (Loan Officer sidebar only)
async function generateQuickReference() {
  const btn = document.getElementById('quickRefBtn');
  const placeholder = document.getElementById('quickRefPlaceholder');
  const sidebar = document.getElementById('loanOfficerSidebar');

  btn.disabled = true;
  btn.textContent = 'Generating...';
  if (placeholder) placeholder.textContent = 'Analyzing borrower profile...';

  try {
    const response = await fetch(`/api/quick-reference/${BORROWER_ID}`, { method: 'POST' });
    const { quickReference, error } = await response.json();

    if (error) {
      if (placeholder) placeholder.textContent = `Error: ${error}`;
      sidebar.style.display = 'none';
    } else {
      // Try to parse as JSON
      let parsed = null;
      try {
        // Strip markdown code blocks if present
        let jsonStr = quickReference.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.log('Quick reference JSON parse failed:', e.message);
        parsed = null;
      }

      if (parsed) {
        populateLoanOfficerSidebar(parsed);
        sidebar.style.display = 'block';
        if (placeholder) placeholder.innerHTML = '<span style="color: var(--success);">Quick reference generated. See sidebar for details.</span>';
      } else {
        if (placeholder) placeholder.textContent = 'Quick reference generated but could not be parsed.';
      }
    }
  } catch (error) {
    if (placeholder) placeholder.textContent = 'Failed to generate quick reference. Please check your API key.';
    sidebar.style.display = 'none';
  }

  btn.disabled = false;
  btn.textContent = 'Regenerate Quick Reference';
}

// AI Analysis (Client Letter - informed by chat history)
async function generateAnalysis() {
  const btn = document.getElementById('generateAnalysisBtn');
  const analysisDiv = document.getElementById('analysisReport');
  const downloadBtn = document.getElementById('downloadPdfBtn');
  const emailBtn = document.getElementById('emailAnalysisBtn');

  btn.disabled = true;
  btn.textContent = 'Generating...';
  analysisDiv.innerHTML = '<p>Creating personalized client letter based on your conversation...</p>';

  try {
    const response = await fetch(`/api/analyze/${BORROWER_ID}`, { method: 'POST' });
    const { analysis, error } = await response.json();

    if (error) {
      analysisDiv.innerHTML = `<p class="text-muted">Error: ${error}</p>`;
      downloadBtn.style.display = 'none';
      emailBtn.style.display = 'none';
    } else {
      // Try to parse as JSON (new format - clientLetter only)
      let parsed = null;
      try {
        // Strip markdown code blocks if present (```json ... ```)
        let jsonStr = analysis.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.log('JSON parse failed, using fallback format:', e.message);
        parsed = null;
      }

      if (parsed && parsed.clientLetter) {
        // New format - render client letter only
        renderClientLetter(parsed.clientLetter);
      } else if (parsed && parsed.loanOfficerSummary && parsed.clientLetter) {
        // Legacy format with both - just render client letter
        renderClientLetter(parsed.clientLetter);
      } else {
        // Old format or plain text - use original rendering
        const formatted = analysis
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/^### (.+)$/gm, '<h4>$1</h4>')
          .replace(/^## (.+)$/gm, '<h3>$1</h3>')
          .replace(/^# (.+)$/gm, '<h2>$1</h2>')
          .replace(/\n/g, '<br>');

        analysisDiv.innerHTML = `
          <div class="analysis-header">
            <img src="/images/logo.png" alt="PathFinder Pro" class="analysis-logo">
            <div class="analysis-header-text">
              <h2 class="analysis-title"><span class="path">PATH</span><span class="finder">FINDER</span> <span class="pro">PRO</span></h2>
              <div class="analysis-subtitle">by ClearPath Utah Mortgage</div>
            </div>
          </div>
          <div class="analysis-agent-info">
            <strong>Kelly Sansom</strong> - Your Mortgage Specialist | NMLS #2510508 | <a href="tel:8018911846">(801) 891-1846</a> | <a href="https://clearpathutah.com" target="_blank">clearpathutah.com</a> | <a href="mailto:hello@clearpathutah.com">hello@clearpathutah.com</a>
          </div>
          <div class="analysis-content">${formatted}</div>
        `;
      }

      // Show edit, download, and email buttons
      const editBtn = document.getElementById('editReportBtn');
      if (editBtn) editBtn.style.display = 'inline-flex';
      downloadBtn.style.display = 'inline-flex';
      emailBtn.style.display = 'inline-flex';

      // Show co-borrower checkbox if there's a co-borrower with email
      const coBorrowerOption = document.getElementById('coBorrowerEmailOption');
      const coEmailInput = document.querySelector('[name="co_email"]');
      const hasCoBorrower = document.getElementById('coBorrowerYes')?.classList.contains('active');
      if (coBorrowerOption && hasCoBorrower && coEmailInput && coEmailInput.value.trim()) {
        coBorrowerOption.style.display = 'inline-flex';
      } else if (coBorrowerOption) {
        coBorrowerOption.style.display = 'none';
      }
    }
  } catch (error) {
    analysisDiv.innerHTML = `<p class="text-muted">Failed to generate analysis. Please check your API key.</p>`;
    const editBtn = document.getElementById('editReportBtn');
    if (editBtn) editBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
    emailBtn.style.display = 'none';
  }

  btn.disabled = false;
  btn.textContent = 'Regenerate Analysis Report';
}

// Toggle edit mode for the analysis report
let isEditMode = false;
function toggleEditMode() {
  const editBtn = document.getElementById('editReportBtn');
  const editableContent = document.getElementById('editableLetterContent');

  if (!editableContent) return;

  isEditMode = !isEditMode;

  if (isEditMode) {
    // Enable editing
    editBtn.textContent = 'Done Editing';
    editBtn.classList.add('btn-primary');

    // Make text sections editable
    editableContent.querySelectorAll('.editable-text').forEach(el => {
      el.contentEditable = 'true';
      el.classList.add('editing');
    });

    // Make list items editable
    editableContent.querySelectorAll('.editable-list li').forEach(el => {
      el.contentEditable = 'true';
      el.classList.add('editing');
    });

    // Add visual indicator
    editableContent.classList.add('edit-mode');
  } else {
    // Disable editing
    editBtn.textContent = 'Edit Report';
    editBtn.classList.remove('btn-primary');

    // Remove contenteditable
    editableContent.querySelectorAll('[contenteditable]').forEach(el => {
      el.contentEditable = 'false';
      el.classList.remove('editing');
    });

    // Remove visual indicator
    editableContent.classList.remove('edit-mode');
  }
}

// Populate the loan officer sidebar with analysis data
function populateLoanOfficerSidebar(summary) {
  const populateList = (id, items) => {
    const el = document.getElementById(id);
    if (el && items && items.length) {
      el.innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    } else if (el) {
      el.innerHTML = '<li class="text-muted">None identified</li>';
    }
  };

  populateList('sidebarStrengths', summary.strengths);
  populateList('sidebarWeaknesses', summary.weaknesses);
  populateList('sidebarSecondaryOptions', summary.secondaryOptions);
  populateList('sidebarConcerns', summary.concernsToAddress);
  populateList('sidebarBorrowerOptions', summary.borrowerOptions);
  populateList('sidebarNextSteps', summary.suggestedNextSteps);

  const primaryRec = document.getElementById('sidebarPrimaryRec');
  if (primaryRec) {
    primaryRec.textContent = summary.primaryRecommendation || 'Analysis needed';
  }
}

// Render the client letter format
function renderClientLetter(letter) {
  const analysisDiv = document.getElementById('analysisReport');
  const editBtn = document.getElementById('editReportBtn');

  // Build highlights list - editable
  const highlightsList = letter.highlights && letter.highlights.length
    ? `<ul class="client-letter-list editable-list" data-section="highlights">${letter.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
    : '<ul class="client-letter-list editable-list" data-section="highlights"><li>Add highlight here...</li></ul>';

  // Build improvements list - editable
  const improvementsList = letter.improvements && letter.improvements.length
    ? `<ul class="client-letter-list editable-list" data-section="improvements">${letter.improvements.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '<ul class="client-letter-list editable-list" data-section="improvements"><li>Add improvement here...</li></ul>';

  // Build options list (numbered) - editable
  const optionsList = letter.options && letter.options.length
    ? `<ol class="client-letter-options editable-list" data-section="options">${letter.options.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ol>`
    : '<ol class="client-letter-options editable-list" data-section="options"><li>Add option here...</li></ol>';

  // Format greeting with phone on next line
  const greetingParts = (letter.greeting || '').split('\n');
  const greetingName = greetingParts[0] || '';
  let greetingPhone = greetingParts[1] || '';

  // Format phone number as (801) 555-5555
  if (greetingPhone) {
    const digits = greetingPhone.replace(/\D/g, '');
    if (digits.length === 10) {
      greetingPhone = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }
  }

  // Format signature
  const signatureParts = (letter.signature || '').split('\n');
  const signatureHtml = signatureParts.map(line => escapeHtml(line)).join('<br>');

  analysisDiv.innerHTML = `
    <div class="analysis-header">
      <img src="/images/logo.png" alt="PathFinder Pro" class="analysis-logo">
      <div class="analysis-header-text">
        <h2 class="analysis-title"><span class="path">PATH</span><span class="finder">FINDER</span> <span class="pro">PRO</span></h2>
        <div class="analysis-subtitle">by ClearPath Utah Mortgage</div>
      </div>
    </div>
    <div class="analysis-agent-info">
      <strong>Kelly Sansom</strong> - Your Mortgage Specialist | NMLS #2510508 | <a href="tel:8018911846">(801) 891-1846</a> | <a href="https://clearpathutah.com" target="_blank">clearpathutah.com</a> | <a href="mailto:hello@clearpathutah.com">hello@clearpathutah.com</a>
    </div>
    <div class="analysis-content client-letter" id="editableLetterContent">
      <p class="letter-greeting editable-text" data-section="greeting">${escapeHtml(greetingName)}</p>
      ${greetingPhone ? `<p class="letter-phone">${escapeHtml(greetingPhone)}</p>` : ''}

      <p class="letter-intro editable-text" data-section="introduction">${escapeHtml(letter.introduction || '')}</p>

      <h3 class="letter-section-title">YOUR HIGHLIGHTS</h3>
      ${highlightsList}

      <h3 class="letter-section-title">ROOM FOR IMPROVEMENT</h3>
      ${improvementsList}

      <h3 class="letter-section-title">OPTIONS TO STRENGTHEN YOUR PROFILE</h3>
      ${optionsList}

      <h3 class="letter-section-title">YOUR CLEARPATH FORWARD</h3>
      <p class="letter-clearpath editable-text" data-section="clearpath">${escapeHtml(letter.clearpath || '')}</p>

      <p class="letter-closing editable-text" data-section="closing">${escapeHtml(letter.closing || '')}</p>

      <div class="letter-signature">
        ${signatureHtml}
      </div>
    </div>
    <div class="analysis-footer">
      <div class="analysis-footer-content">
        <div class="analysis-footer-left">
          <img src="https://clearpathutah.com/wp-content/uploads/2025/07/Clear-Path-Mortgage-Logo-300x300.gif" alt="ClearPath Utah Mortgage" class="analysis-footer-logo">
        </div>
        <div class="analysis-footer-center">
          <div class="analysis-footer-company"><span class="clear">CLEAR</span><span class="path-text">PATH</span> <span class="utah-mortgage">UTAH MORTGAGE</span></div>
          <div class="analysis-footer-contact">
            <a href="tel:8018911846">(801) 891-1846</a> | <a href="mailto:hello@clearpathutah.com">hello@clearpathutah.com</a>
          </div>
          <div class="analysis-footer-nmls">NMLS #2510508 | FAIR LENDER | FAIR HOUSING</div>
          <div class="analysis-footer-disclaimer">
            Powered by Capital Financial Group, Inc. – NMLS #3146. Information subject to change without notice. This is not an offer for extension of credit or a commitment to lend. Equal Housing Lender.
          </div>
        </div>
        <div class="analysis-footer-right">
          <img src="https://clearpathutah.com/wp-content/uploads/2025/10/clearpath-utah-mortgage-reviews.webp" alt="Google Reviews & BBB Rating" class="analysis-footer-reviews">
        </div>
      </div>
    </div>
  `;
}

// Download analysis as PDF (uses edited content from DOM)
async function downloadAnalysisPDF() {
  const btn = document.getElementById('downloadPdfBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    // Extract current content from DOM (includes any edits)
    const content = extractLetterContent();

    const response = await fetch(`/api/analysis/${BORROWER_ID}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      throw new Error('PDF generation failed');
    }

    // Get the PDF blob and download it
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Extract filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'PathFinderPro-Analysis.pdf';
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match) {
        filename = match[1].replace(/['"]/g, '');
      }
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('PDF download error:', error);
    alert('Failed to download PDF. Please try again.');
  }

  btn.disabled = false;
  btn.textContent = 'Download PDF';
}

// Extract letter content from DOM (for PDF/email with edits)
function extractLetterContent() {
  const content = document.getElementById('editableLetterContent');
  if (!content) return null;

  const getText = (selector) => {
    const el = content.querySelector(selector);
    return el ? el.innerText.trim() : '';
  };

  const getListItems = (selector) => {
    const list = content.querySelector(selector);
    if (!list) return [];
    return Array.from(list.querySelectorAll('li')).map(li => li.innerText.trim());
  };

  return {
    greeting: getText('.letter-greeting'),
    introduction: getText('.letter-intro'),
    highlights: getListItems('[data-section="highlights"]'),
    improvements: getListItems('[data-section="improvements"]'),
    options: getListItems('[data-section="options"]'),
    clearpath: getText('.letter-clearpath'),
    closing: getText('.letter-closing'),
    signature: getText('.letter-signature')
  };
}

// Email analysis to client (and copy to Kelly)
async function emailAnalysis() {
  const btn = document.getElementById('emailAnalysisBtn');

  // Read email directly from form input
  const emailInput = document.querySelector('[name="email"]');
  const clientEmail = emailInput ? emailInput.value.trim() : '';

  if (!clientEmail) {
    alert('Please enter the borrower\'s email address in the Borrower Info tab first.');
    return;
  }

  // Check if co-borrower should be included
  const includeCoBorrower = document.getElementById('includeCoBorrower')?.checked;
  const coEmailInput = document.querySelector('[name="co_email"]');
  const coBorrowerEmail = includeCoBorrower && coEmailInput ? coEmailInput.value.trim() : '';

  // Build confirmation message
  let confirmMsg = `Send analysis report to ${clientEmail}?`;
  if (coBorrowerEmail) {
    confirmMsg = `Send analysis report to:\n• ${clientEmail}\n• ${coBorrowerEmail}`;
  }

  if (!confirm(confirmMsg)) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const response = await fetch(`/api/analysis/${BORROWER_ID}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientEmail, coBorrowerEmail })
    });

    const result = await response.json();

    if (result.success) {
      let successMsg = `Analysis report sent to ${clientEmail}`;
      if (coBorrowerEmail) {
        successMsg += ` and ${coBorrowerEmail}`;
      }
      alert(successMsg);
    } else {
      alert(result.error || 'Failed to send email. Please try again.');
    }
  } catch (error) {
    alert('Failed to send email. Please try again.');
  }

  btn.disabled = false;
  btn.textContent = 'Email to Client';
}

// Chat
async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  const chatHistory = document.getElementById('chatHistory');

  // Add user message
  chatHistory.innerHTML += `
    <div class="chat-message chat-user">
      <strong>You:</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  input.value = '';
  chatHistory.scrollTop = chatHistory.scrollHeight;

  try {
    const response = await fetch(`/api/chat/${BORROWER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const { reply, error } = await response.json();

    if (error) {
      chatHistory.innerHTML += `
        <div class="chat-message chat-assistant">
          <strong>Claude:</strong>
          <p>Error: ${escapeHtml(error)}</p>
        </div>
      `;
    } else {
      chatHistory.innerHTML += `
        <div class="chat-message chat-assistant">
          <strong>Claude:</strong>
          <p>${escapeHtml(reply)}</p>
        </div>
      `;
    }
  } catch (error) {
    chatHistory.innerHTML += `
      <div class="chat-message chat-assistant">
        <strong>Claude:</strong>
        <p>Failed to get response. Please try again.</p>
      </div>
    `;
  }

  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Enter key to send chat
document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChat();
});

// Export functions
function exportMISMO() {
  window.location.href = `/api/export/mismo/${BORROWER_ID}`;
}

// Send to Arive directly via API
async function sendToArive() {
  const btn = document.getElementById('sendToAriveBtn');
  const status = document.getElementById('ariveStatus');

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Sending...';
  status.textContent = '';

  try {
    const response = await fetch(`/api/borrower/${BORROWER_ID}/send-to-arive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (result.success) {
      btn.querySelector('span').textContent = 'Sent to Arive';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-success');

      if (result.ariveLeadId) {
        // Direct Arive API success
        status.innerHTML = `Lead sent to Arive! Lead ID: ${result.ariveLeadId}`;
        if (result.deepLinkURL) {
          status.innerHTML += ` <a href="${result.deepLinkURL}" target="_blank">Open in Arive</a>`;
        }
      } else if (result.fallback) {
        // Fallback to Zapier
        status.textContent = result.message;
        status.style.color = '#f59e0b'; // Warning color
      } else {
        status.textContent = result.message || 'Lead sent successfully!';
      }
      status.style.color = '#10b981';
    } else {
      throw new Error(result.error || 'Failed to send');
    }
  } catch (error) {
    btn.querySelector('span').textContent = 'Send to Arive';
    btn.disabled = false;
    status.textContent = 'Error: ' + error.message;
    status.style.color = '#ef4444';
  }
}

function copySummary() {
  const summary = generateSummaryText();
  navigator.clipboard.writeText(summary).then(() => {
    alert('Summary copied to clipboard!');
  });
}

function generateSummaryText() {
  const name = document.getElementById('summaryName')?.textContent || '';
  const income = document.getElementById('summaryMonthlyIncome')?.textContent || '';
  const debts = document.getElementById('summaryMonthlyDebts')?.textContent || '';
  const piti = document.getElementById('summaryPITI')?.textContent || '';
  const frontDTI = document.getElementById('summaryFrontDTI')?.textContent || '';
  const backDTI = document.getElementById('summaryBackDTI')?.textContent || '';
  const loanAmount = document.getElementById('summaryLoanAmount')?.textContent || '';
  const ltv = document.getElementById('summaryLTV')?.textContent || '';
  const assets = document.getElementById('summaryAssets')?.textContent || '';
  const creditScore = document.getElementById('summaryCreditScore')?.textContent || '';

  return `
PATHFINDER PRO - BORROWER SUMMARY
ClearPath Utah Mortgage
=====================================

Borrower: ${name}

THE NUMBERS:
- Gross Monthly Income: ${income}
- Total Monthly Debts: ${debts}
- Proposed Housing Payment: ${piti}
- Front-End DTI: ${frontDTI}
- Back-End DTI: ${backDTI}
- Loan Amount: ${loanAmount}
- LTV: ${ltv}
- Total Assets: ${assets}
- Credit Score: ${creditScore}

=====================================
Kelly | (801) 891-1846 | hello@clearpathutah.com
  `.trim();
}

// Knowledge Modal (same functions as index)
function openKnowledgeModal() {
  document.getElementById('knowledgeModal').classList.add('active');
  loadKnowledgeSources();
}

function closeKnowledgeModal() {
  document.getElementById('knowledgeModal').classList.remove('active');
}

async function loadKnowledgeSources() {
  try {
    const res = await fetch('/knowledge');
    const data = await res.json();

    const urlsBody = document.querySelector('#urlsTable tbody');
    if (urlsBody) {
      urlsBody.innerHTML = data.urls.map(u => `
        <tr>
          <td>${escapeHtml(u.name)}${u.requires_js ? ' <span style="background: #e3f2fd; color: #1565c0; padding: 2px 6px; border-radius: 3px; font-size: 0.75em;">JS</span>' : ''}</td>
          <td><a href="${u.url}" target="_blank">${u.url.substring(0, 40)}...</a></td>
          <td>${u.last_updated ? new Date(u.last_updated).toLocaleDateString() : 'Never'}</td>
          <td>
            <button class="btn btn-sm" onclick="scrapeUrl(${u.id})">Scrape</button>
            <button class="btn btn-sm btn-danger" onclick="deleteUrl(${u.id})">Delete</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Failed to load knowledge sources:', error);
  }
}

async function addUrl() {
  const name = document.getElementById('urlName').value;
  const url = document.getElementById('urlInput').value;
  const requiresJs = document.getElementById('urlRequiresJs')?.checked || false;
  await fetch('/knowledge/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url, requires_js: requiresJs })
  });
  document.getElementById('urlName').value = '';
  document.getElementById('urlInput').value = '';
  if (document.getElementById('urlRequiresJs')) {
    document.getElementById('urlRequiresJs').checked = false;
  }
  loadKnowledgeSources();
}

async function scrapeUrl(id) {
  await fetch(`/knowledge/url/${id}/scrape`, { method: 'POST' });
  loadKnowledgeSources();
}

async function deleteUrl(id) {
  if (confirm('Delete this URL?')) {
    await fetch(`/knowledge/url/${id}`, { method: 'DELETE' });
    loadKnowledgeSources();
  }
}

// Utility functions
function formatCurrency(amount) {
  return '$' + Math.round(amount).toLocaleString();
}

function parseCurrency(str) {
  return parseFloat(str.replace(/[$,]/g, '')) || 0;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function reindexBlocks(container, blockClass, prefix) {
  container.querySelectorAll('.' + blockClass).forEach((block, i) => {
    block.dataset.index = i;
    const header = block.querySelector('h4');
    if (header) {
      header.textContent = blockClass.includes('employer') ? `Employer ${i + 1}` : `Income Source ${i + 1}`;
    }
    const removeBtn = block.querySelector('.btn-danger');
    if (removeBtn) {
      if (blockClass.includes('employer')) {
        removeBtn.onclick = () => removeEmployer(prefix, i);
      } else {
        removeBtn.onclick = () => removeOtherIncome(prefix, i);
      }
    }
  });
}

function reindexTableRows(tbody) {
  tbody.querySelectorAll('tr').forEach((row, i) => {
    row.dataset.index = i;
    row.querySelectorAll('input, select').forEach(input => {
      input.dataset.index = i;
    });
    const removeBtn = row.querySelector('.btn-danger');
    if (removeBtn) {
      const isAsset = tbody.closest('#assetsTable');
      if (isAsset) {
        removeBtn.onclick = () => removeAsset(i);
      } else {
        removeBtn.onclick = () => removeDebt(i);
      }
    }
  });
}

// Knowledge tab switching
document.querySelectorAll('.knowledge-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.knowledge-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.knowledge-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-content')?.classList.add('active');
  });
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeKnowledgeModal();
});

// Quick Adjustments for Max Purchase Power
let originalPropertyValues = null;

function getOriginalPropertyValues() {
  return {
    homePrice: parseFloat(document.querySelector('[name="purchase_price"]')?.value) || 0,
    downPaymentPct: parseFloat(document.querySelector('[name="down_payment_percent"]')?.value) || 3,
    interestRate: parseFloat(document.querySelector('[name="interest_rate"]')?.value) || 7.0,
    taxes: parseFloat(document.querySelector('[name="property_taxes_annual"]')?.value) || 0,
    hoi: parseFloat(document.querySelector('[name="insurance_annual"]')?.value) || 0,
    hoa: parseFloat(document.querySelector('[name="hoa_monthly"]')?.value) || 0
  };
}

function applyQuickAdjustments() {
  // Store original values on first adjustment
  if (!originalPropertyValues) {
    originalPropertyValues = getOriginalPropertyValues();
  }

  // Get adjustment values (use original if empty)
  const adjustHomePrice = document.getElementById('adjustHomePrice').value;
  const adjustDownPaymentPct = document.getElementById('adjustDownPaymentPct').value;
  const adjustInterestRate = document.getElementById('adjustInterestRate').value;
  const adjustTaxes = document.getElementById('adjustTaxes').value;
  const adjustHOI = document.getElementById('adjustHOI').value;
  const adjustHOA = document.getElementById('adjustHOA').value;

  // Check if any adjustments are made
  const hasAdjustments = adjustHomePrice || adjustDownPaymentPct || adjustInterestRate || adjustTaxes || adjustHOI || adjustHOA;

  if (!hasAdjustments) {
    // No adjustments, hide indicator and reset button
    document.getElementById('adjustedIndicator').style.display = 'none';
    document.getElementById('resetAdjustmentsBtn').style.display = 'none';
    updateAllCalculations();
    return;
  }

  // Show indicator and reset button
  document.getElementById('adjustedIndicator').style.display = 'inline';
  document.getElementById('resetAdjustmentsBtn').style.display = 'inline-block';

  // Use adjusted values or fallback to original
  const homePrice = adjustHomePrice ? parseFloat(adjustHomePrice) : originalPropertyValues.homePrice;
  const downPaymentPct = adjustDownPaymentPct ? parseFloat(adjustDownPaymentPct) : originalPropertyValues.downPaymentPct;
  const rate = adjustInterestRate ? parseFloat(adjustInterestRate) : originalPropertyValues.interestRate;
  const taxesAnnual = adjustTaxes ? parseFloat(adjustTaxes) : originalPropertyValues.taxes;
  const hoiAnnual = adjustHOI ? parseFloat(adjustHOI) : originalPropertyValues.hoi;
  const hoaMonthly = adjustHOA ? parseFloat(adjustHOA) : originalPropertyValues.hoa;

  // Calculate adjusted max purchase power
  const monthlyIncome = getMonthlyIncome();
  const monthlyDebts = getMonthlyDebts();

  const power43 = calculateMaxPurchaseAdjusted(monthlyIncome, monthlyDebts, 43, rate, taxesAnnual, hoiAnnual, hoaMonthly, downPaymentPct);
  const power45 = calculateMaxPurchaseAdjusted(monthlyIncome, monthlyDebts, 45, rate, taxesAnnual, hoiAnnual, hoaMonthly, downPaymentPct);
  const power50 = calculateMaxPurchaseAdjusted(monthlyIncome, monthlyDebts, 50, rate, taxesAnnual, hoiAnnual, hoaMonthly, downPaymentPct);

  // Update display
  document.getElementById('maxPurchase43').textContent = formatCurrency(power43.price);
  document.getElementById('maxPurchase45').textContent = formatCurrency(power45.price);
  document.getElementById('maxPurchase50').textContent = formatCurrency(power50.price);
  document.getElementById('piti43').textContent = 'PITI: ' + formatCurrency(power43.piti) + '/mo';
  document.getElementById('piti45').textContent = 'PITI: ' + formatCurrency(power45.piti) + '/mo';
  document.getElementById('piti50').textContent = 'PITI: ' + formatCurrency(power50.piti) + '/mo';

  // Also update The Numbers card if home price is set
  if (adjustHomePrice) {
    const downPaymentAmt = homePrice * (downPaymentPct / 100);
    const loanAmount = homePrice - downPaymentAmt;
    const ltv = homePrice > 0 ? (loanAmount / homePrice) * 100 : 0;

    // Calculate PITI for this home price
    const monthlyRate = rate / 100 / 12;
    const numPayments = 360;
    let pi = 0;
    if (loanAmount > 0 && monthlyRate > 0) {
      pi = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    }
    const monthlyTaxes = taxesAnnual / 12;
    const monthlyInsurance = hoiAnnual / 12;
    const totalPITI = pi + monthlyTaxes + monthlyInsurance + hoaMonthly;

    document.getElementById('summaryLoanAmount').textContent = formatCurrency(loanAmount);
    document.getElementById('summaryLTV').textContent = ltv.toFixed(1) + '%';
    document.getElementById('summaryPITI').textContent = formatCurrency(totalPITI);

    // Update DTI
    const frontDTI = monthlyIncome > 0 ? (totalPITI / monthlyIncome) * 100 : 0;
    const backDTI = monthlyIncome > 0 ? ((monthlyDebts + totalPITI) / monthlyIncome) * 100 : 0;
    document.getElementById('summaryFrontDTI').textContent = frontDTI.toFixed(1) + '%';
    document.getElementById('summaryBackDTI').textContent = backDTI.toFixed(1) + '%';

    // Update cash to close
    const closingCosts = loanAmount * 0.03;
    const cashToClose = downPaymentAmt + closingCosts;
    document.getElementById('summaryCashToClose').textContent = formatCurrency(cashToClose);
  }
}

function calculateMaxPurchaseAdjusted(monthlyIncome, monthlyDebts, targetDTI, rate, taxesAnnual, insuranceAnnual, hoaMonthly, downPaymentPct) {
  if (monthlyIncome <= 0) return { price: 0, piti: 0 };

  const monthlyRate = rate / 100 / 12;
  const numPayments = 360;

  const maxTotalPayment = (monthlyIncome * targetDTI / 100) - monthlyDebts;
  const monthlyTaxes = taxesAnnual / 12;
  const monthlyInsurance = insuranceAnnual / 12;
  const maxPI = maxTotalPayment - monthlyTaxes - monthlyInsurance - hoaMonthly;

  if (maxPI <= 0 || monthlyRate <= 0) return { price: 0, piti: 0 };

  const maxLoan = maxPI * (Math.pow(1 + monthlyRate, numPayments) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, numPayments));

  // Use adjusted down payment percentage
  const downPaymentDecimal = (downPaymentPct || 3) / 100;
  const maxPrice = maxLoan / (1 - downPaymentDecimal);

  // Calculate PITI for this max purchase
  const piti = maxPI + monthlyTaxes + monthlyInsurance + hoaMonthly;

  return { price: maxPrice, piti: piti };
}

function resetAdjustments() {
  // Clear all adjustment inputs
  document.getElementById('adjustHomePrice').value = '';
  document.getElementById('adjustDownPaymentPct').value = '';
  document.getElementById('adjustInterestRate').value = '';
  document.getElementById('adjustTaxes').value = '';
  document.getElementById('adjustHOI').value = '';
  document.getElementById('adjustHOA').value = '';

  // Hide indicator and reset button
  document.getElementById('adjustedIndicator').style.display = 'none';
  document.getElementById('resetAdjustmentsBtn').style.display = 'none';

  // Clear stored original values
  originalPropertyValues = null;

  // Recalculate with original property tab values
  updateAllCalculations();
}
