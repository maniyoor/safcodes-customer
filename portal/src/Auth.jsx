'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Brand, Btn, Field, Icon } from './ui';

const defaultState = { step: 'login', challengeId: '' };
const artwork = [
  ['domain', 'globe', 'Domains'],
  ['hosting', 'server', 'Hosting'],
  ['email', 'mail', 'Email'],
  ['growth', 'chart', 'Growth'],
];

function SignInArtwork() {
  return <aside className="auth-aside" aria-label="About the Safcodes workspace">
    <div className="auth-orbit one" aria-hidden="true"/>
    <div className="auth-orbit two" aria-hidden="true"/>
    <div className="auth-orbit three" aria-hidden="true"/>
    <div className="auth-art" aria-hidden="true">
      <div className="auth-core"><img src="/brand/safcodes-logo-square.png" width="128" height="128" alt=""/></div>
      {artwork.map(([tile,icon,text]) => <div key={tile} className={'auth-tile tile-' + tile}>
        <Icon name={icon}/><span>{text}</span><i/>
      </div>)}
    </div>
    <div className="auth-pitch">
      <span className="eyebrow">LESS ADMIN. MORE POSSIBILITY.</span>
      <h2>One workspace.<br/>Your whole digital world.</h2>
      <p>Products, projects, payments, and the people behind them. Beautifully connected.</p>
      <div className="auth-trust"><Icon name="shield"/>Your services. Your visibility. Your control.</div>
    </div>
  </aside>;
}

export default function Auth({ onSuccess, message }) {
  const [flow, setFlow] = useState(defaultState);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    function readLink() {
      const link = /^#activate\/([a-f0-9-]{36})$/i.exec(window.location.hash);
      if (link) {
        setFlow({ step: 'activate', challengeId: link[1] });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, []);

  function navigate(step, challengeId = '') {
    setFlow({ step, challengeId });
    setError('');
    setNotice('');
    setShow(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (flow.step === 'login') {
        const result = await api('/auth/login', fields);
        navigate(result.next, result.challengeId);
      } else if (flow.step === 'verify') {
        await api('/auth/verify', { ...fields, challengeId: flow.challengeId });
        await onSuccess();
      } else if (flow.step === 'forgot') {
        const result = await api('/auth/reset/request', fields);
        navigate('reset', result.challengeId);
        setNotice(result.message);
      } else {
        const endpoint = flow.step === 'activate' ? '/auth/activate' : '/auth/reset/confirm';
        const result = await api(endpoint, { ...fields, challengeId: flow.challengeId });
        navigate('login');
        setNotice(result.message);
      }
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  const step = flow.step;
  const passwordSetup = ['activate','reset'].includes(step);
  const headings = { login: 'Welcome back.', verify: 'Check your email.', forgot: 'Recover your account.', reset: 'Choose a new password.', activate: 'Set up your access.' };
  const descriptions = {
    login: 'Sign in to your Safcodes workspace with your registered email.',
    verify: 'Enter the six-digit sign-in code sent to your registered email. It expires in five minutes.',
    forgot: 'Enter the email address for your Safcodes customer account.',
    reset: 'Enter the verification code from your email and choose a new password.',
    activate: 'Enter the verification code from your Safcodes email and choose your own password.',
  };
  return <main className="auth-shell">
    <section className="auth-main">
      <div className="auth-brand"><Brand/></div>
      <div className="auth-form-wrap">
        <div className="eyebrow">YOUR BUSINESS, CONNECTED</div>
        <h1>{headings[step]}</h1>
        <p className="auth-description">{descriptions[step]}</p>
        {(notice || message) && <p className="info-box" role="status">{notice || message}</p>}
        <form onSubmit={submit} key={step}>
          {(step === 'login' || step === 'forgot') && <Field id="login-email" name="email" label="Email address" type="email"
            value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" placeholder="you@company.com" required maxLength={254}/>}
          {step === 'login' && <div className="field"><label htmlFor="login-password">Password</label>
            <div className="password-wrap"><input id="login-password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required/>
              <button type="button" className="password-toggle" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye"/></button></div>
          </div>}
          {step === 'login' && <div className="auth-form-meta">
            <span><Icon name="shield"/>Email verification at every sign-in</span>
            <button type="button" className="text-button" disabled={busy} onClick={() => navigate('forgot')}>Forgot password?</button>
          </div>}
          {(step === 'verify' || passwordSetup) && <Field id="email-otp" name="code" label="Email verification code" inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required/>}
          {passwordSetup && <><Field id="new-password" name="password" type="password" label="New password" autoComplete="new-password" minLength={12}
            hint="Use at least 12 characters and no more than 72 bytes." required/>
            <Field id="confirm-password" name="confirmation" type="password" label="Confirm password" autoComplete="new-password" minLength={12} required/></>}
          {error && <p className="live-error" role="alert">{error}</p>}
          <Btn type="submit" primary className="full" disabled={busy} end="right">{busy ? 'Please wait…' :
            { login:'Sign in', verify:'Verify & sign in', forgot:'Send reset code', reset:'Update password', activate:'Set password' }[step]}</Btn>
        </form>
        {step !== 'login' && <button type="button" className="text-button live-auth-link" disabled={busy} onClick={() => navigate('login')}>
          {step === 'verify' ? 'Back to sign in or request a new code' : 'Back to sign in'}
        </button>}
      </div>
      <footer>Safcodes LLC · Client portal</footer>
    </section>
    <SignInArtwork/>
  </main>;
}
