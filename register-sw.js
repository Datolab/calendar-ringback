// Service worker registration for Manifest V3
console.log('Registering service worker...');

// Register the service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/background.js', {
        type: 'module',
        scope: '/'
      });
      
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
      
      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('New service worker found...');
        
        newWorker.addEventListener('statechange', () => {
          console.log('Service worker state changed:', newWorker.state);
          
          if (newWorker.state === 'activated') {
            console.log('Service worker activated!');
          }
        });
      });
      
    } catch (error) {
      console.error('ServiceWorker registration failed: ', error);
    }
  });
}
