// screens-auth.jsx - Sign in, OTP verify, Sign up, Provider sign in/OTP,
// Admin sign in, Link expired. All reuse the same auth shell.

function AuthShell({ T, eyebrow, title, subtitle, children, onBack, footer, dense }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: T.page,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* gradient halo background */}
      <div aria-hidden style={{
        position: 'absolute', top: -120, left: -80, right: -80, height: 360,
        background: `radial-gradient(60% 80% at 50% 0%, ${T.pal.purple}26, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      {/* status bar safe area */}
      <div style={{ height: 54, flexShrink: 0 }} />
      {/* header bar */}
      <div style={{
        position: 'relative', zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px 0',
      }}>
        {onBack ? (
          <button onClick={onBack} style={{
            width: 38, height: 38, borderRadius: 12, border: 'none',
            background: T.card, color: T.ink, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            boxShadow: `inset 0 0 0 1px ${T.border}`,
          }}><IcArrowL size={18} /></button>
        ) : <div style={{ width: 38 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={26} />
          <Wordmark T={T} size={12} />
        </div>
        <div style={{ width: 38 }} />
      </div>
      {/* main content */}
      <div style={{
        flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1,
        padding: `${dense ? 20 : 32}px 22px 24px`,
      }}>
        {eyebrow && (
          <div style={{
            fontFamily: T.fam, fontSize: 11, fontWeight: 700,
            letterSpacing: 1.4, textTransform: 'uppercase',
            color: T.pal.purple, textAlign: 'center', marginBottom: 8,
          }}>{eyebrow}</div>
        )}
        {title && (
          <h1 style={{
            margin: '0 0 8px', textAlign: 'center',
            fontFamily: T.fam, fontWeight: 700, fontSize: 28,
            letterSpacing: -0.6, color: T.ink, textWrap: 'balance',
          }}>{title}</h1>
        )}
        {subtitle && (
          <p style={{
            margin: '0 0 28px', textAlign: 'center',
            fontFamily: T.fam, fontSize: 14.5, lineHeight: 1.5,
            color: T.inkMute, textWrap: 'pretty',
          }}>{subtitle}</p>
        )}
        {children}
      </div>
      {footer}
    </div>
  );
}

// ── Customer sign in (OTP via WhatsApp) ─────────────────────────────────────
function ScreenSignIn({ T, go }) {
  const [phone, setPhone] = React.useState('82 555 0142');
  const valid = phone.replace(/\D/g, '').length >= 9;
  return (
    <AuthShell T={T}
      eyebrow="Welcome back"
      title="Sign in to Plug A Pro"
      subtitle="Get a one-time code on WhatsApp. Your number is never shared with providers until you accept a quote.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <FieldLabel T={T}>Mobile number</FieldLabel>
          <PhoneInput T={T} value={phone} onChange={setPhone} />
        </div>
        {T.showWA && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(37,211,102,0.08)',
            border: `1px solid rgba(37,211,102,0.18)`,
            borderRadius: T.r.md, padding: '10px 12px',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: T.whatsapp,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}><IcWhats size={16} /></div>
            <span style={{ fontFamily: T.fam, fontSize: 12.5, color: T.ink, lineHeight: 1.35 }}>
              We'll send a 6-digit code via <b>WhatsApp</b>.
            </span>
          </div>
        )}
        <Button T={T} variant={valid ? 'primary' : 'secondary'}
                disabled={!valid} onClick={() => go('otp', { phone, role: 'customer' })}
                rightIcon={<IcArrow size={18} />}>
          Send code
        </Button>
        <div style={{
          textAlign: 'center', fontFamily: T.fam, fontSize: 13, color: T.inkMute,
          padding: '2px 0',
        }}>
          New here?{' '}
          <a onClick={() => go('signup')} style={{ color: T.pal.purple, fontWeight: 600, cursor: 'pointer' }}>
            Create an account
          </a>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontFamily: T.fam, fontSize: 11, color: T.inkSoft, letterSpacing: 0.6, textTransform: 'uppercase' }}>or</span>
        <div style={{ flex: 1, height: 1, background: T.border }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button T={T} variant="secondary" leftIcon={<IcWrench size={16} color={T.pal.purple} />}
                onClick={() => go('provider-signin')}>
          I'm a service provider
        </Button>
        <Button T={T} variant="ghost" leftIcon={<IcShield size={16} color={T.inkMute} />}
                onClick={() => go('admin-signin')}>
          Internal team sign in
        </Button>
      </div>
    </AuthShell>
  );
}

// ── OTP verify ─────────────────────────────────────────────────────────────
function ScreenOTP({ T, go, payload = {} }) {
  const [code, setCode] = React.useState('');
  const [seconds, setSeconds] = React.useState(28);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  React.useEffect(() => {
    if (code.length === 6) {
      if (code === '000000') { setError(true); return; }
      setTimeout(() => {
        const isProvider = payload.role === 'provider';
        go(isProvider ? 'provider-home' : 'home', { signedIn: true, role: payload.role || 'customer' });
      }, 350);
    } else setError(false);
  }, [code]);
  const phoneDisp = payload.phone ? `+27 ${payload.phone}` : '+27 82 555 0142';
  return (
    <AuthShell T={T}
      onBack={() => go(payload.role === 'provider' ? 'provider-signin' : 'signin')}
      eyebrow="Verify"
      title="Enter the 6-digit code"
      subtitle={<>Sent to <b style={{ color: T.ink }}>{phoneDisp}</b>{T.showWA ? ' via WhatsApp' : ''}.</>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <OTPInput T={T} value={code} onChange={setCode} autoFocus />
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: T.danger, fontFamily: T.fam, fontSize: 13, fontWeight: 500,
            justifyContent: 'center',
          }}>
            <IcAlert size={16} /> That code didn't match. Try again.
          </div>
        )}
        <div style={{
          fontFamily: T.fam, fontSize: 13, color: T.inkMute, textAlign: 'center',
        }}>
          {seconds > 0
            ? <>Resend code in <span style={{ color: T.ink, fontWeight: 600, fontFamily: T.mono }}>0:{seconds.toString().padStart(2, '0')}</span></>
            : <a onClick={() => setSeconds(30)} style={{ color: T.pal.purple, fontWeight: 600, cursor: 'pointer' }}>Resend code</a>}
        </div>
        <Button T={T} variant={code.length === 6 ? 'primary' : 'secondary'}
                disabled={code.length !== 6}
                onClick={() => code.length === 6 && go(payload.role === 'provider' ? 'provider-home' : 'home', { signedIn: true, role: payload.role || 'customer' })}>
          Verify & continue
        </Button>
        {T.showWA && (
          <button onClick={() => alert('Opens WhatsApp')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 44, borderRadius: T.r.md, border: 'none', cursor: 'pointer',
            background: 'transparent', color: T.whatsappDark,
            fontFamily: T.fam, fontSize: 13.5, fontWeight: 600,
          }}>
            <IcWhats size={16} /> Open WhatsApp to find the code
          </button>
        )}
      </div>
    </AuthShell>
  );
}

// ── Sign up ────────────────────────────────────────────────────────────────
function ScreenSignUp({ T, go }) {
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [agreed, setAgreed] = React.useState(false);
  const valid = first && last && phone.replace(/\D/g, '').length >= 9 && agreed;
  return (
    <AuthShell T={T} onBack={() => go('signin')}
      eyebrow="New here"
      title="Create your account"
      subtitle="Takes about 30 seconds. We'll text you when a provider accepts your request.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel T={T}>First name</FieldLabel>
            <Input T={T} value={first} onChange={setFirst} placeholder="Thandi" />
          </div>
          <div>
            <FieldLabel T={T}>Last name</FieldLabel>
            <Input T={T} value={last} onChange={setLast} placeholder="Mahlangu" />
          </div>
        </div>
        <div>
          <FieldLabel T={T}>Mobile number</FieldLabel>
          <PhoneInput T={T} value={phone} onChange={setPhone} />
        </div>
        <div>
          <FieldLabel T={T} hint="Optional">Email</FieldLabel>
          <Input T={T} value={email} onChange={setEmail} placeholder="you@email.co.za"
                 type="email" leftIcon={<IcMail size={16} />} />
        </div>
        <button onClick={() => setAgreed(a => !a)} style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          background: 'transparent', border: 'none', textAlign: 'left',
          cursor: 'pointer', padding: '6px 4px',
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
            background: agreed ? T.grad : T.card,
            boxShadow: agreed ? 'none' : `inset 0 0 0 1.5px ${T.borderStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', marginTop: 1,
          }}>{agreed && <IcCheck size={13} stroke={2.4} />}</div>
          <span style={{ fontFamily: T.fam, fontSize: 13, lineHeight: 1.5, color: T.inkMute }}>
            I agree to the <a style={{ color: T.pal.purple, fontWeight: 600 }}>Terms</a> and{' '}
            <a style={{ color: T.pal.purple, fontWeight: 600 }}>Privacy Policy</a>.
            I understand my phone number is only shared with a provider after I accept their quote.
          </span>
        </button>
        <Button T={T} variant={valid ? 'primary' : 'secondary'} disabled={!valid}
                onClick={() => go('otp', { phone, role: 'customer' })}
                rightIcon={<IcArrow size={18} />}>
          Create account
        </Button>
      </div>
    </AuthShell>
  );
}

