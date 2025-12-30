/**
 * Headless Browser Service
 * Uses puppeteer-core to fetch pages that require JavaScript execution
 * (e.g., SPAs like Freddie Mac Guide)
 *
 * NOTE: Requires system Chromium. Set PUPPETEER_EXECUTABLE_PATH env var.
 */

let puppeteer = null;
let browser = null;
let puppeteerAvailable = null;

/**
 * Lazy load puppeteer-core to avoid startup delays
 */
async function getPuppeteer() {
    if (puppeteer) return puppeteer;

    try {
        puppeteer = require('puppeteer-core');
        return puppeteer;
    } catch (e) {
        console.log('[Headless] puppeteer-core not installed - JS-required sites will be skipped');
        return null;
    }
}

/**
 * Get or create a browser instance
 * Reuses browser across calls for efficiency
 */
async function getBrowser() {
    if (browser && browser.isConnected()) {
        return browser;
    }

    const pptr = await getPuppeteer();
    if (!pptr) {
        throw new Error('puppeteer-core not available');
    }

    // Get Chromium path from environment (REQUIRED for puppeteer-core)
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    if (!executablePath) {
        throw new Error('PUPPETEER_EXECUTABLE_PATH not set - cannot find Chromium');
    }

    console.log('[Headless] Launching browser...');
    console.log('[Headless] Using Chromium at:', executablePath);

    // Configure for Railway/server environment
    browser = await pptr.launch({
        headless: 'new',
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--single-process'
        ]
    });

    console.log('[Headless] Browser launched successfully');
    return browser;
}

/**
 * Fetch a page using headless browser
 * Handles JavaScript challenges and dynamic content
 *
 * @param {string} url - URL to fetch
 * @param {object} options - Options for fetching
 * @param {number} options.timeout - Timeout in ms (default 30000)
 * @param {string} options.waitForSelector - CSS selector to wait for (optional)
 * @param {number} options.waitTime - Additional time to wait after load in ms (default 2000)
 * @returns {Promise<string>} - HTML content of the page
 */
async function fetchWithBrowser(url, options = {}) {
    const {
        timeout = 30000,
        waitForSelector = null,
        waitTime = 2000
    } = options;

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        // Set a realistic user agent
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        console.log(`[Headless] Fetching: ${url}`);

        // Navigate to the page
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeout
        });

        // Wait for specific selector if provided
        if (waitForSelector) {
            try {
                await page.waitForSelector(waitForSelector, { timeout: 10000 });
            } catch (e) {
                console.log(`[Headless] Selector ${waitForSelector} not found, continuing...`);
            }
        }

        // Additional wait for dynamic content
        await new Promise(resolve => setTimeout(resolve, waitTime));

        // Get the page content
        const html = await page.content();

        console.log(`[Headless] Successfully fetched ${url} (${html.length} bytes)`);

        return html;

    } catch (error) {
        console.error(`[Headless] Error fetching ${url}:`, error.message);
        throw error;
    } finally {
        await page.close();
    }
}

/**
 * Close the browser instance
 * Call this when shutting down the application
 */
async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        console.log('[Headless] Browser closed');
    }
}

/**
 * Check if headless browser is available
 * Requires both puppeteer-core and PUPPETEER_EXECUTABLE_PATH
 */
async function isAvailable() {
    if (puppeteerAvailable !== null) {
        return puppeteerAvailable;
    }

    const pptr = await getPuppeteer();
    const hasExecutablePath = !!process.env.PUPPETEER_EXECUTABLE_PATH;

    puppeteerAvailable = pptr !== null && hasExecutablePath;

    if (!pptr) {
        console.log('[Headless] puppeteer-core not installed - sites with requires_js=true will be skipped');
    } else if (!hasExecutablePath) {
        console.log('[Headless] PUPPETEER_EXECUTABLE_PATH not set - sites with requires_js=true will be skipped');
    } else {
        console.log('[Headless] Headless browser available');
    }

    return puppeteerAvailable;
}

module.exports = {
    fetchWithBrowser,
    closeBrowser,
    isAvailable
};
