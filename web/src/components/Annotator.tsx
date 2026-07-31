import { useRef, useState } from 'preact/hooks';
import type { Annotation } from '../api';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  src: string;
  alt: string;
  annotations: Annotation[];
  readOnly?: boolean;
  activeId?: string | null;
  draft?: Region | null;
  onSelect?: (id: string | null) => void;
  onDraft?: (region: Region | null) => void;
}

/** Movement below this (in px) counts as a click, i.e. a pin rather than a rect. */
const PIN_THRESHOLD = 5;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function Annotator({
  src,
  alt,
  annotations,
  readOnly = false,
  activeId,
  draft,
  onSelect,
  onDraft,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Region | null>(null);

  const positioned = annotations.filter((a) => a.x !== null && a.y !== null);

  function pointFrom(event: PointerEvent) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
      px: event.clientX,
      py: event.clientY,
    };
  }

  function onPointerDown(event: PointerEvent) {
    if (readOnly || event.button !== 0) return;
    const p = pointFrom(event);
    setDragStart({ x: p.x, y: p.y });
    setLive({ x: p.x, y: p.y, w: 0, h: 0 });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragStart) return;
    const p = pointFrom(event);
    setLive({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragStart) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const region = live ?? { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
    const tiny = region.w * rect.width < PIN_THRESHOLD && region.h * rect.height < PIN_THRESHOLD;

    setDragStart(null);
    setLive(null);
    onDraft?.(tiny ? { x: dragStart.x, y: dragStart.y, w: 0, h: 0 } : region);
    event.preventDefault();
  }

  const preview = live ?? draft ?? null;

  return (
    <div
      ref={wrapRef}
      class={`canvas-wrap${readOnly ? '' : ' drawing'}`}
      data-testid="annotator"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={src} alt={alt} data-testid="screenshot-image" draggable={false} />
      <div class="overlay">
        {positioned.map((a, i) => {
          const isPin = (a.w ?? 0) === 0 && (a.h ?? 0) === 0;
          const state = `${a.resolved ? ' resolved' : ''}${activeId === a.id ? ' active' : ''}`;
          const select = (event: MouseEvent) => {
            event.stopPropagation();
            onSelect?.(a.id);
          };
          return isPin ? (
            <div
              key={a.id}
              class={`pin${state}`}
              style={{ left: `${a.x! * 100}%`, top: `${a.y! * 100}%` }}
              title={a.body}
              data-testid={`pin-${a.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={select}
            >
              {i + 1}
            </div>
          ) : (
            <div
              key={a.id}
              class={`region${state}`}
              style={{
                left: `${a.x! * 100}%`,
                top: `${a.y! * 100}%`,
                width: `${a.w! * 100}%`,
                height: `${a.h! * 100}%`,
              }}
              title={a.body}
              data-testid={`region-${a.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={select}
            />
          );
        })}

        {preview &&
          (preview.w === 0 && preview.h === 0 ? (
            <div
              class="pin active"
              style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%` }}
              data-testid="draft-pin"
            />
          ) : (
            <div
              class="region active"
              style={{
                left: `${preview.x * 100}%`,
                top: `${preview.y * 100}%`,
                width: `${preview.w * 100}%`,
                height: `${preview.h * 100}%`,
              }}
              data-testid="draft-region"
            />
          ))}
      </div>
    </div>
  );
}
