import { test, expect } from '@playwright/test';

test.describe('Projects Section', () => {
  test('should display projects listing', async ({ page }) => {
    // Navigate to projects index
    await page.goto('/projects');
    
    // Verify the projects index page URL
    await expect(page).toHaveURL('/projects');
  });
  
  test('should navigate to project detail page', async ({ page }) => {
    // We'll test with a known project ID 
    // Since this is a demo app, we can use 'react-router' as the ID
    const projectId = 'react-router';
    
    // Go directly to the project page
    await page.goto(`/projects/${projectId}`);
    
    // Verify we're on the correct page
    await expect(page).toHaveURL(`/projects/${projectId}`);
    
    // Check project name is displayed
    const projectName = page.locator('h1').first();
    await expect(projectName).toBeVisible();
    
    // Check edit and settings links
    const editLink = page.locator('a[href="edit"]');
    await expect(editLink).toBeVisible();
    
    const settingsLink = page.locator('a[href="settings"]');
    await expect(settingsLink).toBeVisible();
    
    // Check progress section
    const progressSection = page.locator('.card:has-text("Progress")');
    await expect(progressSection).toBeVisible();
    
    // Check team section
    const teamSection = page.locator('.card:has-text("Team")');
    await expect(teamSection).toBeVisible();
    
    // Check activity section
    const activitySection = page.locator('.card:has-text("Recent Activity")');
    await expect(activitySection).toBeVisible();
  });
  
  test('should navigate to project edit page', async ({ page }) => {
    const projectId = 'react-router';
    
    // Go to the project detail page
    await page.goto(`/projects/${projectId}`);
    
    // Click the edit link
    const editLink = page.locator('a:has-text("Edit")');
    await editLink.click();
    
    // Verify we're on the edit page
    await expect(page).toHaveURL(`/projects/${projectId}/edit`);
  });
  
  test('should navigate to project settings page', async ({ page }) => {
    const projectId = 'react-router';
    
    // Go to the project detail page
    await page.goto(`/projects/${projectId}`);
    
    // Click the settings link
    const settingsLink = page.locator('a:has-text("Settings")');
    await settingsLink.click();
    
    // Verify we're on the settings page
    await expect(page).toHaveURL(`/projects/${projectId}/settings`);
  });
}); 