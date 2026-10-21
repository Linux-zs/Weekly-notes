import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="error-state" role="alert">
          <h1>页面暂时无法显示</h1>
          <p>请重新加载页面后再试。</p>
          <button className="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
