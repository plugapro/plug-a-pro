// screens-customer.jsx — Home, Browse, Bookings, Account, Provider Detail

const CATEGORIES = [
  { id: 'plumb',  label: 'Plumbing',     icon: <IcDroplet size={20} />, hue: '#2A78F0' },
  { id: 'elec',   label: 'Electrical',   icon: <IcBolt size={20} />,    hue: '#FFC22B' },
  { id: 'handy',  label: 'Handyman',     icon: <IcWrench size={20} />,  hue: '#8B3FE8' },
  { id: 'carp',   label: 'Carpentry',    icon: <IcSaw size={20} />,     hue: '#C8854D' },
  { id: 'paint',  label: 'Painting',     icon: <IcBrush size={20} />,   hue: '#FF1F8E' },
  { id: 'clean',  label: 'Cleaning',     icon: <IcSpray size={20} />,   hue: '#0FA28A' },
  { id: 'appl',   label: 'Appliances',   icon: <IcOven size={20} />,    hue: '#5B5B66' },
  { id: 'gas',    label: 'Gas & Geyser', icon: <IcFlame size={20} />,   hue: '#E5484D' },
];

// Popular suburb suggestions used by the Area Picker
const POPULAR_SUBURBS = [
  { full: 'Sandton, Sandhurst',        city: 'Johannesburg' },
  { full: 'Rosebank, Parktown North',  city: 'Johannesburg' },
  { full: 'Bryanston, Fourways',       city: 'Johannesburg' },
  { full: "Allen's Nek, Roodepoort",   city: 'Johannesburg' },
  { full: 'Randburg, Ferndale',        city: 'Johannesburg' },
  { full: 'Centurion, Midrand',        city: 'Pretoria' },
  { full: 'Pretoria East, Menlyn',     city: 'Pretoria' },
  { full: 'Soweto, Diepkloof',         city: 'Johannesburg' },
  { full: 'Sea Point, Green Point',    city: 'Cape Town' },
  { full: 'Constantia, Tokai',         city: 'Cape Town' },
  { full: 'Umhlanga, Durban North',    city: 'Durban' },
];

const PROVIDERS = [
  { id: 'sm', name: 'Lovemore Sibanda', area: "Allen's Nek, Roodepoort", rating: 4.9, jobs: 127, years: 5,
    fee: 350, cats: ['Plumbing', 'Painting', 'Handyman'], available: true, online: true, verified: true,
    bio: 'Plumbing, painting and general handyman work. Free quotes within 25 km.', tone: '#8B3FE8' },
  { id: 'nk', name: 'Nomvula Khumalo', area: 'Sandton, Bryanston', rating: 4.8, jobs: 96, years: 7,
    fee: 450, cats: ['Electrical', 'Geyser'], available: true, online: true, verified: true,
    bio: 'Master electrician. After-hours emergencies. COC certificates issued.', tone: '#2A78F0' },
  { id: 'lm', name: 'Lerato Maboe', area: 'Sandton, Rosebank', rating: 4.7, jobs: 88, years: 4,
    fee: 380, cats: ['Plumbing', 'Geyser'], available: true, online: true, verified: true,
    bio: 'Burst pipes, blocked drains, geyser swap-outs. Female plumber team.', tone: '#0FA28A' },
  { id: 'rk', name: 'Riaan Kruger', area: 'Sandton, Bryanston', rating: 4.8, jobs: 145, years: 6,
    fee: 320, cats: ['Painting', 'Handyman', 'Carpentry'], available: true, online: false, verified: true,
    bio: 'Interior painting, built-in cabinets, door hangings. Quotes within a day.', tone: '#FF1F8E' },
  { id: 'tm', name: 'Themba Mokoena', area: 'Soweto, Diepkloof', rating: 4.7, jobs: 64, years: 3,
    fee: 250, cats: ['Handyman', 'Appliances'], available: false, online: false, verified: true,
    bio: 'Appliance repair specialist — washers, dryers, ovens, dishwashers.', tone: '#0FA28A' },
  { id: 'pv', name: 'Pieter van Wyk', area: 'Centurion, Midrand', rating: 4.9, jobs: 211, years: 9,
    fee: 400, cats: ['Plumbing', 'Geyser'], available: true, online: true, verified: true,
    bio: 'Geyser installs, leak detection, blocked drains. Same-day where possible.', tone: '#FF1F8E' },
  { id: 'ng', name: 'Naledi Gumede', area: 'Randburg, Ferndale', rating: 4.6, jobs: 52, years: 3,
    fee: 280, cats: ['Cleaning', 'Handyman'], available: true, online: true, verified: true,
    bio: 'Deep clean, move-in/out cleans, post-renovation. Insured team of three.', tone: '#2A78F0' },
];

// Match a provider's area to a user's area string (substring on the leading suburb)
function providerMatchesArea(p, area) {
  if (!area) return false;
  const token = area.split(',')[0].trim().toLowerCase();
  return p.area.toLowerCase().includes(token);
}

// Small reusable: rating display
function RatingPill({ T, rating, jobs }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: T.fam, fontSize: 12.5, fontWeight: 600, color: T.ink,
    }}>
      <IcStar size={13} color="#F5B400" /> {rating.toFixed(1)}
      <span style={{ color: T.inkMute, fontWeight: 500 }}>· {jobs} jobs</span>
    </span>
  );
}

