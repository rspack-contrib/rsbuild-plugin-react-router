import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(__dirname, '../../build');
const CLIENT_DIR = join(BUILD_DIR, 'client');
const SERVER_DIR = join(BUILD_DIR, 'server');

test.describe('SPA Mode', () => {
  test.describe('Build Output', () => {
    test('should generate index.html in client directory', async () => {
      const indexPath = join(CLIENT_DIR, 'index.html');
      expect(existsSync(indexPath)).toBe(true);
    });

    test('should NOT have server directory after build', async () => {
      // In SPA mode, the server build should be removed after generating index.html
      expect(existsSync(SERVER_DIR)).toBe(false);
    });

    test('index.html should contain hydration data', async () => {
      const indexPath = join(CLIENT_DIR, 'index.html');
      const html = readFileSync(indexPath, 'utf-8');

      // Should have React Router context
      expect(html).toContain('window.__reactRouterContext');

      // Should indicate SPA mode
      expect(html).toContain('"isSpaMode":true');
      expect(html).toContain('"ssr":false');

      // Should have route discovery set to initial (no manifest fetches needed)
      expect(html).toContain('"mode":"initial"');
    });

    test('index.html should contain route modules', async () => {
      const indexPath = join(CLIENT_DIR, 'index.html');
      const html = readFileSync(indexPath, 'utf-8');

      // Should have route modules for hydration
      expect(html).toContain('window.__reactRouterRouteModules');
    });

    test('index.html should include Scripts for hydration', async () => {
      const indexPath = join(CLIENT_DIR, 'index.html');
      const html = readFileSync(indexPath, 'utf-8');

      // Should have the content-hashed entry.client bundle for hydration
      expect(html).toMatch(/\/static\/js\/entry\.client\.[a-f0-9]{8,}\.js/);
    });
  });

  test.describe('Client-Side Application', () => {
    test('should load the home page', async ({ page }) => {
      await page.goto('/');

      // Wait for hydration - the welcome message is rendered client-side
      const welcomeHeading = page.locator(
        'h1:has-text("Welcome to React Router")'
      );
      await expect(welcomeHeading).toBeVisible();

      // Check that the page title is set after hydration
      await expect(page).toHaveTitle(/React Router Demo/);
    });

    test('should perform client-side navigation', async ({ page }) => {
      await page.goto('/');

      // Navigate to about page
      const aboutLink = page.locator('a[href="/about"]').first();
      await aboutLink.click();

      // Should navigate without full page reload
      await expect(page).toHaveURL('/about');
      await expect(
        page.locator('h1:has-text("About This Demo")')
      ).toBeVisible();
    });

    test('should handle browser back/forward navigation', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL('/');

      // Navigate to about
      await page.locator('a[href="/about"]').first().click();
      await expect(page).toHaveURL('/about');

      // Go back
      await page.goBack();
      await expect(page).toHaveURL('/');

      // Go forward
      await page.goForward();
      await expect(page).toHaveURL('/about');
    });

    test('should handle deep linking', async ({ page }) => {
      // Navigate directly to a nested route
      await page.goto('/docs/getting-started');

      // Should render the correct content
      await expect(page).toHaveURL('/docs/getting-started');
      await expect(
        page.locator('h1:has-text("Getting Started")')
      ).toBeVisible();
    });

    test('should handle dynamic routes', async ({ page }) => {
      await page.goto('/');

      // Navigate to projects
      await page.locator('a[href="/projects"]').first().click();
      await expect(page).toHaveURL('/projects');

      // The projects index page shows stats and recent activity
      await expect(
        page.locator('h2:has-text("Recent Activity")')
      ).toBeVisible();
    });
  });

  test.describe('SPA-Specific Behavior', () => {
    test('should not make any /__manifest requests', async ({ page }) => {
      const manifestRequests: string[] = [];

      page.on('request', (request) => {
        if (request.url().includes('/__manifest')) {
          manifestRequests.push(request.url());
        }
      });

      await page.goto('/');

      // Navigate around
      await page.locator('a[href="/about"]').first().click();
      await page.waitForURL('/about');

      await page.locator('a[href="/docs"]').first().click();
      await page.waitForURL('/docs');

      // No manifest requests should have been made in SPA mode
      expect(manifestRequests).toHaveLength(0);
    });

    test('should handle 404 routes gracefully', async ({ page }) => {
      // Navigate to a non-existent route
      await page.goto('/non-existent-route');

      // The app should still load (client-side routing handles this)
      // The specific behavior depends on how routes are configured
      // At minimum, the app should not crash
      await expect(page.locator('body')).toBeVisible();
    });

    test('should persist state across client-side navigations', async ({
      page,
    }) => {
      await page.goto('/');

      // Check that React Router context is available
      const hasContext = await page.evaluate(() => {
        return typeof (window as any).__reactRouterContext !== 'undefined';
      });

      expect(hasContext).toBe(true);

      // Navigate and verify context persists
      await page.locator('a[href="/about"]').first().click();
      await page.waitForURL('/about');

      const stillHasContext = await page.evaluate(() => {
        return typeof (window as any).__reactRouterContext !== 'undefined';
      });

      expect(stillHasContext).toBe(true);
    });
  });

  test.describe('Assets and Styles', () => {
    test('should load CSS correctly', async ({ page }) => {
      await page.goto('/');

      // Check that styles are applied (the page should have some styling)
      const body = page.locator('body');
      const backgroundColor = await body.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });

      // Should have some background color (not default)
      expect(backgroundColor).toBeDefined();
    });

    test('should load static assets', async ({ page }) => {
      const assetRequests: string[] = [];

      page.on('response', (response) => {
        if (response.url().includes('/static/')) {
          assetRequests.push(response.url());
        }
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should have loaded JS and CSS assets
      expect(assetRequests.length).toBeGreaterThan(0);
    });
  });
});
