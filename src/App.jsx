import React, { useEffect, useState } from 'react';
import './App.css';
import routes, { navigateTo, resolveRoute } from './routes';
import AuthPage from './pages/AuthPage';
import { clearAuth, getStoredAuth } from './api/session';

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '页面运行失败',
    };
  }

  componentDidCatch(error) {
    // Keep browser console signal for debugging while avoiding a blank screen.
    // eslint-disable-next-line no-console
    console.error('Route render failed:', error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="app-route-error">
        <h1>页面没有加载成功</h1>
        <p>{this.state.message || '发生了未知运行时错误。'}</p>
        <div className="app-route-error-actions">
          <button
            type="button"
            onClick={() => {
              clearAuth();
              navigateTo('/login');
              this.setState({ hasError: false, message: '' });
            }}
          >
            清除登录态并回到登录页
          </button>
          <button
            type="button"
            onClick={() => {
              navigateTo('/login');
              this.setState({ hasError: false, message: '' });
            }}
          >
            返回登录页
          </button>
        </div>
      </div>
    );
  }
}

function App() {
  const [path, setPath] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const syncRoute = () => {
      setPath(window.location.pathname || '/');
    };

    window.addEventListener('popstate', syncRoute);
    window.addEventListener('lianjue:navigate', syncRoute);

    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('lianjue:navigate', syncRoute);
    };
  }, []);

  const activeRoute = resolveRoute(path);
  const storedAuth = getStoredAuth();
  const isAuthenticated = Boolean(storedAuth?.user_id);
  const isProtectedRoute = path === '/student' || path === '/teacher';
  const shouldForceLogin = isProtectedRoute && !isAuthenticated;
  const ActiveComponent = shouldForceLogin ? AuthPage : activeRoute.component;

  useEffect(() => {
    if (!shouldForceLogin) {
      return;
    }
    if (window.location.pathname !== '/login') {
      navigateTo('/login');
    }
  }, [shouldForceLogin]);

  return (
    <div className="app-shell">
      <RouteErrorBoundary resetKey={path}>
        <ActiveComponent
          currentPath={path}
          routes={routes}
          navigate={navigateTo}
        />
      </RouteErrorBoundary>
    </div>
  );
}

export default App;
