import { BLOCK_TYPE_LABELS } from './blockDefaults.js';

const ORDER = ['heading', 'skills_group', 'experience', 'education', 'custom'];

export function AddBlockMenu({ onAdd }) {
  return (
    <div className="ed-add-menu">
      <span className="ed-add-menu-label">Add block</span>
      <div className="ed-add-menu-buttons">
        {ORDER.map((type) => (
          <button key={type} className="ed-btn ed-btn-ghost" onClick={() => onAdd(type)}>
            + {BLOCK_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
