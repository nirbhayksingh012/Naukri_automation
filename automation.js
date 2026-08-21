const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, 'user_data');
const STATE_FILE = path.join(__dirname, 'state.json');

// ─── Human-like helpers ───────────────────────────────────────────────────────

/**
 * Random delay between min and max milliseconds (simulates human hesitation).
 */
function randomDelay(min = 800, max = 2000) {
  return Math.floor(Math.random() * (max - min) + min);
}

/**
 * Type text character-by-character with random inter-key delays.
 */
async function humanType(page, selector, text, log) {
  await page.click(selector);
  await page.waitForTimeout(randomDelay(300, 600));

  // Triple-click to select all existing text, then delete
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(randomDelay(200, 400));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(50, 150) });
  }
}

/**
 * Move mouse to element in a human-like way before clicking.
 */
async function humanClick(page, selector) {
  const element = page.locator(selector).first();
  const box = await element.boundingBox();
  if (box) {
    // Move to a random point within the element
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    await page.waitForTimeout(randomDelay(100, 300));
  }
  await element.click();
}

// ─── Auto-Login ───────────────────────────────────────────────────────────────

/**
 * Automatically log in to Naukri using email/password from environment variables.
 * Returns true on success, false if credentials are missing or login fails.
 *
 * @param {import('playwright').Page} page
 * @param {Function} log
 * @returns {Promise<boolean>}
 */
async function autoLogin(page, log) {
  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  if (!email || !password) {
    log('AUTO-LOGIN: NAUKRI_EMAIL or NAUKRI_PASSWORD env vars not set. Cannot auto-login.', 'warning');
    return false;
  }

  log('AUTO-LOGIN: Credentials found. Attempting automatic login...', 'info');

  try {
    // Navigate to the login page
    const currentUrl = page.url();
    if (!currentUrl.includes('nlogin/login') && !currentUrl.includes('login')) {
      await page.goto('https://www.naukri.com/nlogin/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    }

    await page.waitForTimeout(randomDelay(2000, 3000));

    // Wait for the email input field
    log('AUTO-LOGIN: Waiting for login form...', 'info');
    try {
      await page.waitForSelector('input[placeholder*="Email" i], input[type="email"], #usernameField', { timeout: 15000 });
    } catch (e) {
      log('AUTO-LOGIN: Login form did not appear. Page might have redirected.', 'warning');
      // Check if we're already logged in
      if (page.url().includes('mnjuser/') || page.url().includes('homepage')) {
        log('AUTO-LOGIN: Already logged in! Proceeding.', 'success');
        return true;
      }
      return false;
    }

    // Find the email field (Naukri uses different selectors across versions)
    const emailSelectors = [
      'input[placeholder*="Email" i]',
      'input[type="email"]',
      '#usernameField',
      'input[name="username"]'
    ];

    let emailSelector = null;
    for (const sel of emailSelectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        emailSelector = sel;
        break;
      }
    }

    if (!emailSelector) {
      log('AUTO-LOGIN: Could not find email input field.', 'error');
      return false;
    }

    // Type email with human-like delays
    log('AUTO-LOGIN: Typing email address...', 'info');
    await humanType(page, emailSelector, email, log);
    await page.waitForTimeout(randomDelay(500, 1000));

    // Find and type password
    const passwordSelectors = [
      'input[placeholder*="Password" i]',
      'input[type="password"]',
      '#passwordField',
      'input[name="password"]'
    ];

    let passwordSelector = null;
    for (const sel of passwordSelectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        passwordSelector = sel;
        break;
      }
    }

    if (!passwordSelector) {
      log('AUTO-LOGIN: Could not find password input field.', 'error');
      return false;
    }

    log('AUTO-LOGIN: Typing password...', 'info');
    await humanType(page, passwordSelector, password, log);
    await page.waitForTimeout(randomDelay(800, 1500));

    // Find and click login/submit button
    const loginBtnSelectors = [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("login")',
      'button:has-text("Sign In")',
      'button.loginButton',
      'input[type="submit"]'
    ];

    let loginBtnSelector = null;
    for (const sel of loginBtnSelectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        loginBtnSelector = sel;
        break;
      }
    }

    if (!loginBtnSelector) {
      log('AUTO-LOGIN: Could not find login button. Trying Enter key instead...', 'warning');
      await page.keyboard.press('Enter');
    } else {
      log('AUTO-LOGIN: Clicking login button...', 'info');
      await humanClick(page, loginBtnSelector);
    }

    // Wait for navigation after login
    log('AUTO-LOGIN: Waiting for post-login navigation...', 'info');
    await page.waitForTimeout(randomDelay(5000, 7000));

    const postLoginUrl = page.url();
    log(`AUTO-LOGIN: Post-login URL: ${postLoginUrl}`, 'info');

    // Check for CAPTCHA or OTP
    const hasCaptcha = await page.locator('[class*="captcha" i], [id*="captcha" i], iframe[src*="recaptcha"]').first().isVisible().catch(() => false);
    if (hasCaptcha) {
      log('AUTO-LOGIN: CAPTCHA detected! Auto-login cannot solve CAPTCHAs. Please import a valid session manually.', 'error');
      return false;
    }

    const hasOtp = await page.locator('input[placeholder*="OTP" i], input[placeholder*="otp" i], [class*="otp" i]').first().isVisible().catch(() => false);
    if (hasOtp) {
      log('AUTO-LOGIN: OTP verification required! Auto-login cannot handle OTPs. Please import a valid session manually.', 'error');
      return false;
    }

    // Check if still on login page (means credentials were wrong)
    if (postLoginUrl.includes('nlogin/login') || postLoginUrl.includes('login')) {
      // Check for error messages
      const errorMsg = await page.locator('.err-message, .error-message, [class*="error" i]').first().textContent().catch(() => '');
      if (errorMsg) {
        log(`AUTO-LOGIN: Login failed — ${errorMsg.trim()}`, 'error');
      } else {
        log('AUTO-LOGIN: Still on login page. Credentials may be incorrect or additional verification needed.', 'error');
      }
      return false;
    }

    // Success! We're past the login page
    log('AUTO-LOGIN: Login successful!', 'success');
    return true;

  } catch (error) {
    log(`AUTO-LOGIN: Exception during login — ${error.message}`, 'error');
    return false;
  }
}

