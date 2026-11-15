import { RouterProvider, createBrowserRouter, useParams } from 'react-router-dom';
import { PublicResumePage } from './resume/PublicResumePage.jsx';
import { HomePage, ResumeRoute } from './landing/HomePage.jsx';
import { lazyRoute } from './lazyRoute.js';
import { RouteError, RouteLoading } from './RouteFallback.jsx';

// A resume's public link (issue #53). Keyed by the slug so following a link
// to another one starts from a blank page, not the previous resume.
function SlugResumePage() {
  const { slug } = useParams();
  return <PublicResumePage key={slug} mode="web" slug={slug} />;
}

// A page in a chunk of its own (issue #179), so a visitor to the public
// pages never downloads it. The import() has to be written out at each
// call for the build to split it. The router keeps the current page up
// while a chunk loads on navigation; RouteLoading is only for a page opened
// directly, and RouteError for a chunk that didn't load (lazyRoute.js).
function lazyPage(path, load, name) {
  return {
    path,
    lazy: lazyRoute(load, name),
    hydrateFallbackElement: <RouteLoading />,
    errorElement: <RouteError />,
  };
}

// A data router, not <BrowserRouter>: the editor's leave guard
// (editor/useLeaveGuard.js, issue #105) needs useBlocker, which only works
// with one. Nothing here loads data through it; every page fetches its own.
// The catch-all keeps an unknown path as blank as it was under <Routes>
// (the server only sends the shell for paths without a file extension),
// rather than the data router's built-in 404 screen.
//
// What a visitor sees stays in the main chunk: the landing page, the
// resumes, and /print, which is the same PublicResumePage. The editor
// (login included, with editor.css), the template previews, and the
// letter and share card pages the server renders (pdfRenderer.js, which
// waits for the page's __PDF_READY__, so for its chunk too) load lazily.
const router = createBrowserRouter([
  // The landing page or the default resume, per host (issue #70).
  { path: '/', element: <HomePage /> },
  { path: '/resume', element: <ResumeRoute /> },
  { path: '/print', element: <PublicResumePage mode="print" /> },
  lazyPage('/print/letter', () => import('./letters/LetterPrintPage.jsx'), 'LetterPrintPage'),
  lazyPage('/print/card', () => import('./share/ShareCardPrintPage.jsx'), 'ShareCardPrintPage'),
  { path: '/r/:slug', element: <SlugResumePage /> },
  lazyPage('/template-preview', () => import('./resume/TemplatePreviewPage.jsx'), 'TemplatePreviewPage'),
  lazyPage('/template-preview/preset/:id', () => import('./resume/TemplatePreviewPage.jsx'), 'TemplatePreviewPage'),
  lazyPage('/editor', () => import('./editor/EditorRoute.jsx'), 'EditorGate'),
  { path: '*', element: null },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