// Avatar tone block — placeholder when no photo (uses gradient with tone)
function ProviderAvatar({ T, p, size = 48 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 14, flexShrink: 0,
      background: `linear-gradient(135deg, ${p.tone} 0%, ${T.pal.purple} 100%)`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.fam, fontWeight: 700, fontSize: size * 0.34, letterSpacing: 0.3,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
    }}>{p.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HOME — area-first, browse-before-commit
// ─────────────────────────────────────────────────────────────────────────
function ScreenHome({ T, go, state, setArea }) {
  const signedIn = state.signedIn;
  const userName = signedIn ? (state.firstName || 'Thandi') : null;
  const area = state.area;          // may be null in first-run
  const hasArea = !!area;
  const [q, setQ] = React.useState('');

  // Matched providers for the selected area
  const matched = React.useMemo(
    () => hasArea ? PROVIDERS.filter(p => providerMatchesArea(p, area)) : [],
    [area, hasArea]
  );
  const onlineCount = matched.filter(p => p.online).length;

  const submitSearch = () => {
    if (!hasArea) { go('area-picker'); return; }
    go('browse', { q });
  };

  return (
    <ScreenScroll T={T}>
      {/* gradient halo top */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 260,
        background: `radial-gradient(70% 100% at 50% -20%, ${T.pal.purple}1f, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      {/* Header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '60px 18px 8px', position: 'relative',
      }}>
        <Logo size={32} />
        <div style={{ flex: 1 }}>
          <Wordmark T={T} size={13} />
        </div>
        <button onClick={() => go('notifications')} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        }}>
          <IcBell size={18} />
          <span style={{
            position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: '50%',
            background: T.pal.pink, boxShadow: `0 0 0 2px ${T.card}`,
          }} />
        </button>
      </div>

      {/* AREA CHIP — primary context-setter, always at top */}
      <div style={{ padding: '6px 18px 14px', position: 'relative' }}>
        <button onClick={() => go('area-picker')} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', height: 56,
          border: 'none', cursor: 'pointer', textAlign: 'left',
          background: T.card, borderRadius: 16,
          boxShadow: hasArea
            ? `inset 0 0 0 1px ${T.border}, 0 1px 2px rgba(15,15,30,0.03)`
            : `inset 0 0 0 1.5px ${T.pal.purple}, 0 8px 22px ${T.pal.purple}22`,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: hasArea ? T.gradSoft : T.grad,
            color: hasArea ? T.pal.purple : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IcPin size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: T.fam, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
              textTransform: 'uppercase', color: T.inkMute, marginBottom: 1,
            }}>
              {hasArea ? 'Looking in' : 'Choose an area to start'}
            </div>
            <div style={{
              fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {hasArea ? area : 'Tap to set your suburb'}
            </div>
          </div>
          <span style={{
            fontFamily: T.fam, fontSize: 12, fontWeight: 600,
            color: hasArea ? T.pal.purple : T.pal.purple,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {hasArea ? 'Change' : 'Set'} <IcChev size={13} />
          </span>
        </button>
      </div>

      {/* Hero */}
      <div style={{ padding: '0 18px 14px', position: 'relative' }}>
        <h1 style={{
          margin: 0, fontFamily: T.fam, fontWeight: 700, fontSize: 26,
          letterSpacing: -0.6, lineHeight: 1.15, color: T.ink, textWrap: 'balance',
        }}>
          {signedIn
            ? <>Hi {userName} — what needs fixing?</>
            : hasArea
              ? <>Trusted help in {area.split(',')[0]}.</>
              : <>Find trusted help, near you.</>}
        </h1>

        {/* Unified Search */}
        <div style={{
          marginTop: 14,
          display: 'flex', alignItems: 'center', height: 56,
          background: T.card, borderRadius: 18,
          boxShadow: `0 1px 0 ${T.border}, 0 10px 30px rgba(15,15,30,0.05)`,
          padding: '0 6px 0 16px',
        }}>
          <IcSearch size={18} color={T.inkMute} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={hasArea ? `Plumber, leak, electrician…` : 'Set an area to search'}
                 onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                 style={{
                   flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none',
                   background: 'transparent', color: T.ink, padding: '0 12px',
                   fontFamily: T.fam, fontSize: 15, fontWeight: 500,
                 }} />
          <button onClick={submitSearch} style={{
            height: 44, padding: '0 14px', borderRadius: 14, border: 'none',
            background: T.grad, color: '#fff', cursor: 'pointer',
            fontFamily: T.fam, fontWeight: 700, fontSize: 13, letterSpacing: -0.1,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <IcSearch size={13} /> Search
          </button>
        </div>
      </div>

      {/* Categories */}
      <div style={{ padding: '6px 18px 6px' }}>
        <SectionLabel T={T} action={
          <a onClick={() => go('browse')} style={{ color: T.pal.purple, fontFamily: T.fam, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            See all
          </a>
        }>Browse by category</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {CATEGORIES.slice(0, 8).map((c) => (
            <button key={c.id} onClick={() => go('browse', { cat: c.label })} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '14px 6px 10px', border: 'none', cursor: 'pointer',
              background: T.card, borderRadius: 16,
              boxShadow: `inset 0 0 0 1px ${T.border}`,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 11,
                background: `${c.hue}15`, color: c.hue,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{c.icon}</div>
              <span style={{ fontFamily: T.fam, fontSize: 11.5, fontWeight: 600, color: T.ink, letterSpacing: -0.1, textAlign: 'center' }}>
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* AVAILABLE NEAR YOU — provider strip */}
      <div style={{ padding: '22px 18px 6px' }}>
        <SectionLabel T={T} action={
          hasArea && matched.length > 0 ? (
            <a onClick={() => go('browse')} style={{ color: T.pal.purple, fontFamily: T.fam, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              See all {matched.length} →
            </a>
          ) : null
        }>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {hasArea ? `Available near ${area.split(',')[0]}` : 'Available providers'}
            {hasArea && onlineCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 7px', borderRadius: 999,
                background: `${T.success}15`, color: T.success,
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.success }} />
                {onlineCount} online
              </span>
            )}
          </span>
        </SectionLabel>

        {!hasArea ? (
          <Card T={T} style={{ textAlign: 'center', padding: 20 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14, margin: '0 auto 10px',
              background: T.gradSoft, color: T.pal.purple,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><IcPin size={20} /></div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14.5, color: T.ink, marginBottom: 4 }}>
              Set your area to see providers
            </div>
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.5, marginBottom: 12, textWrap: 'pretty' }}>
              We'll show you who's working in your suburb right now.
            </div>
            <Button T={T} variant="primary" onClick={() => go('area-picker')}
                    leftIcon={<IcPin size={15} />} fullWidth={false}>
              Choose suburb
            </Button>
          </Card>
        ) : matched.length === 0 ? (
          <Card T={T} style={{ textAlign: 'center', padding: 22 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14, margin: '0 auto 10px',
              background: `${T.warn}15`, color: T.warn,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><IcAlert size={20} /></div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14.5, color: T.ink, marginBottom: 4 }}>
              No providers in {area.split(',')[0]} yet
            </div>
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.5, marginBottom: 12, textWrap: 'pretty' }}>
              Be the first to request — we'll match the closest available pro and notify you when more join your area.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Button T={T} variant="primary" onClick={() => go('book')} fullWidth={false}>
                Request anyway
              </Button>
              <Button T={T} variant="secondary" onClick={() => go('area-picker')} fullWidth={false}>
                Change area
              </Button>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {matched.slice(0, 3).map((p) =>
              <ProviderCard key={p.id} T={T} p={p} onClick={() => go('provider', { id: p.id })} />
            )}
            {matched.length > 3 && (
              <button onClick={() => go('browse')} style={{
                height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: 'transparent', color: T.pal.purple,
                fontFamily: T.fam, fontWeight: 700, fontSize: 13.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                boxShadow: `inset 0 0 0 1px ${T.border}`,
              }}>
                See all {matched.length} in {area.split(',')[0]} <IcArrow size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* URGENT shortcut — blind request, secondary CTA */}
      {hasArea && (
        <div style={{ padding: '18px 18px 6px' }}>
          <button onClick={() => go('book')} style={{
            width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
            background: T.card, borderRadius: T.r.lg,
            boxShadow: `inset 0 0 0 1px ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: `${T.danger}12`, color: T.danger,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><IcZap size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14.5, color: T.ink, letterSpacing: -0.2 }}>
                Need help right now?
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, marginTop: 1 }}>
                Skip browsing — we'll match the closest available pro.
              </div>
            </div>
            <IcChev size={16} color={T.inkSoft} />
          </button>
        </div>
      )}

      {/* How it works */}
      <div style={{ padding: '20px 18px 6px' }}>
        <SectionLabel T={T}>How it works</SectionLabel>
        <Card T={T} padded={false} style={{ padding: '4px 0' }}>
          {[
            { icon: <IcSpark size={18} />,  title: 'Tell us what you need', desc: 'Pick a category and describe the job.' },
            { icon: <IcGrid size={18} />,   title: 'We match providers',     desc: 'Vetted pros in your area get notified.' },
            { icon: <IcWhats size={18} />,  title: 'Approve & track',         desc: T.showWA ? 'Updates straight to WhatsApp.' : 'Track updates in the app.' },
            { icon: <IcCheck size={18} />,  title: 'Pay after the job',       desc: 'Rate your provider when it\'s done.' },
          ].map((s, i, arr) => (
            <div key={i} style={{
              display: 'flex', gap: 12, padding: '12px 16px',
              boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: T.gradSoft, color: T.pal.purple,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{s.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 1 }}>
                  {i + 1}. {s.title}
                </div>
                <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.4 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* CTA for providers */}
      <div style={{ padding: '20px 18px 6px' }}>
        <div style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: T.r.lg, padding: '20px 18px',
          background: T.dark ? '#16161C' : T.ink, color: T.card,
        }}>
          <div aria-hidden style={{
            position: 'absolute', right: -40, top: -40, width: 200, height: 200,
            background: T.grad, opacity: 0.35, filter: 'blur(40px)', borderRadius: '50%',
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: 'rgba(255,255,255,0.1)',
              fontFamily: T.fam, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
              textTransform: 'uppercase', marginBottom: 10,
            }}>
              <IcWrench size={11} /> For service providers
            </div>
            <div style={{
              fontFamily: T.fam, fontWeight: 700, fontSize: 18, lineHeight: 1.25,
              letterSpacing: -0.3, marginBottom: 6,
            }}>
              Win paying work — without the noise.
            </div>
            <div style={{ fontFamily: T.fam, fontSize: 13, opacity: 0.75, lineHeight: 1.5, marginBottom: 14 }}>
              Verified leads, transparent fees, and end-to-end job tracking. Apply once, get matched daily.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => go('provider-signin')} style={{
                flex: 1, height: 42, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: '#fff', color: '#0A0A0F',
                fontFamily: T.fam, fontWeight: 700, fontSize: 13.5,
              }}>
                Join as provider
              </button>
              {T.showWA && (
                <button style={{
                  height: 42, padding: '0 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: T.whatsapp, color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: T.fam, fontWeight: 700, fontSize: 13.5,
                }}>
                  <IcWhats size={15} /> Apply
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '24px 18px 18px', textAlign: 'center',
        fontFamily: T.fam, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.6,
      }}>
        Your exact address is only shared once a provider accepts.<br />
        © 2026 Plug A Pro · <a onClick={() => go('credit-terms')} style={{ color: T.inkMute, cursor: 'pointer', textDecoration: 'underline' }}>Credit terms</a> · <a onClick={() => go('status')} style={{ color: T.inkMute, cursor: 'pointer', textDecoration: 'underline' }}>System status</a>
      </div>
    </ScreenScroll>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PROVIDER CARD (used in Home + Browse)
