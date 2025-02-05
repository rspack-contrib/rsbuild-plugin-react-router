import { Link } from 'react-router';

export function handle() {
  return {
    breadcrumb: () => 'Introduction',
  };
}

const exampleCode = `import { createBrowserRouter } from "react-router-dom";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      {
        path: "dashboard",
        element: <Dashboard />,
      },
    ],
  },
]);`;

export default function DocsIndex() {
  return (
    <article className="max-w-none">
      <div className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          Introduction to React Router
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed">
          React Router is a powerful routing library for React applications that
          enables you to build single-page applications with dynamic, client-side
          routing.
        </p>
      </div>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Key Features</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-6 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
            <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-2">Dynamic Routes</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Create routes with URL parameters and handle them dynamically
            </p>
          </div>
          <div className="p-6 rounded-lg bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
            <h3 className="font-semibold text-purple-700 dark:text-purple-300 mb-2">Nested Routes</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Organize your application with nested layouts and routes
            </p>
          </div>
          <div className="p-6 rounded-lg bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
            <h3 className="font-semibold text-green-700 dark:text-green-300 mb-2">Route Protection</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Implement authentication and protect sensitive routes
            </p>
          </div>
          <div className="p-6 rounded-lg bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
            <h3 className="font-semibold text-orange-700 dark:text-orange-300 mb-2">Data Loading</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Load data for your routes before rendering
            </p>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Getting Started</h2>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-6 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors">
          <p className="text-lg mb-4">
            Ready to start building? Check out our{' '}
            <Link
              to="/docs/getting-started"
              className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium group"
            >
              Getting Started guide
              <svg 
                className="ml-1 w-4 h-4 transform group-hover:translate-x-1 transition-transform" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </p>
          <p className="text-gray-600 dark:text-gray-300">
            Learn the fundamentals and best practices to get up and running quickly.
          </p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Example Usage</h2>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{exampleCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => {
                navigator.clipboard.writeText(exampleCode);
                // You could add a toast notification here
              }}
              className="p-2 text-gray-400 hover:text-gray-200 rounded-md transition-colors"
              title="Copy to clipboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Next Steps</h2>
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 hover:from-blue-100 hover:to-purple-100 dark:hover:from-blue-900/30 dark:hover:to-purple-900/30 transition-colors">
          <p className="text-lg mb-2">
            Once you're comfortable with the basics, explore our{' '}
            <Link
              to="/docs/advanced"
              className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium group"
            >
              Advanced Concepts
              <svg 
                className="ml-1 w-4 h-4 transform group-hover:translate-x-1 transition-transform" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </p>
          <p className="text-gray-600 dark:text-gray-300">
            Dive deeper into powerful features like data loading, error boundaries, and more.
          </p>
        </div>
      </section>
    </article>
  );
}
