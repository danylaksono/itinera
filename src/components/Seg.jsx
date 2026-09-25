/* segmented control: options = [[value, label, title?], ...] */
export default function Seg({ id, label, value, options, onChange, style }) {
  return (
    <div className="seg" id={id} role="group" aria-label={label} style={style}>
      {options.map(([v, l, t]) => <button key={v} data-v={v} title={t} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
