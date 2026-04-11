import { useState } from 'react';
import LoginLayout from '../layouts/LoginLayout';
import { loginUser, registerUser } from '../api/user_api';
import { getStoredAuth } from '../api/session';

function EntryCard({ title, detail, disabled, onClick }) {
  return (
    <button type="button" className="entry-card" onClick={onClick} disabled={disabled}>
      <span className="entry-card-label">{title}</span>
      <span className="entry-card-text">{detail}</span>
    </button>
  );
}

export default function AuthPage({ navigate }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    userName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const storedAuth = getStoredAuth();

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!form.userName.trim() || !form.password) {
      setError('请输入账号和密码');
      return;
    }

    if (mode === 'register') {
      if (!form.email.trim()) {
        setError('请输入邮箱');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
    }

    setBusy(true);
    try {
      const action = mode === 'login' ? loginUser : registerUser;
      const response = await action({
        userName: form.userName.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      if (!response.success || !response.user?.user_id) {
        throw new Error(response.errorMessage || `${mode} failed`);
      }

      setSuccess(mode === 'login' ? '登录成功，已写入本地登录态' : '注册成功，已写入本地登录态');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const enterRoute = (pathname) => {
    if (!getStoredAuth()?.user_id) {
      setError('请先完成登录或注册');
      return;
    }
    navigate(pathname);
  };

  return (
    <LoginLayout
      aside={(
        <div className="auth-hero-copy">
          <p className="layout-eyebrow">Lianjue Learning Platform</p>
          <h1 className="layout-title auth-title">前端 API 对齐入口</h1>
          <p className="layout-subtitle">
            登录态成功写入 `localStorage` 后，教师端和学生端页面都会从本地会话中读取 `user_id` 发起真实请求。
          </p>
          <div className="auth-hero-grid">
            <article className="auth-highlight">
              <span className="auth-highlight-label">Teacher</span>
              <strong>教学大纲、习题草稿/终稿、图谱与材料上传联调。</strong>
            </article>
            <article className="auth-highlight">
              <span className="auth-highlight-label">Student</span>
              <strong>personal_syllabus、提问、推荐材料与学习记录联调。</strong>
            </article>
          </div>
        </div>
      )}
    >
      <section className="auth-card">
        <header className="auth-card-head">
          <p className="layout-eyebrow">{mode === 'login' ? 'Sign In' : 'Sign Up'}</p>
          <h2>{mode === 'login' ? '进入平台' : '创建账号'}</h2>
          <p>
            当前登录态来源于浏览器 `localStorage`。若无登录态，业务页会自动跳回本页。
          </p>
        </header>

        <div className="auth-actions">
          <button
            type="button"
            className={`button ${mode === 'login' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`button ${mode === 'register' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>账号</span>
            <input
              value={form.userName}
              placeholder="输入账号"
              onChange={(event) => updateField('userName', event.target.value)}
            />
          </label>
          {mode === 'register' ? (
            <label className="field">
              <span>邮箱</span>
              <input
                value={form.email}
                placeholder="输入邮箱"
                onChange={(event) => updateField('email', event.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={form.password}
              placeholder="输入密码"
              onChange={(event) => updateField('password', event.target.value)}
            />
          </label>
          {mode === 'register' ? (
            <label className="field">
              <span>确认密码</span>
              <input
                type="password"
                value={form.confirmPassword}
                placeholder="再次输入密码"
                onChange={(event) => updateField('confirmPassword', event.target.value)}
              />
            </label>
          ) : null}
          <div className="tile-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? '处理中..' : mode === 'login' ? '登录' : '注册'}
            </button>
          </div>
        </form>

        {storedAuth?.user_id ? (
          <p className="response-copy">{`当前登录: ${storedAuth.user_name} (#${storedAuth.user_id})`}</p>
        ) : null}
        {success ? <p className="response-copy">{success}</p> : null}
        {error ? <p className="response-copy">{error}</p> : null}

        <div className="auth-entry-grid">
          <EntryCard
            title="教师端"
            detail="进入教学大纲构建、习题草稿/终稿编辑、材料一览。"
            disabled={!storedAuth?.user_id}
            onClick={() => enterRoute('/teacher')}
          />
          <EntryCard
            title="学生端"
            detail="进入学习大纲、提问区、推荐材料区与学习记录。"
            disabled={!storedAuth?.user_id}
            onClick={() => enterRoute('/student')}
          />
        </div>
      </section>
    </LoginLayout>
  );
}
