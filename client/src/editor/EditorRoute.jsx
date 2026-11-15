import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { LoginPage } from './LoginPage.jsx';
import { ResumesEditor } from './ResumesEditor.jsx';
import './editor.css';

// /editor: login, then the editor. Its own chunk (App.jsx's lazy route,
// issue #179), stylesheet included, so the public pages never load either.
export function EditorGate() {
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
