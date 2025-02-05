import { Link } from 'react-router';

export function handle() {
  return {
    breadcrumb: () => 'Getting Started',
  };
}

const installCode = `# Using npm
npm install react-router-dom

# Using yarn
yarn add react-router-dom

# Using pnpm
pnpm add react-router-dom`;

const setupCode = `import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Root from "./routes/root";
import ErrorPage from "./error-page";
import Contact from "./routes/contact";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "contacts/:contactId",
        element: <Contact />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);`;

const paramsCode = `function Contact() {
  const { contactId } = useParams();
  return <h1>Contact {contactId}</h1>;
}`;

export default function GettingStarted() {
  return (
    <article className="max-w-none">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          Getting Started with React Router
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed">
          Learn how to add React Router to your project and create your first routes.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Installation</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          First, install React Router using your preferred package manager:
        </p>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{installCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(installCode)}
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
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Basic Setup</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Create a router instance and wrap your app with{' '}
          <code className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 text-sm">
            RouterProvider
          </code>:
        </p>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{setupCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(setupCode)}
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
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Creating Routes</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Routes are defined as objects with the following properties:
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div className="p-6 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-2">path</h3>
            <p className="text-gray-600 dark:text-gray-300">
              The URL pattern for this route
            </p>
          </div>
          <div className="p-6 rounded-lg bg-purple-50 dark:bg-purple-900/20">
            <h3 className="font-semibold text-purple-700 dark:text-purple-300 mb-2">element</h3>
            <p className="text-gray-600 dark:text-gray-300">
              The component to render for this route
            </p>
          </div>
          <div className="p-6 rounded-lg bg-green-50 dark:bg-green-900/20">
            <h3 className="font-semibold text-green-700 dark:text-green-300 mb-2">errorElement</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Component to render when an error occurs
            </p>
          </div>
          <div className="p-6 rounded-lg bg-orange-50 dark:bg-orange-900/20">
            <h3 className="font-semibold text-orange-700 dark:text-orange-300 mb-2">children</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Nested routes configuration
            </p>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">URL Parameters</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Dynamic segments in your routes are marked with a colon, like{' '}
          <code className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 text-sm">
            :contactId
          </code>{' '}
          in the example above. Access these parameters using the{' '}
          <code className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 text-sm">
            useParams
          </code>{' '}
          hook:
        </p>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{paramsCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(paramsCode)}
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
        <div className="bg-linear-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 hover:from-blue-100 hover:to-purple-100 dark:hover:from-blue-900/30 dark:hover:to-purple-900/30 transition-colors">
          <p className="text-lg mb-2">
            Now that you understand the basics, check out the{' '}
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
            Learn about loaders, actions, and more advanced routing features.
          </p>
        </div>
      </section>
    </article>
  );
}
