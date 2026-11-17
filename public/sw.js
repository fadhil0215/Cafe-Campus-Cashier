const SW_VERSION = 'v6';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: '🔔 Cafe Campus',
      body: event.data ? event.data.text() : 'Pembaruan pesanan Anda.'
    };
  }

  const title = data.title || '🔔 Cafe Campus';
  const options = {
    body: data.body || 'Pesanan Anda telah diperbarui!',
    icon: '/assets/icon.png',
    badge: '/assets/icon.png',
    vibrate: [1000, 300, 1000, 300, 1500, 500, 2000],
    requireInteraction: true,
    renotify: true,
    silent: false,
    tag: data.tag || ('cafe-campus-' + Date.now()),
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: '☕ Buka Status Pesanan' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Jika tab sudah terbuka (baik di background maupun foreground)
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url === targetUrl || client.url.includes('/track/') || client.url.includes('/orders')) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      // Jika tab ditutup sebelumnya, buka tab baru
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
