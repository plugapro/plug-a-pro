// screens-misc.jsx — Provider home, Admin home, Status, Credit terms

// ─────────────────────────────────────────────────────────────────────────
// PROVIDER HOME (dashboard)
// ─────────────────────────────────────────────────────────────────────────
function ScreenProviderHome({ T, go, signOut }) {
  const leads = [
  { id: 'l1', title: 'Leaking kitchen tap', cat: 'Plumbing', suburb: "Allen's Nek", credits: 1, time: '8 min ago', urgency: 'soon' },
  { id: 'l2', title: 'Bathroom geyser not heating', cat: 'Geyser', suburb: 'Roodepoort', credits: 2, time: '24 min ago', urgency: 'now' },
  { id: 'l3', title: 'Replace light fixture', cat: 'Electrical', suburb: 'Florida Park', credits: 1, time: '1 hr ago', urgency: 'flex' }];

  return (
    <ScreenScroll T={T}>
      {/* Header */}
      <div style={{ padding: '54px 18px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={30} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.pal.purple }}>
            Provider portal
          </div>
          <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.2 }}>
            Hi Lovemore
          </div>
        </div>
        <button onClick={signOut} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><IcLogout size={18} /></button>
      </div>

      {/* Credits + status */}
      <div style={{ padding: '12px 18px 0' }}>
        <div style={{
          position: 'relative', overflow: 'hidden',
          background: T.ink, color: T.card,
          borderRadius: T.r.lg, padding: '20px 20px'
        }}>
          <div aria-hidden style={{
            position: 'absolute', right: -40, top: -40, width: 200, height: 200,
            background: T.grad, opacity: 0.35, filter: 'blur(40px)', borderRadius: '50%'
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.fam, fontSize: 12, fontWeight: 600, opacity: 0.7 }}>
              <IcSpark size={14} /> Credits balance
            </div>
            <div style={{
              fontFamily: T.fam, fontWeight: 700, fontSize: 38, letterSpacing: -1, marginTop: 6,
              display: 'flex', alignItems: 'baseline', gap: 6
            }}>
              48
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.65 }}>credits · R2,400</span>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button style={{
                flex: 1, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: '#fff', color: '#0A0A0F',
                fontFamily: T.fam, fontWeight: 700, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
              }}><IcPlus size={14} /> Top up</button>
              <button onClick={() => go('credit-terms')} style={{
                height: 38, padding: '0 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.12)', color: '#fff',
                fontFamily: T.fam, fontWeight: 600, fontSize: 13
              }}>Terms</button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ padding: '12px 18px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
        { v: '3', l: 'Active jobs', tone: T.pal.purple },
        { v: '12', l: 'This month', tone: T.pal.blue },
        { v: '4.9★', l: 'Rating', tone: '#F5B400' }].
        map((s, i) =>
        <Card T={T} key={i} style={{ padding: 14 }}>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 22, color: T.ink, letterSpacing: -0.5 }}>{s.v}</div>
            <div style={{ fontFamily: T.fam, fontSize: 11.5, color: T.inkMute, marginTop: 2 }}>{s.l}</div>
          </Card>
        )}
      </div>

      {/* Availability toggle */}
      <div style={{ padding: '14px 18px 0' }}>
        <Card T={T} padded={false} style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot T={T} tone="success" size={10} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink }}>You're available now</div>
              <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, marginTop: 1 }}>
                Receiving matched leads in your service areas.
              </div>
            </div>
            <div style={{
              width: 42, height: 24, borderRadius: 999, background: T.success,
              position: 'relative', cursor: 'pointer'
            }}>
              <div style={{
                position: 'absolute', top: 2, right: 2, width: 20, height: 20,
                background: '#fff', borderRadius: '50%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }} />
            </div>
          </div>
        </Card>
      </div>

      {/* New leads */}
      <div style={{ padding: '18px 18px 0' }}>
        <SectionLabel T={T} action={
        <a style={{ color: T.pal.purple, fontFamily: T.fam, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>See all 7</a>
        }>New leads</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {leads.map((l) => {
            const tone = l.urgency === 'now' ? 'danger' : l.urgency === 'soon' ? 'warn' : 'success';
            const tlabel = l.urgency === 'now' ? 'Emergency' : l.urgency === 'soon' ? '< 48 hrs' : 'Flexible';
            return (
              <Card T={T} key={l.id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2 }}>
                      {l.title}
                    </div>
                    <div style={{
                      marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8,
                      fontFamily: T.fam, fontSize: 12, color: T.inkMute
                    }}>
                      <span>{l.cat}</span>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: T.inkSoft }} />
                      <IcPin size={11} /> {l.suburb}
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: T.inkSoft }} />
                      <span>{l.time}</span>
                    </div>
                  </div>
                  <Chip T={T} tone={tone}>{tlabel}</Chip>
                </div>
                <div style={{
                  marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', gap: 10
                }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: T.fam, fontSize: 12.5, color: T.inkMute
                  }}>
                    <IcSpark size={14} color={T.pal.purple} />
                    <span>Lead unlock: <b style={{ color: T.ink }}>{l.credits} credit{l.credits > 1 ? 's' : ''}</b></span>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button style={{
                    height: 36, padding: '0 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: T.cardAlt, color: T.ink,
                    fontFamily: T.fam, fontWeight: 600, fontSize: 12.5
                  }}>Decline</button>
                  <button style={{
                    height: 36, padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: T.grad, color: '#fff',
                    fontFamily: T.fam, fontWeight: 700, fontSize: 12.5,
                    display: 'flex', alignItems: 'center', gap: 4
                  }}>
                    Accept <IcCheck size={13} stroke={2.4} />
                  </button>
                </div>
              </Card>);

          })}
        </div>
      </div>

      <div style={{ padding: '18px 18px 0' }}>
        <SectionLabel T={T}>In progress</SectionLabel>
        <Card T={T}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar T={T} name="Sarah K." size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink }}>Drain unblock</div>
              <div style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute }}>Sarah K. · Today 14:00 · Allen's Nek</div>
            </div>
            <Chip T={T} tone="success">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <StatusDot T={T} tone="success" size={6} /> En route
              </span>
            </Chip>
          </div>
        </Card>
      </div>

      <div style={{ height: 30 }} />
    </ScreenScroll>);

}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN HOME
// ─────────────────────────────────────────────────────────────────────────
function ScreenAdminHome({ T, go, signOut }) {
  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '54px 18px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={30} />
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: T.fam, fontSize: 11, fontWeight: 700,
            letterSpacing: 1, textTransform: 'uppercase', color: T.warn
          }}>
            <IcShield size={11} /> Admin · internal
          </div>
          <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.2 }}>
            Operations
          </div>
        </div>
        <button onClick={signOut} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><IcLogout size={18} /></button>
      </div>

      <div style={{ padding: '8px 18px 0', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {[
        { v: '142', l: 'Open requests', tone: T.pal.purple, sub: '+12 today' },
        { v: '38', l: 'Active providers', tone: T.pal.blue, sub: '2 new' },
        { v: '4', l: 'Disputes', tone: T.warn, sub: '1 SLA risk' },
        { v: '98.4%', l: 'SLA met', tone: T.success, sub: 'Last 7d' }].
        map((s, i) =>
        <Card T={T} key={i}>
            <div style={{ fontFamily: T.fam, fontSize: 11, color: T.inkMute, fontWeight: 600 }}>{s.l}</div>
            <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 24, color: T.ink, letterSpacing: -0.5, marginTop: 2 }}>{s.v}</div>
            <div style={{ fontFamily: T.fam, fontSize: 11, color: s.tone, marginTop: 1 }}>{s.sub}</div>
          </Card>
        )}
      </div>

      <div style={{ padding: '18px 18px 0' }}>
        <SectionLabel T={T}>Queue · Needs attention</SectionLabel>
        <Card T={T} padded={false}>
          {[
          { ref: 'PAP-4821', title: 'No provider in area', when: '6m', tone: 'warn' },
          { ref: 'PAP-4815', title: 'Dispute opened', when: '22m', tone: 'danger' },
          { ref: 'PAP-4809', title: 'Refund requested', when: '1h', tone: 'warn' },
          { ref: 'PAP-4801', title: 'Provider verification', when: '2h', tone: 'success' }].
          map((r, i, arr) =>
          <div key={r.ref} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
            boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none',
            cursor: 'pointer'
          }}>
              <StatusDot T={T} tone={r.tone} size={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink }}>{r.title}</div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, marginTop: 1 }}>{r.ref} · {r.when}</div>
              </div>
              <IcChev size={16} color={T.inkSoft} />
            </div>
          )}
        </Card>
      </div>

      <div style={{ padding: '18px 18px 0' }}>
        <SectionLabel T={T} action={<a onClick={() => go('status')} style={{ color: T.pal.purple, fontFamily: T.fam, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Full status</a>}>
          Systems
        </SectionLabel>
        <Card T={T} padded={false}>
          {[
          { l: 'API', v: 'Running', tone: 'success' },
          { l: 'Database', v: 'Running', tone: 'success' },
          { l: 'WhatsApp Cloud', v: 'Degraded · queueing', tone: 'warn' },
          { l: 'Payments', v: 'Running', tone: 'success' }].
          map((s, i, arr) =>
          <div key={s.l} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none'
          }}>
              <span style={{ fontFamily: T.fam, fontWeight: 600, fontSize: 13.5, color: T.ink }}>{s.l}</span>
              <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: T.fam, fontSize: 12, color: T.inkMute
            }}>
                <StatusDot T={T} tone={s.tone} size={6} />
                {s.v}
              </span>
            </div>
          )}
        </Card>
      </div>
      <div style={{ height: 30 }} />
    </ScreenScroll>);

}

