type Row = { kind: "hunk" | "add" | "del" | "ctx" | "meta"; num: number | null; text: string };

function parsePatch(patch: string): Row[] {
  let oldLine = 0;
  let newLine = 0;
  return patch.split("\n").map((line): Row => {
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) { oldLine = Number(m[1]); newLine = Number(m[2]); }
      return { kind: "hunk", num: null, text: line };
    }
    if (line.startsWith("+")) return { kind: "add", num: newLine++, text: line };
    if (line.startsWith("-")) return { kind: "del", num: oldLine++, text: line };
    if (line.startsWith("\\")) return { kind: "meta", num: null, text: line };
    oldLine++;
    return { kind: "ctx", num: newLine++, text: line };
  });
}

const CLS: Record<Row["kind"], string> = {
  hunk: "diff-hunk",
  add: "diff-add",
  del: "diff-del",
  ctx: "text-ink-2",
  meta: "text-faint",
};

export function DiffView({ patch }: { patch?: string }) {
  if (!patch) return <p className="mono p-4 text-muted">No textual diff available for this file.</p>;
  return (
    <div className="diff overflow-x-auto py-2">
      {parsePatch(patch).map((row, i) => (
        <div key={i} className={`diff-line ${CLS[row.kind]}`}>
          <span>{row.num ?? ""}</span>
          <span>{row.text}</span>
        </div>
      ))}
    </div>
  );
}
