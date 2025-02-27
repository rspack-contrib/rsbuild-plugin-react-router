import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display welcome message and feature cards', async ({ page }) => {
    // Navigate to home page
    await page.goto('/');
    
    // Check page title
    await expect(page).toHaveTitle(/React Router Demo/);
    
    // Check welcome message
    const welcomeHeading = page.locator('h1:has-text("Welcome to React Router")');
    await expect(welcomeHeading).toBeVisible();
    
    // Check feature cards (there should be 3)
    const featureCards = page.locator('.card:has(h2)').filter({ hasText: /Dynamic Routing|Nested Routes|Route Protection/ });
    await expect(featureCards).toHaveCount(3);
    
    // Test hover state on a feature card
    const firstFeatureCard = featureCards.first();
    await firstFeatureCard.hover();
    await expect(firstFeatureCard).toHaveClass(/ring-2 ring-blue-500/);
    
    // Test link to about page
    const aboutPageLink = page.locator('a.bg-blue-600').filter({ hasText: 'View About Page' });
    await expect(aboutPageLink).toBeVisible();
    await aboutPageLink.click();
    
    // Verify navigation to about page
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator('h1:has-text("About This Demo")')).toBeVisible();
  });
  
  test('should have working resource links', async ({ page }) => {
    // Navigate to home page
    await page.goto('/');
    
    // Check resource cards
    const resourceLinks = page.locator('a.card').filter({ 
      hasText: /React Router Documentation|GitHub Repository|React Router Blog/ 
    });
    await expect(resourceLinks).toHaveCount(3);
    
    // Test that links have proper attributes
    for (const link of await resourceLinks.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });
}); 