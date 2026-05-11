import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  GripVertical,
  ChevronDown,
  Star,
  Save,
  Code2,
  Layout,
  Type,
  FileCode,
  Palette,
  Terminal,
  Settings,
  Monitor,
  Smartphone,
  Tablet as TabletIcon,
  Download,
  Upload,
  RotateCcw,
  X,
  Maximize2,
  Eye,
  Columns as ColumnsIcon,
} from "lucide-react";
import { 
  Block, 
  BlockType, 
  BlockCMSProps, 
  BLOCK_CONFIGS,
  CmsData,
  ViewportMode,
  BlockMetadata
} from "./cms-types";
import { toast } from "@/components/ui/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// --- Recursive State Helpers ---

const updateBlockInTree = (blocks: Block[], id: string, updater: (block: Block) => Block): Block[] => {
  return blocks.map(block => {
    if (block.id === id) {
      return updater(block);
    }
    if (block.children) {
      return { ...block, children: updateBlockInTree(block.children, id, updater) };
    }
    return block;
  });
};

const deleteBlockFromTree = (blocks: Block[], id: string): Block[] => {
  return blocks.filter(block => block.id !== id).map(block => {
    if (block.children) {
      return { ...block, children: deleteBlockFromTree(block.children, id) };
    }
    return block;
  });
};

const findBlockById = (blocks: Block[], id: string): Block | null => {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return null;
};

// --- Sub-Components ---

const DropIndicator = ({ active }: { active: boolean }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: active ? 1 : 0, height: active ? 2 : 0 }}
    className="bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)] z-10 mx-4"
  />
);

