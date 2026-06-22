// ui.jsx — Shared UI primitives styled by theme (T)
// Components: Logo, Wordmark, Button, Input, PhoneInput, Card, Chip, Stat,
// SectionLabel, FieldLabel, Stepper, Toast, BottomNav, AppHeader, OTPInput,
// ScreenScroll

// ── Brand logo (used as an <img> for fidelity; falls back to a gradient pin)
function Logo({ size = 36, alt = 'Plug A Pro' }) {
  return (
    <img src="assets/logo.png" alt={alt}
    style={{ width: size, height: size, objectFit: 'contain', display: 'block' }} />);

}

// Wordmark beside logo (compact header)
function Wordmark({ T, size = 14 }) {
  return (
    <span style={{
      fontFamily: T.fam, fontWeight: 800, fontSize: size,
      letterSpacing: 0.4, color: T.ink,
      whiteSpace: 'nowrap',
    }}>Plug A Pro</span>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
function Button({
  T, children, onClick, variant = 'primary', size = 'md',
  leftIcon, rightIcon, disabled, fullWidth = true, style = {}
}) {
  const heights = { sm: 40, md: 48, lg: 54 };
  const fontSizes = { sm: 14, md: 15, lg: 16 };
  const h = heights[size];
  const base = {
    height: h, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '0 18px', border: 'none', cursor: 'pointer',
    borderRadius: T.r.md, fontFamily: T.fam, fontWeight: 600, fontSize: fontSizes[size],
    letterSpacing: -0.1, width: fullWidth ? '100%' : 'auto',
    transition: 'transform .12s, box-shadow .15s, background .15s',
    opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? 'none' : 'auto',
    boxSizing: 'border-box'
  };
  const variants = {
    primary: {
      background: T.grad, color: '#fff',
      boxShadow: `0 1px 0 rgba(255,255,255,0.25) inset, 0 8px 24px ${T.pal.purple}33, 0 2px 6px ${T.pal.purple}22`
    },
    secondary: {
      background: T.card, color: T.ink,
      boxShadow: `inset 0 0 0 1px ${T.border}, 0 1px 2px rgba(0,0,0,0.04)`
    },
    ghost: {
      background: 'transparent', color: T.ink
    },
    dark: {
      background: T.ink, color: T.card
    },
    whatsapp: {
      background: T.whatsapp, color: '#fff',
      boxShadow: `0 1px 0 rgba(255,255,255,0.25) inset, 0 6px 18px ${T.whatsapp}55`
    },
    danger: { background: T.danger, color: '#fff' },
    tinted: {
      background: T.dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,15,20,0.04)',
      color: T.ink
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
    style={{ ...base, ...variants[variant], ...style }}>
      {leftIcon}
      <span>{children}</span>
      {rightIcon}
    </button>);

}

// ── Input + Field ───────────────────────────────────────────────────────────
function FieldLabel({ T, children, hint }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginBottom: 6, fontFamily: T.fam
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, letterSpacing: -0.1 }}>{children}</span>
      {hint && <span style={{ fontSize: 12, color: T.inkMute }}>{hint}</span>}
    </div>);

}

function Input({
  T, value, onChange, placeholder, type = 'text', leftIcon, rightIcon,
  autoFocus, inputMode, maxLength, style = {}
}) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 52,
      background: T.card, borderRadius: T.r.md,
      boxShadow: `inset 0 0 0 1px ${focus ? T.pal.purple : T.border}`,
      padding: '0 14px', gap: 10,
      transition: 'box-shadow .15s',
      ...style
    }}>
      {leftIcon && <span style={{ color: focus ? T.pal.purple : T.inkMute, display: 'flex' }}>{leftIcon}</span>}
      <input
        type={type} value={value || ''} onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus} inputMode={inputMode} maxLength={maxLength}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none',
          background: 'transparent', color: T.ink, fontFamily: T.fam,
          fontSize: 15, fontWeight: 500, letterSpacing: -0.1
        }} />
      {rightIcon}
    </div>);

}

