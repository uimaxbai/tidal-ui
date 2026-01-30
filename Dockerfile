# Use a Node.js Slim image for the builder stage
FROM node:24.0.1-slim AS builder

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the source files and build the SvelteKit app
COPY . .
RUN npm run build

# Prune dependencies to production-only
RUN npm prune --production

# Use another Node.js Slim image for the final stage
FROM node:24.0.1-slim AS runner

# Set the working directory
WORKDIR /app

# Copy the built app and production node_modules from the builder stage
COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

# Expose the port the app runs on
EXPOSE 5000

# Set the environment to production
ENV NODE_ENV=production

# Specify the command to run the app
CMD ["node", "build"]
