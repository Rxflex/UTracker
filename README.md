# UTracker

[https://github.com/Rxflex/UTracker](https://github.com/Rxflex/UTracker)

UTracker is a lightweight Discord bot designed to monitor Steam games for updates, patch notes, and announcements. It automatically polls the Steam API and delivers formatted notifications directly to your Discord server.

## Features

- **Real-time Monitoring**: Automatically checks for new Steam events and announcements.
- **Rich Notifications**: Delivers clean, formatted embeds with images and links.
- **Smart Parsing**: Converts Steam's BBCode into readable Discord Markdown.
- **Dual Storage**: Supports Redis for production environments or a local JSON file for simple setups.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime
- A Discord Bot Token
- (Optional) Redis server

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/Rxflex/UTracker.git
    cd UTracker
    ```

2.  **Install dependencies**
    ```bash
    bun install
    ```

3.  **Configure the bot**
    Create a `.env` file in the root directory:
    ```env
    DISCORD_TOKEN=your_bot_token
    DISCORD_CHANNEL_ID=your_channel_id
    STEAM_APP_IDS=2827200,730
    CHECK_INTERVAL_MS=300000
    REDIS_URL=redis://localhost:6379
    ```
    *Remove `REDIS_URL` to use local file storage.*

4.  **Start the bot**
    ```bash
    bun start
    ```

## Storage Configuration

UTracker automatically selects the storage backend based on your environment:

- **Redis**: Recommended for persistence. Set the `REDIS_URL` variable.
- **Local JSON**: Used automatically if `REDIS_URL` is not provided. Stores data in `storage.json`.
