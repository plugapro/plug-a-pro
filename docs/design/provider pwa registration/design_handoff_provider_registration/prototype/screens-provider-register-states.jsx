// screens-provider-register-states.jsx — Provider PWA registration journey (NEW flow)
// Part B: Verification, Work evidence, Review & submit, Submitted, + 5 returning states.
// Depends on helpers exported by screens-provider-register.jsx (RegStepHeader, RegStepFooter,
// RegNote, RegRadioRow, REG_DEMO) and the shared UI kit (ui.jsx).

// ── Upload slot (camera-first; states: empty / uploaded / failed) ──────────
function RegDocSlot({ T, label, sub, state = 'empty', tall, onClick }) {
  const done = state === 'uploaded';
  const failed = state === 'failed';
  return (
    <button type="button" onClick={onClick} style={{
      width: '100%', height: tall ? 150 : 92, borderRadius: T.r.md, cursor: 'pointer',
      border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      background: done ? T.gradSoft : failed ? (T.dark ? 'rgba(229,72,77,0.10)' : 'rgba(229,72,77,0.06)') : T.card,
      boxShadow: done
        ? `inset 0 0 0 2px ${T.pal.purple}`
        : failed
          ? `inset 0 0 0 1.5px ${T.danger}`
          : `inset 0 0 0 1.5px ${T.borderStrong}`,
      backgroundImage: done || failed ? 'none' : `repeating-linear-gradient(135deg, transparent, transparent 9px, ${T.cardAlt} 9px, ${T.cardAlt} 10px)`,
      flexDirection: tall ? 'column' : 'row',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
        background: done ? T.pal.purple : failed ? T.danger : T.cardAlt,
        color: done || failed ? '#fff' : T.inkMute,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{done ? <IcCheck size={20} /> : failed ? <IcAlert size={20} /> : <IcPlus size={20} />}</div>
      <div style={{ textAlign: tall ? 'center' : 'left' }}>
        <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink }}>
          {done ? `${label} added` : failed ? 'Upload failed' : label}
        </div>
        <div style={{ fontFamily: T.fam, fontSize: 12, color: failed ? T.danger : T.inkMute, marginTop: 2 }}>
          {done ? 'Tap to replace' : failed ? 'Check your signal · Tap to retry' : sub}
        </div>
      </div>
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 5. VERIFICATION — ID + selfie + consent  (trust-critical)
// ═════════════════════════════════════════════════════════════════════════
// Step 6 is a CHOICE, not a submit gate. Repo policy: identity verification is
// REQUIRED before credit top-up / paid leads, but DEFERRABLE during application.
function ScreenRegVerify({ T, go }) {
  const involves = [
    { icon: <IcShield size={17} />, label: 'Your SA ID or passport' },
    { icon: <IcUser size={17} />,   label: 'A quick selfie' },
    { icon: <IcTime size={17} />,   label: 'About 2 minutes' },
  ];
  return (
    <>
      <ScreenScroll T={T} padBottom={168}>
        <RegStepHeader T={T} step={6} title="Verify your identity"
          subtitle="Do it now, or later from your dashboard — your application can still be submitted either way."
          onBack={() => go('reg-availability')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RegNote T={T} tone="warn" icon={<IcAlert size={18} />} title="Required before you can buy credits">
            You can submit your application without it, but you’ll need to verify before buying credits and unlocking paid leads.
          </RegNote>

          <RegNote T={T} tone="brand" icon={<IcShield size={18} />} title="Secure & private">
            We use Plug A Pro’s secure identity check. Your documents are stored privately and only seen by our verification team — never by customers.
          </RegNote>

          <div>
            <SectionLabel T={T}>What’s involved</SectionLabel>
            <Card T={T} padded={false}>
              {involves.map((n, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
                  <div style={{ color: T.pal.purple, display: 'flex' }}>{n.icon}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 500, color: T.ink }}>{n.label}</div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </ScreenScroll>
      {/* Stacked choice footer */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 20px 26px',
        background: T.dark ? 'rgba(11,11,16,0.92)' : 'rgba(246,246,248,0.92)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: `inset 0 1px 0 ${T.border}`, zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button T={T} variant="primary" onClick={() => go('reg-identity')} rightIcon={<IcArrow size={16} color="#fff" />}>Verify now</Button>
        <Button T={T} variant="ghost" onClick={() => go('reg-evidence')}>Verify later</Button>
      </div>
    </>
  );
}

// Identity capture — reuses the EXISTING provider identity-verification flow
// (ProviderIdentityVerification / ProviderIdentityDocument / /provider/verify/[token]).
function ScreenRegIdentity({ T, go }) {
  const [idNum, setIdNum] = React.useState('');
  const [reveal, setReveal] = React.useState(false);
  const [docState, setDocState] = React.useState('uploaded');
  const [selfieState, setSelfieState] = React.useState('failed');
  const [consent, setConsent] = React.useState(false);
  const masked = idNum.length > 4 ? '•'.repeat(idNum.length - 4) + idNum.slice(-4) : idNum;
  const valid = idNum.replace(/\D/g, '').length >= 6 && docState === 'uploaded' && selfieState === 'uploaded' && consent;
  return (
    <>
      <ScreenScroll T={T} padBottom={150}>
        <RegStepHeader T={T} step={6} title="Identity check"
          subtitle="Plug A Pro’s secure identity verification."
          onBack={() => go('reg-verify')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <RegNote T={T} tone="brand" icon={<IcShield size={18} />} title="Why we ask">
            Your ID and selfie are stored securely and only seen by our verification team — never by customers.
          </RegNote>

          <div>
            <FieldLabel T={T}>SA ID number</FieldLabel>
            <Input T={T} value={reveal ? idNum : (idNum && !reveal ? masked : idNum)} onChange={(v) => setIdNum(v.replace(/\D/g, '').slice(0, 13))}
              placeholder="13-digit ID number" inputMode="numeric"
              leftIcon={<IcShield size={18} />}
              rightIcon={
                <button onClick={() => setReveal((r) => !r)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.inkMute, display: 'flex' }}>
                  {reveal ? <IcEyeOff size={18} /> : <IcEye size={18} />}
                </button>
              } />
            <div style={{ fontFamily: T.fam, fontSize: 11.5, color: T.inkMute, marginTop: 6 }}>
              We mask your ID — only the last 4 digits show.
            </div>
          </div>

          <div>
            <FieldLabel T={T}>ID document</FieldLabel>
            <RegDocSlot T={T} label="ID document" sub="Take a photo or upload" state={docState}
              onClick={() => setDocState('uploaded')} />
          </div>

          <div>
            <FieldLabel T={T}>Selfie</FieldLabel>
            <RegDocSlot T={T} label="Selfie" sub="Front camera · good light" state={selfieState} tall
              onClick={() => setSelfieState('uploaded')} />
            {selfieState === 'failed' && (
              <div style={{ marginTop: 8 }}>
                <RegNote T={T} tone="plain" icon={<IcInfo size={16} />}>That photo was hard to read. Tap to retake in good light — or finish this later, your details are saved.</RegNote>
              </div>
            )}
          </div>

          {/* Consent */}
          <button onClick={() => setConsent((c) => !c)} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left',
            border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 0',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 7, flexShrink: 0, marginTop: 1,
              background: consent ? T.pal.purple : 'transparent',
              boxShadow: consent ? 'none' : `inset 0 0 0 2px ${T.borderStrong}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{consent && <IcCheck size={14} color="#fff" />}</div>
            <span style={{ fontFamily: T.fam, fontSize: 12.5, lineHeight: 1.5, color: T.inkMute }}>
              I agree to Plug A Pro verifying my identity and I’ve read the{' '}
              <span style={{ color: T.pal.purple, fontWeight: 600 }}>Privacy Policy</span>.
            </span>
          </button>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Submit verification" primaryDisabled={!valid} onPrimary={() => go('reg-evidence')} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 6. WORK EVIDENCE (optional)
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegEvidence({ T, go }) {
  const [photos, setPhotos] = React.useState([true, true, false]);
  const add = (i) => setPhotos((p) => p.map((v, idx) => idx === i ? true : v));
  return (
    <>
      <ScreenScroll T={T} padBottom={120}>
        <RegStepHeader T={T} step={7} title="Show your work"
          subtitle="Photos and references help you win more jobs once you’re approved. You can add these later."
          onBack={() => go('reg-verify')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px' }}>
          <SectionLabel T={T}>Photos of past work <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(optional)</span></SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {photos.map((filled, i) => (
              <button key={i} onClick={() => add(i)} style={{
                aspectRatio: '1', borderRadius: T.r.md, border: 'none', cursor: 'pointer',
                background: filled ? T.gradSoft : T.card,
                boxShadow: filled ? `inset 0 0 0 2px ${T.pal.purple}` : `inset 0 0 0 1.5px ${T.borderStrong}`,
                backgroundImage: filled ? 'none' : `repeating-linear-gradient(135deg, transparent, transparent 8px, ${T.cardAlt} 8px, ${T.cardAlt} 9px)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: filled ? T.pal.purple : T.inkMute,
              }}>{filled ? <IcBrush size={22} /> : <IcPlus size={22} />}</button>
            ))}
          </div>

          <div style={{ marginTop: 24 }}>
            <SectionLabel T={T}>Certificates <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <RegDocSlot T={T} label="Add certificate" sub="e.g. PIRB, trade qualification" state="empty" />
          </div>

          <div style={{ marginTop: 24 }}>
            <SectionLabel T={T}>References <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <Card T={T} padded={false}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                <Avatar T={T} name="Thabo M" size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink }}>Thabo Mokoena</div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMute }}>+27 83 220 9914</div>
                </div>
                <IcCheck size={18} color={T.success} />
              </div>
              <div style={{ borderTop: `1px solid ${T.border}`, padding: '12px 16px' }}>
                <button style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: T.pal.purple, fontFamily: T.fam, fontSize: 13.5, fontWeight: 600 }}>
                  <IcPlus size={16} /> Add a reference
                </button>
              </div>
            </Card>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T} primary="Continue" secondary="Skip" onSecondary={() => go('reg-review')} onPrimary={() => go('reg-review')} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 7. REVIEW & SUBMIT
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegReview({ T, go }) {
  const [submitting, setSubmitting] = React.useState(false);
  const rows = [
    { label: 'Name', value: REG_DEMO.name, to: 'reg-profile' },
    { label: 'Main trade', value: 'Plumbing · 5–10 years', to: 'reg-category' },
    { label: 'Other services', value: 'Handyman, DIY & Assembly', to: 'reg-category' },
    { label: 'Areas served', value: `${REG_DEMO.areas.length} areas · ${REG_DEMO.radius}km radius`, to: 'reg-area' },
    { label: 'Availability', value: 'Weekdays · Extended hours · R350 call-out', to: 'reg-availability' },
    { label: 'Work evidence', value: '2 photos · 1 reference', to: 'reg-evidence' },
  ];
  const submit = () => { setSubmitting(true); setTimeout(() => go('reg-submitted'), 900); };
  return (
    <>
      <ScreenScroll T={T} padBottom={150}>
        <RegStepHeader T={T} step={8} title="Check your details"
          subtitle="Edit anything before you submit." onBack={() => go('reg-evidence')} onExit={() => go('reg-draft')} />
        <div style={{ padding: '0 20px' }}>
          <Card T={T} padded={false}>
            {rows.map((r, i) => (
              <div key={r.label} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                borderTop: i ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.fam, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.inkMute }}>{r.label}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink, marginTop: 3 }}>{r.value}</div>
                </div>
                <button onClick={() => go(r.to)} style={{
                  border: 'none', background: T.cardAlt, cursor: 'pointer', borderRadius: T.r.sm,
                  padding: '6px 12px', fontFamily: T.fam, fontSize: 12.5, fontWeight: 600, color: T.pal.purple,
                }}>Edit</button>
              </div>
            ))}
          </Card>

          {/* Identity status — deferrable; not a submit gate */}
          <div style={{ marginTop: 12 }}>
            <Card T={T}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: T.dark ? 'rgba(230,153,0,0.16)' : 'rgba(230,153,0,0.1)', color: T.warn, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IcShield size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink }}>Identity not verified yet</div>
                  <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1 }}>Required before buying credits</div>
                </div>
                <button onClick={() => go('reg-identity')} style={{ border: 'none', background: T.cardAlt, cursor: 'pointer', borderRadius: T.r.sm, padding: '6px 12px', fontFamily: T.fam, fontSize: 12.5, fontWeight: 600, color: T.pal.purple }}>Verify</button>
              </div>
            </Card>
          </div>

          <div style={{ marginTop: 16 }}>
            <RegNote T={T} tone="success" icon={<IcInfo size={18} />} title="What happens next">
              Our team reviews your application, we’ll message you on WhatsApp with the result, and once you’re approved you can verify your identity (if you haven’t), top up credits, and start receiving job leads.
            </RegNote>
          </div>
        </div>
      </ScreenScroll>
      <RegStepFooter T={T}
        primary={submitting ? 'Submitting…' : 'Submit application'}
        primaryDisabled={submitting} onPrimary={submit} />
    </>
  );
}

