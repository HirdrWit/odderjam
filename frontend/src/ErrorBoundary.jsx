import {Component} from 'react';

import {boundaryMessage} from './boundary.js';

/**
 * Catches a render error in one tab so the sidebar and the other tabs keep working.
 * Re-keyed per tab, so switching tabs clears the error.
 */
export class ErrorBoundary extends Component {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error) {
    console.error(`${this.props.tab} crashed`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bad empty-state" role="alert">
        {boundaryMessage(this.props.tab)}{' '}
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
