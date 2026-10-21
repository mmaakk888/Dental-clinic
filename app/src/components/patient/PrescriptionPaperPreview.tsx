import React, {useEffect, useRef} from 'react';
import {createPrescriptionDocument} from './PrescriptionDocument';
import type {PrescriptionImageData} from '../../utils/prescriptionImage';

/** Fit the same fixed-size print paper; never reflow its clinical content. */
export function PrescriptionPaperPreview({data}: {data: PrescriptionImageData}) {
  const viewport = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null), paper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      if (!viewport.current || !layer.current || !paper.current) return;
      const scale = Math.min(1, viewport.current.clientWidth / paper.current.offsetWidth);
      if (!(scale > 0)) return;
      layer.current.style.transform = `scale(${scale})`;
      viewport.current.style.height = `${Math.ceil(paper.current.offsetHeight * scale)}px`;
    };
    const observer = new ResizeObserver(fit);
    if (viewport.current) observer.observe(viewport.current);
    if (paper.current) observer.observe(paper.current);
    fit(); return () => observer.disconnect();
  }, []);
  return <div className="rx-design-paper-viewport" ref={viewport}><div className="rx-design-paper-layer" ref={layer}>{createPrescriptionDocument(data, paper)}</div></div>;
}
