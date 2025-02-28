import { test, expect } from '@playwright/test';

test.describe('Navigation Flow', () => {
  test('should navigate through all major sections of the app', async ({ page }) => {
    // Start at the home page
    await page.goto('/');
    await expect(page).toHaveURL('/');
    
    // Navigate to about page
    await page.goto('/about');
    await expect(page).toHaveURL('/about');
    
    // Navigate to docs section
    await page.goto('/docs');
    await expect(page).toHaveURL('/docs');
    
    // Navigate to projects section
    await page.goto('/projects');
    await expect(page).toHaveURL('/projects');
    
    // Navigate to a specific project
    const projectId = 'react-router';
    await page.goto(`/projects/${projectId}`);
    await expect(page).toHaveURL(`/projects/${projectId}`);
  });
}); 