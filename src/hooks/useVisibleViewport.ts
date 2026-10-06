import { useEffect } from 'react';

/** Dynamic browser bars and the software keyboard reduce the usable screen.
 * Keep dialog sizing in CSS; this only supplies the actual visible viewport. */
export function useVisibleViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty('--clinic-visible-height', `${Math.round(height)}px`);
      root.style.setProperty('--clinic-viewport-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
      root.toggleAttribute('data-clinic-compact-viewport', height < 440);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      root.style.removeProperty('--clinic-visible-height');
      root.style.removeProperty('--clinic-viewport-top');
      root.removeAttribute('data-clinic-compact-viewport');
    };
  }, []);
}
