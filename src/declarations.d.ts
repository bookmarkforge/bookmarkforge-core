/**
 * declarations.d.ts — lightweight stubs for third-party libraries whose
 * full published type trees would bloat the bundle or stress the type
 * checker at every build.
 *
 * The project ESLint config (eslint.config.js) deliberately disables
 * `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-unused-vars`
 * for this single file because the stubs intentionally expose opaque generic
 * surfaces from RxDB, Mantine, and HuggingFace Transformers. Production code
 * (every other file under `src/`) is subject to those same rules at stricter
 * levels — see the project-wide override in eslint.config.js.
 */
declare module "lucide-react" {
  import {
    FC,
    SVGProps,
    RefAttributes,
    ForwardRefExoticComponent,
  } from "react";
  interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string;
    absoluteStrokeWidth?: boolean;
  }
  type IconNode = [string, Record<string, string>][];
  type LucideComponent = ForwardRefExoticComponent<
    LucideProps & RefAttributes<SVGSVGElement>
  >;
  export type LucideIcon = LucideComponent;
  export const Icon: LucideComponent;
  export function createReactComponent(tag: string): LucideComponent;
  export function createLucideIcon(
    name: string,
    iconNode: IconNode,
  ): LucideComponent;
  // Allow any icon name
  export const Wand2: LucideComponent;
  export const Code2: LucideComponent;
  export const Layout: LucideComponent;
  export const Megaphone: LucideComponent;
  export const Briefcase: LucideComponent;
  export const Accessibility: LucideComponent;
  export const Rocket: LucideComponent;
  export const Wrench: LucideComponent;
  export const CloudLightning: LucideComponent;
  export const Microscope: LucideComponent;
  export const MessageSquareQuote: LucideComponent;
  export const CheckCircle: LucideComponent;
  export const BrainCircuit: LucideComponent;
  export const SearchIcon: LucideComponent;
  export const History: LucideComponent;
  export const Link: LucideComponent;
  export const Link2: LucideComponent;
  export const HardDrive: LucideComponent;
  export const Trash2: LucideComponent;
  export const Loader2: LucideComponent;
  export const Database: LucideComponent;
  export const Download: LucideComponent;
  export const Upload: LucideComponent;
  export const Crown: LucideComponent;
  export const Check: LucideComponent;
  export const Shield: LucideComponent;
  export const ArrowRight: LucideComponent;
  export const RotateCcw: LucideComponent;
  export const Zap: LucideComponent;
  export const ChevronDown: LucideComponent;
  export const Sparkles: LucideComponent;
  export const ExternalLink: LucideComponent;
  export const Search: LucideComponent;
  export const X: LucideComponent;
  export const Plus: LucideComponent;
  export const Menu: LucideComponent;
  export const Settings: LucideComponent;
  export const Bell: LucideComponent;
  export const Sun: LucideComponent;
  export const Moon: LucideComponent;
  export const Bookmark: LucideComponent;
  export const Folder: LucideComponent;
  export const FileText: LucideComponent;
  export const Home: LucideComponent;
  export const BarChart3: LucideComponent;
  export const Share2: LucideComponent;
  export const Lock: LucideComponent;
  export const Unlock: LucideComponent;
  export const Key: LucideComponent;
  export const AlertTriangle: LucideComponent;
  export const AlertCircle: LucideComponent;
  export const Info: LucideComponent;
  export const HelpCircle: LucideComponent;
  export const Copy: LucideComponent;
  export const Edit3: LucideComponent;
  export const MoreVertical: LucideComponent;
  export const ChevronRight: LucideComponent;
  export const ChevronLeft: LucideComponent;
  export const Filter: LucideComponent;
  export const Sliders: LucideComponent;
  export const RefreshCw: LucideComponent;
  export const Globe: LucideComponent;
  export const Tag: LucideComponent;
  export const Clock: LucideComponent;
  export const Star: LucideComponent;
  export const Mic: LucideComponent;
  export const Volume2: LucideComponent;
  export const VolumeX: LucideComponent;
  export const Play: LucideComponent;
  export const Pause: LucideComponent;
  export const StopCircle: LucideComponent;
  export const Maximize2: LucideComponent;
  export const Minimize2: LucideComponent;
  export const GripVertical: LucideComponent;
  export const List: LucideComponent;
  export const Grid3X3: LucideComponent;
  export const LayoutGrid: LucideComponent;
  export const PanelLeft: LucideComponent;
  export const PanelRight: LucideComponent;
  export const Columns3: LucideComponent;
  export const Rows3: LucideComponent;
  export const Bold: LucideComponent;
  export const Italic: LucideComponent;
  export const Underline: LucideComponent;
  export const Strikethrough: LucideComponent;
  export const ListOrdered: LucideComponent;
  export const ListTodo: LucideComponent;
  export const Quote: LucideComponent;
  export const Code: LucideComponent;
  export const Image: LucideComponent;
  export const Table: LucideComponent;
  export const Undo2: LucideComponent;
  export const Redo2: LucideComponent;
  export const AlignLeft: LucideComponent;
  export const AlignCenter: LucideComponent;
  export const AlignRight: LucideComponent;
  export const Indent: LucideComponent;
  export const Outdent: LucideComponent;
  export const Hash: LucideComponent;
  export const AtSign: LucideComponent;
  export const CheckSquare: LucideComponent;
  export const Square: LucideComponent;
  export const Circle: LucideComponent;
  export const Trash: LucideComponent;
  export const Eye: LucideComponent;
  export const EyeOff: LucideComponent;
  export const DownloadCloud: LucideComponent;
  export const UploadCloud: LucideComponent;
  export const Cloud: LucideComponent;
  export const CloudOff: LucideComponent;
  export const Wifi: LucideComponent;
  export const WifiOff: LucideComponent;
  export const Smartphone: LucideComponent;
  export const Monitor: LucideComponent;
  export const MonitorSmartphone: LucideComponent;
  export const Tablet: LucideComponent;
  export const Palette: LucideComponent;
  export const Type: LucideComponent;
  export const Languages: LucideComponent;
  export const Volume1: LucideComponent;
  export const Headphones: LucideComponent;
  export const CornerDownLeft: LucideComponent;
  export const ArrowUpDown: LucideComponent;
  export const ArrowUp: LucideComponent;
  export const ArrowDown: LucideComponent;
  export const ArrowLeft: LucideComponent;
  export const ArrowUpRight: LucideComponent;
  export const Activity: LucideComponent;
  export const Cpu: LucideComponent;
  export const MemoryStick: LucideComponent;
  export const Network: LucideComponent;
  export const Server: LucideComponent;
  export const Terminal: LucideComponent;
  export const Command: LucideComponent;
  export const BookOpen: LucideComponent;
  export const Library: LucideComponent;
  export const Map: LucideComponent;
  export const Compass: LucideComponent;
  export const Bot: LucideComponent;
  export const Workflow: LucideComponent;
  export const Layers: LucideComponent;
  export const GitBranch: LucideComponent;
  export const GitMerge: LucideComponent;
  export const GitPullRequest: LucideComponent;
  export const ShieldAlert: LucideComponent;
  export const ShieldCheck: LucideComponent;
  export const Brain: LucideComponent;
  export const Sparkle: LucideComponent;
  export const Fingerprint: LucideComponent;
  export const CreditCard: LucideComponent;
  export const ShoppingCart: LucideComponent;
  export const Gift: LucideComponent;
  export const Percent: LucideComponent;
  export const BadgeCheck: LucideComponent;
  export const Gauge: LucideComponent;
  export const Timer: LucideComponent;
  export const TimerReset: LucideComponent;
  export const Users: LucideComponent;
  export const UserPlus: LucideComponent;
  export const UserCheck: LucideComponent;
  export const UserX: LucideComponent;
  export const Mail: LucideComponent;
  export const MessageCircle: LucideComponent;
  export const MessageSquare: LucideComponent;
  export const Send: LucideComponent;
  export const Camera: LucideComponent;
  export const Save: LucideComponent;
  export const Printer: LucideComponent;
  export const LogOut: LucideComponent;
  export const LogIn: LucideComponent;
  export const Calendar: LucideComponent;
  export const CalendarDays: LucideComponent;
  export const CalendarCheck: LucideComponent;
  export const CalendarX: LucideComponent;
  export const CalendarPlus: LucideComponent;
  export const ChevronUp: LucideComponent;
  export const ChevronsUp: LucideComponent;
  export const ChevronsDown: LucideComponent;
  export const ChevronsLeft: LucideComponent;
  export const ChevronsRight: LucideComponent;
  export const Clapperboard: LucideComponent;
  export const File: LucideComponent;
  export const Files: LucideComponent;
  export const Package: LucideComponent;
  export const Box: LucideComponent;
  export const CircleCheck: LucideComponent;
  export const CircleX: LucideComponent;
  export const CirclePlus: LucideComponent;
  export const CircleMinus: LucideComponent;
  export const CircleHelp: LucideComponent;
  export const CircleAlert: LucideComponent;
  export const ArrowUpFromLine: LucideComponent;
  export const ArrowDownToLine: LucideComponent;
  export const Bug: LucideComponent;
  export const PenTool: LucideComponent;
  export const Target: LucideComponent;
  export const FileCheck: LucideComponent;
  export const Webhook: LucideComponent;
  export const Stamp: LucideComponent;
  export const ScanSearch: LucideComponent;
  export const Undo: LucideComponent;
  export const Heading1: LucideComponent;
  export const Heading2: LucideComponent;
  export const Heading3: LucideComponent;
  export const Minus: LucideComponent;
  export const ListChecks: LucideComponent;
  export const MessagesSquare: LucideComponent;
  export const Columns2: LucideComponent;
  export const LucideIcon: LucideComponent;
  export const CheckCircle2: LucideComponent;
  export const Redo: LucideComponent;
  export const Tags: LucideComponent;
  export const SquareFunction: LucideComponent;
  export const Coffee: LucideComponent;
  export const AlignJustify: LucideComponent;
  export const Battery: LucideComponent;
  export const BookmarkIcon: LucideComponent;
  export const LayoutDashboard: LucideComponent;
  export const Scissors: LucideComponent;
  export const HardDriveDownload: LucideComponent;
  export const AlertOctagon: LucideComponent;
  export const MicOff: LucideComponent;
  export const Music: LucideComponent;
  export const User: LucideComponent;
  export const Keyboard: LucideComponent;
  export const FileJson: LucideComponent;
  export const Columns: LucideComponent;
  export const TrendingUp: LucideComponent;
  export const Flame: LucideComponent;
  export const Stars: LucideComponent;
  export const GitCompare: LucideComponent;
  export const Shuffle: LucideComponent;
  export const ZapOff: LucideComponent;
  export const FileUp: LucideComponent;
  export const Lightbulb: LucideComponent;
  export const SkipForward: LucideComponent;
  export const DollarSign: LucideComponent;
  export const FolderSync: LucideComponent;
  export const ShieldOff: LucideComponent;
  export const QrCode: LucideComponent;
  export const PanelLeftClose: LucideComponent;
  export const Scan: LucideComponent;
  export const Mic2: LucideComponent;
  export const ToggleLeft: LucideComponent;
  export const ToggleRight: LucideComponent;
  export const FolderOpen: LucideComponent;
  export const Infinity: LucideComponent;
  export const XCircle: LucideComponent;
  export const LifeBuoy: LucideComponent;
}

