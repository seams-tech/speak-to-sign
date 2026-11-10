// From packages/grain-field-ts in seams-monorepo (commit 3407f157), for this repo's
// stricter TypeScript settings.
import { useEffect, useRef } from 'react';
import { grainFieldSource, type GrainFieldName } from './fields';
import { addGrainField, type GrainFieldHandle } from './renderer';
import './GrainField.css';

type GrainFieldProps = {
  field: GrainFieldName;
  /* false holds the current frame, e.g. while the field's menu is closed */
  playing?: boolean;
  className?: string;
  /* How far this field flows, as a multiple of the site style. The flow is
     measured in heights of the short side, so a wide banner, whose colours
     spread over its width, needs more of it to show the same movement. */
  flow?: number;
  /* How fast this field flows, as a multiple of the site style. */
  pace?: number;
};

const MAX_PIXEL_RATIO = 2;

/* A moving, grainy gradient that fills its positioned parent behind the
   parent's content. Reduced motion, an off-screen field and a hidden tab all
   hold the current frame. */
export function GrainField({
  field,
  playing = true,
  className,
  flow = 1,
  pace = 1,
}: GrainFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<GrainFieldHandle | null>(null);
  const source = grainFieldSource(field);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handle = addGrainField(canvas, source, flow, pace);
    handleRef.current = handle;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
      handle.setSize(entry.contentRect.width * ratio, entry.contentRect.height * ratio);
    });
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry) handle.setVisible(entry.isIntersecting);
      },
      { rootMargin: '120px' },
    );
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      handle.dispose();
      handleRef.current = null;
    };
  }, [source, flow, pace]);

  useEffect(() => {
    handleRef.current?.setPlaying(playing);
  }, [playing, source]);

  return (
    <canvas
      ref={canvasRef}
      className={className ? `grain-field ${className}` : 'grain-field'}
      style={{ backgroundColor: source.base }}
      aria-hidden
    />
  );
}
