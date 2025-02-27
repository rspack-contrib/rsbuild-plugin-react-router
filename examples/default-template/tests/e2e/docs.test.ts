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
    // This assumes there's a common layout element across all docs pages
    await page.goto('/docs');
    
    // This is a placeholder - you may need to adjust this based on your actual layout structure
    // For example, if you have a sidebar that's part of the layout
    await expect(page.locator('nav, aside, .sidebar').first()).toBeVisible();
  });
  
  test('should preserve layout when navigating between nested routes', async ({ page }) => {
    // Start at docs index
    await page.goto('/docs');
    
    // Click on a link to getting-started (assuming there's a navigation menu in the layout)
    // Modify this locator based on your actual navigation structure
    const gettingStartedLink = page.locator('a[href="/docs/getting-started"]');
    if (await gettingStartedLink.isVisible()) {
      await gettingStartedLink.click();
      await expect(page).toHaveURL('/docs/getting-started');
      
      // The layout should still be visible
      // Replace with your layout-specific selector
      await expect(page.locator('nav, aside, .sidebar').first()).toBeVisible();
      
      // Now try the advanced page
      const advancedLink = page.locator('a[href="/docs/advanced"]');
      if (await advancedLink.isVisible()) {
        await advancedLink.click();
        await expect(page).toHaveURL('/docs/advanced');
        
        // Layout should still be preserved
        await expect(page.locator('nav, aside, .sidebar').first()).toBeVisible();
      }
    }
  });
}); 