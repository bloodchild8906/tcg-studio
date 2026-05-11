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
  LucideIcon,
} from "lucide-react";

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

export interface BlockCMSProps {
  initialData?: CmsData;
  onDataChange?: (data: CmsData) => void;
  storageTarget?: string;
  sidebarWidth?: string;
  editorWidth?: string;
}

export interface BlockConfig {
  icon: LucideIcon;
  label: string;
  type: BlockType;
  category: "Layout" | "Basic" | "Advanced";
  defaultContent: string;
  defaultChildren?: () => Block[];
  defaultMetadata?: BlockMetadata;
}

export const BLOCK_CONFIGS: BlockConfig[] = [
  {
    icon: Columns,
    label: "2 Columns",
    type: "columns",
    category: "Layout",
    defaultContent: "2",
    defaultChildren: () => [
      { id: `col-${Math.random().toString(36).substr(2, 9)}`, type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: `col-${Math.random().toString(36).substr(2, 9)}`, type: "column", content: "", children: [], metadata: { padding: "4" } },
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
      { id: `col-${Math.random().toString(36).substr(2, 9)}`, type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: `col-${Math.random().toString(36).substr(2, 9)}`, type: "column", content: "", children: [], metadata: { padding: "4" } },
      { id: `col-${Math.random().toString(36).substr(2, 9)}`, type: "column", content: "", children: [], metadata: { padding: "4" } },
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
    defaultContent: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=600",
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
    defaultContent: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  {
    icon: SquareArrowRight,
    label: "Button",
    type: "button",
    category: "Advanced",
    defaultContent: "Click Me|primary|https://example.com",
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
    defaultContent: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400\nhttps://images.unsplash.com/photo-1575537302964-96cd647570ebb?w=400\nhttps://images.unsplash.com/photo-1552664730-d307ca884978?w=400",
  },
  {
    icon: TableIcon,
    label: "Table",
    type: "table",
    category: "Advanced",
    defaultContent: "Header 1 | Header 2 | Header 3\nRow 1 Col 1 | Row 1 Col 2 | Row 1 Col 3\nRow 2 Col 1 | Row 2 Col 2 | Row 2 Col 3",
  },
  {
    icon: ChevronDown,
    label: "Accordion",
    type: "accordion",
    category: "Advanced",
    defaultContent: "What is this?|This is an accordion item\nHow does it work?|Accordion items expand and collapse",
  },
  {
    icon: Star,
    label: "Features",
    type: "features",
    category: "Advanced",
    defaultContent: "Feature 1|Description of the first feature\nFeature 2|Description of the second feature\nFeature 3|Description of the third feature",
  },
];
