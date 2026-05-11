import { BlockCMS } from "@/components";

export default function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-40">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">BlockCMS</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live Edit. Real-time Preview. Advanced Layouts.
            </p>
          </div>
          <div className="bg-secondary/50 px-3 py-1.5 rounded-lg border border-border">
            <code className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Storage: file:homepage
            </code>
          </div>
        </div>
      </header>

      {/* CMS Component */}
      <BlockCMS
        storageTarget="file:homepage"
        onDataChange={(data) => {
          // You could also sync to a global state manager here if needed
        }}
      />
    </div>
  );
}