// ── Provider sign in ───────────────────────────────────────────────────────
function ScreenProviderSignIn({ T, go }) {
  const [phone, setPhone] = React.useState('');
  const valid = phone.replace(/\D/g, '').length >= 9;
  return (
    <AuthShell T={T} onBack={() => go('signin')}
      eyebrow="Provider portal"
      title="Sign in to accept jobs"
      subtitle="Use the mobile number linked to your approved Plug A Pro provider profile.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <FieldLabel T={T}>Provider mobile number</FieldLabel>
          <PhoneInput T={T} value={phone} onChange={setPhone} />
        </div>
        <Button T={T} variant={valid ? 'primary' : 'secondary'} disabled={!valid}
                onClick={() => go('otp', { phone, role: 'provider' })}
                rightIcon={<IcArrow size={18} />}>
          Send code
        </Button>
        <Card T={T} padded={false} style={{ padding: '14px 14px', background: T.gradSoft, boxShadow: `inset 0 0 0 1px ${T.pal.purple}26` }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: T.grad,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0,
            }}><IcWrench size={18} /></div>
            <div>
              <div style={{ fontFamily: T.fam, fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 2 }}>
                New to Plug A Pro?
              </div>
              <div style={{ fontFamily: T.fam, fontSize: 12.5, color: T.inkMute, lineHeight: 1.5 }}>
                Apply to become a provider — it takes about 5 minutes.
              </div>
            </div>
          </div>
          <button onClick={() => go('reg-welcome')} style={{
            marginTop: 12, width: '100%', height: 40, borderRadius: T.r.md,
            border: 'none', background: T.grad, color: '#fff',
            fontFamily: T.fam, fontWeight: 600, fontSize: 13.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer',
          }}>
            Become a provider <IcArrow size={15} color="#fff" />
          </button>
          {T.showWA && (
            <button style={{
              marginTop: 8, width: '100%', height: 38, borderRadius: T.r.md,
              border: 'none', background: 'transparent', color: T.whatsappDark,
              fontFamily: T.fam, fontWeight: 600, fontSize: 12.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer',
            }}>
              <IcWhats size={15} /> Or start on WhatsApp
            </button>
          )}
        </Card>
        <div style={{
          textAlign: 'center', fontFamily: T.fam, fontSize: 13, color: T.inkMute, marginTop: 4,
        }}>
          Looking for customer sign in?{' '}
          <a onClick={() => go('signin')} style={{ color: T.pal.purple, fontWeight: 600, cursor: 'pointer' }}>
            Tap here
          </a>
        </div>
      </div>
    </AuthShell>
  );
}

