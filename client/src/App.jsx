import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { api } from './api.js';
import { PublicResumePage } from './resume/PublicResumePage.jsx';
import { LoginPage } from './editor/LoginPage.jsx';
import { EditorPage } from './editor/EditorPage.jsx';
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
  return <EditorPage onLogout={() => setStatus('anon')} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicResumePage mode="web" />} />
        <Route path="/print" element={<PublicResumePage mode="print" />} />
        <Route path="/editor" element={<EditorGate />} />
      </Routes>
    </BrowserRouter>
  );
}
