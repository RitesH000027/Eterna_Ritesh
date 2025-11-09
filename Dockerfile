# Railway Simple Deployment
FROM node:18-alpine

WORKDIR /app

# Copy package file for simple deployment
COPY package-simple.json package.json

# Install only required dependencies
RUN npm install --production

# Copy demo server and supporting files
COPY examples/demo-server.js ./demo-server.js
COPY examples/demo.html ./demo.html

# Expose port
EXPOSE $PORT

# Start the demo server
CMD ["node", "demo-server.js"]