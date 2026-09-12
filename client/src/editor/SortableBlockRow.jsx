import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BLOCK_TYPE_LABELS } from './blockDefaults.js';
import { HeadingForm } from './blockForms/HeadingForm.jsx';
import { SkillsGroupForm } from './blockForms/SkillsGroupForm.jsx';
import { ExperienceForm } from './blockForms/ExperienceForm.jsx';
import { EducationForm } from './blockForms/EducationForm.jsx';
import { CustomForm } from './blockForms/CustomForm.jsx';

const FORM_COMPONENTS = {
  heading: HeadingForm,
  skills_group: SkillsGroupForm,
  experience: ExperienceForm,
  education: EducationForm,
  custom: CustomForm,
};

function summarize(block) {
  const d = block.data || {};
  switch (block.type) {
    case 'heading':
      return d.text;
    case 'skills_group':
      return d.category;
    case 'experience':
      return `${d.jobTitle || 'Untitled'} — ${d.company || ''}`;
    case 'education':
      return `${d.degree || 'Untitled'} — ${d.institution || ''}`;
    case 'custom':
      return d.title || 'Untitled';
    default:
      return '';
  }
}

export function SortableBlockRow({ block, onChangeData, onChangeVisibility, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const FormComponent = FORM_COMPONENTS[block.type];

  return (
    <div ref={setNodeRef} style={style} className="ed-block-row">
      <div className="ed-block-row-header">
        <button className="ed-drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder">
          ⠿
        </button>
        <button className="ed-block-summary" onClick={() => setExpanded((v) => !v)}>
          <span className="ed-block-type">{BLOCK_TYPE_LABELS[block.type] || block.type}</span>
          <span className="ed-block-title">{summarize(block)}</span>
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

      {expanded && FormComponent && (
        <div className="ed-block-row-body">
          <FormComponent data={block.data} onChange={(newData) => onChangeData(block.id, newData)} />
        </div>
      )}
    </div>
  );
}

function VisibilityToggle({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={`ed-vis-toggle${active ? ' ed-vis-toggle-active' : ''}`}
      onClick={onClick}
      title={active ? `Visible: ${label}` : `Hidden: ${label}`}
    >
      {label}
    </button>
  );
}