// ── PhoneInput with country code segment ────────────────────────────────────
function PhoneInput({ T, value, onChange, autoFocus }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', height: 52,
      borderRadius: T.r.md, overflow: 'hidden',
      boxShadow: `inset 0 0 0 1px ${focus ? T.pal.purple : T.border}`,
      background: T.card, transition: 'box-shadow .15s'
    }}>
      <button type="button" style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px',
        border: 'none', background: T.dark ? 'rgba(255,255,255,0.04)' : '#F4F4F7',
        color: T.ink, fontFamily: T.fam, fontWeight: 600, fontSize: 14,
        cursor: 'pointer', boxShadow: `inset -1px 0 0 ${T.border}`
      }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>🇿🇦</span>
        <span>+27</span>
        <IcChevD size={14} color={T.inkMute} />
      </button>
      <input
        type="tel" value={value || ''} onChange={(e) => onChange(e.target.value.replace(/[^\d\s]/g, ''))}
        placeholder="82 123 4567" autoFocus={autoFocus} inputMode="tel" maxLength={13}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none',
          background: 'transparent', color: T.ink, padding: '0 14px',
          fontFamily: T.fam, fontSize: 15, fontWeight: 500, letterSpacing: 0.2
        }} />
    </div>);

}

// ── Card ────────────────────────────────────────────────────────────────────
function Card({ T, children, style = {}, padded = true, raised = false }) {
  return (
    <div style={{
      background: T.card, borderRadius: T.r.lg,
      boxShadow: raised ?
      `0 1px 0 ${T.border}, 0 10px 30px rgba(15,15,30,0.06)` :
      `inset 0 0 0 1px ${T.border}`,
      padding: padded ? T.d.cardPad : 0,
      ...style
    }}>{children}</div>);

}

// ── Chip ────────────────────────────────────────────────────────────────────
function Chip({ T, children, active, onClick, icon, tone = 'neutral' }) {
  const tones = {
    neutral: {
      bg: active ? T.ink : T.dark ? 'rgba(255,255,255,0.05)' : '#F1F1F4',
      fg: active ? T.card : T.ink
    },
    success: {
      bg: T.dark ? 'rgba(15,157,88,0.18)' : 'rgba(15,157,88,0.10)',
      fg: T.dark ? '#5BD49B' : '#0F7A45'
    },
    warn: {
      bg: T.dark ? 'rgba(230,153,0,0.18)' : 'rgba(230,153,0,0.10)',
      fg: T.dark ? '#FFC25A' : '#A66400'
    },
    danger: {
      bg: T.dark ? 'rgba(229,72,77,0.18)' : 'rgba(229,72,77,0.10)',
      fg: T.dark ? '#FF8B8E' : '#B43439'
    },
    brand: {
      bg: T.gradSoft,
      fg: T.pal.purple
    },
    whatsapp: {
      bg: 'rgba(37,211,102,0.12)', fg: T.whatsappDark
    }
  };
  const t = tones[tone];
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 32, padding: '0 12px', borderRadius: T.r.pill,
      border: 'none', background: t.bg, color: t.fg,
      fontFamily: T.fam, fontSize: 13, fontWeight: 600,
      cursor: onClick ? 'pointer' : 'default', letterSpacing: -0.1,
      transition: 'background .12s, color .12s'
    }}>
      {icon}{children}
    </button>);

}

// ── Section label (small caps eyebrow) ──────────────────────────────────────
function SectionLabel({ T, children, action }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginBottom: 10, padding: '0 4px'
    }}>
      <span style={{
        fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
        textTransform: 'uppercase', color: T.inkMute
      }}>{children}</span>
      {action}
    </div>);

}

// ── Step indicator ──────────────────────────────────────────────────────────
function Stepper({ T, total, current }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 999,
            background: done ? T.pal.purple : active ? T.pal.purple : T.border,
            opacity: done ? 1 : active ? 0.55 : 1,
            transition: 'all .25s'
          }} />);

      })}
    </div>);

}

