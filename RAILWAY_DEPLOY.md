# Aurora Railway Deploy

## Backend + web on one Railway host

This Dockerfile builds the React client and serves it from FastAPI. In Railway:

1. Create a MySQL service.
2. Create an Aurora service from this repository.
3. Add the backend variables:

```env
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_DATABASE=messenger
MYSQL_USER=
MYSQL_PASSWORD=
JWT_SECRET=replace-with-at-least-32-random-characters
CORS_ORIGINS=https://your-aurora-host.up.railway.app
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Railway provides `PORT` automatically. The app listens on that port.

## Client builds for Android and desktop

Use the same Railway host for native builds:

```env
REACT_APP_API_URL=https://your-aurora-host.up.railway.app/api
REACT_APP_WS_URL=wss://your-aurora-host.up.railway.app
```

Put those values in `client/.env.production` before building Android, Linux AppImage, or Windows packages.

## Cloudinary

If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are set, uploads use Cloudinary. If they are empty, uploads fall back to local server storage.
