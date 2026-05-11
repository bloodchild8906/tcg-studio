/**
 * Mountable React wrapper around `pluginHost.mount()` so a panel UI
 * contribution renders as a normal child component.
 *
 * Usage:
 *
 *   <PluginPanelHost instance={inst} />
 *
 * The component owns a div the host attaches the iframe to. We
 * never re-mount on prop changes — the iframe lifecycle is owned
 * by the runtime and outlives this wrapper, so React re-renders
 * just push fresh hostContext through the bridge instead of
 * reloading the iframe.
 */

import { useEffect, useRef } from "react";
import { pluginHost, type PluginInstance } from "./host";

export function PluginPanelHost({ instance }: { instance: PluginInstance }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void pluginHost.mount(instance, el);
    return () => {
      pluginHost.unmount(instance.installId);
    };
    // We intentionally re-mount when the install id changes, but
    // not when the manifest object identity changes — manifest
    // updates flow through `init` over the bridge, not iframe
    // reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.installId]);

  return (
    <div
      ref={ref}
      data-plugin-install={instance.installId}
      className="h-full w-full overflow-hidden bg-ink-950"
    />
  );
}
