// screens-provider-register.jsx — Provider PWA registration journey (NEW flow)
// Part A: shared helpers + Welcome, Phone, OTP, Basic profile, Service category, Service area
// Mirrors the proposed design in docs/design/provider-pwa-registration-proposed-design.md
// All screens render in the 390px iOS frame and reuse the shared UI kit (ui.jsx).

// ─────────────────────────────────────────────────────────────────────────
// Demo persona + shared registration draft (prototype state only)
// ─────────────────────────────────────────────────────────────────────────
const REG_DEMO = {
  name: 'Sipho Ndlovu',
  phone: '82 491 0317',
  mainTrade: 'plumb',
  secondary: ['handy', 'diy'],
  experience: '5–10 years',
  base: 'Soweto, Diepkloof',
  areas: ['Soweto, Diepkloof', 'Soweto, Orlando', 'Johannesburg South'],
  radius: 25,
  idLast4: '0184',
};

const REG_TOTAL = 8; // stepper: phone, profile, services, area, availability, identity, evidence, review
const REG_STEP_ORDER = ['reg-phone', 'reg-profile', 'reg-category', 'reg-area', 'reg-availability', 'reg-verify', 'reg-evidence', 'reg-review'];
function regPrev(id) {
  const i = REG_STEP_ORDER.indexOf(id);
  return i <= 0 ? 'reg-welcome' : REG_STEP_ORDER[i - 1];
}