declare module "rxdb/plugins/storage-dexie" {
  export function getRxStorageDexie(): any;
}

declare module "rxdb/plugins/storage-memory" {
  export function getRxStorageMemory(): any;
}

declare module "rxdb/plugins/encryption-crypto-js" {
  export function wrappedKeyEncryptionCryptoJsStorage(args: any): any;
}

declare module "crypto-js" {
  const CryptoJS: {
    AES: {
      decrypt(
        ciphertext: string,
        password: string,
      ): { toString(enc: unknown): string };
    };
    enc: { Utf8: unknown };
  };
  export default CryptoJS;
}

declare module "rxdb/plugins/validate-z-schema" {
  export function wrappedValidateZSchemaStorage(args: any): any;
}

declare module "rxdb/plugins/dev-mode" {
  export const RxDBDevModePlugin: any;
  export function disableWarnings(): void;
}

declare module "rxdb/plugins/query-builder" {
  export const RxDBQueryBuilderPlugin: any;
}

declare module "rxdb/plugins/migration-schema" {
  export const RxDBMigrationSchemaPlugin: any;
}

declare module "rxdb/plugins/cleanup" {
  export const RxDBCleanupPlugin: any;
}

declare module "rxdb/plugins/leader-election" {
  export const RxDBLeaderElectionPlugin: any;
}

