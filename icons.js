const paths = {
  home: `<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 20v-6h6v6"/>`,
  customers: `<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.6-4 2.5-6 5.5-6s4.9 2 5.5 6"/><circle cx="17.5" cy="9" r="2.2"/><path d="M15.5 14.5c3.2-.3 5 1.5 5.4 4.5"/>`,
  jobs: `<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2"/><path d="M3 11h18"/><path d="M10 11v2h4v-2"/>`,
  devices: `<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="14" r=".7"/><path d="M7 7h10"/>`,
  tasks: `<path d="m4 6 2 2 4-4"/><path d="M12 6h8"/><path d="m4 13 2 2 4-4"/><path d="M12 13h8"/><path d="m4 20 2 2 4-4"/><path d="M12 20h8"/>`,
  finance: `<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="15" r="1.5"/><path d="M7 3h10"/>`,
  staff: `<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-4.2 2.5-6 5.5-6s5 1.8 5.5 6"/><path d="M14 15c3.7-.6 6.5 1.2 7 5"/>`,
  audit: `<path d="M12 4a8 8 0 1 0 7.4 5"/><path d="M12 8v5l3 2"/><path d="M16 3h5v5"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>`,
  camera: `<path d="M4 8h4l1.5-2h5L16 8h4v11H4Z"/><circle cx="12" cy="13.5" r="3.5"/>`,
  file: `<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>`,
  receipt: `<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21Z"/><path d="M9 8h6M9 12h6M9 16h4"/>`,
  signature: `<path d="M3 18c3-5 4-9 6-9 1.8 0 0 5 2 5 1.5 0 2.2-4 3.5-4 1 0 .4 4 2 4 1.4 0 2.5-1.2 4.5-3"/><path d="M3 21h18"/>`,
  chevron: `<path d="m9 5 7 7-7 7"/>`,
  back: `<path d="m15 5-7 7 7 7"/>`,
  check: `<path d="m5 12 4 4 10-10"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>`,
  alert: `<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5M12 17h.01"/>`,
  upload: `<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v5h16v-5"/>`,
  logout: `<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/>`,
  edit: `<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 7 3.5 3.5"/>`,
  trash: `<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/>`,
  dots: `<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-5 3.3-7 8-7s7.3 2 8 7"/>`,
  shield: `<path d="M12 3 4.5 6v5c0 5 3 8.5 7.5 10 4.5-1.5 7.5-5 7.5-10V6Z"/><path d="m8.5 12 2.3 2.3 4.7-5"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7L13 18"/>`,
  download: `<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  close: `<path d="m6 6 12 12M18 6 6 18"/>`
};

export function icon(name, size = 20, className = "") {
  const body = paths[name] || paths.file;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
