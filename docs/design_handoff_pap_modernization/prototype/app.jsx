// app.jsx — Plug A Pro PWA prototype router + screen picker
// Owns: theme, screen state, bottom nav, transitions.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "vibrant",
  "dark": false,
  "density": "cozy",
  "radius": 16,
  "showWhatsApp": true,
  "showPicker": true
}/*EDITMODE-END*/;

// Screen list for the picker (mirrors router)
const SCREEN_GROUPS = [
  {
    label: 'Customer',
    items: [
      { id: 'home',         label: 'Home',           needsTabs: true,  default: true },
      { id: 'home-firstrun',label: 'Home · first run',needsTabs: true },
      { id: 'area-picker',  label: 'Area picker' },
      { id: 'browse',       label: 'Find provider',  needsTabs: true },
      { id: 'browse-empty', label: 'Browse · empty area', needsTabs: true },
      { id: 'provider',     label: 'Provider profile' },
      { id: 'book-quick',   label: 'Book · from provider' },
      { id: 'book',         label: 'Book · urgent (blind)' },
      { id: 'book-submitted', label: 'Request sent' },
      { id: 'bookings',     label: 'My bookings',    needsTabs: true },
      { id: 'account',      label: 'Account',        needsTabs: true },
      { id: 'notifications',label: 'Notifications' },
    ],
  },
  {
    label: 'Auth',
    items: [
      { id: 'signin',          label: 'Sign in' },
      { id: 'otp',             label: 'Verify OTP' },
      { id: 'signup',          label: 'Sign up' },
      { id: 'link-expired',    label: 'Link expired' },
      { id: 'provider-signin', label: 'Provider sign in' },
      { id: 'admin-signin',    label: 'Admin sign in' },
    ],
  },
  {
    label: 'Internal',
    items: [
      { id: 'provider-home', label: 'Provider dashboard' },
      { id: 'admin-home',    label: 'Admin ops' },
      { id: 'status',        label: 'Service status' },
      { id: 'credit-terms',  label: 'Credit terms' },
    ],
  },
];

const SCREENS_WITH_TABS = new Set(['home', 'home-firstrun', 'browse', 'browse-empty', 'bookings', 'account']);

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const T = React.useMemo(() => buildTheme(t), [t]);

  // Screen state — keep history for back nav
  const [screen, setScreen] = React.useState('home');
  const [payload, setPayload] = React.useState({});
  const [state, setState] = React.useState({
    signedIn: false,
    area: "Sandton, Sandhurst",   // default area
  });
  const [transition, setTransition] = React.useState(null);

  const setArea = React.useCallback((area) => setState((s) => ({ ...s, area })), []);

  const go = React.useCallback((id, p = {}) => {
    if (id === screen) return;
    // Merge sign-in/role-changing flags into persistent state
    setState((s) => {
      const merged = { ...s };
      if (p.signedIn != null) merged.signedIn = p.signedIn;
      if (p.role) merged.role = p.role;
      return merged;
    });
    // Apply payload (non-state stuff)
    const rest = { ...p };
    delete rest.signedIn;
    delete rest.role;
    setPayload(rest);
    setTransition(id);
    setScreen(id);
    // clear transition class after animation
    setTimeout(() => setTransition(null), 280);
  }, [screen]);

  const signOut = () => {
    setState({ signedIn: false });
    go('signin');
  };

  // Tabs nav — only shows on tab screens
  const showTabs = SCREENS_WITH_TABS.has(screen);
  const navItems = [
    { id: 'home',     label: 'Home',     icon: <IcHome size={20} /> },
    { id: 'browse',   label: 'Browse',   icon: <IcSearch size={20} /> },
    { id: 'bookings', label: 'Bookings', icon: <IcCal size={20} /> },
    { id: 'account',  label: 'Account',  icon: <IcUser size={20} /> },
  ];

  // Render selected screen
  const renderScreen = () => {
    const merged = { ...state, ...payload };
    switch (screen) {
      case 'home':           return <ScreenHome T={T} go={go} state={merged} setArea={setArea} />;
      case 'home-firstrun':  return <ScreenHome T={T} go={go} state={{ ...merged, area: null }} setArea={setArea} />;
      case 'area-picker':    return <ScreenAreaPicker T={T} go={go} state={merged} setArea={setArea} />;
      case 'browse':         return <ScreenBrowse T={T} go={go} state={merged} setArea={setArea} />;
      case 'browse-empty':   return <ScreenBrowse T={T} go={go} state={{ ...merged, forceEmpty: true }} setArea={setArea} />;
      case 'provider':       return <ScreenProvider T={T} go={go} state={merged} />;
      case 'book':           return <ScreenBook T={T} go={go} state={merged} />;
      case 'book-quick':     return <ScreenBookQuick T={T} go={go} state={merged} />;
      case 'book-submitted': return <ScreenBookSubmitted T={T} go={go} state={merged} />;
      case 'bookings':       return <ScreenBookings T={T} go={go} state={merged} />;
      case 'account':        return <ScreenAccount T={T} go={go} state={merged} signOut={signOut} />;
      case 'notifications':  return <ScreenNotifications T={T} go={go} />;
      case 'signin':         return <ScreenSignIn T={T} go={go} />;
      case 'otp':            return <ScreenOTP T={T} go={go} payload={payload} />;
      case 'signup':         return <ScreenSignUp T={T} go={go} />;
      case 'link-expired':   return <ScreenLinkExpired T={T} go={go} />;
      case 'provider-signin':return <ScreenProviderSignIn T={T} go={go} />;
      case 'admin-signin':   return <ScreenAdminSignIn T={T} go={go} />;
      case 'provider-home':  return <ScreenProviderHome T={T} go={go} signOut={signOut} />;
      case 'admin-home':     return <ScreenAdminHome T={T} go={go} signOut={signOut} />;
      case 'status':         return <ScreenStatus T={T} go={go} />;
      case 'credit-terms':   return <ScreenCreditTerms T={T} go={go} />;
      default:               return <ScreenHome T={T} go={go} state={merged} />;
    }
  };

  return (
    <>
      {/* Global CSS for body */}
      <style>{`
        :root { color-scheme: ${T.dark ? 'dark' : 'light'}; }
        body { background: ${T.dark ? '#1a1a20' : '#E9E9EE'}; transition: background .25s; }
        @keyframes pap-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .pap-screen { animation: pap-fade-in .25s ease-out; }
        ::selection { background: ${T.pal.purple}33; }
      `}</style>

      {/* The phone */}
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px 12px', boxSizing: 'border-box', position: 'relative',
      }}>
        {t.showPicker && (
          <ScreenPicker T={T} current={screen} onPick={go} />
        )}

        <IOSDevice dark={T.dark}>
          <div key={screen + '-' + transition} className="pap-screen"
               style={{ position: 'absolute', inset: 0, background: T.page }}>
            {renderScreen()}
          </div>
          {showTabs && (
            <BottomNav T={T} current={screen} onChange={(id) => go(id)} items={navItems} />
          )}
        </IOSDevice>
      </div>

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        <TweakColor label="Palette" value={t.palette}
                    options={[
                      ['#FF1F8E', '#8B3FE8', '#2A78F0'],
                      ['#C84DBE', '#7B5BE0', '#3F86E8'],
                      ['#FF8A3D', '#FF3D7F', '#B14CE0'],
                      ['#3D3D45', '#1F1F26', '#0A0A0F'],
                    ]}
                    onChange={(v) => {
                      // Map color arrays back to palette keys
                      const map = JSON.stringify(v).toLowerCase();
                      if (map.includes('1f8e')) setTweak('palette', 'vibrant');
                      else if (map.includes('4dbe')) setTweak('palette', 'calm');
                      else if (map.includes('8a3d')) setTweak('palette', 'sunset');
                      else setTweak('palette', 'mono');
                    }} />

        <TweakSection label="Spacing" />
        <TweakRadio label="Density" value={t.density} options={['compact', 'cozy', 'comfy']}
                    onChange={(v) => setTweak('density', v)} />
        <TweakSlider label="Corner radius" value={t.radius} min={6} max={24} unit="px"
                     onChange={(v) => setTweak('radius', v)} />

        <TweakSection label="Brand & Channels" />
        <TweakToggle label="WhatsApp branding" value={t.showWhatsApp}
                     onChange={(v) => setTweak('showWhatsApp', v)} />

        <TweakSection label="Prototype" />
        <TweakToggle label="Screen picker" value={t.showPicker}
                     onChange={(v) => setTweak('showPicker', v)} />
      </TweaksPanel>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Screen picker (sidebar) — left of the device, lets viewer jump screens
