import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The landing page or the default resume, per host (issue #70). */}
        <Route path="/" element={<HomePage />} />
        <Route path="/resume" element={<ResumeRoute />} />
        <Route path="/print" element={<PublicResumePage mode="print" />} />
        <Route path="/print/letter" element={<LetterPrintPage />} />
        <Route path="/print/card" element={<ShareCardPrintPage />} />
        <Route path="/r/:slug" element={<SlugResumePage />} />
        <Route path="/template-preview" element={<TemplatePreviewPage />} />
        <Route path="/template-preview/preset/:id" element={<TemplatePreviewPage />} />
        <Route path="/editor" element={<EditorGate />} />
      </Routes>
    </BrowserRouter>
  );
}
