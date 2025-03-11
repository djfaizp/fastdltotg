# Download Scraper

A Docker-based application for downloading videos and uploading them to Telegram channels.

## Architecture

This application consists of two main services:

1. **App Service (download-scraper)**: A Node.js application that scrapes websites for downloadable content, processes it, and uploads it to Telegram.
2. **Aria2 Service**: A powerful download utility that handles the actual downloading of files.

## Prerequisites

- Docker and Docker Compose installed on your system
- Telegram API credentials (API ID, API Hash, and String Session)
- MongoDB instance (for storing metadata)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
TELEGRAM_STRING_SESSION=your_telegram_string_session
TELEGRAM_CHANNEL_ID=your_telegram_channel_id
ARIA2_SECRET=your_aria2_secret
MONGO_URI=your_mongodb_connection_string
```

### Environment Variables Explanation

| Variable | Description |
|----------|-------------|
| `TELEGRAM_API_ID` | Your Telegram API ID obtained from https://my.telegram.org |
| `TELEGRAM_API_HASH` | Your Telegram API Hash obtained from https://my.telegram.org |
| `TELEGRAM_STRING_SESSION` | A string session for authentication with Telegram |
| `TELEGRAM_CHANNEL_ID` | The ID of the Telegram channel where files will be uploaded |
| `ARIA2_SECRET` | Secret token for Aria2 RPC authentication |
| `MONGO_URI` | MongoDB connection string |

## Volume Mappings

| Container Path | Host Path | Purpose |
|----------------|-----------|----------|
| `/aria2/data` | `./downloads` | Directory where downloaded files are stored |
| `/app/chrome-data` | `./chrome-data` | Chrome browser data for web scraping |
| `/config` | `aria2_config` (Docker volume) | Aria2 configuration files |

## Network Configuration

The services communicate with each other through Docker's internal network:

- The app service connects to the aria2 service using the hostname `aria2` on port `6800`
- The app service exposes port `1234` to the host
- The aria2 service exposes ports `6800` (RPC), `6888` (TCP), and `6888` (UDP) to the host

## Setup Instructions

1. Clone this repository
2. Create a `.env` file with the required environment variables
3. Run the following command to start the services:

```bash
docker-compose up -d
```

4. To generate a Telegram string session (if you don't have one):

```bash
node generate_session.js
```

## Troubleshooting

### Connection Issues Between Services

If the app service cannot connect to the aria2 service:

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

### Download Issues

If downloads are failing:

1. Check the aria2 logs for errors:
   ```bash
   docker logs aria2
   ```

2. Verify the download directory permissions are correct
3. Ensure the RPC secret matches between the app and aria2 services

## Docker Compose Configuration

### App Service

- **Build**: Builds from the Dockerfile in the current directory
- **Container Name**: `download-scraper`
- **Restart Policy**: `unless-stopped` (restarts container unless manually stopped)
- **Ports**: Maps container port 1234 to host port 1234
- **User**: Runs as user with UID/GID 1000:1000
- **Dependencies**: Requires the aria2 service to be running

### Aria2 Service

- **Image**: Uses the p3terx/aria2-pro:latest image
- **Container Name**: `aria2`
- **Ports**: Exposes RPC port (6800) and BitTorrent ports (6888 TCP/UDP)
- **Environment**: Configures user permissions and RPC settings
- **Volumes**: Maps download directory and configuration volume
- **Restart Policy**: `unless-stopped`

## Maintenance

### Updating the Application

```bash
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

### Backing Up Downloaded Files

The downloaded files are stored in the `./downloads` directory. You can back them up by copying this directory.

### Clearing Chrome Data

If you encounter issues with web scraping, you may need to clear the Chrome data:

```bash
docker-compose down
rm -rf ./chrome-data/*
docker-compose up -d
```

## License

This project is proprietary software.