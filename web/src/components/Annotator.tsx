import { useEffect, useRef, useState } from 'preact/hooks';
import type { Annotation } from '../api';
import { IconDownload } from './icons';

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
  /** When set, a download button appears in the toolbar. */
  downloadName?: string;
}

/** Movement below this (in px) counts as a click, i.e. a pin rather than a rect. */
const PIN_THRESHOLD = 5;

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Zoom level plus pan offset, applied as translate(x,y) scale(z) from origin 0 0. */
interface View {
  z: number;
  x: number;
  y: number;
}

const FIT: View = { z: 1, x: 0, y: 0 };

/** Keep the scaled image covering the viewport — no dead space at the edges. */
function clampView(view: View, vw: number, vh: number): View {
  return {
    z: view.z,
    x: Math.min(0, Math.max(vw - vw * view.z, view.x)),
    y: Math.min(0, Math.max(vh - vh * view.z, view.y)),
  };
}

/** Rescale to `z`, keeping the viewport point (cx, cy) fixed under the cursor. */
function zoomTo(view: View, z: number, cx: number, cy: number, vw: number, vh: number): View {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const scale = next / view.z;
  return clampView(
    { z: next, x: cx - (cx - view.x) * scale, y: cy - (cy - view.y) * scale },
    vw,
    vh,
  );
}

export function Annotator({
  src,
  alt,
  annotations,
  readOnly = false,
  activeId,
  draft,
  onSelect,
  onDraft,
  downloadName,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Region | null>(null);
  const [view, setView] = useState<View>(FIT);
  const [tool, setTool] = useState<'comment' | 'pan'>(readOnly ? 'pan' : 'comment');
  const panFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    setView(FIT);
  }, [src]);

  const positioned = annotations.filter((a) => a.x !== null && a.y !== null);

  /** Normalized 0..1 image coordinates, zoom/pan-aware: the transformed
      content element's bounding rect is the image as rendered on screen. */
  function pointFrom(event: PointerEvent) {
    const rect = contentRef.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function viewportSize() {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { vw: rect.width, vh: rect.height, left: rect.left, top: rect.top };
  }

  function onPointerDown(event: PointerEvent) {
    // Middle-drag always pans; left-drag pans in pan mode and annotates otherwise.
    const pans = event.button === 1 || (event.button === 0 && (readOnly || tool === 'pan'));
    if (pans) {
      // At fit zoom there is nothing to pan — leave the gesture to the browser
      // so a touch-drag scrolls the page instead of being swallowed.
      if (view.z === 1) return;
      panFrom.current = { px: event.clientX, py: event.clientY, x: view.x, y: view.y };
      setIsPanning(true);
    } else if (!readOnly && event.button === 0) {
      const p = pointFrom(event);
      setDragStart({ x: p.x, y: p.y });
      setLive({ x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (panFrom.current) {
      const { vw, vh } = viewportSize();
      const from = panFrom.current;
      setView((v) =>
        clampView(
          { z: v.z, x: from.x + event.clientX - from.px, y: from.y + event.clientY - from.py },
          vw,
          vh,
        ),
      );
      return;
    }
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
    if (panFrom.current) {
      panFrom.current = null;
      setIsPanning(false);
      return;
    }
    if (!dragStart) return;
    const rect = contentRef.current!.getBoundingClientRect();
    const region = live ?? { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
    const tiny = region.w * rect.width < PIN_THRESHOLD && region.h * rect.height < PIN_THRESHOLD;

    setDragStart(null);
    setLive(null);
    onDraft?.(tiny ? { x: dragStart.x, y: dragStart.y, w: 0, h: 0 } : region);
    event.preventDefault();
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const { vw, vh, left, top } = viewportSize();
    const factor = Math.exp(-event.deltaY * 0.0022);
    setView((v) => zoomTo(v, v.z * factor, event.clientX - left, event.clientY - top, vw, vh));
  }

  function zoomBy(factor: number) {
    const { vw, vh } = viewportSize();
    setView((v) => zoomTo(v, v.z * factor, vw / 2, vh / 2, vw, vh));
  }

  const preview = live ?? draft ?? null;
  const panMode = readOnly || tool === 'pan';
  const pannable = panMode && view.z > 1;
  const wrapClass = `canvas-wrap${pannable ? ' pannable' : ''}${panMode ? '' : ' drawing'}${isPanning ? ' is-panning' : ''}`;
  // Comment mode needs raw touch input to draw; pan mode only needs it once
  // zoomed in. Otherwise let touches scroll the page normally.
  const touchAction = panMode && view.z === 1 ? 'auto' : 'none';

  return (
    <div class="stack" style="gap:8px">
      <div class="canvas-toolbar" data-testid="canvas-toolbar">
        {!readOnly && (
          <div class="seg" role="group" aria-label="Tool">
            <button
              type="button"
              class={tool === 'comment' ? 'on' : ''}
              onClick={() => setTool('comment')}
              data-testid="tool-comment"
            >
              Comment
            </button>
            <button
              type="button"
              class={tool === 'pan' ? 'on' : ''}
              onClick={() => setTool('pan')}
              data-testid="tool-pan"
            >
              Pan
            </button>
          </div>
        )}
        <div class="seg" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" data-testid="zoom-out">
            −
          </button>
          <button
            type="button"
            class="zoom-label"
            onClick={() => setView(FIT)}
            title="Reset zoom"
            data-testid="zoom-reset"
          >
            {Math.round(view.z * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in" data-testid="zoom-in">
            +
          </button>
        </div>
        {downloadName && (
          <a class="btn small" href={src} download={downloadName} data-testid="download-image">
            <IconDownload />
            Download
          </a>
        )}
      </div>

      <div
        ref={wrapRef}
        class={wrapClass}
        style={{ touchAction }}
        data-testid="annotator"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <div
          ref={contentRef}
          class="canvas-content"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            '--inv': String(1 / view.z),
          }}
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
      </div>
    </div>
  );
}
