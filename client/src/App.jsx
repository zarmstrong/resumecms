import { useEffect, useState } from 'react';
import { RouterProvider, createBrowserRouter, useParams } from 'react-router-dom';
import { api } from './api.js';
import { PublicResumePage } from './resume/PublicResumePage.jsx';
import { TemplatePreviewPage } from './resume/TemplatePreviewPage.jsx';
import { HomePage, ResumeRoute } from './landing/HomePage.jsx';
import { LetterPrintPage } from './letters/LetterPrintPage.jsx';
import { ShareCardPrintPage } from './share/ShareCardPrintPage.jsx';
import { LoginPage } from './editor/LoginPage.jsx';
import { ResumesEditor } from './editor/ResumesEditor.jsx';
import './editor/editor.css';

function EditorGate() {
  const [status, setStatus] = useState('checking'); // checking | authed | anon

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setStatus(s.authenticated ? 'authed' : 'anon'))
      .catch(() => setStatus('anon'));
  }, []);

  if (status === 'checking') return null;
  if (status === 'anon') return <LoginPage onAuthenticated={() => setStatus('authed')} />;
  return <ResumesEditor onLogout={() => setStatus('anon')} />;
}

// A resume's public link (issue #53). Keyed by the slug so following a link
// to another one starts from a blank page, not the previous resume.
function SlugResumePage() {
  const { slug } = useParams();
  return <PublicResumePage key={slug} mode="web" slug={slug} />;
}

// A data router, not <BrowserRouter>: the editor's leave guard
// (editor/useLeaveGuard.js, issue #105) needs useBlocker, which only works
// with one. Nothing here loads data through it; every page fetches its own.
// The catch-all keeps an unknown path as blank as it was under <Routes>
// (the server only sends the shell for paths without a file extension),
// rather than the data router's built-in 404 screen.
const router = createBrowserRouter([
  // The landing page or the default resume, per host (issue #70).
  { path: '/', element: <HomePage /> },
  { path: '/resume', element: <ResumeRoute /> },
  { path: '/print', element: <PublicResumePage mode="print" /> },
  { path: '/print/letter', element: <LetterPrintPage /> },
  { path: '/print/card', element: <ShareCardPrintPage /> },
  { path: '/r/:slug', element: <SlugResumePage /> },
  { path: '/template-preview', element: <TemplatePreviewPage /> },
  { path: '/template-preview/preset/:id', element: <TemplatePreviewPage /> },
  { path: '/editor', element: <EditorGate /> },
  { path: '*', element: null },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