// ── Centered state screen scaffold (submitted / approved / rejected / pending)
function RegStateScreen({ T, tone = 'brand', icon, eyebrow, title, subtitle, children, footer }) {
  const ring = { brand: T.pal.purple, success: T.success, warn: T.warn, danger: T.danger };
  const c = ring[tone] || T.pal.purple;
  return (
    <div style={{ position: 'absolute', inset: 0, background: T.page, display: 'flex', flexDirection: 'column' }}>
      <div aria-hidden style={{
        position: 'absolute', top: -120, left: -80, right: -80, height: 360,
        background: `radial-gradient(60% 80% at 50% 0%, ${c}26, transparent 70%)`, pointerEvents: 'none',
      }} />
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1, padding: '90px 24px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          width: 76, height: 76, borderRadius: 22, margin: '0 auto 22px',
          background: tone === 'brand' ? T.grad : c, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 14px 34px ${c}44`,
        }}>{icon}</div>
        {eyebrow && <div style={{ fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: c, textAlign: 'center', marginBottom: 8 }}>{eyebrow}</div>}
        <h1 style={{ margin: '0 0 10px', textAlign: 'center', fontFamily: T.fam, fontWeight: 700, fontSize: 26, letterSpacing: -0.5, color: T.ink, textWrap: 'balance' }}>{title}</h1>
        {subtitle && <p style={{ margin: '0 auto 22px', maxWidth: 320, textAlign: 'center', fontFamily: T.fam, fontSize: 14.5, lineHeight: 1.5, color: T.inkMute, textWrap: 'pretty' }}>{subtitle}</p>}
        {children}
      </div>
      {footer && <div style={{ padding: '12px 22px 30px', position: 'relative', zIndex: 1 }}>{footer}</div>}
    </div>
  );
}

// ── Status timeline pill row (used in submitted / pending) ──────────────────
function RegTimeline({ T, active = 0 }) {
  const steps = ['Submitted', 'Under review', 'Decision'];
  return (
    <Card T={T} style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((s, i) => {
          const done = i < active, now = i === active;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: done ? T.success : now ? T.pal.purple : T.cardAlt,
                  color: done || now ? '#fff' : T.inkMute,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: now ? `0 0 0 4px ${T.pal.purple}22` : 'none',
                }}>{done ? <IcCheck size={13} /> : <span style={{ fontFamily: T.mono, fontSize: 11 }}>{i + 1}</span>}</div>
                {i < steps.length - 1 && <div style={{ width: 2, height: 18, background: done ? T.success : T.border }} />}
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: now ? 700 : 500, color: now || done ? T.ink : T.inkMute, paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
                {s}{now && <span style={{ color: T.pal.purple, fontWeight: 600 }}> · now</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 8. SUBMITTED / PENDING APPROVAL
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegSubmitted({ T, go }) {
  return (
    <RegStateScreen T={T} tone="brand" icon={<IcCheck size={34} />} eyebrow="Application received"
      title="Thanks, Sipho 👍"
      subtitle="Our team is reviewing your details. We’ll message you on WhatsApp as soon as there’s an update."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="secondary" onClick={() => go('reg-pending')}>View application status</Button>
          <Button T={T} variant="ghost" onClick={() => go('provider-signin')}>Back to sign in</Button>
        </div>
      }>
      <RegTimeline T={T} active={1} />
      <div style={{ marginTop: 16 }}>
        <RegNote T={T} tone="plain" icon={<IcAlert size={18} />} title="You can’t receive leads yet">
          Job leads unlock only after your application is approved — we’ll let you know the moment you’re live.
        </RegNote>
      </div>
      <div style={{ marginTop: 14 }}>
        <RegNote T={T} tone="info" icon={<IcBrush size={18} />} title="While you wait">
          Add photos of your work to strengthen your profile.
        </RegNote>
      </div>
    </RegStateScreen>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 9a. RETURNING — DRAFT INCOMPLETE
// ═════════════════════════════════════════════════════════════════════════
function ScreenRegDraft({ T, go }) {
  return (
    <RegStateScreen T={T} tone="brand" icon={<IcTime size={32} />} eyebrow="Welcome back"
      title="Your application is saved"
      subtitle="Pick up where you left off — nothing is lost."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('reg-verify')} rightIcon={<IcArrow size={16} color="#fff" />}>Continue application</Button>
          <Button T={T} variant="ghost" onClick={() => go('reg-welcome')}>Start over</Button>
        </div>
      }>
      <Card T={T}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontFamily: T.fam, fontSize: 13.5, fontWeight: 700, color: T.ink }}>5 of 8 steps done</span>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.pal.purple }}>63%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: T.cardAlt, overflow: 'hidden' }}>
          <div style={{ width: '63%', height: '100%', background: T.grad }} />
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: T.gradSoft, color: T.pal.purple, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcShield size={17} /></div>
          <div>
            <div style={{ fontFamily: T.fam, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.inkMute }}>Next step</div>
            <div style={{ fontFamily: T.fam, fontSize: 14, fontWeight: 600, color: T.ink }}>Verify your identity</div>
          </div>
        </div>
      </Card>
    </RegStateScreen>
  );
}

// 9b. RETURNING — PENDING REVIEW
function ScreenRegPending({ T, go }) {
  return (
    <RegStateScreen T={T} tone="warn" icon={<IcTime size={32} />} eyebrow="Under review"
      title="We’re reviewing your application"
      subtitle="Most applications are reviewed within 1–2 working days. We’ll message you on WhatsApp with the result."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="secondary" onClick={() => go('reg-evidence')} leftIcon={<IcBrush size={16} color={T.pal.purple} />}>Add work evidence</Button>
          <Button T={T} variant="ghost" onClick={() => go('reg-moreinfo')}>Need help?</Button>
        </div>
      }>
      <RegTimeline T={T} active={1} />
      <div style={{ marginTop: 16 }}>
        <RegNote T={T} tone="plain" icon={<IcAlert size={18} />}>Job leads unlock only after approval. We’ll never charge you credits before you’re live.</RegNote>
      </div>
    </RegStateScreen>
  );
}

// 9c. RETURNING — MORE INFO REQUIRED
function ScreenRegMoreInfo({ T, go }) {
  const items = [
    { icon: <IcShield size={17} />, title: 'Clearer ID photo', sub: 'The number on your ID wasn’t readable.' },
    { icon: <IcUser size={17} />,   title: 'New selfie', sub: 'Take it in good light, facing the camera.' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: T.page, display: 'flex', flexDirection: 'column' }}>
      <RegStepHeader T={T} step={6} title="One more thing"
        subtitle="We just need these updated to finish your review. Everything else is saved."
        onBack={() => go('reg-pending')} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 24px' }}>
        <RegNote T={T} tone="warn" icon={<IcAlert size={18} />} title="Requested by our team">
          Update the items below and resubmit — it usually takes a couple of minutes.
        </RegNote>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it, i) => (
            <Card key={i} T={T}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: T.dark ? 'rgba(230,153,0,0.16)' : 'rgba(230,153,0,0.1)', color: T.warn, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{it.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.fam, fontSize: 14.5, fontWeight: 600, color: T.ink }}>{it.title}</div>
                  <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, marginTop: 1 }}>{it.sub}</div>
                </div>
                <Button T={T} variant="secondary" size="sm" fullWidth={false}>Update</Button>
              </div>
            </Card>
          ))}
        </div>
        {/* Freeform note fallback — admin more-info is stored in `notes`; render it when no itemized fields exist */}
        <div style={{ marginTop: 16 }}>
          <SectionLabel T={T}>Note from the team</SectionLabel>
          <Card T={T}>
            <div style={{ fontFamily: T.fam, fontSize: 13.5, lineHeight: 1.55, color: T.inkMute, fontStyle: 'italic' }}>
              “Thanks for applying. Please re-take your ID photo without glare so we can read the number clearly. Everything else looks good.”
            </div>
          </Card>
        </div>
      </div>
      <RegStepFooter T={T} primary="Resubmit" onPrimary={() => go('reg-pending')} />
    </div>
  );
}

// 9d. RETURNING — APPROVED (identity may still be unverified → credits gated)
function ScreenRegApproved({ T, go }) {
  return (
    <RegStateScreen T={T} tone="success" icon={<IcCheck size={34} />} eyebrow="You’re approved"
      title="Welcome aboard 🎉"
      subtitle="Your application is approved. One last step before you can buy credits and receive paid leads: verify your identity."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('reg-identity')} rightIcon={<IcArrow size={16} color="#fff" />}>Verify identity to unlock credits</Button>
          <Button T={T} variant="ghost" onClick={() => go('provider-home')}>Go to dashboard</Button>
        </div>
      }>
      <Card T={T}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar T={T} name={REG_DEMO.name} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.fam, fontSize: 15, fontWeight: 700, color: T.ink }}>{REG_DEMO.name}</div>
            <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute }}>Plumbing · Soweto +2 areas</div>
          </div>
          <Chip T={T} tone="success" icon={<IcCheck size={14} />}>Approved</Chip>
        </div>
      </Card>
      <div style={{ marginTop: 14 }}>
        <RegNote T={T} tone="warn" icon={<IcLock size={18} />} title="Credits locked">
          Verify your identity to buy credits and unlock paid lead access.
        </RegNote>
      </div>
    </RegStateScreen>
  );
}

// Same-number conflict — repo policy: provider & customer use separate numbers (MVP)
function ScreenRegConflict({ T, go, state = {} }) {
  return (
    <RegStateScreen T={T} tone="warn" icon={<IcInfo size={32} />} eyebrow="This number is in use"
      title="That number is a customer account"
      subtitle="For now, provider and customer profiles need separate mobile numbers. Use a different number to apply as a provider."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('reg-phone')} rightIcon={<IcArrow size={16} color="#fff" />}>Use a different number</Button>
          <Button T={T} variant="secondary" leftIcon={<IcWhats size={16} color={T.whatsappDark} />}>Contact support</Button>
        </div>
      }>
      <RegNote T={T} tone="plain" icon={<IcInfo size={18} />}>
        Same-number multi-role accounts aren’t supported yet. Your customer account stays exactly as it is.
      </RegNote>
    </RegStateScreen>
  );
}

// 9e. RETURNING — NOT APPROVED
function ScreenRegRejected({ T, go }) {
  return (
    <RegStateScreen T={T} tone="danger" icon={<IcInfo size={32} />} eyebrow="Application outcome"
      title="We can’t approve this right now"
      subtitle="We weren’t able to approve your application. If you think this is a mistake, our team can help."
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('reg-welcome')} rightIcon={<IcArrow size={16} color="#fff" />}>Apply again</Button>
          <Button T={T} variant="secondary" leftIcon={<IcWhats size={16} color={T.whatsappDark} />}>Contact support</Button>
        </div>
      }>
      <RegNote T={T} tone="plain" icon={<IcInfo size={18} />}>
        You can contact our team to understand why, or reapply if your situation changes.
      </RegNote>
    </RegStateScreen>
  );
}

Object.assign(window, {
  RegDocSlot, RegStateScreen, RegTimeline,
  ScreenRegVerify, ScreenRegIdentity, ScreenRegEvidence, ScreenRegReview, ScreenRegSubmitted,
  ScreenRegDraft, ScreenRegPending, ScreenRegMoreInfo, ScreenRegApproved, ScreenRegRejected,
  ScreenRegConflict,
});
