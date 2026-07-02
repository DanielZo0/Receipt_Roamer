# Android Home Screen Shortcut Setup

## What Was Configured

Your Receipt Roamer web app now supports **Progressive Web App (PWA) shortcuts** that allow Android users to add an "Upload Receipt" icon directly to their home screen.

## How It Works

1. **Web Manifest (`public/manifest.json`)**
   - Defines your app as installable on Android
   - Includes a shortcut to `/upload` that opens the upload dialog instantly
   - When users tap the shortcut, it goes directly to the upload page

2. **Updated Root Layout (`src/routes/__root.tsx`)**
   - Added manifest link to HTML head
   - This tells Android browsers about your app

## How Users Add the Shortcut

### Method 1: Chrome on Android (Recommended)
1. Open Receipt Roamer in Chrome
2. Tap the **menu** (three dots)
3. Tap **"Install app"** or **"Add to Home screen"**
4. The app installs with an icon
5. Users can then long-press the app to create a shortcut for the "Upload Receipt" action

### Method 2: Direct Shortcut (Faster)
1. Open Receipt Roamer in Chrome
2. Tap the **menu** (three dots)
3. Tap **"Create shortcut"** → Select **"Upload Receipt"**
4. A shortcut icon is added to the home screen
5. Tapping it opens the upload page instantly

### Method 3: Samsung/Stock Android
1. Open Receipt Roamer in any browser
2. Tap menu → **"Add to Home screen"** or **"Create shortcut"**
3. Choose the **"Upload Receipt"** shortcut variant
4. Icon added to home screen

## Icons Required (Optional Enhancement)

The manifest references icons that would improve the visual appearance:
- `public/upload-icon-192.png` — Upload action icon
- `public/icon-192.png` — App icon
- `public/icon-512.png` — Large app icon
- `public/screenshot-540x720.png` — App preview screenshot

These are **optional** — the shortcut works without them, but having them provides better UX.

## Testing

**On Android (Chrome 90+):**
1. Visit `https://your-app-url`
2. Look for **"Install app"** prompt or menu option
3. Follow install steps
4. The shortcut should appear on home screen

**To verify manifest is loaded:**
1. Open Chrome DevTools (Android: `chrome://inspect`)
2. Go to **Application** tab
3. Check **Manifest** section
4. Should show "Upload Receipt" shortcut

## Technical Details

- **Shortcut URL:** `/upload` (opens the upload dialog page directly)
- **Shortcut Name:** "Upload Receipt"
- **Shortcut Type:** Android App Shortcut (Web App Manifest)
- **Browser Support:** Chrome, Edge, Firefox, Samsung Internet (Android 5.0+)

## How It's Different from a Widget

- **Web App Shortcut (What we implemented):** Uses web manifest, works instantly, no app store needed
- **Native Android Widget:** Would require Kotlin/Android development, app store submission

Our approach is simpler and requires zero native code! ✅
