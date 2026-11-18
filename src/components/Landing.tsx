import {
  useCallback,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Contrast,
  FileText,
  FolderOpen,
  Hand,
  Layers,
  Loader2,
  Ruler,
  Search,
  Tags,
  Upload,
  Move,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { filesFromDataTransfer, toFiles } from "@/lib/files";
import { ACTION_KEYS, TOOL_KEYS } from "@/lib/shortcuts";
import { SITE } from "@/lib/site";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

interface LandingProps {
  onFiles: (files: File[]) => void;
  onSample: () => void | Promise<void>;
  loading?: boolean;
}

const MOCK_TOOLS: ComponentType<{ className?: string }>[] = [
  Contrast,
  Hand,
  Search,
  Layers,
  Ruler,
];

/** Header groups shown in the empty inspector: [label, placeholder width]. */
const MOCK_INSPECTOR: { title: string; fields: [string, string][] }[] = [
  {
    title: "Patient",
    fields: [
      ["Name", "60%"],
      ["ID", "45%"],
    ],
  },
  {
    title: "Study",
    fields: [
      ["Description", "75%"],
      ["Date", "40%"],
      ["Accession", "50%"],
    ],
  },
  {
    title: "Series",
    fields: [
      ["Modality", "22%"],
      ["Body part", "35%"],
    ],
  },
  {
    title: "Image",
    fields: [
      ["Matrix", "35%"],
      ["Spacing", "50%"],
    ],
  },
];

export function Landing({ onFiles, onSample, loading }: LandingProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  // dragenter/dragleave fire for every child element; count to know when the
  // pointer has really left the page.
  const dragDepth = useRef(0);

  const busy = loading || sampleLoading;

  const isFileDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("Files");

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (busy) return;
      onFiles(await filesFromDataTransfer(e.dataTransfer));
    },
    [onFiles, busy],
  );

  const handleSample = useCallback(async () => {
    setSampleLoading(true);
    try {
      await onSample();
    } finally {
      setSampleLoading(false);
    }
  }, [onSample]);

  return (
    <div
      className="flex min-h-full flex-col bg-background bg-dotgrid text-foreground"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="border-b border-line bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight">
              {SITE.name}
            </span>
            <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              beta
            </span>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            <a
              href={SITE.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <GithubIcon className="size-4" />
              Source code
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center gap-16 px-4 pb-16 pt-12 sm:px-6 lg:px-10">
        {/* Hero */}
        <div className="flex max-w-[880px] flex-col items-center gap-4 text-center">
          <h1 className="text-[clamp(2.5rem,6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">
            Open any scan.
            <br />
            <span className="text-faint">Nothing leaves your device.</span>
          </h1>
          <p className="max-w-[600px] text-[17px] leading-[1.55] text-muted-foreground text-pretty">
            Open DICOM files to scroll through CT, MR and X-ray series and
            search every header tag. Everything runs on your own machine.
          </p>
        </div>

        {/* Dropzone, styled as an empty viewer */}
        <section
          aria-label="Open DICOM data"
          className={cn(
            "w-full overflow-hidden rounded-2xl border bg-card shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] transition-colors",
            dragging ? "border-primary" : "border-line-strong",
          )}
        >
          {/* Toolbar */}
          <div
            aria-hidden="true"
            className="flex h-11 items-center gap-1 border-b border-line px-2"
          >
            {MOCK_TOOLS.map((Icon, i) => (
              <span
                key={i}
                className="flex size-8 items-center justify-center rounded-lg text-faint opacity-60"
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>

          <div className="flex min-h-[340px] lg:min-h-[480px]">
            {/* Empty series rail */}
            <div
              aria-hidden="true"
              className="hidden w-[240px] flex-none flex-col gap-2 border-r border-line p-3 md:flex"
            >
              <div className="flex text-xs text-faint">
                <span>Series</span>
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line p-2"
                >
                  <div className="size-10 flex-none rounded-md bg-elevated/60" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-2 w-4/5 rounded bg-elevated" />
                    <div className="h-2 w-1/2 rounded bg-elevated/70" />
                  </div>
                </div>
              ))}
            </div>

            {/* Stage */}
            <div className="flex flex-1 p-3">
              <div
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-5 rounded-xl border-[1.5px] border-dashed px-6 py-10 text-center transition-colors",
                  dragging
                    ? "border-primary bg-accent/50"
                    : "border-line-strong bg-background/60",
                )}
              >
                <div
                  className={cn(
                    "flex size-12 items-center justify-center rounded-xl border border-line-strong bg-elevated transition-transform",
                    dragging && "scale-110",
                  )}
                >
                  <Upload className="size-5" />
                </div>

                {dragging ? (
                  <div className="text-[17px] font-medium">Release to open</div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[17px] font-medium">
                        Drop a DICOM folder anywhere on this page
                      </div>
                      <div className="text-sm text-muted-foreground">
                        CD and PACS exports, .zip archives, .dcm and
                        extension-less files
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={() => folderInput.current?.click()}
                        disabled={busy}
                      >
                        <FolderOpen className="size-4" />
                        Choose folder
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => fileInput.current?.click()}
                        disabled={busy}
                      >
                        <FileText className="size-4" />
                        Choose files
                      </Button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSample}
                      disabled={busy}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                    >
                      {sampleLoading && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      No scan handy?{" "}
                      <span className="font-medium text-foreground">
                        Open a sample study
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Empty header inspector */}
            <div
              aria-hidden="true"
              className="hidden w-[240px] flex-none flex-col gap-5 border-l border-line p-4 lg:flex"
            >
              {MOCK_INSPECTOR.map((group) => (
                <div key={group.title} className="flex flex-col gap-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
                    {group.title}
                  </span>
                  {group.fields.map(([label, width]) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 text-xs text-faint"
                    >
                      <span className="w-[76px] flex-none">{label}</span>
                      <div
                        className="h-1.5 rounded bg-elevated"
                        style={{ width }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What you can do */}
        <section
          aria-labelledby="features"
          className="flex w-full flex-col gap-5"
        >
          <h2 id="features" className="sr-only">
            Features
          </h2>
          <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Layers className="size-5" />}
              title="Scroll stacks"
              body="Wheel or arrow keys through every slice, or play the series as cine."
              keys={[ACTION_KEYS.prev, ACTION_KEYS.next, ACTION_KEYS.play]}
            />
            <FeatureCard
              icon={<Contrast className="size-5" />}
              title="Window / level"
              body="Drag to change brightness and contrast. Invert or reset in one key."
              keys={[
                TOOL_KEYS.WindowLevel,
                ACTION_KEYS.invert,
                ACTION_KEYS.reset,
              ]}
            />
            <FeatureCard
              icon={<Move className="size-5" />}
              title="Zoom & pan"
              body="Zoom with right-drag, pan with middle-drag, or pick the tool by key."
              keys={[TOOL_KEYS.Zoom, TOOL_KEYS.Pan]}
            />
            <FeatureCard
              icon={<Tags className="size-5" />}
              title="Tags inspector"
              body="Key fields at a glance, plus the full header with search across every tag."
              keys={[ACTION_KEYS.header]}
            />
          </div>
        </section>
      </main>

      <SiteFooter />

      {/* Hidden inputs */}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(toFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error non-standard but widely supported folder picker
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          onFiles(toFiles(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  keys,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  keys: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-elevated">
          {icon}
        </div>
        <div className="flex gap-1">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-medium">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
