# Google Calendar Callback Extension - Technical Implementation

This document outlines the technical approach for implementing the freemium model in the Google Calendar Callback Extension.

## Architecture Overview

The extension architecture will be designed with feature-gating in mind from the start, using a modular approach that separates core and premium functionality.

### Core Components

```
📁 manifest.json         # Extension configuration
📁 background.js         # Service worker for background tasks
📁 popup/                # Extension popup UI
📁 call-overlay/         # Full-screen call interface
📁 assets/               # Media files and icons
📁 lib/                  # Core libraries
   └── api.js            # API interactions
   └── auth.js           # Authentication handlers
   └── storage.js        # Chrome storage wrappers
   └── licensing.js      # Premium verification
```

## Feature-Gating Implementation

### 1. Premium Feature Detection

We'll implement a licensing module that controls access to premium features:

```javascript
// lib/licensing.js
class LicensingManager {
  constructor() {
    this.cachedStatus = null;
    this.lastChecked = 0;
    this.checkInterval = 1000 * 60 * 60; // Check once per hour
  }

  async isPremium() {
    // Use cached result if available and recent
    const now = Date.now();
    if (this.cachedStatus && (now - this.lastChecked < this.checkInterval)) {
      return this.cachedStatus;
    }
    
    // Otherwise check with the server
    try {
      const { premiumStatus } = await chrome.storage.local.get('premiumStatus');
      
      if (premiumStatus && premiumStatus.expiryTime > now) {
        // Valid premium subscription found
        this.cachedStatus = true;
        this.lastChecked = now;
        return true;
      }
      
      // If we have a token, verify with server
      const { subscriptionToken } = await chrome.storage.local.get('subscriptionToken');
      
      if (subscriptionToken) {
        const status = await this.verifySubscription(subscriptionToken);
        
        if (status.isActive) {
          // Update local cache
          await chrome.storage.local.set({
            premiumStatus: {
              active: true,
              expiryTime: status.expiryTime,
              plan: status.plan
            }
          });
          
          this.cachedStatus = true;
          this.lastChecked = now;
          return true;
        }
      }
      
      // No active premium subscription
      this.cachedStatus = false;
      this.lastChecked = now;
      return false;
    } catch (error) {
      console.error('Error verifying premium status:', error);
      
      // Fail open to cached status or false if no cache
      return this.cachedStatus || false;
    }
  }
  
  async verifySubscription(token) {
    // In production, this would make an API call to your backend
    // For development, we'll simulate a response
    return {
      isActive: token === 'VALID_PREMIUM_TOKEN',
      expiryTime: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
      plan: 'premium'
    };
  }
}

export const licensing = new LicensingManager();
```

### 2. Feature Access Control

Each premium feature will check license status before activating:

```javascript
// Example usage in a feature
import { licensing } from '../lib/licensing.js';

async function useCustomRingtone(selectedTone) {
  const isPremium = await licensing.isPremium();
  
  if (isPremium) {
    // Allow custom ringtone
    return chrome.runtime.getURL(`assets/premium-tones/${selectedTone}.mp3`);
  } else {
    // Use default ringtone
    return chrome.runtime.getURL('assets/ring-default.mp3');
  }
}
```

### 3. UI Integration

The UI will adapt based on premium status:

```javascript
// In popup.js
async function renderSettings() {
  const isPremium = await licensing.isPremium();
  
  // Always show base settings
  document.getElementById('base-settings').classList.remove('hidden');
  
  // Conditionally show premium settings
  const premiumSettings = document.getElementById('premium-settings');
  const upgradeButton = document.getElementById('upgrade-button');
  
  if (isPremium) {
    premiumSettings.classList.remove('hidden');
    upgradeButton.classList.add('hidden');
  } else {
    premiumSettings.classList.add('hidden');
    upgradeButton.classList.remove('hidden');
  }
}
```

## Subscription Management

### Backend Integration

A lightweight backend service will be required to:

1. Process subscription payments via Stripe
2. Issue and validate subscription tokens
3. Handle subscription lifecycle events (renewal, cancellation, etc.)

#### Subscription Flow

1. User clicks "Upgrade to Premium"
2. Extension opens a web page for payment processing
3. After successful payment, user receives a subscription token
4. Token is stored in extension via Chrome storage
5. Extension verifies token with backend and enables premium features

### Backend API Endpoints

```
POST /api/subscriptions/verify
  - Verify a subscription token
  - Return subscription details

POST /api/subscriptions/refresh
  - Refresh a subscription token
  - Return updated subscription details
```

## Free vs. Premium Feature Map

| Feature | Free | Premium |
|---------|------|---------|
| Calendar monitoring | ✓ | ✓ |
| Basic call interface | ✓ | ✓ |
| Single ringtone | ✓ | ✓ |
| Basic answer/decline | ✓ | ✓ |
| Calendar polling interval | 60 seconds | 30 seconds |
| Auto-dismiss timeout | 2 minutes | Configurable |
| Custom ringtones | ❌ | ✓ |
| Interface themes | ❌ | ✓ |
| Meeting prep mode | ❌ | ✓ |
| Analytics dashboard | ❌ | ✓ |
| Multi-account support | ❌ | ✓ |

## Development Phases

### Phase 1: Core Functionality

- Implement complete free tier
- Add licensing framework
- Create placeholder UI for premium features (disabled)

### Phase 2: Premium Features

- Implement custom ringtones library
- Add theme support
- Create analytics data collection

### Phase 3: Backend Integration

- Deploy subscription backend
- Integrate Stripe payment processing
- Implement token verification system

## Testing

We'll implement specific tests for the premium verification system:

1. Mock token verification
2. Feature access with/without premium
3. Token expiration handling
4. Offline/online status handling

## Security Considerations

- Tokens will be JWT-based with asymmetric encryption
- Storage in chrome.storage.local with encryption for sensitive data
- Regular revalidation with backend to prevent abuse
- Graceful degradation when verification fails