// ─────────────────────────────────────────────────────────────────────────
// SERVICE STATUS PAGE
// ─────────────────────────────────────────────────────────────────────────
function ScreenStatus({ T, go }) {
  const [reflectIn, setReflectIn] = React.useState(28);
  React.useEffect(() => {
    const t = setInterval(() => setReflectIn((s) => s > 0 ? s - 1 : 30), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <ScreenScroll T={T}>
      {/* Header */}
      <div style={{ padding: '54px 18px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => go('home')} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><IcArrowL size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.inkMute
          }}>Plug A Pro · Service status</div>
          <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 17, color: T.ink, letterSpacing: -0.2 }}>System health</div>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 11px',
          borderRadius: 999, background: T.cardAlt, color: T.inkMute,
          fontFamily: T.mono, fontSize: 11, fontWeight: 600
        }}>
          <IcRefresh size={12} /> {reflectIn}s
        </div>
      </div>

      {/* Overall status banner */}
      <div style={{ padding: '6px 18px 0' }}>
        <div style={{
          position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(15,157,88,0.10), rgba(15,157,88,0.04))',
          border: `1px solid rgba(15,157,88,0.25)`,
          borderRadius: T.r.lg, padding: 18
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot T={T} tone="success" size={14} />
            <span style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 18, color: T.ink, letterSpacing: -0.3 }}>
              All systems operational
            </span>
          </div>
          <div style={{ marginTop: 6, fontFamily: T.fam, fontSize: 13, color: T.inkMute, lineHeight: 1.5 }}>
            All core services are running. Last checked Thu, 14 May · 10:10.
          </div>
        </div>
      </div>

      {/* Journey grid */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>Journey health</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[
          { icon: <IcUser size={16} />, label: 'Customer', tone: 'success' },
          { icon: <IcWrench size={16} />, label: 'Provider', tone: 'success' },
          { icon: <IcCard size={16} />, label: 'Payments', tone: 'success' },
          { icon: <IcWhats size={16} />, label: 'WhatsApp', tone: 'warn' }].
          map((j) =>
          <Card T={T} key={j.label}>
              <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6
            }}>
                <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: T.gradSoft, color: T.pal.purple,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>{j.icon}</div>
                <span style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13, color: T.ink }}>{j.label}</span>
              </div>
              <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: T.fam, fontSize: 11.5, color: T.inkMute
            }}>
                <StatusDot T={T} tone={j.tone} size={6} />
                {j.tone === 'success' ? 'Operational' : 'Degraded'}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Notice */}
      <div style={{ padding: '20px 18px 0' }}>
        <Card T={T} style={{
          background: 'rgba(230,153,0,0.08)',
          boxShadow: 'inset 0 0 0 1px rgba(230,153,0,0.25)'
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <IcAlert size={18} color={T.warn} />
            <div>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 13.5, color: T.ink, marginBottom: 4 }}>
                WhatsApp delivery delays
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.5 }}>
                We're seeing slower than usual delivery of WhatsApp messages from upstream. Messages will queue and deliver — no action needed from you.
              </div>
              <div style={{ marginTop: 6, fontFamily: T.mono, fontSize: 11, color: T.inkSoft }}>
                Updated 10:08 · 26 min ago
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Components */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>Components</SectionLabel>
        <Card T={T} padded={false}>
          {[
          { l: 'API · /v1', v: 'Running', tone: 'success' },
          { l: 'Database · primary', v: 'Running', tone: 'success' },
          { l: 'Database · read replicas', v: 'Running', tone: 'success' },
          { l: 'Job dispatcher', v: 'Running', tone: 'success' },
          { l: 'WhatsApp Cloud API', v: 'Degraded', tone: 'warn' },
          { l: 'Payfast · checkout', v: 'Running', tone: 'success' },
          { l: 'SMS fallback', v: 'Running', tone: 'success' },
          { l: 'Email · transactional', v: 'Running', tone: 'success' }].
          map((s, i, arr) =>
          <div key={s.l} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '13px 16px',
            boxShadow: i < arr.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none'
          }}>
              <span style={{ fontFamily: T.fam, fontWeight: 500, fontSize: 13.5, color: T.ink }}>{s.l}</span>
              <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: T.fam, fontSize: 12, fontWeight: 600,
              color: s.tone === 'success' ? T.success : s.tone === 'warn' ? T.warn : T.danger
            }}>
                <StatusDot T={T} tone={s.tone} size={6} />
                {s.v}
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* 30-day uptime sparkline */}
      <div style={{ padding: '20px 18px 0' }}>
        <SectionLabel T={T}>Last 30 days uptime</SectionLabel>
        <Card T={T}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 22, color: T.ink, letterSpacing: -0.4 }}>99.92%</span>
            <span style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute }}>2 incidents · 0 sev-1</span>
          </div>
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 36 }}>
            {Array.from({ length: 30 }).map((_, i) => {
              const bad = i === 12 || i === 22;
              return (
                <div key={i} style={{
                  flex: 1, height: bad ? 18 : 30,
                  borderRadius: 2,
                  background: bad ? T.warn : T.success,
                  opacity: bad ? 0.9 : 0.85
                }} />);

            })}
          </div>
        </Card>
      </div>
      <div style={{ padding: '24px 18px 18px', fontFamily: T.fam, fontSize: 11.5, color: T.inkSoft, textAlign: 'center', lineHeight: 1.5 }}>
        Public visibility only · No customer or provider data is shown.
      </div>
    </ScreenScroll>);

}

