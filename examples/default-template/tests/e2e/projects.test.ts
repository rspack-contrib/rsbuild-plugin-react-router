import { test, expect } from '@playwright/test';

test.describe('Projects Section', () => {
  test('should display projects listing', async ({ page }) => {
    // Navigate to projects index
    await page.goto('/projects');
    
    // Verify the projects index page URL
    await expect(page).toHaveURL('/projects');
    
    // Verify the Projects link in nav is active
    const projectsLink = page.locator('a.nav-link[href="/projects"]');
    await expect(projectsLink).toBeVisible();
    await expect(projectsLink).toHaveAttribute('aria-current', 'page');
  });
  
  test('should navigate to project detail page', async ({ page }) => {
    const projectId = 'react-router';
    
    // Go directly to the project page
    await page.goto(`/projects/${projectId}`);
    
    // Verify we're on the correct page
    await expect(page).toHaveURL(`/projects/${projectId}`);
    
    // Check project name is displayed
    const projectName = page.locator('h1').first();
    await expect(projectName).toBeVisible();
    
    // Check edit and settings links in the navigation
    const editLink = page.locator(`a[href="/projects/${projectId}/edit"]`);
    await expect(editLink).toBeVisible();
    
    const settingsLink = page.locator(`a[href="/projects/${projectId}/settings"]`);
    await expect(settingsLink).toBeVisible();
    
    // Check sections
    const sections = page.locator('.card h2').filter({ 
      hasText: /Progress|Team|Recent Activity/ 
    });
    await expect(sections).toHaveCount(3);
  });
  
  test('should navigate to project edit page', async ({ page }) => {
    const projectId = 'react-router';
    
    // Go to the project detail page
    await page.goto(`/projects/${projectId}`);
    
    // Click the edit link
    const editLink = page.locator(`a[href="/projects/${projectId}/edit"]`);
    await editLink.click();
    
    // Verify we're on the edit page
    await expect(page).toHaveURL(`/projects/${projectId}/edit`);
  });
  
  test('should navigate to project settings page', async ({ page }) => {
    const projectId = 'react-router';
    
    // Go to the project detail page
    await page.goto(`/projects/${projectId}`);
    
    // Click the settings link
    const settingsLink = page.locator(`a[href="/projects/${projectId}/settings"]`);
    await settingsLink.click();
    
    // Verify we're on the settings page
    await expect(page).toHaveURL(`/projects/${projectId}/settings`);
  });
}); 