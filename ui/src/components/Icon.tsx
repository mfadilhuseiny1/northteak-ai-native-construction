const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  parse: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6M9 9h2",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  download: "M12 4v12m0 0-4-4m4 4 4-4M4 20h16",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "m5 12 5 5L20 7",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  play: "M7 4v16l13-8z",
  pause: "M8 5v14M16 5v14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  layers: "m12 3 9 5-9 5-9-5zM3 13l9 5 9-5",
  pipeline: "M3 5h6v5H3zM15 14h6v5h-6zM9 7.5h2.5a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2",
  table: "M3 5h18v14H3zM3 10h18M3 15h18M9 10v9",
  transform: "M4 6h16M7 12h10M10 18h4",
  join: "M9 7a5 5 0 1 0 0 10A5 5 0 1 0 9 7M15 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10",
  union: "M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h5.5V13M7.5 11v5.5H13",
  output: "M4 12h11m0 0-4-4m4 4-4 4M20 5v14",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-2 2-2H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8M7.5 11h.01M10 7h.01M15 7.5h.01",
  save: "M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3",
  keyboard: "M3 6h18v12H3zM7 14h10M7 10h.01M11 10h.01M15 10h.01",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  project: "M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M4 13h16",
  folderPlus:"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.6-1.7",
  restore: "M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6",
  move: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6m0 0-2.5-2.5M16 13l-2.5 2.5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  folderUp: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 16v-6m0 0-2.5 2.5M12 10l2.5 2.5",
  stop: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.5 9.5h5v5h-5z",
  // stars joined by lines: the Object Explorer graph tab (Rasi)
  constellation:
    "M3.4 18a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M7.4 9a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M13.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M17.4 5a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M15.4 19a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M5.65 16.54l2.7-6.08M10.43 9.72l3.14 1.56M15.79 10.61l2.42-4.22M15.44 13.54l1.12 3.92",
  graph:
    "M5 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 5a2 2 0 1 0 4 0 2 2 0 1 0-4 0M13 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M9 6.6l6-1.2M8.2 8.6l5.6 7.8M16.8 7l-1.4 9",
  extract: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M14 3v5h5v3M14 16.5l5-2.5M14 16.5l3.5 3.5M14 16.5h.01M19 14h.01M17.5 20h.01",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  database: "M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3",
  thermometer: "M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0zM12 9v7",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  signal: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
  cpu: "M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  bug: "M8 9h8v6a4 4 0 0 1-8 0zM9 9V7a3 3 0 0 1 6 0v2M4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2",
  split: "M4 12h6M10 12l6-6h4M10 12l6 6h4",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  wave: "M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  gauge: "M4 18a8 8 0 1 1 16 0M12 18l4-6",
  comment: "M4 5h16v11H9l-5 4z",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  device: "M7 3h10v18H7zM11 18h2",
  // Ontology Manager: object types
  cube: "M12 2.5 20.5 7v10L12 21.5 3.5 17V7zM3.5 7 12 11.5 20.5 7M12 11.5v10",
  // AIP Logic
  logic: "M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v3.5a2 2 0 0 0 2 2H14M17 4v8M14 7l3-3 3 3",
  // theme toggle
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5",
} as const;

export type IconName = keyof typeof PATHS;
/** for drawing an icon inside an SVG (the flow canvas) */
export const iconPath = (name: IconName) => PATHS[name];

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