// ── Admin sign in ──────────────────────────────────────────────────────────
function ScreenAdminSignIn({ T, go }) {
  const [email, setEmail] = React.useState('');
  const [pwd, setPwd] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const valid = email.includes('@') && pwd.length >= 4;
  return (
    <AuthShell T={T} onBack={() => go('signin')}
      eyebrow="Internal · Admin portal"
      title="Team access"
      subtitle="For Plug A Pro staff only. SSO and 2FA are enforced.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel T={T}>Work email</FieldLabel>
          <Input T={T} value={email} onChange={setEmail} placeholder="you@plugapro.co.za"
                 type="email" leftIcon={<IcMail size={16} />} />
        </div>
        <div>
          <FieldLabel T={T} hint={<a onClick={() => alert('Reset')} style={{ color: T.pal.purple, fontWeight: 600, cursor: 'pointer' }}>Forgot?</a>}>
            Password
          </FieldLabel>
          <Input T={T} value={pwd} onChange={setPwd} placeholder="••••••••"
                 type={showPwd ? 'text' : 'password'}
                 leftIcon={<IcLock size={16} />}
                 rightIcon={
                   <button onClick={() => setShowPwd(s => !s)} style={{
                     border: 'none', background: 'transparent', cursor: 'pointer',
                     color: T.inkMute, display: 'flex', padding: 4,
                   }}>
                     {showPwd ? <IcEyeOff size={18} /> : <IcEye size={18} />}
                   </button>
                 } />
        </div>
        <Button T={T} variant={valid ? 'primary' : 'secondary'} disabled={!valid}
                onClick={() => go('home', { signedIn: true, role: 'admin' })}
                rightIcon={<IcArrow size={18} />}>
          Sign in
        </Button>
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: T.r.md,
          background: T.dark ? 'rgba(255,255,255,0.04)' : '#F4F4F7',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <IcShield size={16} color={T.inkMute} />
          <span style={{ fontFamily: T.fam, fontSize: 12, color: T.inkMute, lineHeight: 1.4 }}>
            All actions are logged and audited. Unauthorized access is prohibited.
          </span>
        </div>
      </div>
    </AuthShell>
  );
}

