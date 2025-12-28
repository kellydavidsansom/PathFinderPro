// Direct Arive API Integration
// Bypasses Zapier - sends leads directly to Arive LOS

const ARIVE_BASE_URL = 'https://3146.myarive.com';
const ARIVE_API_KEY = process.env.ARIVE_API_KEY;
const ASSIGNEE_EMAIL = process.env.ARIVE_ASSIGNEE_EMAIL || 'hello@clearpathutah.com';

/**
 * Send a borrower to Arive as a new lead
 */
async function createLead(borrower, calculations) {
  if (!ARIVE_API_KEY) {
    throw new Error('ARIVE_API_KEY not configured');
  }

  const payload = buildArivePayload(borrower, calculations);

  const fetch = (await import('node-fetch')).default;

  console.log('Sending to Arive:', `${ARIVE_BASE_URL}/api/leads?sync=true`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(`${ARIVE_BASE_URL}/api/leads?sync=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': ARIVE_API_KEY
    },
    body: JSON.stringify(payload)
  });

  // Get the response as text first to handle HTML error pages
  const responseText = await response.text();
  console.log('Arive Response Status:', response.status);
  console.log('Arive Response:', responseText.substring(0, 500));

  // Try to parse as JSON
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    // Response is not JSON (probably HTML error page)
    console.error('Arive returned non-JSON response:', responseText.substring(0, 200));
    throw new Error(`Arive API returned ${response.status}: Not a valid JSON response. Check API endpoint and credentials.`);
  }

  if (!response.ok) {
    console.error('Arive API Error:', data);
    throw new Error(data.message || `Arive API error: ${response.status}`);
  }

  return data;
}

/**
 * Build the Arive API payload from PathFinder Pro borrower data
 */
function buildArivePayload(b, calc) {
  // Helper: format date to YYYY-MM-DD
  const formatDate = (date) => {
    if (!date) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString().split('T')[0];
  };

  // Helper: map state to 2-letter code
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
    if (state && state.length === 2) return state.toUpperCase();
    return stateCodes[state] || state;
  };

  // Helper: map military status
  const mapMilitaryStatus = (status) => {
    const map = {
      'Active Duty': 'ActiveDuty',
      'Veteran': 'Veteran',
      'Reserve/National Guard': 'ReserveNationalGuardNeverActivated'
    };
    return map[status] || undefined;
  };

  // Helper: map home buying stage
  const mapHomeBuyingStage = (stage) => {
    const map = {
      'Just Getting Started': 'GETTING_STARTED',
      'Making Offers': 'MAKING_OFFERS',
      'Found a House/Offer Pending': 'FOUND_A_HOUSE_OR_OFFER_PENDING',
      'Under Contract': 'UNDER_CONTRACT'
    };
    return map[stage] || 'GETTING_STARTED';
  };

  // Helper: map property usage
  const mapPropertyUsage = (occupancy) => {
    const map = {
      'Primary Residence': 'PrimaryResidence',
      'Second Home': 'SecondHome',
      'Investment': 'Investment'
    };
    return map[occupancy] || undefined;
  };

  // Helper: map current housing to occupancy
  const mapOccupancy = (housing) => {
    const map = {
      'Own': 'Own',
      'Rent': 'Rent',
      'Living Rent Free': 'LivingRentFree'
    };
    return map[housing] || 'Rent';
  };

  // Helper: map refinance type
  const mapRefinanceType = (type) => {
    const map = {
      'Rate/Term': 'NoCashOut',
      'Cash Out': 'CashOut'
    };
    return map[type] || undefined;
  };

  // Helper: map cash out purpose
  const mapCashOutPurpose = (purpose) => {
    const map = {
      'Debt Consolidation': 'DebtConsolidation',
      'Home Improvement': 'HomeImprovement',
      'Other': 'Other'
    };
    return map[purpose] || undefined;
  };

  // Helper: map years since event
  const mapYearsSince = (value) => {
    if (!value || value === 'Never') return undefined;
    if (value === 'Within 2 years' || value === 'Within 3 years') return '1';
    if (value === '2+ years ago') return '3';
    if (value === '3+ years ago') return '4';
    return undefined;
  };

  // Build the payload
  const payload = {
    // Lead info
    assigneeEmail: ASSIGNEE_EMAIL,
    loanPurpose: b.loan_purpose || 'Purchase',
    leadSource: 'PathFinder Pro',
    leadStatus: 'QUALIFIED',
    homebuyingStage: mapHomeBuyingStage(b.home_buying_stage),
    crmReferenceId: String(b.id),

    // Loan details
    mortgageType: b.preferred_loan_type || undefined,
    propertyType: b.property_type || undefined,
    propertyUsageType: mapPropertyUsage(b.occupancy),
    baseLoanAmount: Math.max(0, calc.loanAmount || 0),
    purchasePriceOrEstimatedValue: b.loan_purpose === 'Refinance' ? b.property_value : b.purchase_price,

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
      state: mapStateCode(b.property_state)
    },

    // Borrower
    borrower: {
      firstName: b.first_name,
      lastName: b.last_name,
      emailAddressText: b.email,
      birthDate: formatDate(b.date_of_birth),
      mobilePhone10digit: b.phone ? b.phone.replace(/\D/g, '').slice(-10) : undefined,
      ssn: b.ssn ? b.ssn.replace(/\D/g, '') : undefined,
      militaryServiceType: mapMilitaryStatus(b.military_status),
      employmentType: b.employment_type || undefined,
      hasRealEstate: !b.first_time_homebuyer,
      annualIncome: calc.annualIncome || 0,
      totalLiability: calc.totalMonthlyDebts || 0,
      firstTimeHomeBuyer: b.first_time_homebuyer ? true : false,
      yearsSinceForeclosure: mapYearsSince(b.foreclosure),
      yearsSinceBankruptcy: mapYearsSince(b.bankruptcy),
      currentlyOwningAHome: !b.first_time_homebuyer,
      planningToSellItBeforeBuying: b.planning_to_sell_home ? true : false,
      noContactRequest: false,
      emailOptOut: false,
      smsOptOut: false,
      occupancy: mapOccupancy(b.current_housing),
      monthlyRentAmt: b.current_housing === 'Rent' && b.monthly_rent ? String(b.monthly_rent) : undefined,
      hasCoBorrower: b.has_coborrower ? true : false
    }
  };

  // Add refinance-specific fields
  if (b.loan_purpose === 'Refinance') {
    payload.refinanceType = mapRefinanceType(b.refinance_type);
    payload.cashoutPurpose = mapCashOutPurpose(b.cash_out_purpose);
    payload.currentInterestRateRefi = b.current_interest_rate || undefined;
  }

  // Add co-borrower if present
  if (b.has_coborrower && b.co_first_name && b.co_last_name) {
    payload.coBorrower = {
      firstName: b.co_first_name,
      lastName: b.co_last_name,
      emailAddressText: b.co_email || undefined,
      birthDate: formatDate(b.co_date_of_birth),
      cellPhone: b.co_phone ? b.co_phone.replace(/\D/g, '').slice(-10) : undefined,
      ssn: b.co_ssn ? b.co_ssn.replace(/\D/g, '') : undefined,
      militaryServiceType: mapMilitaryStatus(b.co_military_status)
    };
  }

  // Add borrower current residence address
  if (b.street_address || b.city || b.state || b.zip) {
    payload.borrower.currentResidence = {
      lineText: b.street_address || undefined,
      city: b.city || undefined,
      state: mapStateCode(b.state),
      postalCode: b.zip || undefined
    };
  }

  // Remove undefined values to keep payload clean
  return removeUndefined(payload);
}

/**
 * Recursively remove undefined values from object
 */
function removeUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefined(value);
      }
    }
    return cleaned;
  }
  return obj;
}

module.exports = {
  createLead
};
