/**
 * Local Auth Capture Module
 * 
 * Opens a local Chrome browser for the user to log in,
 * then captures the auth state (cookies, localStorage) and
 * uploads it to Cosmic for use with computer use agents.
 */

import puppeteer, { Browser, Page, Cookie } from 'puppeteer';
import chalk from 'chalk';
import { existsSync } from 'fs';

export interface AuthState {
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/**
 * Find the system Chrome executable path
 */
function findChromeExecutable(): string | undefined {
  const possiblePaths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // Windows (common paths)
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const chromePath of possiblePaths) {
    if (chromePath && existsSync(chromePath)) {
      return chromePath;
    }
  }

  return undefined;
}

export interface CaptureResult {
  authState: AuthState;
  url: string;
  domain: string;
}

/**
 * Open a local browser for auth capture
 * Returns the captured auth state when the user closes the browser
 */
export async function captureAuthLocally(
  startUrl: string,
  options: {
    headless?: boolean;
    timeout?: number;
    onStatus?: (message: string) => void;
  } = {}
): Promise<CaptureResult> {
  const {
    headless = false, // Default to showing the browser
    timeout = 600000, // 10 minute timeout
    onStatus = () => { },
  } = options;

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    onStatus('Launching browser...');

    browser = await puppeteer.launch({
      headless,
      defaultViewport: { width: 1280, height: 800 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    page = await browser.newPage();

    // Remove automation detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    onStatus(`Navigating to ${startUrl}...`);
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const domain = new URL(startUrl).hostname;
    onStatus(`Browser opened. Please log in to ${domain}`);
    onStatus(chalk.yellow('Close the browser window when you\'re done logging in.'));

    // Wait for the browser to close or timeout
    const closePromise = new Promise<void>((resolve) => {
      browser!.on('disconnected', () => {
        resolve();
      });
    });

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Auth capture timed out after ${timeout / 1000} seconds`));
      }, timeout);
    });

    // Wait for browser close or timeout
    await Promise.race([closePromise, timeoutPromise]).catch(async (err) => {
      // If timeout, close the browser
      if (browser) {
        await browser.close().catch(() => { });
      }
      throw err;
    });

    // If we get here, the browser was closed by the user
    // We need to capture the auth state before that happens
    // So we'll use a different approach: poll for disconnection

  } catch (error) {
    if (browser) {
      await browser.close().catch(() => { });
    }
    throw error;
  }

  // This approach won't work because browser is disconnected
  // We need to capture BEFORE close. Let me refactor...
  throw new Error('Browser closed before auth could be captured');
}

/**
 * Capture auth with a "Done" button approach
 * Opens browser, adds a "Done" button, and captures when clicked
 */
export async function captureAuthWithDoneButton(
  startUrl: string,
  options: {
    headless?: boolean;
    timeout?: number;
    onStatus?: (message: string) => void;
  } = {}
): Promise<CaptureResult> {
  const {
    headless = false,
    timeout = 600000,
    onStatus = () => { },
  } = options;

  let browser: Browser | null = null;

  try {
    onStatus('Launching browser...');

    // Find system Chrome - most users have it installed
    const executablePath = findChromeExecutable();
    if (!executablePath) {
      throw new Error(
        'Chrome not found. Please install Google Chrome from https://www.google.com/chrome/\n' +
        'Or run: npx puppeteer browsers install chrome'
      );
    }

    browser = await puppeteer.launch({
      headless,
      executablePath,
      defaultViewport: { width: 1280, height: 800 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    const page = await browser.newPage();

    // Remove automation detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    onStatus(`Navigating to ${startUrl}...`);
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const domain = new URL(startUrl).hostname;

    // Inject a floating "Done - Capture Auth" button
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.id = 'cosmic-auth-banner';
      banner.innerHTML = `
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
          padding: 12px 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        ">
          <span>🔐 <strong>Cosmic Auth Capture</strong> — Log in to this site, then click the button when done</span>
          <button id="cosmic-done-btn" style="
            background: white;
            color: #6366f1;
            border: none;
            padding: 8px 20px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            transition: transform 0.1s;
          ">
            ✓ Done - Capture Auth
          </button>
        </div>
      `;
      document.body.appendChild(banner);

      // Add hover effect
      const btn = document.getElementById('cosmic-done-btn');
      if (btn) {
        btn.addEventListener('mouseenter', () => {
          btn.style.transform = 'scale(1.05)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.transform = 'scale(1)';
        });
      }
    });

    onStatus(`Browser opened at ${domain}`);
    onStatus(chalk.cyan('Log in to the site, then click "Done - Capture Auth" in the banner.'));

    // Wait for the done button to be clicked
    const donePromise = page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const btn = document.getElementById('cosmic-done-btn');
        if (btn) {
          btn.addEventListener('click', () => {
            // Visual feedback
            btn.textContent = '⏳ Capturing...';
            btn.setAttribute('disabled', 'true');
            resolve();
          });
        }
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Auth capture timed out after ${timeout / 1000} seconds`));
      }, timeout);
    });

    // Also listen for browser close
    const closePromise = new Promise<never>((_, reject) => {
      browser!.on('disconnected', () => {
        reject(new Error('Browser was closed before auth was captured'));
      });
    });

    // Wait for done click, timeout, or browser close
    await Promise.race([donePromise, timeoutPromise, closePromise]);

    onStatus('Capturing authentication state...');

    // Capture cookies
    const cookies = await page.cookies();

    // Capture localStorage and sessionStorage
    const storageData = await page.evaluate(() => {
      const local: Record<string, string> = {};
      const session: Record<string, string> = {};

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          local[key] = localStorage.getItem(key) || '';
        }
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          session[key] = sessionStorage.getItem(key) || '';
        }
      }

      return { localStorage: local, sessionStorage: session };
    });

    // Get current URL (might have changed after login)
    const currentUrl = page.url();

    onStatus('Closing browser...');
    await browser.close();
    browser = null;

    const result: CaptureResult = {
      authState: {
        cookies,
        localStorage: storageData.localStorage,
        sessionStorage: storageData.sessionStorage,
      },
      url: currentUrl,
      domain: new URL(currentUrl).hostname,
    };

    onStatus(chalk.green(`✓ Captured ${cookies.length} cookies and ${Object.keys(storageData.localStorage).length} localStorage items`));

    return result;

  } catch (error) {
    if (browser) {
      await browser.close().catch(() => { });
    }
    throw error;
  }
}

/**
 * Format captured cookies for the Cosmic API
 */
export function formatCookiesForApi(cookies: Cookie[]): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}> {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  }));
}

/**
 * Format localStorage for the Cosmic API
 */
export function formatLocalStorageForApi(
  localStorage: Record<string, string>
): Array<{ name: string; value: string }> {
  return Object.entries(localStorage).map(([name, value]) => ({
    name,
    value,
  }));
}
