import { useEffect, useState } from 'react';
import { api } from './api';

export function EmailAuthForm() {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  return (
    <form
      className="dialog-form email-auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || sending) return;
        setBusy(true);
        setError('');
        try {
          await api(`/api/auth/email/${register ? 'register' : 'login'}`, {
            method: 'POST',
            body: JSON.stringify({ email, password, ...(register ? { displayName: name, code } : {}) })
          });
          window.location.assign('/');
        } catch (err) {
          setError(err instanceof Error ? err.message : '请求失败，请重试');
          setBusy(false);
        }
      }}
    >
      <h2>{register ? '注册邮箱账号' : '邮箱登录'}</h2>
      <label>
        邮箱
        <input
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          value={email}
          disabled={busy || sending}
          onChange={(e) => {
            setEmail(e.target.value);
            setCode('');
            setNotice('');
          }}
        />
      </label>
      {register && (
        <label>
          显示名称
          <input
            autoComplete="nickname"
            maxLength={60}
            required
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <label>
        密码
        <input
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          minLength={register ? 12 : 1}
          maxLength={128}
          required
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        {register && <small>使用 12–128 个字符。</small>}
      </label>
      {register && (
        <label>
          邮箱验证码
          <div className="email-code-row">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="button"
              className="button secondary"
              disabled={sending || busy || remaining > 0 || !email.trim()}
              onClick={async () => {
                setSending(true);
                setError('');
                setNotice('');
                try {
                  const result = await api<{ retryAfter: number; message: string }>('/api/auth/email/code', {
                    method: 'POST',
                    body: JSON.stringify({ email })
                  });
                  setRemaining(result.retryAfter);
                  setNotice(`${result.message}，10 分钟内有效。`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : '发送失败，请重试');
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? '发送中…' : remaining ? `${remaining} 秒后重发` : '发送验证码'}
            </button>
          </div>
        </label>
      )}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="submit" className="button full" disabled={busy || sending}>
        {busy ? '请稍候…' : register ? '验证并注册' : '登录'}
      </button>
      <button
        type="button"
        className="button secondary full"
        disabled={busy || sending}
        onClick={() => {
          setRegister(!register);
          setError('');
          setNotice('');
          setPassword('');
          setCode('');
        }}
      >
        {register ? '已有账号，去登录' : '没有账号，注册邮箱账号'}
      </button>
    </form>
  );
}
