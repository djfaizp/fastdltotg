# Download Scraper - Comprehensive Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)
8. [Performance Optimization](#performance-optimization)
9. [Security Considerations](#security-considerations)
10. [Development Guide](#development-guide)
11. [Maintenance](#maintenance)

## Introduction

Download Scraper is a Docker-based application designed to automate the process of downloading videos from various websites and uploading them to Telegram channels. The system leverages web scraping technologies, a powerful download utility (Aria2), and the Telegram API to create a seamless pipeline for content distribution.

### Key Features

- Web scraping with Puppeteer and real browser emulation
- High-performance downloads with Aria2
- Automatic upload to Telegram channels
- MongoDB integration for metadata storage and tracking
- Docker containerization for easy deployment and scaling

## System Architecture

### Component Overview

The application consists of several interconnected components:

1. **Web Scraping Module**: Uses Puppeteer with a real browser instance to navigate websites and extract video URLs.

2. **Download Manager**: Interfaces with Aria2 to handle the actual downloading of files with optimized performance.

3. **Telegram Integration**: Provides two methods for uploading content to Telegram:
   - Native JavaScript implementation using the Telegram library
   - Python bridge for handling large files and complex uploads

4. **Database Layer**: MongoDB integration for storing metadata, tracking downloads, and managing the processing queue.

### Service Communication

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│  Web Scraping   │──────▶  Download Mgr   │──────▶  Telegram       │
│  (Puppeteer)    │      │  (Aria2)        │      │  Integration    │
│                 │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                       MongoDB Database                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Docker Container Structure

The application runs in two Docker containers:

1. **App Container (download-scraper)**:
   - Node.js application with the main business logic
   - Chromium browser for web scraping
   - Python environment for the Telegram bridge

2. **Aria2 Container**:
   - Aria2 download utility with RPC interface
   - Configured for optimal download performance
   - Handles all file download operations

## Installation

### Prerequisites

- Docker Engine (version 20.10.0 or higher)
- Docker Compose (version 2.0.0 or higher)
- Telegram account with API access
- MongoDB instance (local or cloud-based)
- At least 2GB of RAM and 10GB of free disk space

### Step-by-Step Installation

1. **Clone the Repository**

   ```bash
   git clone https://your-repository-url/download-scraper.git
   cd download-scraper
   ```

2. **Create Environment File**

   Create a `.env` file in the root directory with the following variables:

   ```
   TELEGRAM_API_ID=your_telegram_api_id
   TELEGRAM_API_HASH=your_telegram_api_hash
   TELEGRAM_STRING_SESSION=your_telegram_string_session
   TELEGRAM_CHANNEL_ID=your_telegram_channel_id
   ARIA2_SECRET=your_aria2_secret
   MONGO_URI=your_mongodb_connection_string
   ARIA2_HOST=aria2
   ARIA2_PORT=6800
   ```

3. **Generate Telegram String Session**

   If you don't have a Telegram string session, generate one using the provided script:

   ```bash
   node generate_session.js
   ```

   Follow the prompts to enter your phone number and the verification code sent to your Telegram account.

4. **Create Required Directories**

   ```bash
   mkdir -p downloads chrome-data
   ```

5. **Start the Services**

   ```bash
   docker-compose up -d
   ```

6. **Verify Installation**

   Check that both containers are running:

   ```bash
   docker-compose ps
   ```

   You should see both the `download-scraper` and `aria2` containers in the "Up" state.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_API_ID` | Yes | - | Your Telegram API ID from https://my.telegram.org |
| `TELEGRAM_API_HASH` | Yes | - | Your Telegram API Hash from https://my.telegram.org |
| `TELEGRAM_STRING_SESSION` | Yes | - | String session for Telegram authentication |
| `TELEGRAM_CHANNEL_ID` | Yes | - | ID of the Telegram channel for uploads |
| `ARIA2_SECRET` | Yes | - | Secret token for Aria2 RPC authentication |
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `ARIA2_HOST` | No | "aria2" | Hostname of the Aria2 service |
| `ARIA2_PORT` | No | 6800 | Port of the Aria2 RPC service |

### Docker Compose Configuration

The `docker-compose.yml` file defines the services, networks, and volumes for the application. Key configuration sections include:

#### App Service

```yaml
app:
  build: .
  container_name: download-scraper
  restart: unless-stopped
  ports:
    - "1234:1234"
  volumes:
    - ./downloads:/aria2/data
    - ./chrome-data:/app/chrome-data
  environment:
    - TELEGRAM_API_ID=${TELEGRAM_API_ID}
    - TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
    - TELEGRAM_STRING_SESSION=${TELEGRAM_STRING_SESSION}
    - TELEGRAM_CHANNEL_ID=${TELEGRAM_CHANNEL_ID}
    - ARIA2_SECRET=${ARIA2_SECRET}
    - MONGO_URI=${MONGO_URI}
    - ARIA2_HOST=aria2
    - ARIA2_PORT=6800
  user: "1000:1000"
  depends_on:
    - aria2
```

#### Aria2 Service

```yaml
aria2:
  image: p3terx/aria2-pro:latest
  container_name: aria2
  ports:
    - "6800:6800"
    - "6888:6888"
    - "6888:6888/udp"
  environment:
    - PUID=1000
    - PGID=1000
    - RPC_SECRET=${ARIA2_SECRET}
    - RPC_PORT=6800
  volumes:
    - ./downloads:/aria2/data
    - aria2_config:/config
  restart: unless-stopped
```

### Volume Mappings

| Container Path | Host Path | Purpose |
|----------------|-----------|----------|
| `/aria2/data` | `./downloads` | Directory where downloaded files are stored |
| `/app/chrome-data` | `./chrome-data` | Chrome browser data for web scraping |
| `/config` | `aria2_config` (Docker volume) | Aria2 configuration files |

## Usage

### Basic Operation

Once the application is running, it will automatically:

1. Scrape configured websites for downloadable content
2. Queue downloads in Aria2
3. Process completed downloads
4. Upload files to the configured Telegram channel

### Monitoring

You can monitor the application through Docker logs:

```bash
# View logs for the app container
docker logs -f download-scraper

# View logs for the aria2 container
docker logs -f aria2
```

### Manual Control

You can interact with the Aria2 RPC interface using various Aria2 clients or the built-in web interface at `http://localhost:6800/jsonrpc`.

## API Reference

### Internal Modules

#### Aria2 Module (`aria2.js`)

Handles communication with the Aria2 download service.

```javascript
// Initialize Aria2 client
const aria2Client = getAria2Client();

// Download a video
await downloadVideo(url, options);
```

#### Telegram Module (`telegram.js`)

Manages uploads to Telegram channels.

```javascript
// Upload a file to Telegram
await uploadToTelegram(filePath, caption);

// Upload a large file
await uploadLargeFileToTelegram(filePath, caption);
```

#### Database Module (`db.js`)

Handles database operations for tracking downloads and metadata.

```javascript
// Get a MongoDB collection
const collection = await getCollection('downloads');

// Process all pending posts
await processAllPosts();
```

### Python Bridge API

The application includes a Python bridge for handling complex Telegram operations:

```javascript
// Upload a file using the Python bridge
const result = await uploadToTelegram(filePath, caption);
```

## Troubleshooting

### Common Issues

#### Connection Issues Between Services

**Problem**: The app service cannot connect to the aria2 service.

**Solution**:
1. Check that both services are running:
   ```bash
   docker-compose ps
   ```

2. Verify the aria2 service is properly configured and listening on port 6800:
   ```bash
   docker logs aria2
   ```

3. Ensure the environment variables in the app service are correctly set:
   ```bash
   docker-compose config
   ```

4. Check the Docker network:
   ```bash
   docker network inspect download-scraper_default
   ```

#### Download Issues

**Problem**: Downloads are failing or stalling.

**Solution**:
1. Check the aria2 logs for errors:
   ```bash
   docker logs aria2
   ```

2. Verify the download directory permissions are correct:
   ```bash
   ls -la ./downloads
   ```

3. Ensure the RPC secret matches between the app and aria2 services.

4. Try restarting the aria2 service:
   ```bash
   docker-compose restart aria2
   ```

#### Telegram Upload Issues

**Problem**: Files are downloaded but not uploading to Telegram.

**Solution**:
1. Verify your Telegram API credentials and string session.

2. Check if the Telegram channel ID is correct.

3. Ensure the app has sufficient permissions in the Telegram channel.

4. Look for errors in the app logs:
   ```bash
   docker logs download-scraper
   ```

5. Try regenerating the string session:
   ```bash
   node generate_session.js
   ```

### Diagnostic Commands

```bash
# Check container status
docker-compose ps

# View container logs
docker logs -f download-scraper

# Check network connectivity
docker exec download-scraper ping -c 4 aria2

# Verify MongoDB connection
docker exec download-scraper node -e "const { MongoClient } = require('mongodb'); async function test() { try { const client = new MongoClient(process.env.MONGO_URI); await client.connect(); console.log('MongoDB connection successful'); await client.close(); } catch (err) { console.error('MongoDB connection failed:', err); } } test();"
```

## Performance Optimization

### Download Performance

Aria2 is configured for optimal download performance, but you can further tune it by modifying the following parameters:

- **Concurrent Downloads**: Adjust the number of simultaneous downloads.
- **Connection Per Server**: Increase the number of connections per server for faster downloads.
- **Disk Cache**: Optimize disk caching for better I/O performance.

Example configuration in `aria2.conf`:

```
max-concurrent-downloads=5
max-connection-per-server=16
disk-cache=64M
```

### Memory Usage

The application uses Chromium for web scraping, which can be memory-intensive. You can optimize memory usage by:

1. Adjusting the Chromium launch parameters in the code.
2. Implementing proper page cleanup after scraping.
3. Setting appropriate container memory limits in Docker Compose.

### Database Optimization

For better MongoDB performance:

1. Create appropriate indexes for frequently queried fields.
2. Implement a data retention policy to prevent database growth.
3. Consider using MongoDB Atlas for managed database services.

## Security Considerations

### API Credentials

- Store all API credentials securely in the `.env` file.
- Never commit the `.env` file to version control.
- Consider using Docker secrets for production deployments.

### Network Security

- The Aria2 RPC interface should not be exposed to the public internet.
- Use a secure RPC secret for Aria2 authentication.
- Consider implementing a reverse proxy with TLS for any exposed services.

### Data Protection

- Implement proper access controls for the downloaded content.
- Regularly backup the MongoDB database.
- Consider encrypting sensitive data at rest.

## Development Guide

### Setting Up Development Environment

1. Clone the repository.
2. Install Node.js and npm locally.
3. Install Python and required packages.
4. Run `npm install` to install dependencies.
5. Create a `.env` file with development configuration.

### Code Structure

```
├── src/
│   ├── index.js          # Application entry point
│   ├── aria2.js          # Aria2 integration
│   ├── db.js             # MongoDB integration
│   ├── telegram.js       # Telegram JS integration
│   ├── telegram.py       # Telegram Python implementation
│   ├── telegram_bridge.py # Python-JS bridge for Telegram
│   └── telegram_python_bridge.js # JS interface to Python bridge
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Service configuration
├── generate_session.js   # Utility for Telegram session
├── package.json          # Node.js dependencies
└── start.sh              # Startup script
```

### Adding New Features

When adding new features to the application, follow these guidelines:

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Implement the Feature**:
   - Follow the existing code style and patterns
   - Add appropriate error handling
   - Include logging for debugging

3. **Test Your Changes**:
   - Write unit tests for new functionality
   - Test the feature in a development environment
   - Verify integration with existing components

4. **Submit a Pull Request**:
   - Provide a clear description of the changes
   - Reference any related issues
   - Ensure all tests pass

### Testing

#### Unit Testing

The application uses a combination of JavaScript and Python testing frameworks:

```bash
# Run JavaScript tests
npm test

# Run Python tests
python -m unittest discover -s tests
```

#### Integration Testing

To test the full application flow:

1. Set up a test environment with Docker Compose
2. Configure test credentials in a `.env.test` file
3. Run the integration test suite:
   ```bash
   npm run test:integration
   ```

#### Manual Testing Checklist

- [ ] Verify web scraping functionality with test URLs
- [ ] Test download capabilities with various file types
- [ ] Confirm Telegram uploads work correctly
- [ ] Check database operations for metadata storage
- [ ] Validate error handling and recovery mechanisms

## Maintenance

### Updating the Application

To update the application to the latest version:

```bash
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

### Database Maintenance

#### Backup Procedure

```bash
# Backup MongoDB data
mongodump --uri="$MONGO_URI" --out=./backup/$(date +%Y-%m-%d)

# Compress the backup
tar -czvf backup-$(date +%Y-%m-%d).tar.gz ./backup/$(date +%Y-%m-%d)
```

#### Restore Procedure

```bash
# Extract backup
tar -xzvf backup-2023-01-01.tar.gz

# Restore MongoDB data
mongorestore --uri="$MONGO_URI" ./backup/2023-01-01
```

### Log Management

The application generates logs in the Docker containers. To manage logs:

1. **Rotate Logs**: Configure Docker log rotation to prevent disk space issues.

   ```bash
   # Example Docker daemon configuration
   {
     "log-driver": "json-file",
     "log-opts": {
       "max-size": "10m",
       "max-file": "3"
     }
   }
   ```

2. **Archive Logs**: Periodically archive important logs for troubleshooting.

   ```bash
   docker logs download-scraper > ./logs/app-$(date +%Y-%m-%d).log
   docker logs aria2 > ./logs/aria2-$(date +%Y-%m-%d).log
   ```

### Monitoring

Consider implementing monitoring solutions:

- **Container Health**: Use Docker health checks to monitor container status
- **Resource Usage**: Monitor CPU, memory, and disk usage
- **Application Metrics**: Track download success rates, processing times, and upload performance

### Scaling

To scale the application for higher throughput:

1. **Horizontal Scaling**: Run multiple instances of the app container
2. **Database Scaling**: Implement MongoDB sharding or replica sets
3. **Load Balancing**: Add a load balancer for distributed processing

## License

This project is proprietary software. All rights reserved.