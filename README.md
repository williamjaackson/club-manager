# Club Manager

This project is an extenstion to the (https://github.com/williamjaackson/griffith-connect)[griffith-connect] Discord bot.

## Features

- Automated web scraping using Puppeteer to keep the CampusGroups club members list up-to-date.
- Discord Bot for auto-roling and club management.
- Redis for data caching and communication channels.
- Docker-based deployment for easy setup and scaling.

## Prerequisites

- Docker and Docker Compose
- Discord Bot Token
- myGriffith credentials
- PingID credentials
- Neon Database URL

## Project Structure

```
.
├── discord-bot/     # Discord bot service
├── puppeteer/       # Web scraping service
├── docker-compose.yaml
└── .env
```

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/williamjaackson/club-manager.git
   cd club-manager
   ```

2. Copy the environment variables template:

   ```bash
   cp .env.example .env
   ```

3. Configure your environment variables in `.env`:

   - Add your Discord Bot Token
   - Configure myGriffith credentials
   - Set up PingID credentials
   - Add your Neon Database URL

4. Start the services using Docker Compose:
   ```bash
   docker compose up -d
   ```

## Services

### Discord Bot

- Handles join events from Griffith Connect to auto-role.
- Handles join events from Campus Groups to auto-role.

### Puppeteer Service

- Performs automated web scraping
- Handles browser automation tasks
- Manages data collection

### Redis

- Provides data caching
- Manages session data
- Handles temporary storage
- Handles communication between services

## Environment Variables

Required environment variables:

- `DISCORD_TOKEN`: Your Discord Bot Token
- `STUDENT_ID`: myGriffith username
- `PASSWORD`: myGriffith password
- `OTP_ID`: PingID Device ID
- `OTP_SECRET`: PingID Secret
- `DATABASE_URL`: Neon Database connection URL

## Development

To modify or extend the project:

1. Make changes to the respective service directories
2. Rebuild the Docker containers:
   ```bash
   docker compose up --build -d
   ```