// ─────────────────────────────────────────────────────────────────────────
function ScreenPicker({ T, current, onPick }) {
  const [open, setOpen] = React.useState(true);

  // Find current label
  const currentLabel = (() => {
    for (const g of SCREEN_GROUPS) for (const it of g.items) if (it.id === current) return it.label;
    return current;
  })();

  return (
    <div style={{
      position: 'fixed', top: 16, left: 16, zIndex: 50,
      display: 'flex', flexDirection: 'column', gap: 6,
      width: open ? 200 : 'auto',
      maxHeight: 'calc(100vh - 32px)',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 12, border: 'none',
        background: T.dark ? 'rgba(20,20,28,0.85)' : 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset, 0 10px 30px rgba(15,15,30,0.08)',
        color: T.ink, fontFamily: 'ui-sans-serif, system-ui', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', minWidth: 0,
      }}>
        <IcGrid size={14} color={T.pal.purple} />
        <span style={{
          flex: 1, minWidth: 0, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left',
        }}>{open ? 'Screens' : currentLabel}</span>
        <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: T.inkMute }}>
          <IcChevD size={12} />
        </span>
      </button>
      {open && (
        <div style={{
          background: T.dark ? 'rgba(20,20,28,0.85)' : 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRadius: 12, padding: 6,
          boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset, 0 10px 30px rgba(15,15,30,0.08)',
          overflowY: 'auto', minHeight: 0,
        }}>
          {SCREEN_GROUPS.map((g) => (
            <div key={g.label} style={{ marginBottom: 4 }}>
              <div style={{
                padding: '8px 10px 4px',
                fontFamily: 'ui-sans-serif, system-ui', fontSize: 10,
                fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
                color: T.inkMute,
              }}>{g.label}</div>
              {g.items.map((it) => {
                const active = it.id === current;
                return (
                  <button key={it.id} onClick={() => onPick(it.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', textAlign: 'left',
                    padding: '6px 10px', border: 'none',
                    borderRadius: 8, cursor: 'pointer',
                    background: active ? T.gradSoft : 'transparent',
                    color: active ? T.pal.purple : T.ink,
                    fontFamily: 'ui-sans-serif, system-ui', fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                  }}>
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: active ? T.pal.purple : 'transparent',
                    }} />
                    {it.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