// ── OTP input ───────────────────────────────────────────────────────────────
function OTPInput({ T, value, onChange, length = 6, autoFocus }) {
  const inputs = React.useRef([]);
  const handle = (i, v) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const arr = (value || '').split('');
    arr[i] = digit;
    const next = arr.join('').slice(0, length);
    onChange(next);
    if (digit && i < length - 1) inputs.current[i + 1]?.focus();
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) inputs.current[i - 1]?.focus();
  };
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
      {Array.from({ length }).map((_, i) => {
        const v = (value || '')[i] || '';
        const filled = !!v;
        return (
          <input
            key={i}
            ref={(el) => inputs.current[i] = el}
            value={v}
            onChange={(e) => handle(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            autoFocus={autoFocus && i === 0}
            inputMode="numeric"
            maxLength={1}
            style={{
              flex: 1, height: 56, minWidth: 0,
              textAlign: 'center', fontFamily: T.mono, fontSize: 24, fontWeight: 600,
              color: T.ink, background: T.card,
              border: 'none', outline: 'none',
              borderRadius: T.r.md,
              boxShadow: filled ?
              `inset 0 0 0 1.5px ${T.pal.purple}` :
              `inset 0 0 0 1px ${T.border}`,
              transition: 'box-shadow .15s'
            }} />);


      })}
    </div>);

}

// ── Bottom nav ──────────────────────────────────────────────────────────────
function BottomNav({ T, current, onChange, items }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: '8px 12px 28px',
      background: T.dark ? 'rgba(11,11,16,0.85)' : 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      boxShadow: `inset 0 1px 0 ${T.border}`,
      display: 'flex', justifyContent: 'space-around',
      zIndex: 10
    }}>
      {items.map((it) => {
        const active = it.id === current;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, padding: '6px 4px',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: active ? T.pal.purple : T.inkMute,
            fontFamily: T.fam, fontSize: 11, fontWeight: 600, letterSpacing: -0.1,
            position: 'relative'
          }}>
            <div style={{
              width: 44, height: 28, borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? T.gradSoft : 'transparent',
              transition: 'background .15s'
            }}>
              {React.cloneElement(it.icon, { color: active ? T.pal.purple : T.inkMute })}
            </div>
            <span>{it.label}</span>
          </button>);

      })}
    </div>);

}

// ── App header (used inside screens, scrolls) ───────────────────────────────
function AppHeader({ T, left, right, title, subtitle, transparent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 18px 12px',
      background: transparent ? 'transparent' : T.page
    }}>
      {left}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{
          fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.2
        }}>{title}</div>}
        {subtitle && <div style={{
          fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1
        }}>{subtitle}</div>}
      </div>
      {right}
    </div>);

}

// ── Scroll wrapper (provides bottom padding for nav) ───────────────────────
function ScreenScroll({ T, children, padBottom = 110, padTop = 0, style = {} }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden',
      paddingTop: padTop, paddingBottom: padBottom,
      WebkitOverflowScrolling: 'touch',
      ...style
    }}>{children}</div>);

}

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ T, msg, onClose }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'absolute', left: 16, right: 16, top: 60, zIndex: 100,
      background: T.ink, color: T.card, borderRadius: T.r.md,
      padding: '12px 14px', fontFamily: T.fam, fontSize: 13, fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
    }}>
      <IcCheck size={16} />
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: T.card, cursor: 'pointer', opacity: 0.6 }}>
        <IcX size={14} />
      </button>
    </div>);

}

// ── Avatar (gradient circle initials or photo) ─────────────────────────────
function Avatar({ T, name, size = 44, src }) {
  const initials = (name || '').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  if (src) return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: T.cardAlt, flexShrink: 0
    }}>
      <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>);

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: T.grad, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.fam, fontWeight: 700, fontSize: size * 0.36
    }}>{initials}</div>);

}

// ── Status dot ─────────────────────────────────────────────────────────────
function StatusDot({ T, tone = 'success', size = 8 }) {
  const colors = { success: T.success, warn: T.warn, danger: T.danger, idle: T.inkMute };
  const c = colors[tone];
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: c, display: 'inline-block', flexShrink: 0,
      boxShadow: `0 0 0 4px ${c}22`
    }} />);

}

Object.assign(window, {
  Logo, Wordmark, Button, Input, PhoneInput, Card, Chip, SectionLabel, FieldLabel,
  Stepper, OTPInput, BottomNav, AppHeader, ScreenScroll, Toast, Avatar, StatusDot
});