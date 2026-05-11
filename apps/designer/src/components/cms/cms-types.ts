/**
 * Block CMS — type definitions.
 *
 * Ported (mostly verbatim) from the standalone `apps/designer/cms/`
 * prototype so we can reuse just the page-builder component inside
 * the existing CmsView. The shape is the authoring schema for the
 * page builder: a tree of `Block` records with free-form `content`
 * strings (pipe-delimited for compound blocks like "button" or
 * "quote") and optional per-block styling metadata.
 *
 * The tree is serialized into `CmsPage.contentJson` as-is when a
 * page is saved through the existing API.
 */
import {
  Type,
  Edit2,
  Image as ImageIcon,
  List,
  Quote,
  Video,
  SquareArrowRight,
  Minus,
  Grid3x3,
  Table as TableIcon,
  ChevronDown,
  Star,
  Columns,
  type IconComponent,
} from "./icons";

export type BlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "code"
  | "columns"
  | "column"
  | "list"
  | "quote"
  | "video"
  | "button"
  | "divider"
  | "gallery"
  | "table"
  | "accordion"
  | "features";

export interface BlockMetadata {
  padding?: string;
  margin?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  customClass?: string;
  altText?: string;
  linkTarget?: string;
  aspectRatio?: string;
  columns?: number;
}

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  children?: Block[];
  metadata?: BlockMetadata;
}

export interface CmsData {
  blocks: Block[];
  globalHtml: string;
  globalCss: string;
  globalJs: string;
}

export type ViewportMode = "mobile" | "tablet" | "desktop";

/**
 * Theme tokens for the page-builder's preview surface. Match the
 * `ThemeTokens` shape stored on `CmsSite.themeJson` so the builder
 * shows the same look the public site will publish. Editor chrome
 * (sidebar, settings panel) deliberately stays on the studio's own
 * palette — only the page content + the preview pane respect these.
 */
export interface BlockCmsTheme {
  /** Primary accent — buttons, headings, dividers. CSS color. */
  accent?: string;
  /** Page surface / canvas background. CSS color. */
  surface?: string;
  /** Body text color on the preview surface. CSS color. */
  text?: string;
  /** Body font family. Plain string — the parent loads fonts. */
  bodyFont?: string;
  /** Heading font family. */
  headingFont?: string;
  /** Corner radius in px (0 = sharp, 12 = round). Default 8. */
  radius?: number;
}

export interface BlockCMSProps {
  initialData?: CmsData;
  /** Fired on every state change. Parent owns persistence — wire this
   *  into your save/dirty tracking. */
  onDataChange?: (data: CmsData) => void;
  /** Theme tokens to apply to the preview pane + page content. When
   *  omitted, the builder falls back to the studio's own palette. */
  theme?: BlockCmsTheme;
  sidebarWidth?: string;
  editorWidth?: string;
}

export interface BlockConfig {
  icon: IconComponent;
  label: string;
  type: BlockType;
  category: "Layout" | "Basic" | "Advanced";
  defaultContent: string;
  defaultChildren?: () => Block[];
  defaultMetadata?: BlockMetadata;
}

/**
 * Helper — generate a short ID. The prototype used
 * `Math.random().toString(36).substr(2, 9)`; `substr` is deprecated,
 * so we use `slice` here. IDs are local to the page tree, not stored
 * anywhere we'd need them to round-trip identically.
 */
export function newBlockId(prefix = "b"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

export const BLOCK_CONFIGS: BlockConfig[] = [
  {
    icon: Columns,
    label: "2 Columns",
    type: "columns",
    category: "Layout",
    defaultContent: "2",
    defaultChildren: () => [
      { id: newBlockId("col"), type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: newBlockId("col"), type: "column", content: "", children: [], metadata: { padding: "4" } },
    ],
    defaultMetadata: { padding: "0", margin: "0" },
  },
  {
    icon: Columns,
    label: "3 Columns",
    type: "columns",
    category: "Layout",
    defaultContent: "3",
    defaultChildren: () => [
      { id: newBlockId("col"), type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: newBlockId("col"), type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: newBlockId("col"), type: "column", content: "", children: [], metadata: { padding: "4" } },
    ],
    defaultMetadata: { padding: "0", margin: "0" },
  },
  {
    icon: Type,
    label: "Heading",
    type: "heading",
    category: "Basic",
    defaultContent: "New Heading",
  },
  {
    icon: Edit2,
    label: "Paragraph",
    type: "paragraph",
    category: "Basic",
    defaultContent: "Enter your text here...",
  },
  {
    icon: ImageIcon,
    label: "Image",
    type: "image",
    category: "Basic",
    defaultContent: "",
  },
  {
    icon: List,
    label: "List",
    type: "list",
    category: "Basic",
    defaultContent: "Item 1\nItem 2\nItem 3",
  },
  {
    icon: Quote,
    label: "Quote",
    type: "quote",
    category: "Advanced",
    defaultContent: "This is an inspiring quote...|Author Name",
  },
  {
    icon: Video,
    label: "Video",
    type: "video",
    category: "Advanced",
    defaultContent: "",
  },
  {
    icon: SquareArrowRight,
    label: "Button",
    type: "button",
    category: "Advanced",
    defaultContent: "Click Me|primary|#",
  },
  {
    icon: Minus,
    label: "Divider",
    type: "divider",
    category: "Advanced",
    defaultContent: "",
  },
  {
    icon: Grid3x3,
    label: "Gallery",
    type: "gallery",
    category: "Advanced",
    defaultContent: "",
  },
  {
    icon: TableIcon,
    label: "Table",
    type: "table",
    category: "Advanced",
    defaultContent: "Header 1 | Header 2 | Header 3\nRow 1 Col 1 | Row 1 Col 2 | Row 1 Col 3",
  },
  {
    icon: ChevronDown,
    label: "Accordion",
    type: "accordion",
    category: "Advanced",
    defaultContent: "What is this?|This is an accordion item\n\nHow does it work?|It expands and collapses",
  },
  {
    icon: Star,
    label: "Features",
    type: "features",
    category: "Advanced",
    defaultContent: "Feature 1|Description of the first feature\nFeature 2|Description of the second feature\nFeature 3|Description of the third feature",
  },
];

/**
 * Empty starter state — used when a page has no content yet. Keeps
 * the canvas non-empty so the user has something to edit immediately.
 */
export const EMPTY_CMS_DATA: CmsData = {
  blocks: [],
  globalHtml: "",
  globalCss: "",
  globalJs: "",
};
