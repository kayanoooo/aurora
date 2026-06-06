# Aurora Mobile App Preparation

## What is ready in the web client

- `client/src/services/mobileApp.ts` is the single bridge for app runtime detection, notification permission, local notifications, app badge, PWA Service Worker messages, Electron, and future Capacitor plugins.
- Capacitor native plugins are connected for app lifecycle, local notifications, push token registration, and launcher badge.
- `client/src/services/mediaSession.ts` publishes music and chat audio to the system Media Session API. This enables lock-screen controls where the platform supports them.
- `client/public/sw.js` can receive push payloads, show notifications, focus/open the app, and pass notification click data back to React.
- Chat audio, voice messages, and the playlist player are still mounted while panels are closed, so playback is not tied to a visible modal.
- `/api/push-tokens` stores per-device native push tokens. Actual remote push dispatch still needs provider keys.

## Native app commands

```bash
npm run mobile:sync
npm run mobile:android
npm run mobile:android:open
```

## Native app next steps

1. Implement real remote push:
   - Android: add Firebase project and `google-services.json`.
   - iOS: add APNs through FCM or a direct APNs provider.
   - Server-side push dispatch when a WebSocket recipient is offline/backgrounded.

2. Background behavior:
   - Keep music/voice playback through native audio session settings.
   - Do not rely on WebSocket while the app is suspended.
   - Use push notifications for messages and native background tasks only for short sync work.

3. Audio polishing:
   - Add native audio session category for playback.
   - Add route controls for call audio separately from media audio.
   - Keep voice messages in the chat mini-player, music in the system media player.

## Push payload shape

```json
{
  "title": "Aurora",
  "body": "Новое сообщение",
  "tag": "aurora-private-123",
  "chatType": "private",
  "chatId": 123,
  "senderId": 123,
  "url": "/"
}
```

For groups:

```json
{
  "title": "Название группы",
  "body": "kayano: привет",
  "tag": "aurora-group-55",
  "chatType": "group",
  "chatId": 55,
  "groupId": 55,
  "senderId": 12,
  "url": "/"
}
```