// ─────────────────────────────────────────────────────────────────────────
function ProviderCard({ T, p, onClick, compact }) {
  return (
    <div onClick={onClick} style={{
      background: T.card, borderRadius: T.r.lg,
      boxShadow: `inset 0 0 0 1px ${T.border}, 0 1px 2px rgba(15,15,30,0.03)`,
      padding: 14, cursor: 'pointer',
      transition: 'transform .15s, box-shadow .15s',
    }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <ProviderAvatar T={T} p={p} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
            }}>{p.name}</div>
            {p.verified && (
              <span title="Verified" style={{
                width: 18, height: 18, borderRadius: '50%',
                background: T.gradSoft, color: T.pal.purple,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><IcCheck size={11} stroke={2.4} /></span>
            )}
          </div>
          <div style={{ marginTop: 2 }}>
            <RatingPill T={T} rating={p.rating} jobs={p.jobs} />
          </div>
          <div style={{
            marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: T.fam, fontSize: 12, color: T.inkMute,
          }}>
            <IcPin size={12} /> {p.area} · {p.years} yrs
          </div>
        </div>
      </div>
      {!compact && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {p.cats.map((c) => <Chip key={c} T={T} tone="brand">{c}</Chip>)}
          </div>
          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute }}>
                Call-out from
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 15, fontWeight: 700, color: T.ink, letterSpacing: -0.2 }}>
                R{p.fee}
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 500, marginLeft: 4 }}>· rate negotiable</span>
              </div>
            </div>
            <Chip T={T} tone={p.available ? 'success' : 'warn'}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: p.available ? T.success : T.warn,
                }} />
                {p.available ? 'Available now' : 'Busy today'}
              </span>
            </Chip>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BROWSE — area + category filter, with explicit empty state
