import { useCallback, useRef, useState } from 'react';

/* [ref, width]: a callback ref that keeps the element's width current (ResizeObserver).
   ref.el is the element, for code that needs it. */
export function useWidth() {
  const [w, setW] = useState(0);
  const ro = useRef(null);
  const ref = useCallback(el => {
    ro.current?.disconnect(); ro.current = null;
    ref.el = el;
    if (!el) return;
    setW(el.clientWidth);
    ro.current = new ResizeObserver(() => setW(el.clientWidth));
    ro.current.observe(el);
  }, []);
  return [ref, w];
}
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
