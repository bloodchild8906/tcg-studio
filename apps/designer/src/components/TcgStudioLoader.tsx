import React, { useMemo } from "react";
import "./TcgStudioLoader.css";

const LOGO_SRC = "data:image/webp;base64,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";

export type LoaderSize = "sm" | "md" | "lg" | "hero";
export type LoaderTone = "ember" | "arcane" | "void" | "verdant";
export type LoaderMode = "forge" | "compile" | "publish";

export type TcgStudioLoaderProps = {
  size?: LoaderSize;
  tone?: LoaderTone;
  mode?: LoaderMode;
  label?: string;
  sublabel?: string;
  progress?: number;
  showText?: boolean;
  showStatusPills?: boolean;
  logoSrc?: string;
};

const sizeMap: Record<LoaderSize, number> = {
  sm: 82,
  md: 132,
  lg: 190,
  hero: 260,
};

const toneClasses: Record<LoaderTone, string> = {
  ember: "tone-ember",
  arcane: "tone-arcane",
  void: "tone-void",
  verdant: "tone-verdant",
};

const modeCopy: Record<LoaderMode, { verb: string; steps: string[] }> = {
  forge: {
    verb: "Forging",
    steps: ["Canvas", "Frames", "Variants", "Rules", "Exports"],
  },
  compile: {
    verb: "Compiling",
    steps: ["Schema", "Layers", "Assets", "Checks", "Preview"],
  },
  publish: {
    verb: "Publishing",
    steps: ["Package", "Manifest", "Sprites", "CMS", "Deploy"],
  },
};

const shardGlyphs = ["✦", "◆", "✧", "✹", "◇", "✶", "✺", "✷"];
const orbitLabels = ["UXML", "USS", "JSON", "PNG"];

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function LoaderShard({ index }: { index: number }) {
  return (
    <span className={`loader-shard shard-${index}`} aria-hidden="true">
      <i>{shardGlyphs[index % shardGlyphs.length]}</i>
    </span>
  );
}

function OrbitChip({ index, label }: { index: number; label: string }) {
  return (
    <span className={`orbit-chip chip-${index}`} aria-hidden="true">
      {label}
    </span>
  );
}

function StatusPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={active ? "status-pill is-active" : "status-pill"}>{children}</span>;
}

export function TcgStudioLoader({
  size = "lg",
  tone = "ember",
  mode = "forge",
  label = "Opening TCG Card Studio",
  sublabel = "Preparing canvas, symbols, layers, variants, and exports",
  progress,
  showText = true,
  showStatusPills = true,
  logoSrc = LOGO_SRC,
}: TcgStudioLoaderProps) {
  const pixelSize = sizeMap[size];
  const safeProgress = typeof progress === "number" ? clampProgress(progress) : undefined;
  const displayProgress = safeProgress ?? 68;
  const copy = modeCopy[mode];
  const activeStep = Math.min(copy.steps.length - 1, Math.floor((displayProgress / 100) * copy.steps.length));
  const statusText = typeof safeProgress === "number" ? `${label} ${Math.round(safeProgress)}%` : label;

  const loaderStyle = useMemo(
    () => ({
      "--loader-size": `${pixelSize}px`,
      "--progress": `${displayProgress}`,
    } as React.CSSProperties),
    [pixelSize, displayProgress]
  );

  return (
    <section
      className={`tcg-loader ${toneClasses[tone]} loader-${size} mode-${mode}`}
      style={loaderStyle}
      role="status"
      aria-live="polite"
      aria-label={statusText}
    >
      <div className="loader-core">
        <div className="aura aura-back" aria-hidden="true" />
        <div className="aura aura-front" aria-hidden="true" />

        <div className="back-card card-a" aria-hidden="true" />
        <div className="back-card card-b" aria-hidden="true" />
        <div className="back-card card-c" aria-hidden="true" />

        <div className="dial dial-progress" aria-hidden="true" />
        <div className="dial dial-major" aria-hidden="true" />
        <div className="dial dial-minor" aria-hidden="true" />
        <div className="dial dial-runes" aria-hidden="true" />
        <div className="dial dial-cut" aria-hidden="true" />

        <div className="orbit orbit-shards" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <LoaderShard key={index} index={index} />)}
        </div>

        <div className="orbit orbit-chips" aria-hidden="true">
          {orbitLabels.map((item, index) => <OrbitChip key={item} index={index} label={item} />)}
        </div>

        <div className="studio-emblem" aria-hidden="true">
          <span className="emblem-corner corner-tl" />
          <span className="emblem-corner corner-tr" />
          <span className="emblem-corner corner-bl" />
          <span className="emblem-corner corner-br" />
          <span className="emblem-glass" />
          <span className="emblem-sheen" />
          <img className="loader-logo" src={logoSrc} alt="TCG Studio logo" draggable={false} />
        </div>

        <div className="scan-beam" aria-hidden="true" />
        <div className="spark-field" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => <span key={index} className={`spark spark-${index}`} />)}
        </div>
      </div>

      {showText && (
        <div className="loader-copy">
          <div className="loader-title-row">
            <span>{copy.verb}</span>
            {typeof safeProgress === "number" && <b>{Math.round(safeProgress)}%</b>}
          </div>
          <strong>{label}</strong>
          <small>{sublabel}</small>

          {showStatusPills && size !== "sm" && (
            <div className="status-pills" aria-hidden="true">
              {copy.steps.map((step, index) => (
                <StatusPill key={step} active={index <= activeStep}>{step}</StatusPill>
              ))}
            </div>
          )}

          {typeof safeProgress === "number" && (
            <div className="progress-track" aria-hidden="true">
              <b style={{ width: `${safeProgress}%` }} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