// ─────────────────────────────────────────────────────────────────────────
// CREDIT TERMS
// ─────────────────────────────────────────────────────────────────────────
function ScreenCreditTerms({ T, go }) {
  const sections = [
  { t: 'What provider credits are',
    b: 'Plug A Pro credits are prepaid platform units used by approved providers to accept customer-selected jobs. 1 credit = R50. Credits are not cash, loans, or financial credit.' },
  { t: 'Onboarding credits',
    b: 'If your provider application is approved, we may award starter credits to help you begin accepting jobs. These appear in your balance separately from purchased credits.' },
  { t: 'Accepting a job',
    b: 'Each customer-selected job you accept uses 1 credit. The credit is deducted only when final acceptance succeeds. Full customer contact details and address unlock only after acceptance.' },
  { t: 'Preview, interest, expiry',
    b: 'Previewing a job, showing interest, being shortlisted, customer selection before final acceptance, declining, and expiry do not use credits.' },
  { t: 'Insufficient credits',
    b: 'If your balance is too low, paid matched leads are paused until you top up or receive additional credits. You can still see allowed preview info; full customer details remain hidden.' },
  { t: 'Top-ups',
    b: 'Purchased credits are added once Plug A Pro or Payfast confirms the payment. Manual EFT top-ups may take longer because finance must match the reference.' },
  { t: 'Refunds & reversals',
    b: 'We may reverse or refund credits where a job is invalid, duplicated, technically failed, or qualifies under support review. Refunds are recorded in your ledger.' },
  { t: 'Misuse',
    b: 'We may pause access, reverse credits, or block leads where there is fraud, abuse, false information, or behaviour that harms customers, providers, or the marketplace.' }];

  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '54px 18px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => go('home')} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><IcArrowL size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: T.fam, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.pal.purple
          }}>Plug A Pro · Provider docs</div>
        </div>
      </div>
      <div style={{ padding: '4px 22px 0' }}>
        <h1 style={{
          margin: 0, fontFamily: T.fam, fontWeight: 700, fontSize: 28, letterSpacing: -0.6,
          color: T.ink, textWrap: 'balance'
        }}>Provider credits - terms & rules</h1>
        <p style={{
          margin: '8px 0 0', fontFamily: T.fam, fontSize: 14.5, color: T.inkMute,
          lineHeight: 1.55, textWrap: 'pretty'
        }}>
          Plain-language rules for prepaid credits, top-ups, lead acceptance, and refunds.
        </p>
      </div>

      <div style={{ padding: '20px 18px 0' }}>
        <Card T={T} style={{ background: T.gradSoft, boxShadow: 'none' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <IcInfo size={18} color={T.pal.purple} />
            <div style={{ fontFamily: T.fam, fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
              Credits are <b>prepaid platform units</b> — not cash, not loans, not financial credit. Your application must be approved before your profile activates.
            </div>
          </div>
        </Card>
      </div>

      <div style={{ padding: '18px 18px 0' }}>
        <Card T={T} padded={false}>
          {sections.map((s, i) =>
          <div key={s.t} style={{
            padding: '16px 18px',
            boxShadow: i < sections.length - 1 ? `inset 0 -1px 0 ${T.border}` : 'none'
          }}>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: -0.2, marginBottom: 6 }}>
                {s.t}
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 13.5, color: T.inkMute, lineHeight: 1.6, textWrap: 'pretty' }}>
                {s.b}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div style={{ padding: '20px 18px 0' }}>
        <Card T={T}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: T.whatsapp + '20', color: T.whatsappDark, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}><IcWhats size={18} /></div>
            <div>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 4 }}>
                Questions about your credits?
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 13, color: T.inkMute, lineHeight: 1.5 }}>
                Send the job reference and a short note to support — we usually respond within a couple of hours.
              </div>
            </div>
          </div>
          {T.showWA &&
          <button style={{
            marginTop: 12, width: '100%', height: 42, borderRadius: T.r.md,
            border: 'none', cursor: 'pointer',
            background: T.whatsapp, color: '#fff',
            fontFamily: T.fam, fontWeight: 700, fontSize: 13.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
              <IcWhats size={15} /> Open WhatsApp support
            </button>
          }
        </Card>
      </div>
      <div style={{ height: 30 }} />
    </ScreenScroll>);

}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────
function ScreenNotifications({ T, go }) {
  const items = [
  { id: 1, icon: <IcWhats size={16} />, tone: T.whatsapp, title: 'Lovemore accepted your request', body: 'En route now — eta 18 min.', when: '2 min', unread: true },
  { id: 2, icon: <IcSpark size={16} />, tone: T.pal.purple, title: 'New quote from Pieter van Wyk', body: 'R650 for geyser thermostat replacement.', when: '1 h', unread: true },
  { id: 3, icon: <IcStar size={16} />, tone: '#F5B400', title: 'Rate your last service', body: 'How was your job with Nomvula Khumalo?', when: 'Yesterday' },
  { id: 4, icon: <IcCheck size={16} />, tone: T.success, title: 'Payment received', body: 'R450 for PAP-4602 was paid out.', when: '2 d' }];

  return (
    <ScreenScroll T={T}>
      <div style={{ padding: '54px 18px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => go('home')} style={{
          width: 38, height: 38, borderRadius: 12, border: 'none',
          background: T.card, color: T.ink, cursor: 'pointer',
          boxShadow: `inset 0 0 0 1px ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><IcArrowL size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 19, color: T.ink, letterSpacing: -0.3 }}>Notifications</div>
        </div>
        <button style={{
          height: 32, padding: '0 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: T.cardAlt, color: T.ink,
          fontFamily: T.fam, fontWeight: 600, fontSize: 12
        }}>Mark all read</button>
      </div>
      <div style={{ padding: '14px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((n) =>
        <Card T={T} key={n.id} style={{ position: 'relative' }}>
            {n.unread &&
          <span style={{
            position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: '50%',
            background: T.pal.pink
          }} />
          }
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: n.tone + '18', color: n.tone,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>{n.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink, paddingRight: 16 }}>
                  {n.title}
                </div>
                <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, marginTop: 2, lineHeight: 1.5 }}>
                  {n.body}
                </div>
                <div style={{ fontFamily: T.fam, fontSize: 11, color: T.inkSoft, marginTop: 6 }}>{n.when} ago</div>
              </div>
            </div>
          </Card>
        )}
      </div>
      <div style={{ height: 30 }} />
    </ScreenScroll>);

}

Object.assign(window, {
  ScreenProviderHome, ScreenAdminHome, ScreenStatus, ScreenCreditTerms, ScreenNotifications
});