# Capacitor Background GPS - Device Test Checklist

Driver-only native build. Tracking is shift-gated (start on shift, stop on end);
no startOnBoot / stopOnTerminate. Run each case on a real iPhone and a real
Android device.

## Foreground
- [ ] Start shift: dot turns live, driver_positions rows land, dispatcher map updates.
- [ ] Drive 1-2 km: breadcrumbs follow the route, spacing matches distanceFilter.

## Screen locked
- [ ] Lock screen for 10+ minutes while moving: points keep arriving.

## Backgrounded / killed
- [ ] Background the app for 1h+ (iOS): updates continue via significant-location.
- [ ] Force-kill the app (Android): foreground service resumes tracking.
- [ ] Reboot the phone: tracking does NOT silently resume (shift-gated).

## Offline
- [ ] Airplane mode, drive, then reconnect: buffered points flush; no gaps, no dupes.

## Shift boundaries
- [ ] End shift: stop() fires, no further rows after end.
- [ ] Start/stop several times: no duplicate watchers, no leaked intervals.

## Security / multi-tenant
- [ ] A driver only sees their own positions; cross-tenant read denied by RLS.
- [ ] log_gps ignores any driver_id in the payload (identity from JWT only).

## Battery
- [ ] Full work day: drain within ~8-12%/hour target; tune distanceFilter if higher.
