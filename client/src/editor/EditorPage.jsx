import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BlockList } from './BlockList.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { HeaderEditorForm } from './HeaderEditorForm.jsx';
import { SiteSettingsForm } from './SiteSettingsForm.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { ResumeView } from '../resume/ResumeView.jsx';
import { defaultDataForType } from './blockDefaults.js';

const SAVE_DEBOUNCE_MS = 500;

function timeAgo(iso) {
  if (!iso) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EditorPage({ onLogout }) {
  const [header, setHeader] = useState(null);
  const [site, setSite] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [publishedAt, setPublishedAt] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [publishState, setPublishState] = useState('idle'); // idle | publishing | published

  const debounceTimers = useRef({});

  useEffect(() => {
    Promise.all([
      api.getHeader(),
      api.getSite(),
      api.getBlocks(),
      api.publishStatus(),
      api.getCredentials(),
    ]).then(([h, s, b, status, credentials]) => {
      setHeader(h.header);
      setSite(s.site);
      setBlocks(b.blocks);
      setPublishedAt(status.publishedAt);
      setIsDirty(status.isDirty);
      setUsername(credentials.username);
      setLoading(false);
    });
  }, []);

  function flashSaved() {
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  async function handlePublish() {
    setPublishState('publishing');
    try {
      const { publishedAt: newPublishedAt } = await api.publish();
      setPublishedAt(newPublishedAt);
      setIsDirty(false);
      setPublishState('published');
      setTimeout(() => setPublishState((s) => (s === 'published' ? 'idle' : s)), 1500);
    } catch {
      setPublishState('idle');
    }
  }

  async function handleDiscard() {
    const draft = await api.discardDraft();
    setHeader(draft.header);
    setSite(draft.site);
    setBlocks(draft.blocks);
    setIsDirty(false);
  }

  function handleHeaderChange(newHeader) {
    setHeader(newHeader);
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__header);
    debounceTimers.current.__header = setTimeout(async () => {
      await api.putHeader(newHeader);
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  function handleBlockDataChange(id, newData) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, data: newData } : b)));
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(async () => {
      await api.updateBlock(id, { data: newData });
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  function handleSiteChange(newSite) {
    setSite(newSite);
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__site);
    debounceTimers.current.__site = setTimeout(async () => {
      await api.putSite(newSite);
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  async function handleVisibilityChange(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setIsDirty(true);
    setSaveState('saving');
    await api.updateBlock(id, patch);
    flashSaved();
  }

  async function handleReorder(reordered) {
    setBlocks(reordered);
    setIsDirty(true);
    setSaveState('saving');
    await api.reorderBlocks(reordered.map((b) => b.id));
    flashSaved();
  }

  async function handleAdd(type) {
    const { block } = await api.createBlock(type, defaultDataForType(type));
    setBlocks((prev) => [...prev, block]);
    setIsDirty(true);
  }

  async function handleDelete(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await api.deleteBlock(id);
    setIsDirty(true);
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
          {saveState === 'idle' && (isDirty ? 'Unpublished changes' : `Published ${timeAgo(publishedAt) || 'never'}`)}
        </div>
        <div className="ed-topbar-actions">
          {isDirty && (
            <button className="ed-btn ed-btn-ghost" onClick={handleDiscard}>
              Discard changes
            </button>
          )}
          <button className="ed-btn ed-btn-primary" onClick={handlePublish} disabled={publishState === 'publishing'}>
            {publishState === 'publishing' && 'Publishing…'}
            {publishState === 'published' && 'Published'}
            {publishState === 'idle' && 'Publish'}
          </button>
          <a className="ed-btn ed-btn-ghost" href="/" target="_blank" rel="noreferrer">
            View public site
          </a>
          <a className="ed-btn ed-btn-ghost" href="/api/public/resume.pdf">
            Download PDF
          </a>
          <button className="ed-btn ed-btn-ghost" onClick={() => setSettingsOpen(true)}>
            Account Settings
          </button>
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
            <button className="ed-panel-toggle" onClick={() => setSiteOpen((v) => !v)}>
              <span>Site Settings &amp; Colors</span>
              <span>{siteOpen ? '−' : '+'}</span>
            </button>
            {siteOpen && (
              <div className="ed-panel-body">
                <SiteSettingsForm site={site} onChange={handleSiteChange} />
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
          <div className="ed-preview-label">Draft preview — dimmed blocks are hidden from web and/or print</div>
          <div className="ed-preview-frame">
            <ResumeView header={header} site={site} blocks={blocks} mode="preview" />
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          username={username}
          onUsernameChange={setUsername}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
