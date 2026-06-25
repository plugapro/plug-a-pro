// screens-book.jsx — 4-step book flow

function ScreenBook({ T, go, state }) {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({
    cat: state.cat || 'Plumbing',
    province: 'Gauteng', suburb: '', street: '', unit: '', complex: '',
    title: '', desc: '', urgency: 'soon', photos: 1,
    name: 'Thandi Mahlangu', phone: '+27 82 555 0142',
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const steps = ['Category', 'Address', 'Details', 'Review'];

  return (
    <ScreenScroll T={T}>
      {/* Header */}
      <div style={{ padding: '54px 18px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : go('home')} style={{
            width: 38, height: 38, borderRadius: 12, border: 'none',
            background: T.card, color: T.ink, cursor: 'pointer',
            boxShadow: `inset 0 0 0 1px ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><IcArrowL size={18} /></button>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: 'uppercase', color: T.pal.purple,
            }}>
              Request a service · Step {step + 1} of {steps.length}
            </div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 19, color: T.ink, letterSpacing: -0.3, marginTop: 2 }}>
              {steps[step]}
            </div>
          </div>
        </div>
        <Stepper T={T} total={steps.length} current={step} />
      </div>

      {/* Steps */}
      <div style={{ padding: '20px 18px 0' }}>
        {step === 0 && <BookStepCategory T={T} data={data} set={set} />}
        {step === 1 && <BookStepAddress T={T} data={data} set={set} />}
        {step === 2 && <BookStepDetails T={T} data={data} set={set} />}
        {step === 3 && <BookStepReview T={T} data={data} go={go} />}
      </div>

      {/* Footer CTA */}
      <div style={{ padding: '20px 18px 0' }}>
        {step < steps.length - 1 ? (
          <Button T={T} variant="primary" onClick={() => setStep(s => s + 1)}
                  rightIcon={<IcArrow size={18} />}
                  disabled={step === 1 && (!data.suburb || !data.street)}>
            Continue
          </Button>
        ) : (
          <Button T={T} variant="primary" onClick={() => go('book-submitted', { data })}
                  rightIcon={<IcCheck size={18} />}>
            Submit request
          </Button>
        )}
      </div>
    </ScreenScroll>
  );
}

function BookStepCategory({ T, data, set }) {
  return (
    <div>
      <Card T={T} padded={false} style={{ padding: '12px 14px', marginBottom: 14, background: T.gradSoft, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <IcShield size={18} color={T.pal.purple} />
          <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>
            <b>Your details stay private.</b> We only share your suburb and category until a provider accepts.
          </div>
        </div>
      </Card>
      <SectionLabel T={T}>What do you need help with?</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {CATEGORIES.map((c) => {
          const active = data.cat === c.label;
          return (
            <button key={c.id} onClick={() => set('cat', c.label)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 14px', border: 'none', cursor: 'pointer',
              background: T.card, borderRadius: T.r.md, textAlign: 'left',
              boxShadow: active
                ? `inset 0 0 0 1.5px ${T.pal.purple}, 0 4px 14px ${T.pal.purple}1f`
                : `inset 0 0 0 1px ${T.border}`,
              transition: 'box-shadow .15s',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${c.hue}15`, color: c.hue, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{c.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink, letterSpacing: -0.15 }}>
                  {c.label}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BookStepAddress({ T, data, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card T={T} style={{ background: T.gradSoft, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <IcLock size={18} color={T.pal.purple} />
          <div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink, marginBottom: 2 }}>
              Address privacy
            </div>
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.5 }}>
              Providers see your <b style={{ color: T.ink }}>suburb</b> and province until they accept.
              Full address only unlocks after acceptance.
            </div>
          </div>
        </div>
      </Card>

      <Button T={T} variant="secondary" leftIcon={<IcPin size={16} color={T.pal.purple} />}>
        Use my current location
      </Button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
        <div style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontFamily: T.fam, fontSize: 11, color: T.inkSoft, letterSpacing: 0.6, textTransform: 'uppercase' }}>or enter manually</span>
        <div style={{ flex: 1, height: 1, background: T.border }} />
      </div>

      <div>
        <FieldLabel T={T}>Province</FieldLabel>
        <Input T={T} value={data.province} onChange={(v) => set('province', v)} placeholder="Gauteng"
               rightIcon={<IcChevD size={16} color={T.inkMute} />} />
      </div>
      <div>
        <FieldLabel T={T}>Suburb</FieldLabel>
        <Input T={T} value={data.suburb} onChange={(v) => set('suburb', v)} placeholder="e.g. Allen's Nek" />
      </div>
      <div>
        <FieldLabel T={T}>Street address</FieldLabel>
        <Input T={T} value={data.street} onChange={(v) => set('street', v)} placeholder="12 Main Road" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <FieldLabel T={T} hint="Optional">Unit</FieldLabel>
          <Input T={T} value={data.unit} onChange={(v) => set('unit', v)} placeholder="12B" />
        </div>
        <div>
          <FieldLabel T={T} hint="Optional">Complex</FieldLabel>
          <Input T={T} value={data.complex} onChange={(v) => set('complex', v)} placeholder="Acacia Mews" />
        </div>
      </div>
    </div>
  );
}

function BookStepDetails({ T, data, set }) {
  const URGENCIES = [
    { id: 'now',     label: 'Emergency', sub: 'ASAP · Today', hue: T.danger, icon: <IcZap size={16} /> },
    { id: 'soon',    label: 'Soon',      sub: 'Within 48 hrs', hue: T.warn,  icon: <IcTime size={16} /> },
    { id: 'flex',    label: 'Flexible',  sub: 'This week',     hue: T.success, icon: <IcCal size={16} /> },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <FieldLabel T={T}>Job title</FieldLabel>
        <Input T={T} value={data.title} onChange={(v) => set('title', v)}
               placeholder="e.g. Kitchen tap won't stop dripping" />
      </div>
      <div>
        <FieldLabel T={T} hint={`${(data.desc || '').length}/280`}>
          Describe what you need
        </FieldLabel>
        <div style={{
          background: T.card, borderRadius: T.r.md,
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          padding: '12px 14px',
        }}>
          <textarea value={data.desc} onChange={(e) => set('desc', e.target.value.slice(0, 280))}
                    placeholder="Started last night. Mixer tap in the kitchen, hot water side. Have tried tightening the handle. Need a plumber to replace the cartridge…"
                    style={{
                      width: '100%', minHeight: 100, resize: 'vertical',
                      border: 'none', outline: 'none', background: 'transparent',
                      fontFamily: T.fam, fontSize: 14, lineHeight: 1.5, color: T.ink,
                    }} />
        </div>
      </div>
      <div>
        <FieldLabel T={T}>Urgency</FieldLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {URGENCIES.map((u) => {
            const active = data.urgency === u.id;
            return (
              <button key={u.id} onClick={() => set('urgency', u.id)} style={{
                padding: '12px 8px', border: 'none', cursor: 'pointer',
                background: T.card, borderRadius: T.r.md, textAlign: 'left',
                boxShadow: active
                  ? `inset 0 0 0 1.5px ${u.hue}, 0 4px 14px ${u.hue}1f`
                  : `inset 0 0 0 1px ${T.border}`,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: `${u.hue}15`, color: u.hue,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{u.icon}</div>
                <div>
                  <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13, color: T.ink, letterSpacing: -0.1 }}>
                    {u.label}
                  </div>
                  <div style={{ fontFamily: T.fam, fontSize: 11, color: T.inkMute, marginTop: 1 }}>
                    {u.sub}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <FieldLabel T={T} hint="Optional · helps providers quote">Photos</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{
              flex: 1, aspectRatio: '1', borderRadius: T.r.md,
              background: i < data.photos ? `linear-gradient(135deg, ${T.pal.start}, ${T.pal.end})` : T.card,
              boxShadow: i < data.photos ? 'none' : `inset 0 0 0 1.5px ${T.border}`,
              backgroundImage: i < data.photos
                ? `linear-gradient(135deg, ${T.pal.start}55, ${T.pal.end}55), repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 4px, transparent 4px 12px)`
                : `repeating-linear-gradient(45deg, ${T.border} 0 2px, transparent 2px 10px)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: i < data.photos ? '#fff' : T.inkSoft,
            }} onClick={() => set('photos', data.photos === 3 ? 0 : data.photos + 1)}>
              {i < data.photos ? <IcCheck size={20} /> : <IcPlus size={20} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BookStepReview({ T, data, go }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card T={T}>
        <SectionLabel T={T}>Service</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {(() => {
            const c = CATEGORIES.find(x => x.label === data.cat) || CATEGORIES[0];
            return (
              <>
                <div style={{
                  width: 38, height: 38, borderRadius: 11,
                  background: `${c.hue}18`, color: c.hue,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{c.icon}</div>
                <div>
                  <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2 }}>{c.label}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
                    Urgency: {data.urgency === 'now' ? 'Emergency · Today' : data.urgency === 'soon' ? 'Within 48 hours' : 'This week'}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </Card>
      <Card T={T}>
        <SectionLabel T={T}>Address (suburb shared)</SectionLabel>
        <div style={{ fontFamily: T.fam, fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
          {data.street ? <>{data.street}<br /></> : null}
          {data.complex ? <>{data.complex}{data.unit ? `, Unit ${data.unit}` : ''}<br /></> : null}
          <b>{data.suburb || 'Suburb not set'}</b>, {data.province}
        </div>
        <div style={{ marginTop: 8, fontFamily: T.fam, fontSize: 12, color: T.inkMute, lineHeight: 1.5 }}>
          <IcLock size={11} /> Full address shown to provider only after acceptance.
        </div>
      </Card>
      <Card T={T}>
        <SectionLabel T={T}>Details</SectionLabel>
        <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, marginBottom: 4 }}>
          {data.title || '(no title given)'}
        </div>
        <div style={{ fontFamily: T.fam, fontSize: 13.5, color: T.inkMute, lineHeight: 1.55 }}>
          {data.desc || 'No description.'}
        </div>
      </Card>
      <Card T={T}>
        <SectionLabel T={T}>You'll be contacted on</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar T={T} name={data.name} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink }}>{data.name}</div>
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>{data.phone}</div>
          </div>
          {T.showWA && <Chip T={T} tone="whatsapp"><IcWhats size={11} /> WhatsApp</Chip>}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Submitted confirmation
// ─────────────────────────────────────────────────────────────────────────
function ScreenBookSubmitted({ T, go }) {
  return (
    <ScreenScroll T={T} padBottom={20}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(60% 50% at 50% 30%, ${T.pal.purple}22, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'relative', padding: '60px 22px 30px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          width: 120, height: 120, borderRadius: 36,
          background: T.gradSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 22,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: 24, background: T.grad,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', boxShadow: `0 12px 32px ${T.pal.purple}66`,
          }}>
            <IcCheck size={42} stroke={2.4} />
          </div>
        </div>
        <h1 style={{
          margin: 0, fontFamily: T.fam, fontWeight: 700, fontSize: 26,
          color: T.ink, letterSpacing: -0.5, textAlign: 'center',
        }}>Request received</h1>
        <p style={{
          margin: '8px 0 22px', fontFamily: T.fam, fontSize: 14.5, color: T.inkMute,
          textAlign: 'center', lineHeight: 1.55, textWrap: 'pretty', maxWidth: 320,
        }}>
          We're matching qualified providers in your area now. You'll get a notification when the first one responds.
        </p>
        <Card T={T} style={{ width: '100%', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: T.gradSoft, color: T.pal.purple,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><IcSpark size={20} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink }}>Reference</div>
              <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkMute, letterSpacing: 0.5, marginTop: 1 }}>PAP-4822</div>
            </div>
            <Chip T={T} tone="warn">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <StatusDot T={T} tone="warn" size={6} /> Matching
              </span>
            </Chip>
          </div>
        </Card>
        {T.showWA && (
          <Card T={T} style={{ width: '100%', marginBottom: 18, background: 'rgba(37,211,102,0.06)', boxShadow: 'inset 0 0 0 1px rgba(37,211,102,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: T.whatsapp, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><IcWhats size={20} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink }}>Updates on WhatsApp</div>
                <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>Live status, quotes & messages.</div>
              </div>
              <IcCheck size={18} color={T.whatsappDark} />
            </div>
          </Card>
        )}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('bookings')}>
            Track this request
          </Button>
          <Button T={T} variant="ghost" onClick={() => go('home')}>
            Back to home
          </Button>
        </div>
      </div>
    </ScreenScroll>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BOOK QUICK — 2-step flow when coming from a provider profile.
// Provider + category + area are pre-set; we only collect details + street.
// ─────────────────────────────────────────────────────────────────────────
function ScreenBookQuick({ T, go, state }) {
  const provider = PROVIDERS.find(p => p.id === state.providerId) || PROVIDERS[0];
  const defaultCat = provider.cats[0];
  const area = state.area || "Sandton, Sandhurst";

  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({
    cat: state.cat || defaultCat,
    title: '',
    desc: '',
    urgency: 'soon',
    photos: 0,
    street: '', unit: '', complex: '',
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const steps = ['Tell us about it', 'Review'];
  const canContinue = step === 0 ? data.title.trim().length > 0 && data.desc.trim().length > 0 : true;

  return (
    <ScreenScroll T={T}>
      {/* Header */}
      <div style={{ padding: '54px 18px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : go('provider', { id: provider.id })}
                  style={{
                    width: 38, height: 38, borderRadius: 12, border: 'none',
                    background: T.card, color: T.ink, cursor: 'pointer',
                    boxShadow: `inset 0 0 0 1px ${T.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><IcArrowL size={18} /></button>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: 'uppercase', color: T.pal.purple,
            }}>
              Request · Step {step + 1} of {steps.length}
            </div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 19, color: T.ink, letterSpacing: -0.3, marginTop: 2 }}>
              {steps[step]}
            </div>
          </div>
        </div>
        <Stepper T={T} total={steps.length} current={step} />
      </div>

      {/* Provider context strip */}
      <div style={{ padding: '14px 18px 0' }}>
        <Card T={T} style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProviderAvatar T={T} p={provider} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  fontFamily: T.fam, fontWeight: 700, fontSize: 14.5, color: T.ink,
                  letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{provider.name}</div>
                {provider.verified && (
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: T.gradSoft, color: T.pal.purple,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}><IcCheck size={10} stroke={2.4} /></span>
                )}
              </div>
              <div style={{ marginTop: 1 }}>
                <RatingPill T={T} rating={provider.rating} jobs={provider.jobs} />
              </div>
            </div>
            <Chip T={T} tone={provider.available ? 'success' : 'warn'}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: provider.available ? T.success : T.warn,
                }} />
                {provider.available ? 'Available' : 'Busy'}
              </span>
            </Chip>
          </div>
        </Card>
      </div>

      {/* Step body */}
      <div style={{ padding: '16px 18px 0' }}>
        {step === 0 ? (
          <BookQuickDetails T={T} data={data} set={set} area={area} />
        ) : (
          <BookQuickReview T={T} data={data} provider={provider} area={area} />
        )}
      </div>

      {/* Footer CTA */}
      <div style={{ padding: '20px 18px 0' }}>
        {step === 0 ? (
          <Button T={T} variant="primary" onClick={() => setStep(1)} disabled={!canContinue}
                  rightIcon={<IcArrow size={18} />}>
            Review request
          </Button>
        ) : (
          <Button T={T} variant="primary" onClick={() => go('book-submitted', { data: { ...data, provider: provider.name } })}
                  rightIcon={<IcCheck size={18} />}>
            Send to {provider.name.split(' ')[0]}
          </Button>
        )}
        {step === 0 && (
          <div style={{ marginTop: 10, fontFamily: T.fam, fontSize: 11.5, color: T.inkSoft, textAlign: 'center', lineHeight: 1.5 }}>
            <IcLock size={11} /> Your exact address is only shared once {provider.name.split(' ')[0]} accepts.
          </div>
        )}
      </div>
    </ScreenScroll>
  );
}

