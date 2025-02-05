import { Link, NavLink, Outlet } from 'react-router';

const sidebarItems = [
  { to: '/docs', label: 'Introduction', exact: true },
  { to: '/docs/getting-started', label: 'Getting Started' },
  { to: '/docs/advanced', label: 'Advanced Concepts' },
];

export function handle() {
  return {
    breadcrumb: () => 'Documentation',
  };
}

export default function DocsLayout() {
  return (
    <div className="page-container bg-white dark:bg-gray-900">
      <div className="max-w-8xl mx-auto px-4 sm:px-6 md:px-8">
        <div className="flex">
          {/* Sidebar */}
          <aside className="hidden md:block w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800">
            <div className="sticky top-16 pt-8 pb-4 overflow-y-auto h-[calc(100vh-4rem)]">
              <div className="mb-8">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">
                  Documentation
                </h3>
                <nav className="space-y-1">
                  {sidebarItems.map(({ to, label, exact }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }: { isActive: boolean }) =>
                        `group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-100'
                            : 'text-gray-700 dark:text-gray-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 dark:hover:text-blue-100'
                        }`
                      }
                      end={exact}
                    >
                      {label}
                    </NavLink>
                  ))}
                </nav>
              </div>

              {/* Quick Links */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">
                  Quick Links
                </h3>
                <div className="space-y-2">
                  <a
                    href="https://github.com/web-infra-dev/rsbuild"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 dark:hover:text-blue-100 rounded-md transition-colors"
                  >
                    <svg className="mr-3 h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                    GitHub
                  </a>
                  <a
                    href="https://rsbuild.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 dark:hover:text-blue-100 rounded-md transition-colors"
                  >
                    <svg className="mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Website
                  </a>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 py-8 px-4 md:px-8">
            <div className="prose dark:prose-invert max-w-none">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