// ── Link expired ───────────────────────────────────────────────────────────
function ScreenLinkExpired({ T, go }) {
  return (
    <AuthShell T={T}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, marginTop: 8 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 28,
          background: T.gradSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 18,
            background: T.card, color: T.warn,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `inset 0 0 0 1px ${T.border}`,
          }}>
            <IcTime size={28} />
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            margin: '0 0 8px', fontFamily: T.fam, fontWeight: 700, fontSize: 24,
            letterSpacing: -0.5, color: T.ink,
          }}>This link has expired</h1>
          <p style={{
            margin: 0, fontFamily: T.fam, fontSize: 14, lineHeight: 1.55, color: T.inkMute, textWrap: 'pretty',
          }}>
            We couldn't verify access to this request. The link may have been used or revoked.
            Open your most recent WhatsApp message from Plug A Pro, or start a new request.
          </p>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button T={T} variant="primary" onClick={() => go('book')}
                  rightIcon={<IcArrow size={18} />}>
            Start a new request
          </Button>
          <Button T={T} variant="secondary" onClick={() => go('signin')}>
            Sign in to my account
          </Button>
          {T.showWA && (
            <button onClick={() => alert('WhatsApp')} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 44, borderRadius: T.r.md, border: 'none', cursor: 'pointer',
              background: 'transparent', color: T.whatsappDark,
              fontFamily: T.fam, fontSize: 13.5, fontWeight: 600,
            }}>
              <IcWhats size={16} /> Reopen WhatsApp chat
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

Object.assign(window, {
  AuthShell, ScreenSignIn, ScreenOTP, ScreenSignUp,
  ScreenProviderSignIn, ScreenAdminSignIn, ScreenLinkExpired,
});
