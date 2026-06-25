self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = data.title || "The Prime Route";
  var options = {
    body: data.body || "",
    icon: "/web-app-manifest-192x192.png",
    badge: "/favicon-96x96.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/d" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/d";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
      for (var i = 0; i < cs.length; i++) {
        if (cs[i].url.indexOf(url) !== -1 && "focus" in cs[i]) return cs[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
