// Browser-only entry point for the EV fleet analysis application
// All computation and CSV parsing happens client-side with no network requests

import { analyzeFleet, DieselModel, Van, EVModel, CapConfig } from './engine';

// Initialize app when DOM is ready
function initApp(): void {
  const app = document.getElementById('app');
  if (!app) {
    console.error('App container not found');
    return;
  }

  app.innerHTML = `
    <div style="max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h1>Which Vans Go Electric?</h1>
      <p style="color: #666; margin-top: 10px;">Browser-based EV fleet analysis app</p>
      <p style="margin-top: 20px; color: #999;">Application UI coming soon...</p>
      <p style="margin-top: 10px; font-size: 12px; color: #ccc;">All computation happens client-side with no network requests.</p>
    </div>
  `;
}

// Start app
document.addEventListener('DOMContentLoaded', initApp);

// Export engine for testing
export { analyzeFleet, type DieselModel, type Van, type EVModel, type CapConfig };
