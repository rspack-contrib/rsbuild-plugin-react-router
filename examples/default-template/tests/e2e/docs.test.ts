import { test, expect } from '@playwright/test';

test.describe('Docs Section', () => {
  test('should navigate through docs section with nested routes', async ({ page }) => {
    // Navigate to docs index
    await page.goto('/docs');
    
    // Verify the docs index page is shown
    await expect(page).toHaveURL('/docs');
    
    // Navigate to getting-started page
    await page.goto('/docs/getting-started');
    await expect(page).toHaveURL('/docs/getting-started');
    
    // Navigate to advanced page
    await page.goto('/docs/advanced');
    await expect(page).toHaveURL('/docs/advanced');
    
    // Verify layouts are preserved during navigation
    await page.goto('/docs');
    
    // Check for the main navigation menu
    const mainNav = page.locator('header nav');
    await expect(mainNav).toBeVisible();
    await expect(mainNav.locator('a[href="/docs"]')).toBeVisible();
  });
  
  test('should preserve layout when navigating between nested routes', async ({ page }) => {
    // Start at docs index
    await page.goto('/docs');
    
    // Click on the Documentation link in the main nav
    const mainNav = page.locator('header nav');
    const docsLink = mainNav.locator('a[href="/docs"]');
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute('aria-current', 'page');
    
    // Navigate to getting-started
    await page.goto('/docs/getting-started');
    await expect(page).toHaveURL('/docs/getting-started');
    
    // The main navigation should still be visible
    await expect(mainNav).toBeVisible();
    await expect(docsLink).toBeVisible();
    
    // Navigate to advanced
    await page.goto('/docs/advanced');
    await expect(page).toHaveURL('/docs/advanced');
    
    // Navigation should still be preserved
    await expect(mainNav).toBeVisible();
    await expect(docsLink).toBeVisible();
  });
}); 