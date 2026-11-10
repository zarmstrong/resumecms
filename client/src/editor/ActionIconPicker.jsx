import { useState } from 'react';
import { ACTION_ICONS, ACTION_ICON_GROUPS, actionIcon } from '../landing/actionIcons.js';
import { ActionIcon } from '../landing/ActionIcon.jsx';

// A landing page button's icon: collapsed to what's chosen, opening onto
// every icon by group. Picking one (or "No icon") closes it again.
// `value` is '' for none.
export function ActionIconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const chosen = actionIcon(value);
  const pick = (next) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <details className="ed-collapsible ed-icon-picker" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Icon{' '}
        <span className="ed-collapsible-summary">
          {chosen ? (
            <>
              <ActionIcon name={value} className="ed-icon-picker-icon" /> {chosen.label}
            </>
          ) : (
            'None'
          )}
        </span>
      </summary>
      <div className="ed-collapsible-body">
        <button type="button" className="ed-btn ed-btn-ghost ed-icon-picker-none" aria-pressed={!chosen} onClick={() => pick('')}>
          No icon
        </button>
        {ACTION_ICON_GROUPS.map((group) => (
          <div key={group} className="ed-icon-picker-group" role="group" aria-label={group}>
            <span className="ed-field-hint">{group}</span>
            <div className="ed-icon-picker-grid">
              {ACTION_ICONS.filter((entry) => entry.group === group).map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className="ed-icon-picker-option"
                  aria-pressed={entry.value === value}
                  aria-label={entry.label}
                  title={entry.label}
                  onClick={() => pick(entry.value)}
                >
                  <ActionIcon name={entry.value} className="ed-icon-picker-icon" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
