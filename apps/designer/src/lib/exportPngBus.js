/**
 * Tiny event bus so the Header's "Export PNG" button can ping the canvas
 * (which holds the Konva Stage ref) without dragging the stage ref through
 * React context or the Zustand store.
 *
 * The store is the wrong place for non-serializable runtime objects like
 * Konva nodes; an event bus keeps them out of state.
 */
class ExportBus {
    listeners = new Set();
    emit(_event) {
        this.listeners.forEach((l) => l());
    }
    on(_event, listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
export const exportPngBus = new ExportBus();
