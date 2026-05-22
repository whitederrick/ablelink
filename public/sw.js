// public/sw.js — AbleLink Service Worker (출퇴근 알람용)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// 푸시 메시지 수신
self.addEventListener("push", e => {
  if (!e.data) return;
  const { title, body, icon, badge, data } = e.data.json();
  e.waitUntil(
    self.registration.showNotification(title || "AbleLink", {
      body: body || "",
      icon: icon || "/icon-192.png",
      badge: badge || "/icon-192.png",
      data,
      vibrate: [200, 100, 200],
    })
  );
});

// 알림 클릭 시 앱 열기
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("/worker/home");
    })
  );
});