// ─── Profile Update ───────────────────────────────────────────────────────────

/**
 * Perform the Naukri profile update.
 * If the session is expired, attempts auto-login before retrying.
 *
 * @param {Function} log - Callback function to stream logs back to the server/UI
 * @param {boolean} headless - Whether to run the browser in headless mode
 * @param {boolean} _isRetry - Internal flag to prevent infinite retry loops
 * @returns {Promise<{success: boolean, error?: string, headline?: string}>}
 */
async function updateProfile(log, headless = true, _isRetry = false) {
  let browserContext = null;
  try {
    log('Launching browser context...');
    
    // Ensure the user_data directory exists
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ];

    // If the server requested "headless" mode (silent background run),
    // we run headful but push it off-screen to bypass Akamai detection.
    if (headless) {
      launchArgs.push('--window-position=-2000,-2000');
      launchArgs.push('--window-size=1280,800');
    }

    const launchOptions = {
      headless: false, // Always run headful to bypass Akamai bot detection
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      args: launchArgs
    };

    if (fs.existsSync(STATE_FILE)) {
      log('Pre-loading session cookies from state.json...');
      launchOptions.storageState = STATE_FILE;
    }

    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);

    const pages = browserContext.pages();
    const page = pages.length > 0 ? pages[0] : await browserContext.newPage();

    // Set extra headers or modify browser attributes to look more human
    await page.addInitScript(() => {
      // Overwrite webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Overwrite languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      // Overwrite plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Viewer' },
          { name: 'Chromium PDF Viewer' }
        ]
      });
    });

    log('Navigating to Naukri Profile Page...');
    await page.goto('https://www.naukri.com/mnjuser/profile', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Short wait for client-side routing / redirection
    await page.waitForTimeout(4000);

    let currentUrl = page.url();
    log(`Current Page URL: ${currentUrl}`);

    // Check if redirected to Login page
    if (currentUrl.includes('nlogin/login') || currentUrl.includes('login')) {
      if (_isRetry) {
        // Already retried once after auto-login, don't loop
        log('Session still expired after auto-login attempt. Giving up.', 'error');
        await browserContext.close();
        return { success: false, error: 'auth_required' };
      }

      log('Session expired. Attempting automatic re-login...', 'warning');
      const loginOk = await autoLogin(page, log);

      if (loginOk) {
        // Save the fresh session state
        try {
          const state = await browserContext.storageState();
          fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
          log('Fresh session state saved after auto-login.', 'success');
        } catch (saveErr) {
          log(`Warning: Could not save session after login: ${saveErr.message}`, 'warning');
        }

        await browserContext.close();

        // Retry the whole profile update with fresh cookies
        log('Retrying profile update with fresh session...', 'info');
        return updateProfile(log, headless, true);
      } else {
        log('Auto-login failed. Manual session import required.', 'error');
        await browserContext.close();
        return { success: false, error: 'auth_required' };
      }
    }

    log('Detecting profile layout type...');
    let isCampusProfile = false;
    
    // Wait for either #lazyResumeHead or .profileSummary to appear
    try {
      await page.waitForSelector('#lazyResumeHead, .profileSummary', { timeout: 15000 });
      isCampusProfile = await page.locator('.profileSummary').isVisible();
      log(`Profile Type Detected: ${isCampusProfile ? 'Naukri Campus (Profile Summary)' : 'Naukri Standard (Resume Headline)'}`);
    } catch (e) {
      log('ERROR: Profile sections (#lazyResumeHead or .profileSummary) could not be loaded. Please ensure you are fully logged in and on the profile page.', 'error');
      // Take page screenshot for diagnostics
      const diagnosticPath = path.join(__dirname, 'diagnostic_error.png');
      await page.screenshot({ path: diagnosticPath });
      log(`Diagnostic screenshot saved to ${diagnosticPath}`, 'info');
      await browserContext.close();
      return { success: false, error: 'profile_load_failed' };
    }

    if (isCampusProfile) {
      // Naukri Campus profile: Edit Profile Summary
      const editBtn = page.locator('.profileSummary span.new-pencil').first();
      if (!await editBtn.isVisible()) {
        log('ERROR: Could not find Profile Summary edit pencil.', 'error');
        await browserContext.close();
        return { success: false, error: 'edit_button_not_found' };
      }

      log('Clicking Profile Summary edit pencil...');
      await editBtn.click();
      await page.waitForTimeout(1500);

      log('Waiting for Profile Summary input textarea (#summary)...');
      try {
        await page.waitForSelector('#summary', { timeout: 10000 });
      } catch (e) {
        log('ERROR: Profile Summary textarea (#summary) did not appear.', 'error');
        await browserContext.close();
        return { success: false, error: 'textarea_not_found' };
      }

      const currentSummary = await page.inputValue('#summary');
      log(`Current Profile Summary: "${currentSummary.substring(0, 100)}..."`);

      // Toggle a dot at the end to force an update event
      let newSummary = currentSummary.trim();
      if (newSummary.endsWith('.')) {
        newSummary = newSummary.slice(0, -1).trim();
      } else {
        newSummary = `${newSummary}.`;
      }

      log(`Changing Summary to: "${newSummary.substring(0, 100)}..."`);
      
      await page.fill('#summary', '');
      await page.fill('#summary', newSummary);
      await page.waitForTimeout(500);

      const saveBtn = page.locator('#submit-btn').first();
      if (!await saveBtn.isVisible()) {
        log('ERROR: Could not find Save button (#submit-btn).', 'error');
        await browserContext.close();
        return { success: false, error: 'save_button_not_found' };
      }

      log('Clicking Save button...');
      await saveBtn.click();

      log('Waiting for updates to save (modal to close)...');
      try {
        await page.waitForSelector('#summary', { state: 'hidden', timeout: 10000 });
        log('Update saved successfully!', 'success');
      } catch (e) {
        log('WARNING: Save modal did not disappear automatically. Verifying if update was sent...', 'warning');
        await page.waitForTimeout(3000);
      }

      // Save storage state to keep cookies fresh
      try {
        const state = await browserContext.storageState();
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        log('Session state updated in state.json.', 'info');
      } catch (saveErr) {
        log(`Warning: Failed to save updated session state: ${saveErr.message}`, 'warning');
      }

      await browserContext.close();
      log('Browser closed. Profile refresh sequence complete.', 'info');
      
      // Return shortened text for the dashboard display
      const displayHeadline = newSummary.length > 50 ? `${newSummary.substring(0, 47)}...` : newSummary;
      return { success: true, headline: displayHeadline };

    } else {
      // Naukri Standard profile: Edit Resume Headline
      log('Processing Naukri Standard Profile Update...');
      const editSelectors = [
        '#lazyResumeHead .editVal',
        '#lazyResumeHead .edit',
        '#lazyResumeHead .icon',
        '#lazyResumeHead span:has-text("edit")',
        '#lazyResumeHead span:has-text("Edit")',
        'xpath=//*[@id="lazyResumeHead"]/div/div/div[1]/span[2]'
      ];

      let editBtn = null;
      for (const selector of editSelectors) {
        const element = page.locator(selector).first();
        if (await element.isVisible()) {
          editBtn = element;
          log(`Found edit button using selector: "${selector}"`);
          break;
        }
      }

      if (!editBtn) {
        log('ERROR: Could not find Resume Headline edit button. Naukri UI might have changed.', 'error');
        await browserContext.close();
        return { success: false, error: 'edit_button_not_found' };
      }

      log('Clicking the Edit button...');
      await editBtn.click();
      await page.waitForTimeout(1500);

      // Wait for the text area
      log('Waiting for headline input textarea (#resumeHeadlineTxt)...');
      try {
        await page.waitForSelector('#resumeHeadlineTxt', { timeout: 10000 });
      } catch (e) {
        log('ERROR: Headline input textarea (#resumeHeadlineTxt) did not appear.', 'error');
        await browserContext.close();
        return { success: false, error: 'textarea_not_found' };
      }

      // Get current headline
      const currentHeadline = await page.inputValue('#resumeHeadlineTxt');
      log(`Current Resume Headline: "${currentHeadline}"`);

      // Toggle a dot at the end to force an update event
      let newHeadline = currentHeadline.trim();
      if (newHeadline.endsWith('.')) {
        newHeadline = newHeadline.slice(0, -1).trim();
      } else {
        newHeadline = `${newHeadline}.`;
      }
      
      log(`Changing Headline to: "${newHeadline}"`);
      
      // Clear and fill new value
      await page.fill('#resumeHeadlineTxt', '');
      await page.fill('#resumeHeadlineTxt', newHeadline);
      await page.waitForTimeout(500);

      // Find and click the save button
      const saveSelectors = [
        'form button[type="submit"]:has-text("Save")',
        'button:has-text("Save")',
        '.btn-dark-ot',
        'xpath=//button[contains(text(),"Save")]'
      ];

      let saveBtn = null;
      for (const selector of saveSelectors) {
        const element = page.locator(selector).first();
        if (await element.isVisible()) {
          saveBtn = element;
          log(`Found Save button using selector: "${selector}"`);
          break;
        }
      }

      if (!saveBtn) {
        log('ERROR: Could not find Save button.', 'error');
        await browserContext.close();
        return { success: false, error: 'save_button_not_found' };
      }

      log('Clicking Save button...');
      await saveBtn.click();

      log('Waiting for updates to save (saving dialog to close)...');
      try {
        // Wait for input to disappear which indicates success and modal close
        await page.waitForSelector('#resumeHeadlineTxt', { state: 'hidden', timeout: 10000 });
        log('Update saved successfully!', 'success');
      } catch (e) {
        log('WARNING: Save modal did not disappear automatically. Verifying if update was sent...', 'warning');
        await page.waitForTimeout(3000);
      }

      // Save storage state to keep cookies fresh
      try {
        const state = await browserContext.storageState();
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        log('Session state updated in state.json.', 'info');
      } catch (saveErr) {
        log(`Warning: Failed to save updated session state: ${saveErr.message}`, 'warning');
      }

      await browserContext.close();
      log('Browser closed. Profile refresh sequence complete.', 'info');
      return { success: true, headline: newHeadline };
    }

  } catch (error) {
    log(`AUTOMATION EXCEPTION: ${error.message}`, 'error');
    if (browserContext) {
      try {
        await browserContext.close();
      } catch (e) {}
    }
    return { success: false, error: error.message };
  }
}

