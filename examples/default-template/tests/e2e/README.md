# End-to-End Tests

This directory contains end-to-end tests for the React Router default template application using Playwright.

## Test Structure

The tests are organized by feature area:

- `home.test.ts` - Tests for the home page and welcome component
- `about.test.ts` - Tests for the about page
- `docs.test.ts` - Tests for the docs section with nested routes
- `projects.test.ts` - Tests for the projects section with dynamic routes
- `navigation.test.ts` - General navigation flows across the application

## Running Tests

You can run the tests using the following npm scripts:

```bash
# Run all tests
npm run test:e2e

# Run tests with the Playwright UI
npm run test:e2e:ui

# Run tests in debug mode
npm run test:e2e:debug
```

## Test Configuration

Test configuration is defined in `playwright.config.ts` in the project root. The configuration:

- Runs tests in the `tests/e2e` directory
- Tests across multiple browsers (Chrome, Firefox, Safari)
- Tests across desktop and mobile viewports
- Automatically starts the development server before running tests
- Takes screenshots on test failures
- Generates HTML reports

## Adding New Tests

To add new tests:

1. Create a new file in the `tests/e2e` directory with the `.test.ts` extension
2. Import the required Playwright utilities:
   ```typescript
   import { test, expect } from '@playwright/test';
   ```
3. Write your tests using the Playwright API
4. Run your tests with `npm run test:e2e`

## Generating Base Screenshots

If you need to generate baseline screenshots for visual comparison:

```bash
npx playwright test --update-snapshots
```

## CI Integration

These tests can be integrated into CI pipelines. The configuration includes special settings for CI environments:

- More retries on CI
- Forbidding `.only` tests on CI
- Not reusing existing servers on CI 