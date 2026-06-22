// icons.jsx — Line icons, 20×20, 1.6 stroke
// All icons accept { size, color, stroke } and inherit currentColor

const Icon = ({ size = 20, color = 'currentColor', stroke = 1.6, children, fill = false }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
       stroke={fill ? 'none' : color} strokeWidth={stroke}
       strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

const IcHome    = (p) => <Icon {...p}><path d="M3.5 9.5L10 4l6.5 5.5V16a1 1 0 01-1 1H12v-4H8v4H4.5a1 1 0 01-1-1V9.5z"/></Icon>;
const IcSearch  = (p) => <Icon {...p}><circle cx="9" cy="9" r="5.5"/><path d="M17 17l-3.6-3.6"/></Icon>;
const IcCal     = (p) => <Icon {...p}><rect x="3" y="4.5" width="14" height="13" rx="2"/><path d="M7 3v3M13 3v3M3 9h14"/></Icon>;
const IcUser    = (p) => <Icon {...p}><circle cx="10" cy="7" r="3.2"/><path d="M3.5 17c1-3 3.4-4.5 6.5-4.5s5.5 1.5 6.5 4.5"/></Icon>;
const IcArrow   = (p) => <Icon {...p}><path d="M4 10h12M11 5l5 5-5 5"/></Icon>;
const IcArrowL  = (p) => <Icon {...p}><path d="M16 10H4M9 15l-5-5 5-5"/></Icon>;
const IcCheck   = (p) => <Icon {...p}><path d="M4 10.5l4 4 8-9"/></Icon>;
const IcX       = (p) => <Icon {...p}><path d="M5 5l10 10M15 5L5 15"/></Icon>;
const IcPin     = (p) => <Icon {...p}><path d="M10 17.5s-5.5-5-5.5-9.5a5.5 5.5 0 0111 0c0 4.5-5.5 9.5-5.5 9.5z"/><circle cx="10" cy="8" r="2"/></Icon>;
const IcPhone   = (p) => <Icon {...p}><path d="M5 3h3l2 4-2 1a8 8 0 004 4l1-2 4 2v3a2 2 0 01-2 2A13 13 0 013 5a2 2 0 012-2z"/></Icon>;
const IcLock    = (p) => <Icon {...p}><rect x="4" y="9" width="12" height="9" rx="2"/><path d="M7 9V6.5a3 3 0 016 0V9"/></Icon>;
const IcMail    = (p) => <Icon {...p}><rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3.5 6.5l6.5 5 6.5-5"/></Icon>;
const IcShield  = (p) => <Icon {...p}><path d="M10 2.5l6 2v5c0 4-2.7 7-6 8-3.3-1-6-4-6-8v-5l6-2z"/></Icon>;
const IcStar    = (p) => <Icon {...p} fill><path d="M10 2.5l2.4 5 5.4.8-3.9 3.7.9 5.3L10 14.8 5.2 17.3l.9-5.3L2.2 8.3l5.4-.8z" fill="currentColor"/></Icon>;
const IcChev    = (p) => <Icon {...p}><path d="M7 5l5 5-5 5"/></Icon>;
const IcChevD   = (p) => <Icon {...p}><path d="M5 8l5 5 5-5"/></Icon>;
const IcPlus    = (p) => <Icon {...p}><path d="M10 4v12M4 10h12"/></Icon>;
const IcMenu    = (p) => <Icon {...p}><path d="M3 5h14M3 10h14M3 15h14"/></Icon>;
const IcBell    = (p) => <Icon {...p}><path d="M5 14h10l-1-2v-3a4 4 0 00-8 0v3l-1 2zM8 16a2 2 0 004 0"/></Icon>;
const IcSpark   = (p) => <Icon {...p}><path d="M10 3v4M10 13v4M3 10h4M13 10h4M5 5l2.5 2.5M12.5 12.5L15 15M5 15l2.5-2.5M12.5 7.5L15 5"/></Icon>;
const IcInfo    = (p) => <Icon {...p}><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.5v.5"/></Icon>;
const IcAlert   = (p) => <Icon {...p}><circle cx="10" cy="10" r="7.5"/><path d="M10 6v5M10 13.5v.5"/></Icon>;
const IcLogout  = (p) => <Icon {...p}><path d="M11 3H5a1 1 0 00-1 1v12a1 1 0 001 1h6M14 7l3 3-3 3M17 10H8"/></Icon>;
const IcSettings= (p) => <Icon {...p}><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></Icon>;
const IcCard    = (p) => <Icon {...p}><rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M2.5 8.5h15"/></Icon>;
const IcTime    = (p) => <Icon {...p}><circle cx="10" cy="10" r="7.5"/><path d="M10 6v4l3 2"/></Icon>;
const IcZap     = (p) => <Icon {...p}><path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z"/></Icon>;
const IcWrench  = (p) => <Icon {...p}><path d="M13 3a4 4 0 014.5 5L13 12.5l-5 5a2 2 0 01-3-3l5-5L14.5 5A4 4 0 0113 3z"/></Icon>;
const IcBolt    = (p) => <Icon {...p}><path d="M10.5 2l-6 9h4l-1 7 6-9h-4l1-7z"/></Icon>;
const IcDroplet = (p) => <Icon {...p}><path d="M10 2.5s5 5 5 9a5 5 0 11-10 0c0-4 5-9 5-9z"/></Icon>;
const IcSaw     = (p) => <Icon {...p}><path d="M3 6h10l4 4-2 5H7l-4-4V6z"/><path d="M5 8l2 2M8 8l2 2M11 8l2 2"/></Icon>;
const IcBrush   = (p) => <Icon {...p}><path d="M15 3l2 2-7 7-3-3 7-7z"/><path d="M7 9l3 3-4 4a2 2 0 11-3-3l4-4z"/></Icon>;
const IcSpray   = (p) => <Icon {...p}><rect x="6" y="8" width="8" height="9" rx="1.5"/><path d="M8 8V5h4v3M14 3l3 1M14 5l3 0M14 7l3-1"/></Icon>;
const IcOven    = (p) => <Icon {...p}><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7.5h14M6 5.5h.01M9 5.5h.01M12 5.5h.01"/></Icon>;
const IcFlame   = (p) => <Icon {...p}><path d="M10 2.5s4 3 4 7a4 4 0 11-8 0c0-2 1-3 2-4 0 2 1 2 2 2-1-3 0-5 0-5z"/></Icon>;
const IcWhats   = (p) => (
  <Icon {...p}><path d="M3 17l1.4-3.7A6.7 6.7 0 113 17z" /><path d="M7.5 7.5c0 .5.5 2 1.5 3s2.5 1.5 3 1.5l1-1 2 1-.5 1.5c-.5.5-1.5.5-2 .5-2 0-4-1-5.5-2.5S5 8.5 5 6.5c0-.5 0-1.5.5-2L7 4l1 2-.5 1z" strokeWidth="0" fill="currentColor"/></Icon>
);
const IcMap     = (p) => <Icon {...p}><path d="M3 5l4-1.5L13 5l4-1.5V15l-4 1.5L7 15 3 16.5V5z"/><path d="M7 3.5v11.5M13 5v11.5"/></Icon>;
const IcEye     = (p) => <Icon {...p}><path d="M1.5 10S4 4.5 10 4.5 18.5 10 18.5 10 16 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/></Icon>;
const IcEyeOff  = (p) => <Icon {...p}><path d="M3 3l14 14M9 5a8 8 0 019.5 5 9 9 0 01-1.7 2.4M6 6.5A9 9 0 001.5 10S4 15.5 10 15.5a8 8 0 003.5-.8M8.5 8.5a2 2 0 002.8 2.8"/></Icon>;
const IcMore    = (p) => <Icon {...p}><circle cx="5" cy="10" r="1.2" fill="currentColor" strokeWidth="0"/><circle cx="10" cy="10" r="1.2" fill="currentColor" strokeWidth="0"/><circle cx="15" cy="10" r="1.2" fill="currentColor" strokeWidth="0"/></Icon>;
const IcGrid    = (p) => <Icon {...p}><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/></Icon>;
const IcRefresh = (p) => <Icon {...p}><path d="M16 4v4h-4M4 16v-4h4"/><path d="M16 8a6 6 0 00-11-2M4 12a6 6 0 0011 2"/></Icon>;

Object.assign(window, {
  IcHome, IcSearch, IcCal, IcUser, IcArrow, IcArrowL, IcCheck, IcX, IcPin, IcPhone,
  IcLock, IcMail, IcShield, IcStar, IcChev, IcChevD, IcPlus, IcMenu, IcBell, IcSpark,
  IcInfo, IcAlert, IcLogout, IcSettings, IcCard, IcTime, IcZap, IcWrench, IcBolt,
  IcDroplet, IcSaw, IcBrush, IcSpray, IcOven, IcFlame, IcWhats, IcMap, IcEye, IcEyeOff,
  IcMore, IcGrid, IcRefresh,
});