/**
 * Launches headful browser to help user log in manually.
 * @param {Function} log - Callback to stream status back
 * @param {Function} onLoginSuccess - Callback when login is successful
 * @param {Function} onClose - Callback when the browser closes
 */
async function launchLoginHelper(log, onLoginSuccess, onClose) {
  let browserContext = null;
  try {
    log('Launching visual browser for login...');
    
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled']
    });

    const pages = browserContext.pages();
    const page = pages.length > 0 ? pages[0] : await browserContext.newPage();

    log('Directing browser to Naukri Login page...');
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'load' });

    log('SYSTEM: Please log in using the opened browser window. Solve any CAPTCHAs or OTPs.', 'info');
    log('SYSTEM: The dashboard will automatically detect when you are logged in.', 'info');

    // Poll the page URL to check if user successfully logged in
    let checkInterval = setInterval(async () => {
      try {
        if (page.isClosed()) {
          clearInterval(checkInterval);
          log('Login browser window closed by user.', 'info');
          return;
        }
        
        const url = page.url();
        const isLoggedIn = url.includes('mnjuser/') || await page.locator('#lazyResumeHead').isVisible().catch(() => false);
        
        if (isLoggedIn) {
          clearInterval(checkInterval);
          log('SUCCESS: Login detected successfully!', 'success');
          onLoginSuccess();
          // Keep it open for 5 seconds so they can see the redirect complete, then close it
          await page.waitForTimeout(5000);
          await browserContext.close();
          log('Visual browser closed.', 'info');
        }
      } catch (e) {
        // Suppress errors during polling if page is closing
      }
    }, 2000);

    // Detect browser close event
    browserContext.on('close', () => {
      clearInterval(checkInterval);
      log('Browser session closed.', 'info');
      if (onClose) onClose();
    });

  } catch (error) {
    log(`LOGIN HELPER ERROR: ${error.message}`, 'error');
    if (browserContext) {
      try {
        await browserContext.close();
      } catch (e) {}
    }
    if (onClose) onClose();
  }
}

/**
 * Exports the active session state from the local user_data directory.
 * @param {Function} log - Callback to stream status back
 * @returns {Promise<Object>} - The storage state object
 */
async function exportSessionState(log) {
  let browserContext = null;
  try {
    log('Launching headless browser to extract storage state...');
    
    if (!fs.existsSync(USER_DATA_DIR)) {
      throw new Error('No local user data directory found. Please log in first.');
    }

    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled']
    });

    log('Extracting session cookies and storage state...');
    const state = await browserContext.storageState();
    
    await browserContext.close();
    log('Session state extracted successfully!', 'success');
    return state;
  } catch (error) {
    log(`EXPORT EXCEPTION: ${error.message}`, 'error');
    if (browserContext) {
      try {
        await browserContext.close();
      } catch (e) {}
    }
    throw error;
  }
}

module.exports = {
  updateProfile,
  launchLoginHelper,
  exportSessionState
};