const SettingsPanel = ({ 
  block, 
  onUpdate, 
  onClose 
}: { 
  block: Block; 
  onUpdate: (metadata: BlockMetadata) => void; 
  onClose: () => void 
}) => {
  const meta = block.metadata || {};
  
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-border flex items-center justify-between bg-secondary/20">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          {block.type.toUpperCase()} Settings
        </h3>
        <button onClick={onClose} className="p-1 hover:bg-secondary rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <section>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 block">Spacing</label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">Padding</span>
              <input 
                type="text" 
                value={meta.padding || ""} 
                onChange={e => onUpdate({ ...meta, padding: e.target.value })}
                className="w-full bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                placeholder="e.g. 4, 8, 12"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">Margin (Y)</span>
              <input 
                type="text" 
                value={meta.margin || ""} 
                onChange={e => onUpdate({ ...meta, margin: e.target.value })}
                className="w-full bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                placeholder="e.g. 4, 8"
              />
            </div>
          </div>
        </section>

        <section>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 block">Styling</label>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">Background Color</span>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  value={meta.backgroundColor || "#ffffff"} 
                  onChange={e => onUpdate({ ...meta, backgroundColor: e.target.value })}
                  className="w-8 h-8 rounded-md cursor-pointer border border-border"
                />
                <input 
                  type="text" 
                  value={meta.backgroundColor || ""} 
                  onChange={e => onUpdate({ ...meta, backgroundColor: e.target.value })}
                  className="flex-1 bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                  placeholder="#hex or rgba"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">Border Radius</span>
              <input 
                type="text" 
                value={meta.borderRadius || ""} 
                onChange={e => onUpdate({ ...meta, borderRadius: e.target.value })}
                className="w-full bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                placeholder="e.g. 8px, 1rem"
              />
            </div>
          </div>
        </section>

        <section>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 block">Advanced</label>
          <div className="space-y-4">
             <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">Custom CSS Classes</span>
              <input 
                type="text" 
                value={meta.customClass || ""} 
                onChange={e => onUpdate({ ...meta, customClass: e.target.value })}
                className="w-full bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                placeholder="Tailwind or custom classes"
              />
            </div>
            {block.type === "image" && (
               <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground">Alt Text</span>
                <input 
                  type="text" 
                  value={meta.altText || ""} 
                  onChange={e => onUpdate({ ...meta, altText: e.target.value })}
                  className="w-full bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

// --- Main Component ---

export const BlockCMS = ({
  initialData,
  onDataChange,
  storageTarget,
  sidebarWidth = "w-64",
  editorWidth = "flex-1",
}: BlockCMSProps) => {
  const [data, setData] = useState<CmsData>(initialData || {
    blocks: [
      { id: "1", type: "heading", content: "Welcome to BlockCMS Pro" },
      { id: "2", type: "paragraph", content: "Experience a professional-grade editor with advanced layouts." }
    ],
    globalHtml: "",
    globalCss: "",
    globalJs: "",
  });

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [activeTab, setActiveTab] = useState<"blocks" | "code">("blocks");
  const [activeCodeTab, setActiveCodeTab] = useState<"html" | "css" | "js">("html");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  
  // History State
  const [history, setHistory] = useState<CmsData[]>([]);
  const [redoStack, setRedoStack] = useState<CmsData[]>([]);

  // Persistence Refs
  const lastSavedData = useRef<string>(JSON.stringify(data));
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  const persistData = useCallback(async (manual = false) => {
    if (!storageTarget) return;
    
    try {
      const response = await fetch("/api/persist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageTarget, data }),
      });

      if (response.ok) {
        lastSavedData.current = JSON.stringify(data);
        if (manual) toast({ title: "Save Successful", description: `Data persisted to ${storageTarget}` });
      }
    } catch (error) {
      console.error("Save failed:", error);
      toast({ variant: "destructive", title: "Save Failed", description: "Backend is unreachable." });
    }
  }, [data, storageTarget]);

  useEffect(() => {
    if (storageTarget && !initialData) {
      const loadData = async () => {
        try {
          const response = await fetch(`/api/persist?target=${storageTarget}`);
          if (response.ok) {
            const loadedData = await response.json();
            setData(loadedData);
            lastSavedData.current = JSON.stringify(loadedData);
          }
        } catch (error) { console.warn("Could not load initial data:", error); }
      };
      loadData();
    }
  }, [storageTarget]);

  useEffect(() => {
    if (JSON.stringify(data) !== lastSavedData.current) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => persistData(), 3000);
    }
    onDataChange?.(data);
  }, [data, persistData, onDataChange]);

  const pushToHistory = (newData: CmsData) => {
    setHistory(prev => [...prev.slice(-49), data]);
    setRedoStack([]);
    setData(newData);
  };

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack(prev => [...prev, data]);
    setHistory(prev => prev.slice(0, -1));
    setData(previous);
  }, [history, data]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, data]);
    setRedoStack(prev => prev.slice(0, -1));
    setData(next);
  }, [redoStack, data]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (e.key === "y") { e.preventDefault(); redo(); }
        else if (e.key === "s") { e.preventDefault(); persistData(true); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, persistData]);

  // --- Actions ---

  const addBlock = (type: BlockType, parentId?: string) => {
    const config = BLOCK_CONFIGS.find(c => c.type === type);
    const newBlock: Block = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      content: config?.defaultContent || "",
      children: config?.defaultChildren ? config.defaultChildren() : undefined,
      metadata: config?.defaultMetadata || {},
    };

    let newBlocks;
    if (!parentId) {
      newBlocks = [...data.blocks, newBlock];
    } else {
      newBlocks = updateBlockInTree(data.blocks, parentId, block => ({
        ...block,
        children: [...(block.children || []), newBlock]
      }));
    }
    pushToHistory({ ...data, blocks: newBlocks });
  };

  const deleteBlock = (id: string) => {
    pushToHistory({ ...data, blocks: deleteBlockFromTree(data.blocks, id) });
  };

  const clearCanvas = () => {
    if (confirm("Are you sure you want to clear the entire canvas? This cannot be undone.")) {
      pushToHistory({ ...data, blocks: [] });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cms-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        pushToHistory(imported);
        toast({ title: "Import Successful" });
      } catch (error) {
        toast({ variant: "destructive", title: "Import Failed", description: "Invalid JSON format." });
      }
    };
    reader.readAsText(file);
  };

  const updateBlockContent = (id: string, content: string) => {
    setData(prev => ({
      ...prev,
      blocks: updateBlockInTree(prev.blocks, id, block => ({ ...block, content }))
    }));
  };

  const updateBlockMetadata = (id: string, metadata: BlockMetadata) => {
    pushToHistory({
      ...data,
      blocks: updateBlockInTree(data.blocks, id, block => ({ ...block, metadata }))
    });
  };

  // --- DND Logic ---

  const handleDrop = (e: React.DragEvent, targetId: string, isNested = false) => {
    e.preventDefault();
    setDropTargetId(null);
    if (!draggedId || draggedId === targetId) return;

    const draggedBlock = findBlockById(data.blocks, draggedId);
    if (!draggedBlock) return;
    if (findBlockById(draggedBlock.children || [], targetId)) { setDraggedId(null); return; }

    const moveRecursive = (blocks: Block[]): Block[] => {
      const filtered = deleteBlockFromTree(blocks, draggedId);
      if (isNested) {
        return updateBlockInTree(filtered, targetId, block => ({
          ...block,
          children: [...(block.children || []), draggedBlock]
        }));
      } else {
        const insertBeside = (list: Block[]): Block[] => {
          const index = list.findIndex(b => b.id === targetId);
          if (index !== -1) {
            const newList = [...list];
            newList.splice(index, 0, draggedBlock);
            return newList;
          }
          return list.map(b => b.children ? { ...b, children: insertBeside(b.children) } : b);
        };
        return insertBeside(filtered);
      }
    };

    pushToHistory({ ...data, blocks: moveRecursive(data.blocks) });
    setDraggedId(null);
  };

  // --- Renderers ---

  const EditorBlock = memo(({ block }: { block: Block }) => {
    const isColumn = block.type === "column";
    const isColumns = block.type === "columns";

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full"
      >
        <div
          draggable={!isColumn}
          onDragStart={(e) => { e.stopPropagation(); !isColumn && setDraggedId(block.id); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(block.id); }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={(e) => { e.stopPropagation(); handleDrop(e, block.id, isColumn); }}
          className={cn(
            "group relative border-2 rounded-xl transition-all duration-200",
            isColumn ? "flex-1 min-h-[120px] border-dashed border-muted p-2" : "p-5 mb-4",
            draggedId === block.id ? "border-primary bg-primary/5 opacity-50 scale-95" : 
            isColumn ? "hover:border-primary/30" : "border-border hover:border-primary/40 bg-card hover:shadow-xl",
            dropTargetId === block.id && "border-primary ring-4 ring-primary/10 shadow-2xl"
          )}
        >
          {!isColumn && (
            <div className="absolute left-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
              <div className="p-1 hover:bg-secondary rounded cursor-move"><GripVertical className="w-4 h-4 text-muted-foreground" /></div>
            </div>
          )}

          <div className={cn("flex flex-col", !isColumn && "ml-8")}>
            {isColumns ? (
              <div className="flex gap-4 min-h-[140px]">
                {block.children?.map(child => <EditorBlock key={child.id} block={child} />)}
              </div>
            ) : isColumn ? (
              <div className="space-y-2 h-full flex flex-col">
                <AnimatePresence>
                  {block.children?.map(child => <EditorBlock key={child.id} block={child} />)}
                </AnimatePresence>
                <div className="flex-1 flex flex-col items-center justify-center py-4">
                  {block.children?.length === 0 && (
                    <span className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.2em] opacity-40 mb-2">Empty Zone</span>
                  )}
                  <button onClick={() => addBlock("paragraph", block.id)} className="p-1.5 hover:bg-primary/10 rounded-full text-muted-foreground hover:text-primary transition-all scale-75 hover:scale-100"><Plus className="w-4 h-4" /></button>
                </div>
              </div>
            ) : (
              <div className="w-full">
                {/* Visual Type Indicator */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center"><Layout className="w-3 h-3 text-primary" /></div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{block.type}</span>
                </div>
                
                {/* Dynamic Inputs */}
                {(block.type === "heading" || block.type === "image" || block.type === "video") && (
                  <input
                    type="text" value={block.content}
                    onChange={(e) => updateBlockContent(block.id, e.target.value)}
                    className={cn("w-full bg-transparent text-foreground outline-none focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 border border-transparent hover:border-border", block.type === "heading" ? "text-xl font-bold" : "text-xs font-mono text-muted-foreground")}
                    placeholder={`${block.type.toUpperCase()} content...`}
                  />
                )}
                {(["paragraph", "code", "list", "quote", "button", "gallery", "table", "accordion", "features"] as BlockType[]).includes(block.type) && (
                  <textarea
                    value={block.content}
                    onChange={(e) => updateBlockContent(block.id, e.target.value)}
                    className={cn("w-full bg-transparent text-foreground outline-none focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 resize-none min-h-[80px] border border-transparent hover:border-border text-sm leading-relaxed", block.type === "code" && "bg-zinc-900 text-zinc-100 font-mono text-[11px] p-4")}
                    placeholder={`${block.type.toUpperCase()} content...`}
                    spellCheck={false}
                  />
                )}
                {block.type === "divider" && <div className="h-px w-full bg-border my-4" />}
              </div>
            )}
          </div>

          {/* Block Actions */}
          {!isColumn && (
            <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => setEditingBlockId(block.id)} className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-primary transition-colors" title="Settings"><Settings className="w-3.5 h-3.5" /></button>
              <button onClick={() => duplicateBlock(block.id)} className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground transition-colors" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
              <button onClick={() => deleteBlock(block.id)} className="p-1.5 hover:bg-destructive/10 rounded-lg text-destructive/70 hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      </motion.div>
    );
  });

  const PreviewBlock = ({ block }: { block: Block }) => {
    const meta = block.metadata || {};
    const style = {
      padding: meta.padding ? `${parseInt(meta.padding) * 0.25}rem` : undefined,
      marginTop: meta.margin ? `${parseInt(meta.margin) * 0.125}rem` : undefined,
      marginBottom: meta.margin ? `${parseInt(meta.margin) * 0.125}rem` : undefined,
      backgroundColor: meta.backgroundColor,
      borderRadius: meta.borderRadius,
    };

    const renderContent = () => {
      switch (block.type) {
        case "columns":
          return (
            <div className="flex flex-wrap md:flex-nowrap gap-8">
              {block.children?.map(col => (
                <div key={col.id} className="flex-1 space-y-4">
                  {col.children?.map(child => <PreviewBlock key={child.id} block={child} />)}
                </div>
              ))}
            </div>
          );
        case "heading": return <h1 className="text-4xl font-bold text-foreground leading-tight">{block.content}</h1>;
        case "paragraph": return <p className="text-lg leading-relaxed text-foreground/80 font-light">{block.content}</p>;
        case "image": return <img src={block.content} alt={meta.altText || ""} className="w-full h-auto rounded-lg shadow-sm" />;
        case "code": return <pre className="bg-zinc-950 text-emerald-400 p-6 rounded-xl overflow-x-auto text-[13px] font-mono shadow-inner border border-white/5">{block.content}</pre>;
        case "list": return (
          <ul className="space-y-3">
            {block.content.split("\n").map((item, i) => (
              <li key={i} className="flex items-start gap-4">
                <span className="w-2 h-2 rounded-full bg-primary mt-2.5 flex-shrink-0" />
                <span className="text-lg text-foreground/90">{item}</span>
              </li>
            ))}
          </ul>
        );
        case "quote": {
          const [text, author] = block.content.split("|").map(s => s.trim());
          return (
            <div className="relative py-4">
               <div className="absolute -left-4 top-0 text-6xl text-primary/10 font-serif">"</div>
              <blockquote className="border-l-4 border-primary pl-8">
                <p className="text-2xl italic font-light text-foreground/90 mb-4">"{text}"</p>
                <footer className="text-sm font-bold uppercase tracking-widest text-muted-foreground">— {author}</footer>
              </blockquote>
            </div>
          );
        }
        case "video": return (
          <div className="aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl border border-white/10">
            <iframe src={block.content} className="w-full h-full" allowFullScreen />
          </div>
        );
        case "button": {
          const [text, style, url] = block.content.split("|").map(s => s.trim());
          return (
            <a href={url} className={cn(
              "inline-flex items-center justify-center px-8 py-4 rounded-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-lg",
              style === "secondary" ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20"
            )}>
              {text}
            </a>
          );
        }
        case "divider": return <hr className="border-border/50 my-12" />;
        case "gallery": {
          const images = block.content.split("\n").filter(url => url.trim());
          return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {images.map((url, i) => (
                <motion.img 
                  whileHover={{ scale: 1.05 }} 
                  key={i} src={url} 
                  className="w-full h-56 object-cover rounded-2xl shadow-md border border-white/10" 
                />
              ))}
            </div>
          );
        }
        case "table": {
          const rows = block.content.split("\n").map(row => row.split("|").map(cell => cell.trim()));
          return (
            <div className="overflow-hidden border border-border rounded-2xl shadow-sm">
              <table className="w-full border-collapse">
                <thead><tr>{rows[0]?.map((cell, i) => <th key={i} className="bg-secondary/50 text-foreground border-b border-border px-6 py-4 text-left font-bold text-xs uppercase tracking-widest">{cell}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((row, i) => <tr key={i} className="hover:bg-secondary/20 transition-colors">{row.map((cell, j) => <td key={j} className="border-b border-border/50 px-6 py-4 text-foreground/80">{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        case "accordion": {
          const items = block.content.split("\n\n").map(item => {
            const [q, a] = item.split("|").map(s => s.trim());
            return { q, a };
          });
          return (
            <div className="space-y-3">
              {items.map((item, i) => (
                <details key={i} className="group border border-border rounded-xl bg-card overflow-hidden transition-all">
                  <summary className="px-6 py-4 cursor-pointer font-bold text-foreground flex items-center justify-between hover:bg-secondary/30">
                    {item.q}
                    <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-6 py-4 text-foreground/70 bg-secondary/10 border-t border-border/50 leading-relaxed">{item.a}</div>
                </details>
              ))}
            </div>
          );
        }
        case "features": {
          const feats = block.content.split("\n").map(feat => {
            const [title, desc] = feat.split("|").map(s => s.trim());
            return { title, desc };
          });
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {feats.map((feat, i) => (
                <div key={i} className="bg-card border border-border/50 p-8 rounded-3xl shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6"><Star className="w-6 h-6 text-primary" /></div>
                  <h3 className="text-xl font-bold text-foreground mb-3">{feat.title}</h3>
                  <p className="text-foreground/60 leading-relaxed">{feat.desc}</p>
                </div>
              ))}
            </div>
          );
        }
        default: return null;
      }
    };

    return (
      <div style={style} className={meta.customClass}>
        {renderContent()}
      </div>
    );
  };

  // --- JS Execution ---
  useEffect(() => {
    if (!data.globalJs) return;
    try {
      const script = document.createElement("script");
      script.text = `(function(){ ${data.globalJs} })();`;
      document.body.appendChild(script);
      return () => { document.body.removeChild(script); };
    } catch (error) { console.error("Global JS error:", error); }
  }, [data.globalJs]);

  return (
    <div className="flex overflow-hidden h-full bg-background text-foreground selection:bg-primary/20">
      <style>{data.globalCss}</style>
      
      {/* Settings Modal Overlay */}
      <AnimatePresence>
        {editingBlockId && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingBlockId(null)} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[45]" />
            <SettingsPanel 
              block={findBlockById(data.blocks, editingBlockId)!} 
              onUpdate={(meta) => updateBlockMetadata(editingBlockId, meta)}
              onClose={() => setEditingBlockId(null)}
            />
          </>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(sidebarWidth, "border-r border-border bg-card flex flex-col z-40")}>
        <div className="flex border-b border-border p-1 bg-secondary/10">
          <button onClick={() => setActiveTab("blocks")} className={cn("flex-1 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", activeTab === "blocks" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Layout className="w-3.5 h-3.5" /> Blocks
          </button>
          <button onClick={() => setActiveTab("code")} className={cn("flex-1 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", activeTab === "code" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Code2 className="w-3.5 h-3.5" /> Dev
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {activeTab === "blocks" ? (
            <div className="p-5 space-y-8">
              {["Layout", "Basic", "Advanced"].map(cat => (
                <div key={cat}>
                  <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] px-2 mb-4 opacity-50">{cat}</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {BLOCK_CONFIGS.filter(c => c.category === cat).map(({ icon: Icon, label, type }) => (
                      <button
                        key={label} onClick={() => addBlock(type)}
                        className="w-full px-4 py-3 rounded-xl bg-transparent hover:bg-primary/5 text-foreground transition-all text-xs font-bold flex items-center justify-between group border border-transparent hover:border-primary/20"
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          {label}
                        </div>
                        <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col h-full">
               <div className="flex bg-secondary/30 p-1 m-4 rounded-xl">
                {[{ id: "html", icon: FileCode }, { id: "css", icon: Palette }, { id: "js", icon: Terminal }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveCodeTab(id as any)} className={cn("flex-1 py-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-2 transition-all", activeCodeTab === id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <Icon className="w-3.5 h-3.5" /> {id.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex-1 px-4 pb-4">
                <textarea
                  value={activeCodeTab === "html" ? data.globalHtml : activeCodeTab === "css" ? data.globalCss : data.globalJs}
                  onChange={(e) => setData(prev => ({ ...prev, [activeCodeTab === "html" ? "globalHtml" : activeCodeTab === "css" ? "globalCss" : "globalJs"]: e.target.value }))}
                  className="w-full h-full bg-zinc-950 text-emerald-400 p-5 rounded-2xl outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono text-[11px] leading-relaxed shadow-inner border border-white/5"
                  placeholder={`// Custom ${activeCodeTab.toUpperCase()} code...`}
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border space-y-4 bg-secondary/5">
          <div className="flex items-center justify-between px-1">
             <div className="flex gap-1">
                <button onClick={undo} disabled={history.length === 0} className="p-2 hover:bg-secondary rounded-lg disabled:opacity-30 transition-all active:scale-90" title="Undo (Ctrl+Z)"><RotateCcw className="w-4 h-4 scale-x-[-1]" /></button>
                <button onClick={redo} disabled={redoStack.length === 0} className="p-2 hover:bg-secondary rounded-lg disabled:opacity-30 transition-all active:scale-90" title="Redo (Ctrl+Y)"><RotateCcw className="w-4 h-4" /></button>
              </div>
              <button onClick={clearCanvas} className="p-2 hover:bg-destructive/10 text-destructive/70 hover:text-destructive rounded-lg transition-all active:scale-90" title="Clear Canvas"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <div className="w-full py-2.5 px-3 bg-secondary/50 border border-border rounded-xl text-[10px] font-black uppercase tracking-widest text-center cursor-pointer hover:bg-secondary transition-all flex items-center justify-center gap-2">
                <Upload className="w-3 h-3" /> Import
              </div>
              <input type="file" accept=".json" onChange={importJson} className="hidden" />
            </label>
            <button onClick={exportJson} className="flex-1 py-2.5 px-3 bg-secondary/50 border border-border rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-secondary transition-all flex items-center justify-center gap-2">
              <Download className="w-3 h-3" /> Export
            </button>
          </div>
          <button onClick={() => persistData(true)} className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:opacity-90 transition-all shadow-xl shadow-primary/20 active:scale-[0.98]">
            <Save className="w-4 h-4" /> Save Changes
          </button>
        </div>
      </aside>

      {/* Editor & Preview */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor Area */}
        <main className={cn(editorWidth, "overflow-y-auto border-r border-border bg-secondary/5 relative")}>
          <div className="p-10 max-w-2xl mx-auto min-h-full">
            <header className="mb-10 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Project Canvas</h2>
                <p className="text-xs text-muted-foreground mt-1 font-medium">Drafting recursive layouts</p>
              </div>
              <div className="flex items-center gap-2 bg-card border border-border p-1 rounded-lg shadow-sm">
                 <button onClick={() => setViewport("desktop")} className={cn("p-1.5 rounded transition-all", viewport === "desktop" ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground")}><Monitor className="w-3.5 h-3.5" /></button>
                 <button onClick={() => setViewport("tablet")} className={cn("p-1.5 rounded transition-all", viewport === "tablet" ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground")}><TabletIcon className="w-3.5 h-3.5" /></button>
                 <button onClick={() => setViewport("mobile")} className={cn("p-1.5 rounded transition-all", viewport === "mobile" ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground")}><Smartphone className="w-3.5 h-3.5" /></button>
              </div>
            </header>

            <AnimatePresence initial={false}>
              {data.blocks.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-32 text-center border-2 border-dashed border-border rounded-[2rem] bg-card/30 backdrop-blur-sm">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6"><Plus className="w-10 h-10 text-primary opacity-40" /></div>
                  <p className="text-lg font-bold text-foreground/40">Ready to build?</p>
                  <p className="text-xs text-muted-foreground/50 mt-2 font-medium tracking-wide">Choose a block from the library to start your design</p>
                </motion.div>
              ) : (
                <div className="space-y-1">
                  {data.blocks.map(block => <EditorBlock key={block.id} block={block} />)}
                </div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Preview Area */}
        <section className="flex-1 flex flex-col bg-zinc-100 dark:bg-zinc-900/50">
          <header className="h-12 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
             <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-destructive/30" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400/30" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/30" />
                </div>
                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-60">Live Preview</span>
             </div>
             <div className="flex items-center gap-4">
                <div className="text-[10px] font-bold text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded uppercase">{viewport} Mode</div>
                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
             </div>
          </header>

          <div className="flex-1 overflow-y-auto p-12 flex justify-center custom-scrollbar bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)]">
             <motion.div
               layout
               animate={{ width: viewport === "mobile" ? 375 : viewport === "tablet" ? 768 : "100%" }}
               transition={{ type: "spring", stiffness: 300, damping: 30 }}
               className="bg-card min-h-full shadow-2xl overflow-hidden rounded-2xl origin-top border border-border"
             >
                <div className="p-12">
                   <div dangerouslySetInnerHTML={{ __html: data.globalHtml }} />
                   <div className="space-y-12 mt-6">
                     {data.blocks.map(block => <div key={block.id}><PreviewBlock block={block} /></div>)}
                   </div>
                </div>
             </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
};