function BookQuickDetails({ T, data, set, area }) {
  const URGENCIES = [
    { id: 'now',  label: 'Today',     hue: T.danger,  icon: <IcZap size={14} /> },
    { id: 'soon', label: 'Within 48h',hue: T.warn,    icon: <IcTime size={14} /> },
    { id: 'flex', label: 'This week', hue: T.success, icon: <IcCal size={14} /> },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <FieldLabel T={T}>What's the job?</FieldLabel>
        <Input T={T} value={data.title} onChange={(v) => set('title', v)}
               placeholder="e.g. Kitchen tap won't stop dripping" />
      </div>
      <div>
        <FieldLabel T={T} hint={`${(data.desc || '').length}/280`}>
          A bit more detail
        </FieldLabel>
        <div style={{
          background: T.card, borderRadius: T.r.md,
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          padding: '12px 14px',
        }}>
          <textarea value={data.desc} onChange={(e) => set('desc', e.target.value.slice(0, 280))}
                    placeholder="Started last night. Mixer tap, hot side. Tried tightening the handle. Probably need the cartridge replaced."
                    style={{
                      width: '100%', minHeight: 86, resize: 'vertical',
                      border: 'none', outline: 'none', background: 'transparent',
                      fontFamily: T.fam, fontSize: 14, lineHeight: 1.5, color: T.ink,
                    }} />
        </div>
      </div>
      <div>
        <FieldLabel T={T}>When?</FieldLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {URGENCIES.map((u) => {
            const active = data.urgency === u.id;
            return (
              <button key={u.id} onClick={() => set('urgency', u.id)} style={{
                padding: '10px 8px', border: 'none', cursor: 'pointer',
                background: T.card, borderRadius: T.r.md,
                boxShadow: active
                  ? `inset 0 0 0 1.5px ${u.hue}, 0 4px 14px ${u.hue}1f`
                  : `inset 0 0 0 1px ${T.border}`,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 7,
                  background: `${u.hue}15`, color: u.hue,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{u.icon}</div>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 12.5, color: T.ink, letterSpacing: -0.1 }}>
                  {u.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <FieldLabel T={T} hint="Optional">Photos</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} onClick={() => set('photos', data.photos === 3 ? 0 : data.photos + 1)} style={{
              flex: 1, aspectRatio: '1', borderRadius: T.r.md, cursor: 'pointer',
              background: i < data.photos ? `linear-gradient(135deg, ${T.pal.start}, ${T.pal.end})` : T.card,
              boxShadow: i < data.photos ? 'none' : `inset 0 0 0 1.5px ${T.border}`,
              backgroundImage: i < data.photos
                ? `linear-gradient(135deg, ${T.pal.start}55, ${T.pal.end}55), repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 4px, transparent 4px 12px)`
                : `repeating-linear-gradient(45deg, ${T.border} 0 2px, transparent 2px 10px)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: i < data.photos ? '#fff' : T.inkSoft,
            }}>
              {i < data.photos ? <IcCheck size={18} /> : <IcPlus size={18} />}
            </div>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel T={T}>Address</FieldLabel>
        <Card T={T} style={{ background: T.gradSoft, boxShadow: 'none', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IcPin size={16} color={T.pal.purple} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink, letterSpacing: -0.15 }}>
                {area}
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 11.5, color: T.inkMute, marginTop: 1 }}>
                Suburb — visible to provider
              </div>
            </div>
          </div>
        </Card>
        <Input T={T} value={data.street} onChange={(v) => set('street', v)} placeholder="Street address (shared after acceptance)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <Input T={T} value={data.unit} onChange={(v) => set('unit', v)} placeholder="Unit (opt.)" />
          <Input T={T} value={data.complex} onChange={(v) => set('complex', v)} placeholder="Complex (opt.)" />
        </div>
      </div>
    </div>
  );
}

function BookQuickReview({ T, data, provider, area }) {
  const u = data.urgency === 'now' ? 'Today / ASAP' : data.urgency === 'soon' ? 'Within 48 hours' : 'This week';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card T={T}>
        <SectionLabel T={T}>Going to</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ProviderAvatar T={T} p={provider} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2 }}>{provider.name}</div>
            <div style={{ marginTop: 2, fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>
              {provider.cats.join(' · ')}
            </div>
          </div>
        </div>
      </Card>
      <Card T={T}>
        <SectionLabel T={T}>Job</SectionLabel>
        <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, marginBottom: 4 }}>
          {data.title || '(no title given)'}
        </div>
        <div style={{ fontFamily: T.fam, fontSize: 13.5, color: T.inkMute, lineHeight: 1.55, marginBottom: 10 }}>
          {data.desc || 'No description.'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Chip T={T} tone="brand">{data.cat}</Chip>
          <Chip T={T} tone={data.urgency === 'now' ? 'danger' : data.urgency === 'soon' ? 'warn' : 'success'}>
            {u}
          </Chip>
          {data.photos > 0 && <Chip T={T} tone="neutral">{data.photos} photo{data.photos > 1 ? 's' : ''}</Chip>}
        </div>
      </Card>
      <Card T={T}>
        <SectionLabel T={T}>Location</SectionLabel>
        <div style={{ fontFamily: T.fam, fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
          {data.street && <>{data.street}<br /></>}
          {data.complex && <>{data.complex}{data.unit ? `, Unit ${data.unit}` : ''}<br /></>}
          <b>{area}</b>
        </div>
        <div style={{ marginTop: 8, fontFamily: T.fam, fontSize: 12, color: T.inkMute, lineHeight: 1.5 }}>
          <IcLock size={11} /> Full address shown to {provider.name.split(' ')[0]} only after acceptance.
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, {
  ScreenBook, ScreenBookSubmitted, ScreenBookQuick,
  BookStepCategory, BookStepAddress, BookStepDetails, BookStepReview,
  BookQuickDetails, BookQuickReview,
});
