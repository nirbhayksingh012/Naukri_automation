# Use the official Microsoft Playwright image with Node.js and Ubuntu Noble
FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Expose the server port
EXPOSE 3000

# Set Node environment
ENV NODE_ENV=production

# Start the application using xvfb-run
# xvfb-run runs a virtual X server in memory, allowing headful browsers to run
# on headless servers (which is required by the script to bypass bot detection).
CMD ["xvfb-run", "--server-args=-screen 0 1280x800x24", "node", "server.js"]