declare module "rxdb/plugins/replication-webrtc" {
  export function replicateWebRTC(args: any): any;
  export function getConnectionHandlerSimplePeer(options?: any): any;
}

declare module "@huggingface/transformers" {
  export class Pipeline {
    static async fromPretrained(modelName: string, options?: any): Promise<any>;
  }
  export function pipeline(
    task: string,
    modelName?: string,
    options?: any,
  ): Promise<any>;
  export function cos_sim(a: number[], b: number[]): number;
  // env is a NAMED export of the real module (it has no default export).
  // Runtime code reads env.allowLocalModels/useBrowserCache/remoteHost/...
  export const env: {
    allowLocalModels?: boolean;
    useBrowserCache?: boolean;
    remoteHost?: string;
    remotePathTemplate?: string;
    backends?: Record<
      string,
      Record<string, { proxy?: boolean; [key: string]: unknown }>
    >;
    [key: string]: unknown;
  };
  export type FeatureExtractionPipeline = any;
  export type TextClassificationPipeline = any;
}

declare module "@mantine/core" {
  import { FC, ReactNode } from "react";
  export const MantineProvider: FC<{
    children: ReactNode;
    theme?: any;
    defaultColorScheme?: string;
  }>;
  export const Modal: FC<{
    children: ReactNode;
    opened: boolean;
    onClose: () => void;
    title?: string;
    size?: string;
    [key: string]: any;
  }>;
  export const Button: FC<{ children?: ReactNode; [key: string]: any }>;
  export const TextInput: FC<{ [key: string]: any }>;
  export const PasswordInput: FC<{ [key: string]: any }>;
  export const Select: FC<{ [key: string]: any }>;
  export const Tabs: FC<{ children?: ReactNode; [key: string]: any }> & {
    List: FC<any>;
    Tab: FC<any>;
    Panel: FC<any>;
  };
  export const Card: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Container: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Group: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Stack: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Title: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Text: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Badge: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Tooltip: FC<{ children?: ReactNode; [key: string]: any }>;
  export const ActionIcon: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Switch: FC<{ [key: string]: any }>;
  export const Slider: FC<{ [key: string]: any }>;
  export const RangeSlider: FC<{ [key: string]: any }>;
  export const ColorInput: FC<{ [key: string]: any }>;
  export const ColorPicker: FC<{ [key: string]: any }>;
  export const Notification: FC<{ [key: string]: any }>;
  export const Loader: FC<{ [key: string]: any }>;
  export const Progress: FC<{ [key: string]: any }>;
  export const Skeleton: FC<{ [key: string]: any }>;
  export const Alert: FC<{ children?: ReactNode; [key: string]: any }>;
  export const ThemeIcon: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Code: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Kbd: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Table: FC<{ children?: ReactNode; [key: string]: any }>;
  export const ScrollArea: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Divider: FC<{ [key: string]: any }>;
  export const Space: FC<{ [key: string]: any }>;
  export const Center: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Flex: FC<{ children?: ReactNode; [key: string]: any }>;
  export const SimpleGrid: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Grid: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Collapse: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Transition: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Overlay: FC<{ [key: string]: any }>;
  export const Affix: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Popover: FC<{ children?: ReactNode; [key: string]: any }>;
  export const HoverCard: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Menu: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Drawer: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Chip: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Chips: FC<{ children?: ReactNode; [key: string]: any }>;
  export const MultiSelect: FC<{ [key: string]: any }>;
  export const TagsInput: FC<{ [key: string]: any }>;
  export const Autocomplete: FC<{ [key: string]: any }>;
  export const FileInput: FC<{ [key: string]: any }>;
  export const NativeSelect: FC<{ [key: string]: any }>;
  export const NumberInput: FC<{ [key: string]: any }>;
  export const Textarea: FC<{ [key: string]: any }>;
  export const JsonInput: FC<{ [key: string]: any }>;
  export const Checkbox: FC<{ [key: string]: any }>;
  export const Radio: FC<{ [key: string]: any }>;
  export const Rating: FC<{ [key: string]: any }>;
  export const SegmentedControl: FC<{ [key: string]: any }>;
  export const Stepper: FC<{ children?: ReactNode; [key: string]: any }>;
  export const Pagination: FC<{ [key: string]: any }>;
  export const CloseButton: FC<{ [key: string]: any }>;
  export const CopyButton: FC<{
    children: (props: any) => ReactNode;
    [key: string]: any;
  }>;
  export const ThemeProvider: FC<{ children: ReactNode; theme?: any }>;
  export function createTheme(theme: any): any;
  export function useMantineTheme(): any;
  export function useMantineColorScheme(): {
    colorScheme: string;
    setColorScheme: (scheme: string) => void;
  };
  export const DEFAULT_THEME: any;
  export const createStyles: any;
  export type MantineTheme = any;
  export type MantineColor = string;
  export type MantineSize = string;
}
