import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { BLOCK_TYPE_LABELS } from './blockDefaults.js';
import { HeadingForm } from './blockForms/HeadingForm.jsx';
import { SummaryForm } from './blockForms/SummaryForm.jsx';
import { ExecutiveSummaryForm } from './blockForms/ExecutiveSummaryForm.jsx';
import { SkillsGroupForm } from './blockForms/SkillsGroupForm.jsx';
import { ExperienceForm } from './blockForms/ExperienceForm.jsx';
import { EducationForm } from './blockForms/EducationForm.jsx';
import { CustomForm } from './blockForms/CustomForm.jsx';
import { VisibilityToggle } from './VisibilityToggle.jsx';
import { BlockStyleForm } from './BlockStyleForm.jsx';
import { AiRewritePanel } from './AiRewritePanel.jsx';
import { PlanHideList } from './PlanHidePanel.jsx';
import { AI_REWRITABLE_TYPES, targetKey } from './aiReview.js';

// One block's open AI proposals, keyed by targetKey, or null when it has none.
function proposalsForBlock(proposals, blockId) {
  const entries = Object.values(proposals || {}).filter((entry) => entry.blockId === blockId);
  return entries.length ? Object.fromEntries(entries.map((entry) => [targetKey(entry.target), entry])) : null;
}

const FORM_COMPONENTS = {
  heading: HeadingForm,
  summary: SummaryForm,
  executive_summary: ExecutiveSummaryForm,
  skills_group: SkillsGroupForm,
  experience: ExperienceForm,
  education: EducationForm,
  custom: CustomForm,
};

function summarize(block) {
  const d = block.data || {};
  switch (block.type) {
    case 'heading':
      return { title: d.text };
    case 'summary':
    case 'executive_summary': {
      const text = d.headline || d.text || '';
      return { title: text.length > 60 ? `${text.slice(0, 60)}…` : text || 'Untitled' };
    }
    case 'skills_group':
      return { title: d.category };
    case 'experience': {
      const dates = [d.startDate, d.endDate].filter(Boolean).join(' – ');
      const subtitle = [d.company, dates].filter(Boolean).join(' · ');
      return { title: d.jobTitle || 'Untitled', subtitle: subtitle || null };
    }
    case 'education':
      return { title: `${d.degree || 'Untitled'} — ${d.institution || ''}` };
    case 'custom':
      return { title: d.title || 'Untitled' };
    default:
      return { title: '' };
  }
}

// `plan` is the tailoring plan's open hides (EditorPage's, see PlanHidePanel).
export function SortableBlockRow({ block, nested, drop, nestTarget, moving, ai, plan, onChangeData, onChangeVisibility, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({ id: block.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: block.id });
  function setNodeRef(node) {
    setDragRef(node);
    setDropRef(node);
  }

  const FormComponent = FORM_COMPONENTS[block.type];
  const { title, subtitle } = summarize(block);
  const aiEnabled = Boolean(ai?.available && AI_REWRITABLE_TYPES.has(block.type));
  // Forms with parts that can be rewritten on their own (an experience
  // description or bullet, a custom item) render a scoped panel with this,
  // and look up a part's open proposal in `aiEntries` (keyed by targetKey).
  // Both are rebuilt each render on purpose. ExperienceForm's memoized
  // bullet rows only skip renders mid-drag, when the form passes its last
  // props through unchanged anyway; a keystroke re-renders every row (see
  // bulletPropsEqual). A stable callback reading a ref would let a skipped
  // row keep a stale block or accept handler.
  const aiPanel = aiEnabled ? (target, props) => <AiRewritePanel block={block} ai={ai} target={target} {...props} /> : null;
  const aiEntries = aiEnabled ? proposalsForBlock(ai.proposals, block.id) : null;

  return (
    <div ref={setNodeRef} className={`ed-block-row${nested ? ' ed-block-row-nested' : ''}${isDragging || moving ? ' ed-block-row-dragging' : ''}${nestTarget ? ' ed-block-nest-target' : ''}${drop?.headingId ? ' ed-block-nest-active' : ''}`}>
      {drop && !drop.headingId && <div className={`ed-drop-indicator ed-drop-${drop.edge}${drop.parentId ? ' ed-drop-nested' : ''}`}><span>{drop.label}</span></div>}
      <div className="ed-block-row-header">
        {drop?.headingId && <div className="ed-drop-indicator ed-drop-inside ed-drop-nested"><span>{drop.label}</span></div>}
        <button ref={setActivatorNodeRef} className="ed-drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder or nest">
          ⠿
        </button>
        <button className="ed-block-summary" onClick={() => setExpanded((v) => !v)}>
          <span className="ed-block-type">{BLOCK_TYPE_LABELS[block.type] || block.type}</span>
          <span className="ed-block-title">{title}</span>
          {subtitle && <span className="ed-block-subtitle">{subtitle}</span>}
        </button>

        <div className="ed-visibility-toggles">
          <VisibilityToggle
            label="Web"
            active={block.visibleWeb}
            onClick={() => onChangeVisibility(block.id, { visibleWeb: !block.visibleWeb })}
          />
          <VisibilityToggle
            label="Print/PDF"
            active={block.visiblePrint}
            onClick={() => onChangeVisibility(block.id, { visiblePrint: !block.visiblePrint })}
          />
        </div>

        <button className="ed-icon-btn" onClick={() => onDelete(block.id)} aria-label="Delete block">
          ✕
        </button>
      </div>

      <PlanHideList blockId={block.id} plan={plan} />

      {expanded && (
        <div className="ed-block-row-body">
          {FormComponent && (
            <FormComponent
              data={block.data}
              onChange={(newData) => onChangeData(block.id, newData)}
              aiPanel={aiPanel}
              aiEntries={aiEntries}
            />
          )}
          {aiEnabled && (
            <AiRewritePanel
              block={block}
              ai={ai}
              label={block.type === 'experience' ? '✨ Rewrite tagline and bullets with AI' : '✨ Rewrite with AI'}
            />
          )}
          <BlockStyleForm type={block.type} data={block.data} onChange={(newData) => onChangeData(block.id, newData)} />
        </div>
      )}
    </div>
  );
}
