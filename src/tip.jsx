/* One shared tooltip. Content is JSX, so file text is escaped by React. */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

let tip = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());
export function showTip(ev, content) { tip = { x: ev.clientX, y: ev.clientY, content }; emit(); }
export function hideTip() { if (tip) { tip = null; emit(); } }
const sub = f => { subs.add(f); return () => subs.delete(f); };

export function Tip() {
  const t = useSyncExternalStore(sub, () => tip);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!t) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.x + 14, y = t.y + 14;
    if (x + w > innerWidth - 8) x = t.x - w - 14;
    if (y + h > innerHeight - 8) y = t.y - h - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }, [t]);
  return <div className="tip" id="tip" ref={ref}>{t?.content}</div>;
}
