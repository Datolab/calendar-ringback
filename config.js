// Browser-specific configuration
export const BROWSER_CONFIG = {
  // Chrome (default)
  chrome: {
    clientId: '723533017595-d130o0h5hb695q3t3un5vlnn48nh51ma.apps.googleusercontent.com',
    redirectUri: chrome.identity.getRedirectURL('google_callback')
  },
  // Microsoft Edge
  edge: {
    clientId: '723533017595-db929vbh0p7rpebbe431u6fogb4sjnbm.apps.googleusercontent.com',  // Replace with your Edge client ID
    redirectUri: chrome.identity.getRedirectURL('google_callback')
  },
  // Brave Browser
  brave: {
    clientId: '723533017595-52oulvpomf0s45vgjnbg92vb6e6ipqnn.apps.googleusercontent.com',  // Replace with your Brave client ID
    redirectUri: chrome.identity.getRedirectURL('google_callback')
  },
  // Opera
  opera: {
    clientId: '723533017595-hou7fbs29ma449sk5931innbahp5loh2.apps.googleusercontent.com',  // Replace with your Opera client ID
    redirectUri: chrome.identity.getRedirectURL('google_callback')
  },
  // Vivaldi
  vivaldi: {
    clientId: '723533017595-le2d7nj6rk0vgg9moij9id3414ba5vls.apps.googleusercontent.com',  // Replace with your Vivaldi client ID
    redirectUri: chrome.identity.getRedirectURL('google_callback')
  }
};

// Browser detection
const BROWSER_DETECTION = {
  edge: /Edg\//i,
  opera: /OPR\//i,
  vivaldi: /Vivaldi\//i,
  // Brave doesn't identify itself in the user agent, so we'll use a different approach
};

// Detect browser
export function getBrowserConfig() {
  const userAgent = navigator.userAgent;
  
  // Check for Brave (it doesn't identify in user agent, so we check for Brave-specific APIs)
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    return BROWSER_CONFIG.brave;
  }
  
  // Check other browsers
  for (const [browser, regex] of Object.entries(BROWSER_DETECTION)) {
    if (regex.test(userAgent)) {
      return BROWSER_CONFIG[browser] || BROWSER_CONFIG.chrome;
    }
  }
  
  // Default to Chrome
  return BROWSER_CONFIG.chrome;
}
