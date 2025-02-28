import { test, expect } from '@playwright/test';

test.describe('About Page', () => {
  test('should display about page content and team members', async ({ page }) => {
    // Navigate to about page
    await page.goto('/about');
    
    // Check page heading
    const heading = page.locator('h1:has-text("About This Demo")');
    await expect(heading).toBeVisible();
    
    // Check team member cards
    const teamCards = page.locator('.card');
    await expect(teamCards).toHaveCount(3);
    
    // Verify each team member
    const expectedMembers = ['React Router', 'Tailwind CSS', 'TypeScript'];
    for (let i = 0; i < expectedMembers.length; i++) {
      const memberName = expectedMembers[i];
      await expect(teamCards.nth(i).locator('h2')).toContainText(memberName);
    }
    
    // Check that back to home link works
    const backLink = page.locator('a:has-text("← Back to Home")');
    await expect(backLink).toBeVisible();
    await backLink.click();
    
    // Verify navigation back to home page
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('h1:has-text("Welcome to React Router")')).toBeVisible();
  });
  
  test('should have working external links', async ({ page }) => {
    // Navigate to about page
    await page.goto('/about');
    
    // Get all external links
    const externalLinks = page.locator('.card a[target="_blank"]');
    
    // Verify each link has correct attributes
    for (const link of await externalLinks.all()) {
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveText('Learn more →');
    }
  });
}); 