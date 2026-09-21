"use client";

import { LAYERS, type Summary } from "@/lib/schema";

const NODE_W = 208;
const NODE_H = 58;
const COL_GAP = 76;
const ROW_GAP = 20;
const PAD = 28;
/** Small graphs scale up to fill the panel, but never past this factor so they don't look blown up. */
const MAX_SCALE = 1.6;
/** Approximate advance of one mono character at the edge-label size, for sizing pills. */
const LABEL_CHAR_W = 6.7;

const CHANGE_COLOR: Record<string, string> = {
  added: "var(--moss)",
  modified: "var(--amber)",
  removed: "var(--rust)",
  unchanged: "var(--faint)",
};

export function ArchMap({ summary, onSelect, selected }: {
  summary: Summary;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const byLayer = new Map<string, Summary["components"]>();
  for (const c of summary.components) {
    if (!byLayer.has(c.layer)) byLayer.set(c.layer, []);
    byLayer.get(c.layer)!.push(c);
  }
  const layers = LAYERS.filter((l) => byLayer.has(l));
  if (layers.length === 0) return null;

  const maxRows = Math.max(...layers.map((l) => byLayer.get(l)!.length));
  const height = PAD * 2 + 28 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const width = PAD * 2 + layers.length * NODE_W + (layers.length - 1) * COL_GAP;

  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, ci) => {
    const nodes = byLayer.get(layer)!;
    const colHeight = nodes.length * NODE_H + (nodes.length - 1) * ROW_GAP;
    const top = PAD + 28 + (height - PAD * 2 - 28 - colHeight) / 2;
    nodes.forEach((n, ri) => {
      pos.set(n.id, { x: PAD + ci * (NODE_W + COL_GAP), y: top + ri * (NODE_H + ROW_GAP) });
    });
  });

  const related = new Set<string>();
  if (selected) {
    related.add(selected);
    for (const r of summary.relationships) {
      if (r.from === selected) related.add(r.to);
      if (r.to === selected) related.add(r.from);
    }
  }

  // Edge geometry, computed once so labels can be painted in a final pass above the nodes.
  const edges = summary.relationships.flatMap((r) => {
    const a = pos.get(r.from);
    const b = pos.get(r.to);
    if (!a || !b) return [];
    const forward = b.x >= a.x;
    const x1 = forward ? a.x + NODE_W : a.x;
    const x2 = forward ? b.x : b.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const y2 = b.y + NODE_H / 2;
    const sameCol = a.x === b.x;
    const dx = sameCol ? 60 : Math.max(40, Math.abs(x2 - x1) / 2);
    const d = sameCol
      ? `M ${a.x + NODE_W} ${y1} C ${a.x + NODE_W + dx} ${y1}, ${b.x + NODE_W + dx} ${y2}, ${b.x + NODE_W} ${y2}`
      : `M ${x1} ${y1} C ${x1 + (forward ? dx : -dx)} ${y1}, ${x2 - (forward ? dx : -dx)} ${y2}, ${x2} ${y2}`;
    const hot = selected ? r.from === selected || r.to === selected : false;
    const dim = !!selected && !hot;
    // Label sits at the connector's midpoint. Room is the horizontal gap between the two nodes
    // (or the loop's width for same-column edges); the label is trimmed to fit that plus a little
    // overhang, and drawn on a pill so whatever it overlaps stays legible.
    const room = sameCol ? 2 * dx : Math.abs(x2 - x1);
    const maxChars = Math.max(6, Math.floor((room + 40) / LABEL_CHAR_W));
    const label = truncate(r.label, maxChars);
    const mx = sameCol ? a.x + NODE_W + dx * 0.75 : (x1 + x2) / 2;
    let my = (y1 + y2) / 2 - 12;
    // A connector that crosses a column lands its midpoint on whatever node sits there.
    // Lift the label into the row gap above that node instead of covering its title.
    for (const n of pos.values()) {
      if (mx > n.x - 4 && mx < n.x + NODE_W + 4 && my > n.y - 4 && my < n.y + NODE_H + 4) {
        my = n.y - ROW_GAP / 2;
        break;
      }
    }
    return [{ d, hot, dim, label, mx, my }];
  });

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ maxWidth: Math.round(width * MAX_SCALE), margin: "0 auto" }} onClick={() => onSelect(null)}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--faint)" />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--amber)" />
          </marker>
        </defs>

        {layers.map((layer, ci) => (
          <text
            key={layer}
            x={PAD + ci * (NODE_W + COL_GAP) + NODE_W / 2}
            y={PAD + 6}
            textAnchor="middle"
            style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", fill: "var(--muted)", textTransform: "uppercase" }}
          >
            {layer}
          </text>
        ))}

        {edges.map((e, i) => (
          <g key={i} opacity={e.dim ? 0.15 : 1} style={{ transition: "opacity 160ms" }}>
            <path d={e.d} fill="none" stroke={e.hot ? "var(--amber)" : "var(--line-2)"} strokeWidth={e.hot ? 1.6 : 1.2} markerEnd={e.hot ? "url(#arrow-hot)" : "url(#arrow)"} />
          </g>
        ))}

        {summary.components.map((c) => {
          const p = pos.get(c.id)!;
          const dim = selected && !related.has(c.id);
          const isSel = selected === c.id;
          return (
            <g
              key={c.id}
              transform={`translate(${p.x}, ${p.y})`}
              opacity={dim ? 0.3 : 1}
              style={{ cursor: "pointer", transition: "opacity 160ms" }}
              onClick={(e) => { e.stopPropagation(); onSelect(isSel ? null : c.id); }}
            >
              <rect width={NODE_W} height={NODE_H} rx={8} fill={isSel ? "var(--bg-4)" : c.change === "unchanged" ? "var(--bg)" : "var(--bg-3)"} stroke={isSel ? "var(--amber)" : "var(--line-2)"} strokeWidth={isSel ? 1.5 : 1} strokeDasharray={c.change === "unchanged" ? "4 3" : undefined} />
              <rect x={0} y={10} width={3} height={NODE_H - 20} rx={1.5} fill={CHANGE_COLOR[c.change]} />
              <text x={16} y={24} style={{ fontFamily: "var(--font-body)", fontSize: 14.5, fontWeight: 600, fill: c.change === "unchanged" ? "var(--muted)" : "var(--text)" }}>
                {truncate(c.name, 23)}
              </text>
              <text x={16} y={43} style={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--muted)" }}>
                {c.kind} · {c.change === "unchanged" ? "in blast radius" : c.change}
              </text>
            </g>
          );
        })}

        {edges.filter((e) => e.hot).map((e, i) => {
          const w = e.label.length * LABEL_CHAR_W + 14;
          return (
            <g key={`label-${i}`} className="reveal">
              <rect x={e.mx - w / 2} y={e.my - 9} width={w} height={17} rx={8.5} fill="var(--bg-2)" stroke="rgba(229,163,58,0.45)" strokeWidth={1} />
              <text x={e.mx} y={e.my + 3.5} textAnchor="middle" style={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--amber)" }}>
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
