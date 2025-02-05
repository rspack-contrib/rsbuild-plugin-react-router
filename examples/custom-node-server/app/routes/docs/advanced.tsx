import { Link } from 'react-router';

export function handle() {
  return {
    breadcrumb: () => 'Advanced Concepts',
  };
}

const loaderCode = `// Route definition
{
  path: "projects/:projectId",
  element: <Project />,
  loader: async ({ params }) => {
    const project = await fetchProject(params.projectId);
    if (!project) {
      throw new Response("", { status: 404 });
    }
    return project;
  },
}

// Component
function Project() {
  const project = useLoaderData();
  return <h1>{project.name}</h1>;
}`;

const actionCode = `// Route definition
{
  path: "projects/new",
  element: <NewProject />,
  action: async ({ request }) => {
    const formData = await request.formData();
    const project = await createProject(formData);
    return redirect(\`/projects/\${project.id}\`);
  },
}

// Component
function NewProject() {
  const { state } = useNavigation();
  const isSubmitting = state === "submitting";

  return (
    <Form method="post">
      <input name="name" type="text" />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create Project"}
      </button>
    </Form>
  );
}`;

const errorCode = `// Route definition
{
  path: "projects/:projectId",
  element: <Project />,
  errorElement: <ProjectError />,
}

// Error component
function ProjectError() {
  const error = useRouteError();
  return (
    <div className="error-container">
      <h1>Oops!</h1>
      <p>{error.message}</p>
    </div>
  );
}`;

export default function Advanced() {
  return (
    <article className="max-w-none">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          Advanced React Router Concepts
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed">
          Explore powerful features like data loading, form handling, and error boundaries.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Data Loading with Loaders</h2>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 mb-6">
          <p className="text-gray-700 dark:text-gray-300">
            Loaders let you load data before rendering a route. They run before the
            route is rendered and their data is available to the component via the{' '}
            <code className="px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-400 text-sm">
              useLoaderData
            </code>{' '}
            hook.
          </p>
        </div>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{loaderCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(loaderCode)}
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
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Form Handling with Actions</h2>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-6 mb-6">
          <p className="text-gray-700 dark:text-gray-300">
            Actions handle form submissions and other data mutations. They work with
            the{' '}
            <code className="px-2 py-1 rounded-md bg-purple-100 dark:bg-purple-800 text-purple-600 dark:text-purple-400 text-sm">
              Form
            </code>{' '}
            component to provide a seamless form handling experience.
          </p>
        </div>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{actionCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(actionCode)}
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
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Error Handling</h2>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6 mb-6">
          <p className="text-gray-700 dark:text-gray-300">
            Error boundaries catch errors during rendering, data loading, and data mutations.
            They provide a way to gracefully handle errors and show user-friendly error messages.
          </p>
        </div>
        <div className="relative group">
          <pre className="bg-gray-900 text-gray-100 p-6 rounded-lg overflow-x-auto">
            <code className="text-sm font-mono">{errorCode}</code>
          </pre>
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => navigator.clipboard.writeText(errorCode)}
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
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Try It Out</h2>
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 hover:from-blue-100 hover:to-purple-100 dark:hover:from-blue-900/30 dark:hover:to-purple-900/30 transition-colors">
          <p className="text-lg mb-2">
            Check out our{' '}
            <Link
              to="/projects"
              className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium group"
            >
              Projects Demo
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
            See these advanced concepts in action with a real-world example.
          </p>
        </div>
      </section>
    </article>
  );
}
