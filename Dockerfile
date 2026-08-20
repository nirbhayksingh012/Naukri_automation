# Use the official Microsoft Playwright image with Node.js and Ubuntu Noble
FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Switch to root to set up the app directory
USER root

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Give ownership of /app to pwuser (the default non-root user in the Playwright image)
RUN chown -R pwuser:pwuser /app

# Switch back to the non-root user
USER pwuser

# Expose the server port
EXPOSE 3000

# Set Node environment
ENV NODE_ENV=production

# Start the application using xvfb-run
# xvfb-run runs a virtual X server in memory, allowing headful browsers to run
# on headless servers (which is required by the script to bypass bot detection).
CMD ["xvfb-run", "-e", "/dev/stderr", "-a", "node", "server.js"]
