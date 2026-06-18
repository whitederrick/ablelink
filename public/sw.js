// public/sw.js — Able-Link Service Worker (출퇴근 알람용)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// 설치 가능(installable) 조건 충족용 fetch 핸들러.
//  Chrome/Android는 "fetch 핸들러가 등록된 서비스워커"가 있어야 beforeinstallprompt(홈 화면 추가)를
//  발생시킨다. 캐싱은 하지 않고 요청을 그대로 네트워크에 흘려보낸다(respondWith 미호출 = 기본 동작).
self.addEventListener("fetch", () => { /* no-op pass-through */ });

// 페이지 → SW 메시지로 알림 표시 (백그라운드에서도 동작)
self.addEventListener("message", e => {
  if (e.data?.type !== "SHOW_ALARM") return;
  e.waitUntil(
    self.registration.showNotification("Able-Link 알람", {
      body: e.data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate: [200, 100, 200],
      tag: "ablelink-alarm",
      renotify: true,
    })
  );
});

// 서버 Web Push 수신
self.addEventListener("push", e => {
  if (!e.data) return;
  const { title, body, icon, badge, data } = e.data.json();
  e.waitUntil(
    self.registration.showNotification(title || "Able-Link", {
      body: body || "",
      icon: icon || "/icons/icon-192.png",
      badge: badge || "/icons/icon-192.png",
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
      const focused = clients.find(c => c.url.includes("/worker/"));
      if (focused) return focused.focus();
      return self.clients.openWindow("/worker/home");
    })
  );
});