// ── Step header (back + "Step n of 7" + progress + title) ──────────────────
function RegStepHeader({ T, go, step, title, subtitle, onBack, onExit }) {
  return (
    <div style={{ padding: '52px 20px 18px', background: T.page }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: '50%', border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><IcArrowL size={16} /></button>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMute }}>
          Step {step} of {REG_TOTAL}
        </div>
        {onExit && (
          <button onClick={onExit} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontFamily: T.fam, fontSize: 12.5, fontWeight: 600, color: T.inkMute,
            padding: '6px 4px',
          }}>Save &amp; exit</button>
        )}
      </div>
      <Stepper T={T} total={REG_TOTAL} current={step - 1} />
      <div style={{ marginTop: 18 }}>
        <div style={{ fontFamily: T.fam, fontSize: 22, fontWeight: 700, color: T.ink, letterSpacing: -0.4 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontFamily: T.fam, fontSize: 14, color: T.inkMute, marginTop: 4, textWrap: 'pretty' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sticky footer CTA bar ──────────────────────────────────────────────────
function RegStepFooter({ T, primary, onPrimary, secondary, onSecondary, primaryDisabled, note }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: note ? '10px 20px 24px' : '12px 20px 28px',
      background: T.dark ? 'rgba(11,11,16,0.92)' : 'rgba(246,246,248,0.92)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      boxShadow: `inset 0 1px 0 ${T.border}`, zIndex: 5,
    }}>
      {note && (
        <div style={{
          fontFamily: T.fam, fontSize: 11.5, color: T.inkMute,
          textAlign: 'center', marginBottom: 8,
        }}>{note}</div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {secondary && (
          <div style={{ flex: '0 0 auto' }}>
            <Button T={T} variant="secondary" fullWidth={false} onClick={onSecondary}>{secondary}</Button>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <Button T={T} onClick={onPrimary} disabled={primaryDisabled} rightIcon={<IcArrow size={16} color="#fff" />}>
            {primary}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Reassurance / info callout (used in welcome + verify) ──────────────────
function RegNote({ T, icon, tone = 'brand', title, children }) {
  const tones = {
    brand:    { bg: T.gradSoft, fg: T.pal.purple, line: `${T.pal.purple}33` },
    success:  { bg: T.dark ? 'rgba(15,157,88,0.14)' : 'rgba(15,157,88,0.08)', fg: T.success, line: `${T.success}30` },
    info:     { bg: T.dark ? 'rgba(42,120,240,0.14)' : 'rgba(42,120,240,0.07)', fg: T.pal.blue, line: `${T.pal.blue}30` },
    plain:    { bg: T.cardAlt, fg: T.inkMute, line: T.border },
  };
  const c = tones[tone] || tones.brand;
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 14px',
      background: c.bg, borderRadius: T.r.md, boxShadow: `inset 0 0 0 1px ${c.line}`,
    }}>
      <div style={{ color: c.fg, flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        {title && <div style={{ fontFamily: T.fam, fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 2 }}>{title}</div>}
        <div style={{ fontFamily: T.fam, fontSize: 12.5, lineHeight: 1.5, color: T.inkMute, textWrap: 'pretty' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Radio row (used in profile / category / area) ──────────────────────────
function RegRadioRow({ T, label, sub, active, onClick, icon }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: '13px 14px', border: 'none', cursor: 'pointer', background: T.card,
      borderRadius: T.r.md,
      boxShadow: active
        ? `inset 0 0 0 2px ${T.pal.purple}, 0 6px 16px ${T.pal.purple}14`
        : `inset 0 0 0 1px ${T.border}`,
      transition: 'box-shadow .15s',
    }}>
      {icon && (
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: active ? T.gradSoft : T.cardAlt, color: active ? T.pal.purple : T.inkMute,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.fam, fontSize: 14.5, fontWeight: 600, color: T.ink, letterSpacing: -0.1 }}>{label}</div>
        {sub && <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: active ? T.pal.purple : 'transparent',
        boxShadow: active ? 'none' : `inset 0 0 0 2px ${T.borderStrong}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{active && <IcCheck size={14} color="#fff" />}</div>
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 0. WELCOME — what Plug A Pro is + what you'll need
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegWelcome({ T, go }) {
  const need = [
    { icon: <IcShield size={17} />, label: 'Your SA ID or passport' },
    { icon: <IcUser size={17} />,   label: 'A selfie to confirm it’s you' },
    { icon: <IcBrush size={17} />,  label: 'Photos of past work (optional)' },
    { icon: <IcTime size={17} />,   label: 'About 5–8 minutes' },
  ];
  return (
    <AuthShell T={T} onBack={() => go('provider-signin')}
      eyebrow="Become a provider"
      title="Get work near you"
      subtitle="Plug A Pro connects skilled tradespeople with customers nearby. Apply once, get verified, and start receiving job leads in your areas.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RegNote T={T} tone="brand" icon={<IcCheck size={18} />} title="Reviewed before you go live">
          Every provider is checked before activation. This keeps customers safe and your profile trusted.
        </RegNote>

        <div>
          <SectionLabel T={T}>What you’ll need</SectionLabel>
          <Card T={T} padded={false}>
            {need.map((n, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                borderTop: i ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ color: T.pal.purple, display: 'flex' }}>{n.icon}</div>
                <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 500, color: T.ink }}>{n.label}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button T={T} variant="primary" onClick={() => go('reg-phone')} rightIcon={<IcArrow size={18} color="#fff" />}>
          Get started
        </Button>
        <div style={{ textAlign: 'center', fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
          Free to apply. No credits needed yet.
        </div>
        <button onClick={() => go('provider-signin')} style={{
          border: 'none', background: 'transparent', cursor: 'pointer', marginTop: 4,
          fontFamily: T.fam, fontSize: 13.5, color: T.inkMute,
        }}>
          Already a provider? <span style={{ color: T.pal.purple, fontWeight: 600 }}>Sign in</span>
        </button>
      </div>
    </AuthShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 1. PHONE — confirm number, role-aware
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegPhone({ T, go, state = {} }) {
  const [phone, setPhone] = React.useState(state.regPhone || REG_DEMO.phone);
  const valid = phone.replace(/\D/g, '').length >= 9;
  return (
    <>
      <ScreenScroll T={T} padBottom={150}>
        <RegStepHeader T={T} step={1} title="What’s your mobile number?"
          subtitle="We’ll text you a code to confirm it. This becomes your provider login."
          onBack={() => go('reg-welcome')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel T={T}>Mobile number</FieldLabel>
            <PhoneInput T={T} value={phone} onChange={setPhone} />
          </div>
          {/* Separate-number policy (repo-confirmed): customer & provider profiles use different numbers */}
          <RegNote T={T} tone="plain" icon={<IcInfo size={18} />} title="Already book services with this number?">
            Provider and customer accounts use separate numbers for now.{' '}
            <button onClick={() => go('reg-conflict', { regPhone: phone })} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: T.pal.purple, fontWeight: 600, fontFamily: T.fam, fontSize: 12.5 }}>See options</button>
          </RegNote>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Send code" primaryDisabled={!valid}
        onPrimary={() => go('reg-otp', { regPhone: phone })}
        note="We’ll send a code to confirm it’s you. By continuing you agree to the Provider Terms & Privacy Policy." />
    </>
  );
}

// 1c. OTP — verify code (same step number)
function ScreenRegOTP({ T, go, state = {} }) {
  const [code, setCode] = React.useState('');
  const phone = state.regPhone || REG_DEMO.phone;
  const full = code.length === 6;
  return (
    <>
      <ScreenScroll T={T} padBottom={150}>
        <RegStepHeader T={T} step={1} title="Enter the 6-digit code"
          subtitle={`Sent to +27 ${phone} on WhatsApp.`}
          onBack={() => go('reg-phone', { regPhone: phone })} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <OTPInput T={T} value={code} onChange={setCode} autoFocus />
          <button onClick={() => setCode('')} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontFamily: T.fam, fontSize: 13, color: T.inkMute, textAlign: 'center',
          }}>
            Didn’t get it? <span style={{ color: T.pal.purple, fontWeight: 600 }}>Resend in 0:24</span>
          </button>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Verify & continue" primaryDisabled={!full}
        onPrimary={() => go('reg-profile')} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 2. BASIC PROFILE
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegProfile({ T, go }) {
  const [name, setName] = React.useState(REG_DEMO.name);
  const [biz, setBiz] = React.useState('Ndlovu Plumbing');
  const [idType, setIdType] = React.useState('id');
  const [contact, setContact] = React.useState('whatsapp');
  const valid = name.trim().length > 1;
  const contacts = [
    { id: 'whatsapp', label: 'WhatsApp', icon: <IcWhats size={16} /> },
    { id: 'call', label: 'Call', icon: <IcPhone size={16} /> },
    { id: 'sms', label: 'SMS', icon: <IcMail size={16} /> },
  ];
  return (
    <>
      <ScreenScroll T={T} padBottom={120}>
        <RegStepHeader T={T} step={2} title="Tell us who you are"
          subtitle="Use your full name as it appears on your ID — it helps us verify you faster."
          onBack={() => go('reg-phone')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Profile photo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar T={T} name={name} size={64} />
            <div style={{ flex: 1 }}>
              <Button T={T} variant="secondary" size="sm" fullWidth={false}
                leftIcon={<IcPlus size={15} color={T.pal.purple} />}>Add profile photo</Button>
              <div style={{ fontFamily: T.fam, fontSize: 11.5, color: T.inkMute, marginTop: 6 }}>
                Optional — builds trust with customers.
              </div>
            </div>
          </div>

          <div>
            <FieldLabel T={T}>Full name</FieldLabel>
            <Input T={T} value={name} onChange={setName} placeholder="e.g. Sipho Ndlovu" />
          </div>
          <div>
            <FieldLabel T={T} hint="optional">Business / trading name</FieldLabel>
            <Input T={T} value={biz} onChange={setBiz} placeholder="e.g. Ndlovu Plumbing" />
          </div>

          <div>
            <FieldLabel T={T}>ID type</FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <RegRadioRow T={T} label="South African ID" active={idType === 'id'} onClick={() => setIdType('id')} icon={<IcShield size={17} />} />
              <RegRadioRow T={T} label="Passport" active={idType === 'pp'} onClick={() => setIdType('pp')} icon={<IcShield size={17} />} />
            </div>
          </div>

          <div>
            <FieldLabel T={T}>Preferred contact method</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {contacts.map((c) => (
                <button key={c.id} onClick={() => setContact(c.id)} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  padding: '12px 6px', border: 'none', cursor: 'pointer', background: T.card,
                  borderRadius: T.r.md,
                  boxShadow: contact === c.id ? `inset 0 0 0 2px ${T.pal.purple}` : `inset 0 0 0 1px ${T.border}`,
                  color: contact === c.id ? T.pal.purple : T.inkMute,
                }}>
                  {c.icon}
                  <span style={{ fontFamily: T.fam, fontSize: 12.5, fontWeight: 600, color: contact === c.id ? T.ink : T.inkMute }}>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Continue" primaryDisabled={!valid} onPrimary={() => go('reg-category')} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 3. SERVICE CATEGORY
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegCategory({ T, go }) {
  const cats = (window.CATEGORIES || []).slice(0, 8);
  const [main, setMain] = React.useState(REG_DEMO.mainTrade);
  const [secondary, setSecondary] = React.useState(REG_DEMO.secondary);
  const [exp, setExp] = React.useState(REG_DEMO.experience);
  const [desc, setDesc] = React.useState('Qualified plumber, 8 years. Geysers, leaks, drains and bathroom installs.');
  const expLevels = ['Under 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'];
  const toggleSec = (id) => setSecondary((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const needsCert = main === 'plumb';
  return (
    <>
      <ScreenScroll T={T} padBottom={120}>
        <RegStepHeader T={T} step={3} title="What kind of work do you do?"
          subtitle="Pick your main trade. You can add other services you offer too."
          onBack={() => go('reg-profile')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px' }}>
          <SectionLabel T={T}>Main trade</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {cats.map((c) => {
              const active = c.id === main;
              return (
                <button key={c.id} onClick={() => setMain(c.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '14px 12px',
                  border: 'none', cursor: 'pointer', background: T.card, borderRadius: T.r.md, textAlign: 'left',
                  boxShadow: active ? `inset 0 0 0 2px ${T.pal.purple}, 0 6px 16px ${T.pal.purple}1a` : `inset 0 0 0 1px ${T.border}`,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: active ? T.gradSoft : T.cardAlt, color: active ? T.pal.purple : c.hue,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{c.icon}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 13.5, fontWeight: 600, color: T.ink, letterSpacing: -0.1 }}>{c.label}</div>
                </button>
              );
            })}
          </div>

          {needsCert && (
            <div style={{ marginTop: 14 }}>
              <RegNote T={T} tone="info" icon={<IcInfo size={18} />}>
                Plumbing may need a PIRB certificate. You can add it in the next steps or after approval.
              </RegNote>
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <SectionLabel T={T}>Other services <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cats.filter((c) => c.id !== main).map((c) => (
                <Chip key={c.id} T={T} active={secondary.includes(c.id)} onClick={() => toggleSec(c.id)}>{c.label}</Chip>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <SectionLabel T={T}>Experience</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {expLevels.map((e) => (
                <Chip key={e} T={T} active={exp === e} onClick={() => setExp(e)} tone={exp === e ? 'neutral' : 'neutral'}>{e}</Chip>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <FieldLabel T={T} hint={`${desc.length}/300`}>Short description (optional)</FieldLabel>
            <div style={{ background: T.card, borderRadius: T.r.md, boxShadow: `inset 0 0 0 1px ${T.border}`, padding: 12 }}>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 300))} rows={3}
                placeholder="A sentence or two about the work you do."
                style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none',
                  fontFamily: T.fam, fontSize: 14.5, color: T.ink, lineHeight: 1.45 }} />
            </div>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Continue" onPrimary={() => go('reg-area')} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 4. SERVICE AREA
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegArea({ T, go }) {
  const suggestions = ['Soweto, Orlando', 'Johannesburg South', 'Lenasia', 'Roodepoort', 'Florida', 'Mondeor'];
  const [areas, setAreas] = React.useState(REG_DEMO.areas);
  const [radius, setRadius] = React.useState(REG_DEMO.radius);
  const [query, setQuery] = React.useState('');
  const addArea = (a) => { if (!areas.includes(a)) setAreas([...areas, a]); setQuery(''); };
  const removeArea = (a) => setAreas(areas.filter((x) => x !== a));
  const valid = areas.length > 0;
  return (
    <>
      <ScreenScroll T={T} padBottom={120}>
        <RegStepHeader T={T} step={4} title="Where do you work?"
          subtitle="Choose the areas you can travel to. We’ll only send you jobs in these areas."
          onBack={() => go('reg-category')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px' }}>
          <FieldLabel T={T}>Search your suburb</FieldLabel>
          <Input T={T} value={query} onChange={setQuery} placeholder="e.g. Soweto, Diepkloof" leftIcon={<IcSearch size={18} />} />

          {/* Selected areas */}
          {areas.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {areas.map((a) => (
                <button key={a} onClick={() => removeArea(a)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px 0 12px',
                  borderRadius: T.r.pill, border: 'none', cursor: 'pointer', background: T.gradSoft, color: T.pal.purple,
                  fontFamily: T.fam, fontSize: 13, fontWeight: 600,
                }}>
                  <IcPin size={14} />{a}<IcX size={13} />
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <SectionLabel T={T}>Suggested near you</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.filter((s) => !areas.includes(s)).map((s) => (
                <Chip key={s} T={T} icon={<IcPlus size={14} />} onClick={() => addArea(s)}>{s}</Chip>
              ))}
            </div>
          </div>

          {/* Travel radius */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontFamily: T.fam, fontSize: 13, fontWeight: 600, color: T.ink }}>Travel radius</span>
              <span style={{ fontFamily: T.mono, fontSize: 13, color: T.pal.purple, fontWeight: 500 }}>{radius} km</span>
            </div>
            <input type="range" min={5} max={50} step={5} value={radius} onChange={(e) => setRadius(+e.target.value)}
              style={{ width: '100%', accentColor: T.pal.purple }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.fam, fontSize: 11, color: T.inkSoft, marginTop: 2 }}>
              <span>5 km</span><span>50 km</span>
            </div>
          </div>

          {/* Map placeholder */}
          <div style={{ marginTop: 18, position: 'relative', height: 130, borderRadius: T.r.md, overflow: 'hidden',
            background: `repeating-linear-gradient(45deg, ${T.cardAlt}, ${T.cardAlt} 10px, ${T.card} 10px, ${T.card} 20px)`,
            boxShadow: `inset 0 0 0 1px ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: T.inkMute }}>
              <IcMap size={22} />
              <span style={{ fontFamily: T.mono, fontSize: 11 }}>map · drop a pin (optional)</span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <RegNote T={T} tone="plain" icon={<IcLock size={16} />}>Your exact address is never shown to customers.</RegNote>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Continue" primaryDisabled={!valid} onPrimary={() => go('reg-availability')} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 5. AVAILABILITY & RATES  (repo: completeness needs availability; call-out fee gates customer display)
// ══════════════════════════════════════════════════════════════════
function ScreenRegAvailability({ T, go }) {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const [days, setDays] = React.useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [hours, setHours] = React.useState('extended');
  const [emergency, setEmergency] = React.useState(true);
  const [fee, setFee] = React.useState('350');
  const toggleDay = (d) => setDays((s) => s.includes(d) ? s.filter((x) => x !== d) : [...s, d]);
  const preset = (set) => setDays(set);
  const valid = days.length > 0 && fee.trim().length > 0;
  return (
    <>
      <ScreenScroll T={T} padBottom={150}>
        <RegStepHeader T={T} step={5} title="When can you work?"
          subtitle="This helps us match you to jobs at the right times. You can change it anytime."
          onBack={() => go('reg-area')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px' }}>
          <SectionLabel T={T}>Days available</SectionLabel>
          <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
            {DAYS.map((d) => {
              const on = days.includes(d);
              return (
                <button key={d} onClick={() => toggleDay(d)} style={{
                  flex: 1, height: 42, borderRadius: T.r.sm, border: 'none', cursor: 'pointer',
                  background: on ? T.grad : T.card, color: on ? '#fff' : T.inkMute,
                  boxShadow: on ? 'none' : `inset 0 0 0 1px ${T.border}`,
                  fontFamily: T.fam, fontSize: 12, fontWeight: 600,
                }}>{d[0]}</button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Chip T={T} onClick={() => preset(['Mon','Tue','Wed','Thu','Fri'])}>Weekdays</Chip>
            <Chip T={T} onClick={() => preset(['Sat','Sun'])}>Weekends</Chip>
            <Chip T={T} onClick={() => preset(DAYS)}>Every day</Chip>
          </div>

          <div style={{ marginTop: 22 }}>
            <SectionLabel T={T}>Working hours</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <RegRadioRow T={T} label="Standard" sub="7am – 5pm" active={hours === 'standard'} onClick={() => setHours('standard')} icon={<IcTime size={17} />} />
              <RegRadioRow T={T} label="Extended" sub="6am – 8pm" active={hours === 'extended'} onClick={() => setHours('extended')} icon={<IcTime size={17} />} />
              <RegRadioRow T={T} label="Around the clock" sub="24 / 7" active={hours === '247'} onClick={() => setHours('247')} icon={<IcTime size={17} />} />
            </div>
            <button onClick={() => setEmergency((e) => !e)} style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '12px 14px', border: 'none', cursor: 'pointer', background: T.card, borderRadius: T.r.md,
              boxShadow: `inset 0 0 0 1px ${T.border}`,
            }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: emergency ? T.gradSoft : T.cardAlt, color: emergency ? T.pal.purple : T.inkMute, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IcAlert size={17} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.fam, fontSize: 14.5, fontWeight: 600, color: T.ink }}>Available for emergencies</div>
                <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute }}>After-hours call-outs</div>
              </div>
              <div style={{ width: 44, height: 26, borderRadius: 999, flexShrink: 0, background: emergency ? T.pal.purple : T.borderStrong, position: 'relative', transition: 'background .15s' }}>
                <div style={{ position: 'absolute', top: 3, left: emergency ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </div>
            </button>
          </div>

          <div style={{ marginTop: 22 }}>
            <FieldLabel T={T}>Call-out fee</FieldLabel>
            <Input T={T} value={fee} onChange={(v) => setFee(v.replace(/\D/g, '').slice(0, 5))} inputMode="numeric"
              placeholder="e.g. 350" leftIcon={<span style={{ fontFamily: T.mono, fontSize: 14, color: T.inkMute }}>R</span>} />
            <div style={{ marginTop: 10 }}>
              <RegNote T={T} tone="plain" icon={<IcInfo size={16} />}>Shown to customers. Needed before your profile can go live — but you can refine it later.</RegNote>
            </div>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Continue" primaryDisabled={!valid} onPrimary={() => go('reg-verify')} />
    </>
  );
}

Object.assign(window, {
  REG_DEMO, REG_TOTAL, REG_STEP_ORDER, regPrev,
  RegStepHeader, RegStepFooter, RegNote, RegRadioRow,
  ScreenRegWelcome, ScreenRegPhone, ScreenRegOTP, ScreenRegProfile, ScreenRegCategory, ScreenRegArea,
  ScreenRegAvailability,
});
