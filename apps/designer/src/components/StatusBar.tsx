import { useDesigner, selectSelectedLayer } from "@/store/designerStore";

/**
 * Status bar — bottom of the shell.
 *
 * Surface the things a designer wants visible at all times without having to
 * dig into a panel:
 *   • Selection summary
 *   • Card design size
 *   • Total layer count
 *   • Build / version stamp (placeholder until we wire CI)
 */
export function StatusBar() {
  const layer = useDesigner(selectSelectedLayer);
  const template = useDesigner((s) => s.template);
  const overlays = useDesigner((s) => s.overlays);

  return (
    <footer className="flex h-7 items-center gap-3 bg-ink-900 px-3 text-[11px] text-ink-300">
      <Pair label="Card">
        {template.size.width}×{template.size.height}px · bleed {template.bleed} · safe {template.safeZone}
      </Pair>
      <Pair label="Layers">{template.layers.length}</Pair>
      <Pair label="Selected">
        {layer ? (
          <span className="text-accent-300">
            {layer.name} <span className="text-ink-400">({layer.type})</span>
          </span>
        ) : (
          <span className="text-ink-500">none</span>
        )}
      </Pair>
      <Pair label="Overlays">
        {[
          overlays.grid && "grid",
          overlays.safeZone && "safe",
          overlays.bleed && "bleed",
        ]
          .filter(Boolean)
          .join(" · ") || <span className="text-ink-500">off</span>}
      </Pair>
      <span className="ml-auto text-ink-500">TCGStudio Designer · prototype build</span>
    </footer>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      <span className="text-ink-200">{children}</span>
    </span>
  );
}
