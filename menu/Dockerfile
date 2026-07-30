# Serve the prebuilt Vite SPA as static files behind nginx.
# Build dist/ locally first (npm is proven to install here; the Fly builders
# can't due to this network's TLS interception):
#   VITE_API_URL=https://just-cake-bakery.fly.dev npm run build
FROM nginx:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
