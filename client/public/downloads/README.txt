Release files for the Aurora landing page (download cards):

- Aurora-Android.apk    — Android (Capacitor, debug build)
- Aurora-Linux.AppImage — Linux (Electron, AppImage)
- Aurora-Windows.exe    — Windows (Electron, NSIS installer)

These exact filenames are referenced from
  client/src/components/LandingPage.tsx
and served at
  /api/downloads/Aurora-Android.apk
  /api/downloads/Aurora-Linux.AppImage
  /api/downloads/Aurora-Windows.exe
by the FastAPI backend (server/app/main.py, endpoint /api/downloads/{filename}).

The backend looks for files in:
  - client/build/downloads/         (Docker/Railway runtime)
  - client/public/downloads/        (copied here for dev; CRA copies public/ into build/ on `npm run build`)

To refresh releases:
  1. Build desktop artifacts in electron/ and Android in android/ (see Dockerfile).
  2. Copy them to this folder using the exact filenames above.
  3. Commit via Git LFS (files are listed in .gitignore for that reason).