// ─────────────────────────────────────────────────────────────────────────
function ScreenBrowse({ T, go, state, setArea }) {
  const [activeCat, setActiveCat] = React.useState(state.cat || 'All');
  const [q, setQ] = React.useState(state.q || '');
  const cats = ['All', ...CATEGORIES.map(c => c.label)];
  const area = state.area;
  const hasArea = !!area;

  // Filter by area first, then category, then query
  const filtered = React.useMemo(() => {
    if (state.forceEmpty) return [];
    let list = hasArea ? PROVIDERS.filter(p => providerMatchesArea(p, area)) : [...PROVIDERS];
    if (activeCat !== 'All') list = list.filter(p => p.cats.includes(activeCat));
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(needle) ||
        p.cats.some(c => c.toLowerCase().includes(needle)) ||
        p.bio.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [area, hasArea, activeCat, q, state.forceEmpty]);

  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '58px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontFamily: T.fam, fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: T.ink }}>
            Find a provider
          </h1>
          <button onClick={() => alert('Map view')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 11px',
            border: 'none', borderRadius: 999, cursor: 'pointer',
            background: T.dark ? 'rgba(255,255,255,0.06)' : '#F1F1F4',
            color: T.ink, fontFamily: T.fam, fontWeight: 600, fontSize: 12.5,
          }}>
            <IcMap size={13} /> Map
          </button>
        </div>
      </div>

      {/* Area + result row */}
      <div style={{ padding: '8px 18px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => go('area-picker')} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 34, padding: '0 12px 0 10px',
          border: 'none', borderRadius: 999, cursor: 'pointer',
          background: T.gradSoft, color: T.pal.purple,
          fontFamily: T.fam, fontWeight: 700, fontSize: 12.5, letterSpacing: -0.1,
          maxWidth: '100%', minWidth: 0,
        }}>
          <IcPin size={14} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hasArea ? area : 'Set area'}
          </span>
          <IcChevD size={12} />
        </button>
        <span style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
          {filtered.length} {filtered.length === 1 ? 'provider' : 'providers'}
          {activeCat !== 'All' ? ` · ${activeCat}` : ''}
        </span>
      </div>

      {/* Search */}
      <div style={{ padding: '0 18px 12px' }}>
        <Input T={T} placeholder="Search plumber, leak, geyser…"
               leftIcon={<IcSearch size={16} />} value={q} onChange={setQ} />
      </div>

      {/* Category pills (horizontal scroll) */}
      <div style={{
        overflowX: 'auto', overflowY: 'hidden',
        padding: '0 14px 14px',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        <div style={{ display: 'inline-flex', gap: 8, padding: '0 4px' }}>
          {cats.map((c) => (
            <Chip key={c} T={T} active={activeCat === c} onClick={() => setActiveCat(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      {/* Sort row */}
      {filtered.length > 0 && (
        <div style={{
          padding: '0 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, fontWeight: 500 }}>
            Sorted by <b style={{ color: T.ink, fontWeight: 700 }}>Rating</b>
          </span>
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: T.pal.purple, fontFamily: T.fam, fontWeight: 600, fontSize: 12,
          }}>
            Filters <IcChevD size={12} />
          </button>
        </div>
      )}

      {/* Provider list / empty state */}
      <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((p) =>
          <ProviderCard key={p.id} T={T} p={p} onClick={() => go('provider', { id: p.id })} />
        )}
        {filtered.length === 0 && (
          <BrowseEmpty T={T} area={area} activeCat={activeCat} go={go} setActiveCat={setActiveCat} />
        )}
      </div>
    </ScreenScroll>
  );
}

// Empty state — distinct messaging for "no providers in area" vs "no match for filter"
function BrowseEmpty({ T, area, activeCat, go, setActiveCat }) {
  const reason = !area
    ? 'no-area'
    : activeCat === 'All'
      ? 'no-area-providers'
      : 'no-category-match';

  return (
    <Card T={T} style={{ padding: 24, textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 18, margin: '0 auto 14px',
        background: reason === 'no-area' ? T.gradSoft : `${T.warn}15`,
        color: reason === 'no-area' ? T.pal.purple : T.warn,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {reason === 'no-area' ? <IcPin size={24} /> : <IcAlert size={24} />}
      </div>
      <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 16, color: T.ink, marginBottom: 6, letterSpacing: -0.2 }}>
        {reason === 'no-area'         && 'Choose an area first'}
        {reason === 'no-area-providers' && `No providers in ${area.split(',')[0]} yet`}
        {reason === 'no-category-match' && `No ${activeCat.toLowerCase()} providers ${area ? 'in ' + area.split(',')[0] : ''}`}
      </div>
      <div style={{ fontFamily: T.fam, fontSize: 13, color: T.inkMute, lineHeight: 1.55, textWrap: 'pretty', marginBottom: 16 }}>
        {reason === 'no-area' && 'Set your suburb and we\'ll show pros working near you.'}
        {reason === 'no-area-providers' &&
          'You\'re early — be the first to request and we\'ll match the closest available pro. We\'ll also notify you when a provider joins your area.'}
        {reason === 'no-category-match' &&
          'Try a different category, or request the service anyway — we\'ll match someone who covers this work.'}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {reason === 'no-area' && (
          <Button T={T} variant="primary" onClick={() => go('area-picker')}
                  leftIcon={<IcPin size={15} />} fullWidth={false}>Choose area</Button>
        )}
        {reason === 'no-area-providers' && (
          <>
            <Button T={T} variant="primary" onClick={() => go('book')} fullWidth={false}>
              Request anyway
            </Button>
            <Button T={T} variant="secondary" onClick={() => alert('You\'ll be notified when providers join ' + area)} fullWidth={false}>
              Notify me
            </Button>
          </>
        )}
        {reason === 'no-category-match' && (
          <>
            <Button T={T} variant="primary" onClick={() => go('book', { cat: activeCat })} fullWidth={false}>
              Request anyway
            </Button>
            <Button T={T} variant="secondary" onClick={() => setActiveCat('All')} fullWidth={false}>
              Show all
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AREA PICKER — full-screen sheet with suburb autocomplete
// ─────────────────────────────────────────────────────────────────────────
function ScreenAreaPicker({ T, go, state, setArea }) {
  const [q, setQ] = React.useState('');
  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return POPULAR_SUBURBS;
    return POPULAR_SUBURBS.filter(s =>
      s.full.toLowerCase().includes(needle) || s.city.toLowerCase().includes(needle)
    );
  }, [q]);
  const current = state.area;

  const pickArea = (full) => {
    setArea(full);
    go('home');
  };

  return (
    <ScreenScroll T={T} padBottom={20}>
      {/* Header */}
      <div style={{
        padding: '54px 18px 8px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => go('home')} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><IcX size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1,
            textTransform: 'uppercase', color: T.pal.purple,
          }}>Service area</div>
          <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 20, color: T.ink, letterSpacing: -0.4, marginTop: 1 }}>
            Where do you need help?
          </div>
        </div>
      </div>

      <div style={{ padding: '8px 18px 4px' }}>
        <div style={{ fontFamily: T.fam, fontSize: 13.5, color: T.inkMute, lineHeight: 1.5, marginBottom: 14, textWrap: 'pretty' }}>
          We use your suburb to match nearby providers. Your full address only unlocks after a provider accepts.
        </div>

        {/* Search */}
        <Input T={T} value={q} onChange={setQ} autoFocus
               placeholder="Search suburb or area…"
               leftIcon={<IcSearch size={16} />} />

        {/* Use current location */}
        <div style={{ marginTop: 10 }}>
          <Button T={T} variant="secondary" leftIcon={<IcPin size={16} color={T.pal.purple} />}
                  onClick={() => pickArea('Sandton, Sandhurst')}>
            Use my current location
          </Button>
        </div>
      </div>

      {/* Results */}
      <div style={{ padding: '18px 18px 0' }}>
        <SectionLabel T={T}>{q ? 'Matches' : 'Popular areas'}</SectionLabel>
        <Card T={T} padded={false}>
          {filtered.map((s, i, arr) => {
            const active = s.full === current;
            return (
              <button key={s.full} onClick={() => pickArea(s.full)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: active ? T.gradSoft : 'transparent',
                boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: active ? T.grad : (T.dark ? 'rgba(255,255,255,0.04)' : '#F4F4F7'),
                  color: active ? '#fff' : T.inkMute,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><IcPin size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: T.fam, fontWeight: 700, fontSize: 14.5,
                    color: active ? T.pal.purple : T.ink, letterSpacing: -0.15,
                  }}>{s.full}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1 }}>
                    {s.city}
                  </div>
                </div>
                {active
                  ? <IcCheck size={18} color={T.pal.purple} />
                  : <IcChev size={16} color={T.inkSoft} />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <div style={{ fontFamily: T.fam, fontWeight: 600, fontSize: 13.5, color: T.ink, marginBottom: 4 }}>
                No matches for "{q}"
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
                Try a wider search or use your current location.
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Privacy footnote */}
      <div style={{ padding: '18px 18px 0' }}>
        <Card T={T} style={{ background: T.gradSoft, boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <IcLock size={16} color={T.pal.purple} />
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>
              <b>We never share your full address upfront.</b> Providers only see your suburb until you accept their quote.
            </div>
          </div>
        </Card>
      </div>
    </ScreenScroll>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PROVIDER DETAIL
// ─────────────────────────────────────────────────────────────────────────
function ScreenProvider({ T, go, state }) {
  const p = PROVIDERS.find(x => x.id === state.id) || PROVIDERS[0];
  return (
    <ScreenScroll T={T}>
      {/* Top header */}
      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${p.tone}, ${T.pal.purple})` }} />
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 16px)`,
        }} />
        <div style={{
          position: 'absolute', top: 58, left: 16, right: 16,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <button onClick={() => go('browse')} style={{
            width: 38, height: 38, borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,0.18)', color: '#fff',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><IcArrowL size={18} /></button>
          <button style={{
            width: 38, height: 38, borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,0.18)', color: '#fff',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><IcMore size={18} /></button>
        </div>
      </div>

      {/* Profile card overlapping */}
      <div style={{ padding: '0 18px', marginTop: -64, position: 'relative' }}>
        <Card T={T} raised>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProviderAvatar T={T} p={p} size={66} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <h1 style={{
                  margin: 0, fontFamily: T.fam, fontSize: 19, fontWeight: 700, color: T.ink,
                  letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.name}</h1>
                {p.verified && (
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: T.gradSoft, color: T.pal.purple,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><IcCheck size={11} stroke={2.4} /></span>
                )}
              </div>
              <div style={{ marginTop: 3 }}><RatingPill T={T} rating={p.rating} jobs={p.jobs} /></div>
              <div style={{
                marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: T.fam, fontSize: 12.5, color: T.inkMute,
              }}>
                <IcPin size={12} /> {p.area}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button T={T} variant="primary" onClick={() => go('book-quick', { providerId: p.id })}
                    rightIcon={<IcArrow size={16} />}>Request service</Button>
            {T.showWA && (
              <button style={{
                width: 48, height: 48, borderRadius: T.r.md, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: T.whatsapp, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 6px 18px ${T.whatsapp}55`,
              }}><IcWhats size={20} /></button>
            )}
          </div>
        </Card>
      </div>

      {/* Trust strip */}
      <div style={{ padding: '16px 18px 0' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
          background: T.border, borderRadius: T.r.md, overflow: 'hidden',
        }}>
          {[
            { v: `${p.years} yrs`, l: 'Experience' },
            { v: `${p.jobs}`, l: 'Jobs done' },
            { v: '98%', l: 'On-time' },
          ].map((s, i) => (
            <div key={i} style={{ background: T.card, padding: '12px 4px', textAlign: 'center' }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.3 }}>{s.v}</div>
              <div style={{ fontFamily: T.fam, fontSize: 11, color: T.inkMute, marginTop: 1 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bio */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>About</SectionLabel>
        <p style={{
          margin: 0, fontFamily: T.fam, fontSize: 14, lineHeight: 1.55,
          color: T.ink, textWrap: 'pretty',
        }}>{p.bio}</p>
      </div>

      {/* Services */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>Services</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {p.cats.map((c) => <Chip key={c} T={T} tone="brand">{c}</Chip>)}
        </div>
      </div>

      {/* Pricing */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>Pricing & terms</SectionLabel>
        <Card T={T} padded={false}>
          {[
            { l: 'Call-out fee', v: `R${p.fee}` },
            { l: 'Hourly rate', v: 'Negotiable' },
            { l: 'After-hours', v: '+30%' },
            { l: 'Quote turnaround', v: '< 1 hour' },
          ].map((r, i, arr) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none',
            }}>
              <span style={{ fontFamily: T.fam, fontSize: 13.5, color: T.inkMute }}>{r.l}</span>
              <span style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink }}>{r.v}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Reviews preview */}
      <div style={{ padding: '20px 18px 28px' }}>
        <SectionLabel T={T} action={<a style={{ color: T.pal.purple, fontFamily: T.fam, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>See all {p.jobs}</a>}>
          Recent reviews
        </SectionLabel>
        {[
          { name: 'Sarah K.', stars: 5, body: 'Arrived on time, fixed the leak in 40 min, tidy. Clear quote upfront.', when: '3d ago' },
          { name: 'Johan P.', stars: 5, body: 'Great communication on WhatsApp throughout. Will book again.', when: '1w ago' },
        ].map((r, i) => (
          <Card T={T} key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar T={T} name={r.name} size={28} />
                <span style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink }}>{r.name}</span>
              </div>
              <span style={{ fontFamily: T.fam, fontSize: 11.5, color: T.inkSoft }}>{r.when}</span>
            </div>
            <div style={{ display: 'flex', gap: 2, marginBottom: 6, color: '#F5B400' }}>
              {Array.from({ length: 5 }).map((_, j) => (
                <IcStar key={j} size={13} color={j < r.stars ? '#F5B400' : T.border} />
              ))}
            </div>
            <p style={{ margin: 0, fontFamily: T.fam, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{r.body}</p>
          </Card>
        ))}
      </div>
    </ScreenScroll>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BOOKINGS LIST
// ─────────────────────────────────────────────────────────────────────────
function ScreenBookings({ T, go, state }) {
  const items = [
    { id: 'b1', title: 'Leaking kitchen tap', cat: 'Plumbing', provider: 'Lovemore Sibanda',
      status: 'En route', tone: 'success', when: 'Today · 14:00', ref: 'PAP-4821' },
    { id: 'b2', title: 'Geyser not heating', cat: 'Geyser', provider: 'Pieter van Wyk',
      status: 'Awaiting quote', tone: 'warn', when: 'Tomorrow', ref: 'PAP-4795' },
    { id: 'b3', title: 'Replace bedroom switch', cat: 'Electrical', provider: 'Nomvula Khumalo',
      status: 'Completed', tone: 'idle', when: 'Last week', ref: 'PAP-4602' },
  ];
  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '58px 18px 12px' }}>
        <h1 style={{ margin: 0, fontFamily: T.fam, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, color: T.ink }}>
          Your bookings
        </h1>
        <div style={{ marginTop: 4, fontFamily: T.fam, fontSize: 13.5, color: T.inkMute }}>
          Active and recent requests
        </div>
      </div>
      <div style={{ padding: '0 14px 0', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {['Active', 'Pending', 'Completed', 'Cancelled'].map((t, i) => (
          <Chip key={t} T={T} active={i === 0}>{t}</Chip>
        ))}
      </div>
      <div style={{ padding: '16px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((b) => (
          <Card T={T} key={b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, letterSpacing: 0.4 }}>{b.ref}</span>
              <Chip T={T} tone={b.tone}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <StatusDot T={T} tone={b.tone} size={6} /> {b.status}
                </span>
              </Chip>
            </div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 16, color: T.ink, letterSpacing: -0.2 }}>
              {b.title}
            </div>
            <div style={{ marginTop: 2, fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
              {b.cat} · {b.when}
            </div>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <Avatar T={T} name={b.provider} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.fam, fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {b.provider}
                </div>
              </div>
              {T.showWA && b.tone !== 'idle' && (
                <button style={{
                  width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'rgba(37,211,102,0.12)', color: T.whatsappDark,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><IcWhats size={16} /></button>
              )}
              <button style={{
                height: 36, padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: T.ink, color: T.card,
                fontFamily: T.fam, fontWeight: 600, fontSize: 12.5,
              }}>View</button>
            </div>
          </Card>
        ))}
      </div>
      <div style={{ padding: '20px 18px' }}>
        <Button T={T} variant="secondary" leftIcon={<IcPlus size={16} />}
                onClick={() => go('book')}>
          Request another service
        </Button>
      </div>
    </ScreenScroll>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ACCOUNT
// ─────────────────────────────────────────────────────────────────────────
function ScreenAccount({ T, go, state, signOut }) {
  if (!state.signedIn) {
    return (
      <ScreenScroll T={T}>
        <div style={{ padding: '58px 18px 12px' }}>
          <h1 style={{ margin: 0, fontFamily: T.fam, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, color: T.ink }}>
            Account
          </h1>
        </div>
        <div style={{ padding: '12px 18px' }}>
          <Card T={T}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', padding: '12px 0',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 20, background: T.gradSoft,
                color: T.pal.purple, display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                <IcUser size={28} />
              </div>
              <h2 style={{ margin: 0, fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.2 }}>
                Sign in to track jobs
              </h2>
              <p style={{ margin: '4px 0 16px', fontFamily: T.fam, fontSize: 13, color: T.inkMute, textAlign: 'center', textWrap: 'pretty' }}>
                See your active requests, message providers, and pay.
              </p>
              <Button T={T} variant="primary" onClick={() => go('signin')}>Sign in</Button>
              <div style={{ marginTop: 10, fontFamily: T.fam, fontSize: 13, color: T.inkMute }}>
                New?{' '}
                <a onClick={() => go('signup')} style={{ color: T.pal.purple, fontWeight: 600, cursor: 'pointer' }}>Create an account</a>
              </div>
            </div>
          </Card>
        </div>
        <div style={{ padding: '8px 18px' }}>
          <SectionLabel T={T}>Other access</SectionLabel>
          <Card T={T} padded={false}>
            <AccountRow T={T} icon={<IcWrench size={18} color={T.pal.purple} />} title="Provider sign in"
                        subtitle="Accept jobs and manage your profile" onClick={() => go('provider-signin')} />
            <AccountRow T={T} icon={<IcShield size={18} color={T.inkMute} />} title="Internal team"
                        subtitle="Admin portal" last onClick={() => go('admin-signin')} />
          </Card>
        </div>
      </ScreenScroll>
    );
  }
  const role = state.role || 'customer';
  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '58px 18px 12px' }}>
        <h1 style={{ margin: 0, fontFamily: T.fam, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, color: T.ink }}>
          Account
        </h1>
      </div>
      <div style={{ padding: '8px 18px' }}>
        <Card T={T} raised>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar T={T} name="Thandi Mahlangu" size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 16, color: T.ink, letterSpacing: -0.2 }}>
                Thandi Mahlangu
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, marginTop: 1 }}>
                +27 82 555 0142 · {role === 'admin' ? 'Admin' : role === 'provider' ? 'Provider' : 'Customer'}
              </div>
            </div>
            <button style={{
              width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: T.cardAlt, color: T.ink,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><IcSettings size={18} /></button>
          </div>
        </Card>
      </div>
      <div style={{ padding: '16px 18px 0' }}>
        <SectionLabel T={T}>Activity</SectionLabel>
        <Card T={T} padded={false}>
          <AccountRow T={T} icon={<IcCal size={18} color={T.pal.purple} />} title="My bookings" subtitle="2 active · 8 completed" onClick={() => go('bookings')} />
          <AccountRow T={T} icon={<IcCard size={18} color={T.pal.blue} />} title="Payments" subtitle="3 saved methods" />
          <AccountRow T={T} icon={<IcStar size={18} color="#F5B400" />} title="Reviews you've left" subtitle="6 reviews" last />
        </Card>
      </div>
      <div style={{ padding: '16px 18px 0' }}>
        <SectionLabel T={T}>Settings</SectionLabel>
        <Card T={T} padded={false}>
          <AccountRow T={T} icon={<IcBell size={18} color={T.pal.pink} />} title="Notifications" subtitle={T.showWA ? 'WhatsApp + Push' : 'Push only'} />
          <AccountRow T={T} icon={<IcPin size={18} color={T.pal.blue} />} title="Saved addresses" subtitle="2 saved" />
          <AccountRow T={T} icon={<IcShield size={18} color={T.inkMute} />} title="Privacy & security" last />
        </Card>
      </div>
      <div style={{ padding: '16px 18px 0' }}>
        <SectionLabel T={T}>Help</SectionLabel>
        <Card T={T} padded={false}>
          <AccountRow T={T} icon={<IcInfo size={18} color={T.inkMute} />} title="System status" onClick={() => go('status')} />
          <AccountRow T={T} icon={<IcCard size={18} color={T.inkMute} />} title="Credit & billing terms" onClick={() => go('credit-terms')} />
          <AccountRow T={T} icon={<IcLogout size={18} color={T.danger} />} title="Sign out" last
                      onClick={signOut} hideChev />
        </Card>
      </div>
    </ScreenScroll>
  );
}

function AccountRow({ T, icon, title, subtitle, onClick, last, hideChev }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
      cursor: onClick ? 'pointer' : 'default',
      boxShadow: last ? 'none' : `inset 0 -1px 0 ${T.border}`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: T.dark ? 'rgba(255,255,255,0.04)' : '#F4F4F7',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.fam, fontWeight: 600, fontSize: 14, color: T.ink, letterSpacing: -0.1 }}>{title}</div>
        {subtitle && <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {!hideChev && <IcChev size={16} color={T.inkSoft} />}
    </div>
  );
}

Object.assign(window, {
  CATEGORIES, PROVIDERS, POPULAR_SUBURBS, providerMatchesArea,
  RatingPill, ProviderAvatar, ProviderCard,
  ScreenHome, ScreenBrowse, ScreenAreaPicker, ScreenProvider,
  ScreenBookings, ScreenAccount, AccountRow,
});
