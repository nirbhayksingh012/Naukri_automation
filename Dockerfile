# Use the official Microsoft Playwright image with Node.js and Ubuntu Noble
FROM mcr.microsoft.com/playwright:v1.62.1-noble

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

# Make the startup script executable
RUN chmod +x start.sh

# Start the application using start.sh
# This starts Xvfb in the background and then launches Node.js immediately,
# ensuring the HTTP port opens quickly for Render's health check.
CMD ["./start.sh"]
