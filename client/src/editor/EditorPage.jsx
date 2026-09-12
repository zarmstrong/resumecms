import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BlockList } from './BlockList.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { HeaderEditorForm } from './HeaderEditorForm.jsx';
import { ResumeView } from '../resume/ResumeView.jsx';
import { defaultDataForType } from './blockDefaults.js';

const SAVE_DEBOUNCE_MS = 500;

export function EditorPage({ onLogout }) {
  const [header, setHeader] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved

  const debounceTimers = useRef({});

  useEffect(() => {
    Promise.all([api.getHeader(), api.getBlocks()]).then(([h, b]) => {
      setHeader(h.header);
      setBlocks(b.blocks);
      setLoading(false);
    });
  }, []);

  function flashSaved() {
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  function handleHeaderChange(newHeader) {
    setHeader(newHeader);
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__header);
    debounceTimers.current.__header = setTimeout(async () => {
      await api.putHeader(newHeader);
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  function handleBlockDataChange(id, newData) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, data: newData } : b)));
    setSaveState('saving');
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(async () => {
      await api.updateBlock(id, { data: newData });
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  async function handleVisibilityChange(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setSaveState('saving');
    await api.updateBlock(id, patch);
    flashSaved();
  }

  async function handleReorder(reordered) {
    setBlocks(reordered);
    setSaveState('saving');
    await api.reorderBlocks(reordered.map((b) => b.id));
    flashSaved();
  }

  async function handleAdd(type) {
    const { block } = await api.createBlock(type, defaultDataForType(type));
    setBlocks((prev) => [...prev, block]);
  }

  async function handleDelete(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await api.deleteBlock(id);
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  if (loading) return <div className="ed-loading">Loading editor…</div>;

  return (
    <div className="ed-shell">
      <header className="ed-topbar">
        <div className="ed-topbar-title">Resume Editor</div>
        <div className="ed-topbar-status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
        </div>
        <div className="ed-topbar-actions">
          <a className="ed-btn ed-btn-ghost" href="/" target="_blank" rel="noreferrer">
            View public site
          </a>
          <a className="ed-btn ed-btn-ghost" href="/api/public/resume.pdf">
            Download PDF
          </a>
          <button className="ed-btn ed-btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className="ed-columns">
        <div className="ed-left-pane">
          <section className="ed-panel">
            <button className="ed-panel-toggle" onClick={() => setHeaderOpen((v) => !v)}>
              <span>Header &amp; Contact Info</span>
              <span>{headerOpen ? '−' : '+'}</span>
            </button>
            {headerOpen && (
              <div className="ed-panel-body">
                <HeaderEditorForm header={header} onChange={handleHeaderChange} />
              </div>
            )}
          </section>

          <section className="ed-panel">
            <div className="ed-panel-label">Resume Sections</div>
            <BlockList
              blocks={blocks}
              onReorder={handleReorder}
              onChangeData={handleBlockDataChange}
              onChangeVisibility={handleVisibilityChange}
              onDelete={handleDelete}
            />
            <AddBlockMenu onAdd={handleAdd} />
          </section>
        </div>

        <div className="ed-right-pane">
          <div className="ed-preview-label">Live preview — dimmed blocks are hidden from web and/or print</div>
          <div className="ed-preview-frame">
            <ResumeView header={header} blocks={blocks} mode="preview" />
          </div>
        </div>
      </div>
    </div>
  );
}
