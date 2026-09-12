export function VisibilityToggle({ label, active, onClick }) {
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
