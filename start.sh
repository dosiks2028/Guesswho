cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm ci; fi
npm run build && npm start
