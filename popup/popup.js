// Google Calendar Callback Extension - Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const notSignedInSection = document.getElementById('not-signed-in');
  const signedInSection = document.getElementById('signed-in');
  const userEmailSpan = document.getElementById('user-email');
  const signInButton = document.getElementById('signin-button');
  const signOutButton = document.getElementById('signout-button');
  const statusSection = document.getElementById('status-section');
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const upcomingList = document.getElementById('upcoming-list');
  const noMeetingsMsg = document.getElementById('no-meetings');
  const notificationTiming = document.getElementById('notification-timing');
  const autoJoinCheckbox = document.getElementById('auto-join');
  const ringtoneSelect = document.getElementById('ringtone');
  const testSoundButton = document.getElementById('test-sound');
  const saveSettingsButton = document.getElementById('save-settings');
  const firstRunModal = document.getElementById('first-run-modal');
  const firstRunContinue = document.getElementById('first-run-continue');
  const versionSpan = document.getElementById('version');

  // Initialize
  initializePopup();
  
  // Add event listeners
  document.getElementById('first-run-continue').addEventListener('click', handleFirstRunContinue);
  document.getElementById('signin-button').addEventListener('click', handleSignIn);
  document.getElementById('signout-button').addEventListener('click', handleSignOut);
  saveSettingsButton.addEventListener('click', saveSettings);
  testSoundButton.addEventListener('click', testRingtone);
  firstRunContinue.addEventListener('click', handleFirstRunContinue);
  
  // Functions
  async function initializePopup() {
    // Check if auth is in progress first
    const { authInProgress } = await chrome.storage.local.get('authInProgress');
    
    if (authInProgress) {
      console.log('Auth in progress detected');
      // Show authentication status message
      const statusDiv = document.createElement('div');
      statusDiv.id = 'auth-status';
      statusDiv.style.padding = '20px';
      statusDiv.style.textAlign = 'center';
      statusDiv.innerHTML = '<h3>Authentication in progress...</h3><p>Please complete the authentication in the popup window.</p>';
      document.body.appendChild(statusDiv);
      
      // Hide other UI elements
      const firstRunElement = document.getElementById('first-run-modal');
      if (firstRunElement) {
        firstRunElement.style.display = 'none';
        firstRunElement.classList.add('hidden');
      }
      if (notSignedInSection) notSignedInSection.classList.add('hidden');
      if (signedInSection) signedInSection.classList.add('hidden');
      if (statusSection) statusSection.classList.add('hidden');
      
      return; // Exit early, don't proceed with normal initialization
    }
    
    // Check if we have a token already
    const { oauth_token } = await chrome.storage.local.get('oauth_token');
    
    if (oauth_token) {
      console.log('Found stored token, user is already authenticated');
      // Skip first run modal since we're already authenticated
      if (firstRunModal) {
        firstRunModal.classList.add('hidden');
        firstRunModal.style.display = 'none';
        // Set firstRun to false to prevent it from showing again
        chrome.storage.local.set({ firstRun: false });
      }
    } else {
      // Check if first run
      const { firstRun } = await chrome.storage.local.get('firstRun');
      
      if (firstRun === undefined || firstRun === true) {
        // Show the first run modal
        firstRunModal.classList.remove('hidden');
      }
    }
    
    // Load extension version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = `v${manifest.version}`;
    
    // Check auth status
    checkAuthStatus();
    
    // Load settings
    loadSettings();
    
    // Load upcoming meetings
    loadUpcomingMeetings();
  }
  
  async function checkAuthStatus() {
    try {
      // First check if we have a stored token
      const { oauth_token } = await chrome.storage.local.get('oauth_token');
      
      if (oauth_token) {
        console.log('Found stored OAuth token, user is authenticated');
        
        // Hide first run modal if it exists
        if (firstRunModal) {
          console.log('Hiding firstRunModal - user already authenticated');
          firstRunModal.classList.add('hidden');
          firstRunModal.style.display = 'none';
          
          // Also set firstRun to false to prevent it from showing again
          chrome.storage.local.set({ firstRun: false });
        }
        
        // Update status indicators
        statusText.textContent = 'Authenticated';
        statusIcon.style.backgroundColor = '#34a853'; // Green
        
        // Show signed in section
        notSignedInSection.classList.add('hidden');
        signedInSection.classList.remove('hidden');
        
        // We're authenticated, but don't have email info from token directly
        // Instead, let's get fresh identity info from Chrome
        try {
          // Request fresh identity information (interactive: true so the user can consent if needed)
          const result = await new Promise((resolve) => {
            chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
              resolve(userInfo);
            });
          });
          
          if (result && result.email) {
            // Store email for future use
            await chrome.storage.local.set({ userEmail: result.email });
            document.getElementById('user-email').textContent = result.email;
          } else {
            document.getElementById('user-email').textContent = 'Authenticated User';
          }
        } catch (error) {
          console.error('Error getting profile info:', error);
          document.getElementById('user-email').textContent = 'Authenticated User';
        }
        
        // Check upcoming events
        loadUpcomingMeetings();
        return;
      }
      
      // If no stored token, try to get one non-interactively
      const token = await getAuthToken(false);
      
      if (token) {
        // Get user info
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const userInfo = await response.json();
          userEmailSpan.textContent = userInfo.email;
          
          notSignedInSection.classList.add('hidden');
          signedInSection.classList.remove('hidden');
          statusSection.classList.remove('hidden');
        } else {
          throw new Error('Failed to get user info');
        }
      } else {
        notSignedInSection.classList.remove('hidden');
        signedInSection.classList.add('hidden');
        statusSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      notSignedInSection.classList.remove('hidden');
      signedInSection.classList.add('hidden');
      statusSection.classList.add('hidden');
    }
  }
  
  async function handleSignIn() {
    // Before attempting authentication, show a status indicator
    const existingStatus = document.getElementById('auth-status');
    if (!existingStatus) {
      const statusDiv = document.createElement('div');
      statusDiv.id = 'auth-status';
      statusDiv.style.padding = '20px';
      statusDiv.style.textAlign = 'center';
      statusDiv.innerHTML = '<h3>Authenticating...</h3><p>Please authorize the extension when the Google prompt appears.</p>';
      document.body.appendChild(statusDiv);
    }
    
    // Hide other UI elements that might be in the way
    if (firstRunModal) firstRunModal.style.display = 'none';
    if (notSignedInSection) notSignedInSection.classList.add('hidden');
    
    console.log('Clearing tokens and starting WebAuthFlow...');
    
    // Skip standard auth entirely and go straight to WebAuthFlow
    chrome.identity.clearAllCachedAuthTokens(() => {
      console.log('Tokens cleared, launching WebAuthFlow');
      launchWebAuthFlow();
    });
  }
  
  async function handleSignOut() {
    try {
      const token = await getAuthToken(false);
      if (token) {
        // Revoke token
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        
        // Clear token from Chrome's cache
        chrome.identity.removeCachedAuthToken({ token });
        
        // Update UI
        notSignedInSection.classList.remove('hidden');
        signedInSection.classList.add('hidden');
        statusSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
  
  async function loadUpcomingMeetings() {
    try {
      const { upcomingEvents } = await chrome.storage.local.get('upcomingEvents');
      
      if (upcomingEvents && upcomingEvents.length > 0) {
        // Sort events by start time
        const sortedEvents = upcomingEvents.sort((a, b) => {
          const aStart = new Date(a.start.dateTime || a.start.date);
          const bStart = new Date(b.start.dateTime || b.start.date);
          return aStart - bStart;
        });
        
        // Clear existing list
        upcomingList.innerHTML = '';
        noMeetingsMsg.classList.add('hidden');
        
        // Add each event to the list
        sortedEvents.forEach(event => {
          const startTime = new Date(event.start.dateTime || event.start.date);
          const meetingItem = document.createElement('div');
          meetingItem.className = 'meeting-item';
          
          const meetingTitle = document.createElement('div');
          meetingTitle.className = 'meeting-title';
          meetingTitle.textContent = event.summary || 'Unnamed meeting';
          
          const meetingTime = document.createElement('div');
          meetingTime.className = 'meeting-time';
          meetingTime.textContent = formatTime(startTime);
          
          meetingItem.appendChild(meetingTitle);
          meetingItem.appendChild(meetingTime);
          upcomingList.appendChild(meetingItem);
        });
        
        // Update status
        statusText.textContent = 'Calendar monitoring active';
        statusIcon.style.backgroundColor = '#34a853'; // Green
      } else {
        upcomingList.innerHTML = '';
        noMeetingsMsg.classList.remove('hidden');
        
        // Update status if authenticated
        if (!notSignedInSection.classList.contains('hidden')) {
          statusText.textContent = 'No upcoming meetings with Meet links';
          statusIcon.style.backgroundColor = '#fbbc04'; // Yellow
        }
      }
    } catch (error) {
      console.error('Error loading upcoming meetings:', error);
      statusText.textContent = 'Error loading meetings';
      statusIcon.style.backgroundColor = '#ea4335'; // Red
    }
  }
  
  async function loadSettings() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      
      if (settings) {
        notificationTiming.value = settings.notificationTiming.toString();
        autoJoinCheckbox.checked = settings.autoJoin;
        ringtoneSelect.value = settings.ringtone;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
  
  async function saveSettings() {
    try {
      const settings = {
        notificationTiming: parseInt(notificationTiming.value, 10),
        autoJoin: autoJoinCheckbox.checked,
        ringtone: ringtoneSelect.value
      };
      
      await chrome.storage.local.set({ settings });
      
      // Show saved confirmation
      saveSettingsButton.textContent = 'Saved!';
      setTimeout(() => {
        saveSettingsButton.textContent = 'Save Settings';
      }, 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      saveSettingsButton.textContent = 'Error Saving';
      setTimeout(() => {
        saveSettingsButton.textContent = 'Save Settings';
      }, 2000);
    }
  }
  
  /**
   * Fetches user information from Google's userinfo endpoint using the OAuth token
   * @param {string} token - The OAuth access token
   * @returns {Promise<Object>} User information including email
   */
  async function fetchUserInfo(token) {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching user info:', error);
      throw error;
    }
  }
  
  async function testRingtone() {
    const ringtone = ringtoneSelect.value;
    let soundFile = 'assets/audio/classic-ring.mp3';
    
    switch (ringtone) {
      case 'classic':
        soundFile = 'assets/audio/classic-ring.mp3';
        break;
      case 'digital':
        soundFile = 'assets/audio/digital-ring.mp3';
        break;
      case 'old':
        soundFile = 'assets/audio/old-ring.mp3';
        break;
      default:
        soundFile = 'assets/audio/classic-ring.mp3';
    }
    
    const audio = new Audio(chrome.runtime.getURL(soundFile));
    audio.play();
    
    // Stop after 3 seconds
    setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
    }, 3000);
  }
  
  function handleFirstRunContinue() {
    firstRunModal.classList.add('hidden');
    
    // Add a visual indicator
    const statusDiv = document.createElement('div');
    statusDiv.id = 'auth-status';
    statusDiv.style.padding = '20px';
    statusDiv.style.textAlign = 'center';
    statusDiv.innerHTML = '<h3>Authenticating...</h3><p>Please authorize the extension when the Google prompt appears.</p>';
    document.body.appendChild(statusDiv);
    
    // Mark first run as complete
    chrome.storage.local.set({ firstRun: false });
    
    // Clear any cached tokens first
    chrome.identity.clearAllCachedAuthTokens(() => {
      console.log('Cleared cached tokens, attempting interactive authentication');
      // Try to authenticate with interactive=true flag
      handleSignIn();
    });
  }
  
  // Helper Functions
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
           ' - ' + 
           new Date(date.getTime() + 30*60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
      console.log(`Requesting auth token with interactive=${interactive}`);
      
      // Force interactive to true to ensure consent screen appears
      chrome.identity.getAuthToken({ interactive: true }, function(token) {
        if (chrome.runtime.lastError) {
          console.error('Auth token error:', chrome.runtime.lastError);
          
          // If we get an error about the OAuth flow
          if (chrome.runtime.lastError.message.includes('OAuth2')) {
            // Immediately try fallback authentication
            console.log('OAuth error detected, immediately falling back to WebAuthFlow');
            reject(chrome.runtime.lastError);
            return;
          }
          
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (token) {
          console.log('Token retrieved successfully');
          resolve(token);
        } else {
          console.error('No token returned');
          reject(new Error('No token returned'));
        }
      });
    });
  }
  
  // Direct WebAuthFlow authentication
  async function launchWebAuthFlow() {
    // Set auth state flag to indicate we're in the middle of auth flow
    chrome.storage.local.set({ authInProgress: true }, function() {
      console.log('Auth in progress flag set');
    });
    
    // Get the manifest and client ID
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2.client_id;
    
    // Get the extension's own redirect URL
    const redirectURL = chrome.identity.getRedirectURL();
    console.log('Using redirect URL:', redirectURL);
    
    // Get the extension ID - critical for OAuth URI registration
    const extensionId = chrome.runtime.id;
    console.log('Extension ID:', extensionId);
    
    // Show the redirect URI that needs to be configured
    const statusDiv = document.getElementById('auth-status');
    if (statusDiv) {
      statusDiv.innerHTML = `
        <h3>OAuth Setup Required</h3>
        <p>Please add this redirect URI to your Google Cloud OAuth client:</p>
        <div style="background: #f0f0f0; padding: 10px; margin: 10px 0; word-break: break-all;">
          <strong>${redirectURL}</strong>
        </div>
        <p>Your current extension ID is: <strong>${extensionId}</strong></p>
        <p>After adding this URI to Google Cloud Console in your OAuth client's Authorized redirect URIs list, reload the extension and try again.</p>
      `;
    }
    
    // Create the auth URL
    const authURL = 
      'https://accounts.google.com/o/oauth2/auth' +
      '?client_id=' + encodeURIComponent(clientId) +
      '&response_type=token' + // Request token directly instead of auth code
      '&redirect_uri=' + encodeURIComponent(redirectURL) +
      '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly') +
      '&prompt=consent';
    
    console.log('Launching WebAuthFlow with URL:', authURL);
    
    try {
      // Show a warning that we're likely going to fail due to redirect URI mismatch
      console.log('Warning: WebAuthFlow will likely fail until redirect URI is registered');
      
      // Launch the web auth flow
      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authURL, interactive: true },
          (responseUrl) => {
            if (chrome.runtime.lastError) {
              console.error('WebAuthFlow error:', chrome.runtime.lastError);
              reject(chrome.runtime.lastError);
            } else {
              console.log('WebAuthFlow succeeded with responseUrl', responseUrl);
              resolve(responseUrl);
            }
          }
        );
      });
      
      console.log('Auth successful, processing response URL...');
      
      // Process the response URL to extract the token
      const url = new URL(responseUrl);
      const hash = url.hash.substring(1); // Remove the # character
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');
      const expiresIn = params.get('expires_in');
      
      if (token) {
        // Store the token
        await chrome.storage.local.set({ 
          oauth_token: token,
          token_expiry: Date.now() + (parseInt(expiresIn) * 1000)
        });
        
        // Clear the auth in progress flag
        await chrome.storage.local.set({ authInProgress: false });
        
        // Notify background script of authentication update
        chrome.runtime.sendMessage({ action: 'authenticationUpdated' });
        
        // Remove the status message
        const statusDiv = document.getElementById('auth-status');
        if (statusDiv) statusDiv.remove();
        
        // Re-check auth status to update UI
        checkAuthStatus();
      } else {
        throw new Error('No access token found in response');
      }
    } catch (error) {
      console.error('WebAuthFlow error:', error);
      
      // Check if the error is likely due to redirect URI mismatch
      const isRedirectUriError = error && 
                              (error.message?.includes('redirect_uri_mismatch') ||
                               error.message?.includes('invalid_request'));
      
      const statusDiv = document.getElementById('auth-status');
      if (statusDiv) {
        if (isRedirectUriError) {
          // Keep the redirect URI registration instructions visible
          // They were already set above
        } else {
          statusDiv.innerHTML = '<h3>Authentication Failed</h3><p>Please try again by clicking the Sign In button.</p>';
        }
      }
      
      // Clear the auth in progress flag
      chrome.storage.local.set({ authInProgress: false });
      
      // Only remove the status message if it's not a redirect URI error
      if (!isRedirectUriError) {
        // Update UI after a short delay
        setTimeout(() => {
          // Show sign-in section
          if (notSignedInSection) notSignedInSection.classList.remove('hidden');
          // Remove the status message
          const statusDiv = document.getElementById('auth-status');
          if (statusDiv) statusDiv.remove();
        }, 3000);
      }
    }
  }
  
  // Fallback authentication function is no longer needed since we're going straight to WebAuthFlow
  // Keeping this as a stub that just calls launchWebAuthFlow
  function fallbackAuthentication() {
    console.log('Called fallbackAuthentication, redirecting to launchWebAuthFlow');
    launchWebAuthFlow();
  }
  

});
