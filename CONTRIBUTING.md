# Contributing to rsbuild-plugin-react-router

## Development Workflow

1. Fork and clone the repository
2. Install dependencies with `pnpm install`
3. Make changes
4. Run tests with `pnpm test`
5. Create a changeset (see below)
6. Submit a pull request

## Changesets

We use [changesets](https://github.com/changesets/changesets) to manage our versioning and release process.

> **Note:** Only the `plugin-react-router` package is configured for release. Other packages in the monorepo are ignored by the changesets process.

### Creating a Changeset

After making your changes, create a changeset to document what you've changed:

```bash
pnpm changeset
```

This will:
1. Ask you what kind of change you've made (patch, minor, or major)
2. Ask for a summary of your changes
3. Create a new file in the `.changeset` directory

The changeset file should be committed to the repository along with your changes.

### Versioning Guidelines

- **Patch**: Bug fixes and small changes that don't affect the public API
- **Minor**: New features that don't break backward compatibility
- **Major**: Changes that break backward compatibility

## Release Process

The release process is handled automatically by GitHub Actions when changes are merged to the main branch. The workflow will:

1. Create a pull request with all pending changes
2. When the PR is merged, publish the new version to npm

If you need to trigger a release manually, run:

```bash
pnpm version
pnpm release
``` 
